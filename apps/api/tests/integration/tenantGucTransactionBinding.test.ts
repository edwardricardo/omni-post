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
 *   the operation stays on the transaction's own connection.
 *
 *   ## Both shapes, because a transaction is opened in two ways
 *
 *   The spec requires the atomicity proof on BOTH shapes, and they fail for different
 *   reasons, so neither stands in for the other:
 *
 *   - **Repository-opened** — the non-unit-of-work arm of `PrismaPostRepository.save`, the
 *     arm a repository takes when no unit of work is open. Its marker comes from
 *     `withGucBoundTransaction`.
 *   - **Unit of work** — `PrismaUnitOfWork.executeInTransaction`, whose marker is adopted in
 *     the unit of work itself. Every repository inside the callback issues its writes on THAT
 *     transaction's client, so if the marker is missing each of those writes is re-wrapped
 *     onto a second pooled connection and commits through the unit of work's rollback.
 *
 *   The probe extension below records observations the shipped extension does not expose
 *   (which operations took the wrapping path, whether the marker was held at a given write)
 *   but DELEGATES the decision itself to `bindGucForOperation` — the function the shipped
 *   extension runs — so this suite cannot pass over a look-alike.
 *
 * @layer infrastructure
 */

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { Prisma, createTestPrismaClient, type PrismaClient } from "@infra/prisma";
import {
  tenantGuardExtension,
  type TenantContextProvider,
} from "@infra/prisma/extensions/tenantGuard.js";
import { isGucBound } from "@infra/prisma/extensions/tenantGuc.js";
import {
  bindGucForOperation,
  type GucBindingHost,
} from "@infra/prisma/extensions/tenantGucBinding.js";
import { PostAggregate, ProjectId } from "@core/domain/index.js";
import { PrismaPostRepository } from "../../src/infrastructure/repositories/PrismaPostRepository.js";
import { PrismaUnitOfWork } from "../../src/infrastructure/unitofwork/PrismaUnitOfWork.js";
import { withTenantContext } from "../../src/security/tenantContext.js";
import { createSeedPrismaClient } from "./helpers/seedPrismaClient.js";

/** Mutable observations the probe extension records for the assertions below. */
interface ProbeControl {
  /** When true, the nested content write is forced to fail. */
  failNestedContentCreate: boolean;
  /** `model.operation` for every operation that took the WRAPPING path. */
  wrappedOperations: string[];
  /** Whether the marker was held when the post insert reached the extension. */
  markerHeldAtPostCreate: boolean | null;
  /** Whether the marker was held at the top of the unit-of-work callback. */
  markerHeldInsideUoW: boolean | null;
}

/**
 * @function bindingProbeExtension
 * @description The SHIPPED per-operation binding, with an observation sink around it. The
 *   decision — pass through under an ambient marker, wrap in a two-statement batch otherwise,
 *   leave a scope-less operation alone — is `bindGucForOperation`, not a re-implementation of
 *   it; only the recording and the forced failure belong to the probe.
 * @param root - The client the batch transaction is opened on.
 * @param scope - Tenant scope the probe's provider reports.
 * @param control - Observation sink for the assertions.
 * @returns A Prisma extension definition.
 */
function bindingProbeExtension(root: unknown, scope: string, control: ProbeControl) {
  const client = root as GucBindingHost;
  const provider: TenantContextProvider = {
    getTenantContext: () => ({ accountId: scope }),
    getSystemContext: () => undefined,
  };
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
          if (!isGucBound()) {
            control.wrappedOperations.push(`${model}.${operation}`);
          }
          return bindGucForOperation(
            { client, args, query: query as (a: unknown) => Promise<unknown> },
            provider
          );
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
    markerHeldInsideUoW: null,
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

  it("rolls the unit of work back together with every write issued inside it", async () => {
    control.failNestedContentCreate = false;
    control.wrappedOperations = [];
    control.markerHeldAtPostCreate = null;
    control.markerHeldInsideUoW = null;

    const created = PostAggregate.create({
      projectId: ProjectId.fromStringUnsafe(projectId),
      body: "atomicity of a unit of work",
    });
    assert.ok(created.ok, "the aggregate fixture must be valid");
    const aggregate = created.value;
    createdPostIds.push(aggregate.id.value);

    const unitOfWork = new PrismaUnitOfWork(extendedClient);

    // The tenant context is bound because the unit of work resolves its own GUC scope from
    // the ambient request context, and a scope-less run would never reach the branch this
    // test is about: with no scope the binding passes everything through, so the write could
    // not escape even with the marker gone, and the assertion below would pass vacuously.
    await assert.rejects(
      withTenantContext({ accountId }, async () =>
        unitOfWork.executeInTransaction(async () => {
          control.markerHeldInsideUoW = isGucBound();
          const saveResult = await repository.save(aggregate);
          assert.ok(saveResult.ok, "the write inside the unit of work must succeed");
          throw new Error("forced failure after the write, inside the unit of work");
        })
      ),
      /forced failure after the write/,
      "the forced failure must propagate out of the unit of work"
    );

    // The row comes first deliberately: it is the HARM, and the marker is the diagnostic. A
    // suite that fails on the diagnostic never shows whether the write actually escaped.
    const survivor = await seedClient.post.findUnique({
      where: { id: aggregate.id.value },
      select: { id: true },
    });
    assert.equal(
      survivor,
      null,
      "the post row survived the unit of work's rollback: the insert escaped onto a second " +
        "connection and committed there"
    );

    assert.equal(
      control.markerHeldInsideUoW,
      true,
      "the unit of work ran without holding the marker, so every write inside it would be " +
        "re-wrapped onto a second connection"
    );
  });
});
