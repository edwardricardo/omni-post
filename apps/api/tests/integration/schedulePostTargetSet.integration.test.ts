/**
 * @file schedulePostTargetSet.integration.test.ts
 * @description REC-1 against a real database: scheduling a post PERSISTS one publication
 *   record per intended channel, and that record set — not the saga row, not the queue,
 *   not `PublishLog` — is the system's answer to "where was this post meant to go".
 *
 *   The three scenarios here are the requirement's own `[integration]` ones, proved at the
 *   SCHEDULE tip, which is where the writer being added lives. What each one is worth:
 *
 *   - Scenario 1 (one record per intended channel): FULL.
 *   - Scenario 2 (the target set OUTLIVES the saga): FULL — a terminal saga row is seeded
 *     for the post and the records are then read without it. An earlier version asserted
 *     that NO saga row existed, which is a different and weaker claim: "never had one"
 *     cannot distinguish surviving the coordinator from being read before it started.
 *   - Scenario 3 (a channel that never ran is recorded, not missing): WEAKENED, and said
 *     so rather than implied. It is exercised in its schedule-time form — no job has run
 *     for ANY channel yet. Its real form is a MIXED state, where one channel of a real
 *     publish reported and another never did, and that needs the worker's attempt writes
 *     (order 10). A scenario asserted in a weaker form than its text is half-proved.
 * @layer infrastructure
 */

import { describe, it, before, after } from "node:test";
import { randomUUID } from "node:crypto";
import assert from "node:assert/strict";
import { PrismaPostRepository, PrismaUnitOfWork } from "@adapters/db-prisma";
import { SchedulePostUseCase } from "@core/posts/SchedulePostUseCase.js";
import { PostAggregate, ProjectId, ChannelId } from "@core/domain/index.js";
import {
  ambientTenantContextProvider,
  withTenantContext,
} from "../../src/security/tenantContext.js";
import { createSeedPrismaClient } from "./helpers/seedPrismaClient.js";

const prisma = createSeedPrismaClient();

