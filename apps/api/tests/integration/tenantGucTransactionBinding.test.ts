/**
 * @file tenantGucTransactionBinding.test.ts
 * @description Real-database proof that a transaction opened by a REPOSITORY — not by the
 *   unit of work — keeps its atomicity once every model operation on the extended client is
 *   wrapped in its own GUC-binding transaction.
 *
 *   ## The class this pins
 *
 *   Binding `app.account_id` per operation means an operation that runs with no ambient
 *   marker opens a transaction of its own. Transactions are connection-scoped, so an
 *   operation that fires from INSIDE another transaction and gets wrapped that way checks
 *   out a SECOND pooled connection and commits on it — through its caller's rollback. That
 *   is measurable, and it was measured before this suite was written: a post row created
 *   inside a repository-opened transaction SURVIVED that transaction's rollback.
 *
 *   The closure is an AsyncLocalStorage marker: a transaction that owns GUC adjudication
 *   holds it, and the binding recognises it and passes the operation straight through, so
 *   the operation stays on the transaction's own connection. This suite drives the
 *   non-unit-of-work arm of `PrismaPostRepository.save` — the arm a repository takes when
 *   no unit of work is open — and asserts BOTH halves: the write and the forced failure
 *   roll back together, and no operation inside that transaction takes the wrapping path.
 *
 *   The binding extension itself lands in the next link; the probe extension below has the
 *   same shape (bind-then-query in one batch transaction, pass through when the marker is
 *   held) so this suite fails for the escape rather than for a missing composition.
 *
 * @layer infrastructure
 */

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { Prisma, createTestPrismaClient, type PrismaClient } from "@infra/prisma";
import { tenantGuardExtension } from "@infra/prisma/extensions/tenantGuard.js";
import { isGucBound } from "@infra/prisma/extensions/tenantGuc.js";
import { PostAggregate, ProjectId } from "@core/domain/index.js";
import { PrismaPostRepository } from "../../src/infrastructure/repositories/PrismaPostRepository.js";
import { createSeedPrismaClient } from "./helpers/seedPrismaClient.js";

/** Mutable observations the probe extension records for the assertions below. */
interface ProbeControl {
  /** When true, the nested content write is forced to fail. */
  failNestedContentCreate: boolean;
  /** `model.operation` for every operation that took the WRAPPING path. */
  wrappedOperations: string[];
  /** Whether the marker was held when the post insert reached the extension. */
  markerHeldAtPostCreate: boolean | null;
}

/**
 * Batch-transaction client surface. Structural because the batch overload of
 * `$transaction` is what the binding uses, and the nominal generated types do not unify
 * across the app's client and this package's own instantiation.
 */
interface BatchTransactionClient {
  $transaction(operations: unknown[]): Promise<unknown[]>;
  $executeRaw(query: TemplateStringsArray, ...values: unknown[]): unknown;
}

/**
 * @function bindingProbeExtension
 * @description Same shape as the request-scoped binding this workstream lands next: bind
 *   `app.account_id` and run the operation in ONE batch transaction, unless an ambient
 *   transaction already owns GUC adjudication, in which case the operation passes through
 *   untouched and stays on that transaction's connection.
 * @param root - The client the batch transaction is opened on.
 * @param scope - Tenant scope bound before the wrapped operation runs.
 * @param control - Observation sink for the assertions.
 * @returns A Prisma extension definition.
 */
function bindingProbeExtension(root: unknown, scope: string, control: ProbeControl) {
  const client = root as BatchTransactionClient;
  return Prisma.defineExtension({
    name: "tenantGucBindingProbe",
    query: {
      $allModels: {
        async $allOperations({ model, operation, query, args }) {
          if (model === "Post" && operation === "create") {
            control.markerHeldAtPostCreate = isGucBound();
          }
          if (
            control.failNestedContentCreate &&
            model === "PostContent" &&
            operation === "create"
          ) {
            throw new Error("forced failure on the nested content write");
          }
          if (isGucBound()) {
            return query(args);
          }
          control.wrappedOperations.push(`${model}.${operation}`);
          const results = await client.$transaction([
            client.$executeRaw`SELECT set_config('app.account_id', ${scope}, true)`,
            query(args),
          ]);
          return results[results.length - 1];
        },
      },
    },
  });
}

