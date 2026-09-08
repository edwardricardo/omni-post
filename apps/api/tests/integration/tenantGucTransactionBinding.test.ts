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
import { readFileSync } from "node:fs";
import { Prisma, createTestPrismaClient, type PrismaClient } from "@infra/prisma";
import {
  tenantGuardExtension,
  type TenantContextProvider,
} from "@infra/prisma/extensions/tenantGuard.js";
import { isGucBound } from "@infra/prisma/extensions/tenantGuc.js";
import {
  bindGucForOperation,
  tenantGuardWithGucBindingExtension,
  type GucBindingHost,
} from "@infra/prisma/extensions/tenantGucBinding.js";
import { PostAggregate, ProjectId, TrackedLink } from "@core/domain/index.js";
import { PrismaPostRepository } from "../../src/infrastructure/repositories/PrismaPostRepository.js";
import { PrismaCrisisProjectRepository } from "../../src/infrastructure/repositories/PrismaCrisisProjectRepository.js";
import { PrismaProjectRepository } from "../../src/infrastructure/repositories/PrismaProjectRepository.js";
import { PrismaTrackedLinkRepository } from "../../src/infrastructure/repositories/PrismaTrackedLinkRepository.js";
import { PrismaUnitOfWork } from "../../src/infrastructure/unitofwork/PrismaUnitOfWork.js";
import { withTenantContext } from "../../src/security/tenantContext.js";
import { createSeedPrismaClient } from "./helpers/seedPrismaClient.js";
import { assertAppRoleSession, createAppRoleClient } from "./helpers/appRoleClient.js";

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

/**
 * The THIRD shape of the same class, and the one the runtime cutover surfaced: a repository
 * write issued on the BASE client while a unit of work is open.
 *
 * The marker says "the ambient transaction owns GUC adjudication, do not wrap", which is true
 * only for operations that run ON that transaction's connection. A repository method that
 * reaches for `this.prisma` instead of `PrismaUnitOfWork.getTransactionClient()` runs on a
 * different connection, where the unit of work's `set_config('app.account_id', …, true)` was
 * never issued and the per-operation binding has been told to stand down. Under a superuser
 * that write simply committed outside its caller's transaction and nothing complained — the
 * architecture canon's unit-of-work rule was violated silently. Under `omnipost_app` the
 * `tenant_isolation` policy refuses it outright: SQLSTATE 42501, "new row violates row-level
 * security policy".
 *
 * The channel is therefore the app role, through the committed session helper, so the case
 * holds on both sides of the `DATABASE_URL` cutover instead of only after it.
 */