describe("REC-1 — scheduling records the intended target set", () => {
  let useCase: SchedulePostUseCase;
  let repository: PrismaPostRepository;
  let accountId: string;
  let projectId: string;
  let channelIds: string[];
  const createdPostIds: string[] = [];
  const createdSagaIds: string[] = [];

  const asTenant = <T>(fn: () => Promise<T>): Promise<T> => withTenantContext({ accountId }, fn);

  /** Creates a DRAFT post in the database and returns its id. */
  const seedDraft = async (): Promise<string> => {
    const created = PostAggregate.create({
      projectId: ProjectId.fromStringUnsafe(projectId),
      body: "scheduled body",
    });
    assert.ok(created.ok, "the fixture post must build");
    const post = created.value;
    const saved = await asTenant(() => repository.save(post));
    assert.ok(saved.ok, "the fixture post must persist");
    createdPostIds.push(post.id.value);
    return post.id.value;
  };

  const scheduleTo = async (postId: string, targets: string[]) =>
    asTenant(() =>
      useCase.execute({
        postId,
        channelIds: targets,
        scheduledFor: new Date(Date.now() + 7_200_000).toISOString(),
      })
    );

  before(async () => {
    // randomUUID, not Date.now(): two runs started in the same millisecond — a retry, or
    // a parallel runner — would collide on the account's primary key and the second
    // would fail in its `before` hook, which cancels every case in the file.
    const suffix = randomUUID();
    accountId = `rec1-account-${suffix}`;
    projectId = `rec1-project-${suffix}`;

    await prisma.account.create({
      data: { id: accountId, email: `rec1-${suffix}@example.test`, name: "REC-1 Account" },
    });
    await prisma.project.create({
      data: { id: projectId, name: `REC-1 Project ${suffix}`, accountId, locale: "en" },
    });

    // Real Channel rows: the publication record carries a foreign key to the channel, so
    // a double here would prove the write against a constraint the database does not have.
    channelIds = [];
    for (const index of [1, 2, 3]) {
      const channel = await prisma.channel.create({
        data: {
          accountId,
          projectId,
          provider: "X",
          handle: `@rec1-${suffix}-${index}`,
          credentialsCiphertext: "ct",
          credentialsIv: "iv",
          credentialsAuthTag: "tag",
        },
      });
      channelIds.push(channel.id);
    }

    repository = new PrismaPostRepository(prisma, undefined, ambientTenantContextProvider);
    useCase = new SchedulePostUseCase(
      repository,
      // The dispatcher and the metrics port are doubles on purpose: this suite's subject
      // is what the DATABASE holds after the command commits, and neither of them writes
      // to it.
      { dispatch: async () => {}, dispatchAll: async () => {}, register: () => {} } as never,
      {
        findById: async (channelId: ChannelId) => {
          const row = await prisma.channel.findFirst({ where: { id: channelId.value } });
          return row === null
            ? { ok: false as const, error: new Error(`no channel ${channelId.value}`) }
            : { ok: true as const, value: row };
        },
      } as never,
      {
        incrementPostCreated: () => {},
        incrementPostPublished: () => {},
        incrementPostDeleted: () => {},
      } as never,
      new PrismaUnitOfWork(prisma, ambientTenantContextProvider)
    );
  });

  after(async () => {
    // Each step is attempted even when an earlier one fails — a leftover child row must
    // not stop the parents from being tried — but NOTHING is swallowed. A silent cleanup
    // leaves rows behind that the next run inherits, and the run that inherits them is
    // the one that looks broken (CODING_STANDARDS: empty catch blocks, zero tolerance).
    const failures: string[] = [];
    const attempt = async (what: string, run: () => Promise<unknown>): Promise<void> => {
      try {
        await run();
      } catch (error: unknown) {
        failures.push(`${what}: ${error instanceof Error ? error.message : String(error)}`);
      }
    };

    await attempt("sagaInstance", () =>
      prisma.sagaInstance.deleteMany({ where: { id: { in: createdSagaIds } } })
    );
    await attempt("postChannelPublication", () =>
      prisma.postChannelPublication.deleteMany({ where: { postId: { in: createdPostIds } } })
    );
    await attempt("postContent", () =>
      prisma.postContent.deleteMany({ where: { postId: { in: createdPostIds } } })
    );
    await attempt("post", () => prisma.post.deleteMany({ where: { id: { in: createdPostIds } } }));
    await attempt("channel", () => prisma.channel.deleteMany({ where: { projectId } }));
    await attempt("project", () => prisma.project.deleteMany({ where: { id: projectId } }));
    await attempt("account", () => prisma.account.deleteMany({ where: { id: accountId } }));

    await prisma.$disconnect();

    if (failures.length > 0) {
      assert.fail(`cleanup left rows behind:\n  ${failures.join("\n  ")}`);
    }
  });

  it("persists one record per intended channel, each unresolved", async () => {
    const postId = await seedDraft();

    const result = await scheduleTo(postId, channelIds);

    assert.ok(result.ok, "the schedule command commits");
    const rows = await prisma.postChannelPublication.findMany({
      where: { postId },
      orderBy: { channelId: "asc" },
    });
    assert.strictEqual(rows.length, 3, "exactly three records, one per intended channel");
    assert.deepStrictEqual(
      rows.map((row) => row.channelId).sort(),
      [...channelIds].sort(),
      "one per intended channelId"
    );
    assert.ok(
      rows.every((row) => row.outcome === "UNRESOLVED"),
      "each record is in an unresolved outcome"
    );
    assert.ok(
      rows.every((row) => row.accountId === accountId),
      "each record lands in the post's tenant"
    );
  });

  it("answers the intended set and every outcome AFTER its saga reached a terminal state", async () => {
    const postId = await seedDraft();
    await scheduleTo(postId, channelIds);

    // The scenario says OUTLIVES a saga, so a saga has to have existed and ENDED. An
    // earlier version of this case asserted `count === 0` — "never had one" — which is a
    // different and weaker claim: it cannot distinguish a record set that survives the
    // coordinator from one that was simply read before the coordinator started.
    const sagaId = `publish-${postId}`;
    await prisma.sagaInstance.create({
      data: {
        id: sagaId,
        definitionId: "post-publishing-saga",
        status: "COMPLETED",
        currentStep: 4,
        context: { postId, accountId },
        accountId,
        completedAt: new Date(),
      },
    });
    createdSagaIds.push(sagaId);
    const saga = await prisma.sagaInstance.findFirst({ where: { id: sagaId } });
    assert.strictEqual(saga?.status, "COMPLETED", "the saga is in a terminal state");

    // Read WITHOUT consulting that row: the query names the post, not the saga.
    const rows = await prisma.postChannelPublication.findMany({ where: { postId } });
    assert.strictEqual(rows.length, 3, "the intended set is answerable in full");
    assert.deepStrictEqual(
      rows.map((row) => row.channelId).sort(),
      [...channelIds].sort(),
      "the intended channel set outlives the saga"
    );
    assert.ok(
      rows.every((row) => row.outcome === "UNRESOLVED" && row.episode === 0),
      "every per-channel outcome is answerable, at the pre-publication episode"
    );
  });

  it("records a channel that has not run rather than leaving it missing", async () => {
    const postId = await seedDraft();

    await scheduleTo(postId, channelIds);

    // No attempt has been recorded for any channel, which is precisely the state in
    // which "absence of a record" would otherwise be the only representation available.
    const rows = await prisma.postChannelPublication.findMany({ where: { postId } });
    assert.strictEqual(rows.length, channelIds.length);
    for (const channelId of channelIds) {
      const row = rows.find((candidate) => candidate.channelId === channelId);
      assert.ok(row, `channel ${channelId} has a record rather than being absent`);
      assert.strictEqual(row.outcome, "UNRESOLVED");
      assert.strictEqual(row.attempts, 0, "a channel that never ran has no attempts");
      assert.strictEqual(row.publishedAt, null);
    }
  });
});