describe("GUC binding and a repository-opened transaction", () => {
  const suffix = randomUUID();
  const accountId = `guc-tx-acct-${suffix}`;
  const projectId = `guc-tx-proj-${suffix}`;
  const createdPostIds: string[] = [];

  let seedClient: PrismaClient;
  let applicationClient: PrismaClient;
  let extendedClient: PrismaClient;
  let repository: PrismaPostRepository;

  const control: ProbeControl = {
    failNestedContentCreate: false,
    wrappedOperations: [],
    markerHeldAtPostCreate: null,
  };

  before(async () => {
    seedClient = createSeedPrismaClient();
    applicationClient = createTestPrismaClient();

    await seedClient.account.create({
      data: { id: accountId, name: "GUC tx account", email: `${accountId}@example.test` },
    });
    await seedClient.project.create({
      data: { id: projectId, accountId, name: "GUC tx project", locale: "en" },
    });

    const guarded = applicationClient.$extends(
      tenantGuardExtension({
        getTenantContext: () => ({ accountId }),
        getSystemContext: () => undefined,
      })
    );
    extendedClient = guarded.$extends(
      bindingProbeExtension(guarded, accountId, control)
    ) as unknown as PrismaClient;
    repository = new PrismaPostRepository(extendedClient);
  });

  after(async () => {
    if (createdPostIds.length > 0) {
      await seedClient.postMedia.deleteMany({ where: { postId: { in: createdPostIds } } });
      await seedClient.postContent.deleteMany({ where: { postId: { in: createdPostIds } } });
      await seedClient.post.deleteMany({ where: { id: { in: createdPostIds } } });
    }
    await seedClient.post.deleteMany({ where: { projectId } });
    await seedClient.project.deleteMany({ where: { id: projectId } });
    await seedClient.account.deleteMany({ where: { id: accountId } });
    await seedClient.$disconnect();
    await applicationClient.$disconnect();
  });

  it("rolls the post back when the nested content write fails inside the repository transaction", async () => {
    control.failNestedContentCreate = true;
    control.wrappedOperations = [];
    control.markerHeldAtPostCreate = null;

    const created = PostAggregate.create({
      projectId: ProjectId.fromStringUnsafe(projectId),
      body: "atomicity of a repository-opened transaction",
    });
    assert.ok(created.ok, "the aggregate fixture must be valid");
    const aggregate = created.value;
    createdPostIds.push(aggregate.id.value);

    const saveResult = await repository.save(aggregate);
    assert.equal(saveResult.ok, false, "the forced nested failure must surface as an error");

    const survivor = await seedClient.post.findUnique({
      where: { id: aggregate.id.value },
      select: { id: true },
    });
    assert.equal(
      survivor,
      null,
      "the post row survived its own transaction's rollback: the insert escaped onto a " +
        "second connection and committed there"
    );
  });

  it("keeps operations inside the repository transaction on that transaction's connection", async () => {
    control.failNestedContentCreate = false;
    control.wrappedOperations = [];
    control.markerHeldAtPostCreate = null;

    const created = PostAggregate.create({
      projectId: ProjectId.fromStringUnsafe(projectId),
      body: "marker held for the whole repository transaction",
    });
    assert.ok(created.ok, "the aggregate fixture must be valid");
    const aggregate = created.value;
    createdPostIds.push(aggregate.id.value);

    const saveResult = await repository.save(aggregate);
    assert.ok(saveResult.ok, "the save must succeed when nothing is forced to fail");

    assert.equal(
      control.markerHeldAtPostCreate,
      true,
      "the post insert ran without the ambient marker, so the binding would wrap it"
    );
    assert.equal(
      control.wrappedOperations.includes("Post.create"),
      false,
      "the post insert took the wrapping path from inside a transaction that owns its connection"
    );
    assert.equal(
      control.wrappedOperations.includes("PostContent.create"),
      false,
      "the content insert took the wrapping path from inside a transaction that owns its connection"
    );

    const persisted = await seedClient.post.findUnique({
      where: { id: aggregate.id.value },
      select: { id: true },
    });
    assert.notEqual(persisted, null, "the successful save must be committed");
  });
});