describe("a repository write inside a unit of work runs on the transaction's connection", () => {
  const suffix = randomUUID();
  const accountId = `uow-write-acct-${suffix}`;
  const projectId = `uow-write-proj-${suffix}`;

  let seedClient: PrismaClient;
  let appRoleClient: PrismaClient;
  let guardedClient: PrismaClient;
  let unitOfWork: PrismaUnitOfWork;

  before(async () => {
    seedClient = createSeedPrismaClient();
    appRoleClient = createAppRoleClient();
    await assertAppRoleSession(appRoleClient);

    await seedClient.account.create({
      data: { id: accountId, name: "UoW write account", email: `${accountId}@example.test` },
    });
    await seedClient.project.create({
      data: { id: projectId, accountId, name: "UoW write project", locale: "en" },
    });

    guardedClient = appRoleClient.$extends(
      tenantGuardWithGucBindingExtension(appRoleClient, {
        getTenantContext: () => ({ accountId }),
        getSystemContext: () => undefined,
      })
    ) as unknown as PrismaClient;
    unitOfWork = new PrismaUnitOfWork(guardedClient);
  });

  after(async () => {
    await seedClient.trackedLink.deleteMany({ where: { accountId } });
    await seedClient.project.deleteMany({ where: { id: projectId } });
    await seedClient.account.deleteMany({ where: { id: accountId } });
    await seedClient.$disconnect();
    await appRoleClient.$disconnect();
  });

  it("persists a project through the unit of work instead of failing the tenant policy", async () => {
    const repository = new PrismaProjectRepository(guardedClient);

    await withTenantContext({ accountId }, async () => {
      const found = await repository.findById(ProjectId.fromStringUnsafe(projectId));
      assert.ok(found.ok, "the seeded project must be readable under a bound tenant context");

      const project = found.value;
      assert.ok(project.enterCrisisMode("unit-of-work write channel"), "fixture precondition");

      await unitOfWork.executeInTransaction(async () => {
        const saved = await repository.save(project);
        assert.ok(
          saved.ok,
          "the save was refused inside the unit of work: it ran on the base client, on a " +
            "connection the unit of work never bound `app.account_id` on, so the tenant " +
            `policy rejected the row (${saved.ok ? "" : String(saved.error).slice(0, 200)})`
        );
      });
    });

    const persisted = await seedClient.project.findUnique({
      where: { id: projectId },
      select: { isInCrisisMode: true },
    });
    assert.equal(persisted?.isInCrisisMode, true, "the committed row does not carry the write");
  });

  it("persists a crisis-mode change through the unit of work instead of failing the tenant policy", async () => {
    const repository = new PrismaCrisisProjectRepository(guardedClient);

    await withTenantContext({ accountId }, async () => {
      const found = await repository.findById(ProjectId.fromStringUnsafe(projectId));
      assert.ok(found.ok, "the seeded project must be readable under a bound tenant context");

      const project = found.value;
      assert.ok(project.exitCrisisMode(), "fixture precondition: the project is in crisis mode");

      await unitOfWork.executeInTransaction(async () => {
        const saved = await repository.save(project);
        assert.ok(
          saved.ok,
          "the save was refused inside the unit of work: it ran on the base client, where the " +
            "tenant policy hides the row the UPDATE targets " +
            `(${saved.ok ? "" : String(saved.error).slice(0, 200)})`
        );
      });
    });

    const persisted = await seedClient.project.findUnique({
      where: { id: projectId },
      select: { isInCrisisMode: true },
    });
    assert.equal(persisted?.isInCrisisMode, false, "the committed row does not carry the write");
  });

  it("persists a tracked link through the unit of work instead of failing the tenant policy", async () => {
    const repository = new PrismaTrackedLinkRepository(guardedClient);

    const created = TrackedLink.create({
      accountId,
      projectId: ProjectId.fromStringUnsafe(projectId),
      originalUrl: "https://example.test/unit-of-work-write-channel",
    });
    assert.ok(created.ok, "the tracked-link fixture must be valid");
    const link = created.value;

    await withTenantContext({ accountId }, async () => {
      await unitOfWork.executeInTransaction(async () => {
        const saved = await repository.save(link);
        assert.ok(
          saved.ok,
          "the save was refused inside the unit of work: it ran on the base client, outside " +
            "the transaction that bound the tenant " +
            `(${saved.ok ? "" : String(saved.error).slice(0, 200)})`
        );
      });
    });

    const persisted = await seedClient.trackedLink.findUnique({
      where: { id: link.id.value },
      select: { id: true },
    });
    assert.notEqual(persisted, null, "the tracked link was not committed by the unit of work");
  });
});

describe("scheduler tick tenant scope — node:test pin", () => {
  // Second, collector-independent pin for the bound-scope invariant on the bootstrap's
  // recurring ticks. The exhaustive gate (exact spans, per-tick reason naming) lives in
  // tests/unit/bootstrap/schedulerTickTenantScope.test.ts under the vitest tier; that tier's
  // reachability rests on its config's include globs, so this batch — explicitly named in
  // run-tests.sh and therefore held by fitness #30 — pins the CLASS-level invariant too. A
  // vitest include regression now disables one of two guards, not the only one.
  it("every scheduler.register tick in the bootstrap declares a system: scope within its callback window", () => {
    const bootstrapUrl = new URL("../../src/index.ts", import.meta.url);
    const lines = readFileSync(bootstrapUrl, "utf8").split("\n");
    const MINIMUM_TICKS = 9;
    const WINDOW = 8;
    const unscoped: string[] = [];
    let ticks = 0;
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i] ?? "";
      if (!line.includes("scheduler.register(") || line.trimStart().startsWith("//")) continue;
      ticks += 1;
      const window = lines.slice(i, i + WINDOW).join("\n");
      if (!window.includes('withSystemContext("system:')) {
        unscoped.push(`src/index.ts:${i + 1}: ${line.trim()}`);
      }
    }
    assert.ok(
      ticks >= MINIMUM_TICKS,
      `non-vacuity floor: found ${ticks} scheduler.register ticks against a floor of ${MINIMUM_TICKS} — the call shape moved and this scan stopped seeing it`
    );
    assert.deepEqual(
      unscoped,
      [],
      'every recurring tick must declare its cross-account sweep via withSystemContext("system:...") inside its callback'
    );
  });
});
