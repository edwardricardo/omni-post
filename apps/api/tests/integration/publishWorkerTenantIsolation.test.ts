/**
 * @file publishWorkerTenantIsolation.test.ts
 * @description MERGE-BLOCKING two-tenant publish regression for the worker
 *   tenant scoping, exercised against a REAL database with the REAL worker
 *   collaborators (`CredentialResolver`, `ChannelAuthFailureRecorder`,
 *   `PublishHandler`) wired over the production `createPrismaRepoAdapter`.
 *
 *   Workers run the raw Prisma client — the API's `$extends` tenant guard is
 *   not in their process and PostgreSQL RLS is inert while the connection role
 *   bypasses it — so the explicit `accountId` predicate threaded through every
 *   worker channel access IS the active isolation layer. This suite proves it
 *   end to end:
 *
 *     - own-tenant job: credentials resolve, the provider receives the tenant's
 *       plaintext token, and the publish log lands OK;
 *     - foreign `(channelId, accountId)` pair: the job dies at the publication
 *       record read, which is the first tenant-bound read and the one tenant B
 *       cannot satisfy over tenant A's post. The credential resolver is never
 *       reached, so the failure is no longer AUTH and no log row is written at
 *       all; the thrown message carries no plaintext, the provider is never
 *       invoked, NOTHING is decrypted (the decrypt callback is never entered),
 *       and the victim channel's record and reauth state are both untouched.
 *       The resolver's own AUTH path is covered directly by the
 *       "credential resolution is confined to the caller's tenant" block below;
 *     - payload without `accountId`: the job is REFUSED. The owner lookup that
 *       used to resolve the channel's tenant is gone — resolving a tenant the
 *       job did not name is the one thing a job that predates the publication
 *       record must not be allowed to do;
 *     - reauth recorder: a foreign tenant flips no flag and emits no outbox
 *       event, while the owner flips both.
 *
 *   Every publish job here carries a minted job id and an OPENED episode, because
 *   that is what a publish job is now: the worker reads the publication record
 *   before it calls a provider, and a job naming an episode nobody opened is
 *   content addressed at nothing.
 *
 *   It lives under `apps/api/tests/integration/` (node:test, real DB) rather
 *   than `apps/workers/tests/` because the worker vitest suite runs in CI
 *   without database services, and it drives worker code through the same
 *   relative-import seam `publish.flow.test.ts` already uses.
 *
 * @layer infrastructure
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID, randomBytes } from "node:crypto";
import { type PrismaClient } from "@infra/prisma";
import { createSeedPrismaClient } from "./helpers/seedPrismaClient.js";
import { createPrismaRepoAdapter } from "@adapters/db-prisma";
import { PUBLICATION_OUTCOME_KINDS } from "@core/domain/index.js";
import {
  encryptChannelCredentials,
  decryptChannelCredentials,
  mintPublishJobId,
  readPublishJobId,
  type EncryptedChannelCredentialsEnvelope,
} from "@shared/types";
import {
  createPublishWorkerHarness,
  type PublishWorkerHarness,
} from "./helpers/publishWorkerHarness.js";
import { CredentialResolver } from "../../../../apps/workers/src/services/CredentialResolver.js";
import { ChannelAuthFailureRecorder } from "../../../../apps/workers/src/services/ChannelAuthFailureRecorder.js";
import { PublishHandler } from "../../../../apps/workers/src/publishHandler.js";
import type {
  PublishJobInput,
  PublishProvider,
} from "../../../../apps/workers/src/publishHandlerTypes.js";
import {
  createMockProvider,
  createMockInstrumentation,
  createMockDatabaseInstrumentation,
  createMockBusinessKPITracker,
  createTestWorkerMetrics,
  createSilentLogger,
} from "../../../../apps/workers/tests/setup.js";

const TAG = `pub-iso-${Date.now()}`;

// Test-local key: the suite encrypts the seeded envelopes and injects the
// matching decrypt callback, so the assertions never depend on the deployment
// key material.
const TEST_KEY = randomBytes(32).toString("base64");

interface Seeded {
  accountId: string;
  projectId: string;
  channelId: string;
  token: string;
}

describe("Publish worker — two-tenant isolation (MERGE-BLOCKING)", { concurrency: 1 }, () => {
  let base: PrismaClient;
  let repo: ReturnType<typeof createPrismaRepoAdapter>;
  let resolver: CredentialResolver;
  let recorder: ChannelAuthFailureRecorder;
  let harness: PublishWorkerHarness;

  let tenantA: Seeded;
  let tenantB: Seeded;
  let postId: string;

  /** Counts entries into the decrypt callback — the "nothing decrypted" probe. */
  let decryptions = 0;
  /** Credentials every provider invocation received, in order. */
  let providerCredentials: unknown[] = [];

  function buildProvider(): PublishProvider {
    const mock = createMockProvider();
    return {
      ...mock,
      publish: async (input, credentials) => {
        providerCredentials.push(credentials);
        return mock.publish(input, credentials);
      },
    };
  }

  function buildHandler(): PublishHandler {
    return new PublishHandler({
      repo,
      providerRegistry: { x: buildProvider() },
      credentialResolver: resolver,
      workerMetrics: createTestWorkerMetrics(),
      logger: createSilentLogger(),
      instrumentation: createMockInstrumentation(),
      databaseInstrumentation: createMockDatabaseInstrumentation(),
      businessKPITracker: createMockBusinessKPITracker(),
      outcomeRecorder: harness.outcomeRecorder,
      publicationRecord: harness.publicationRecord,
    });
  }

  async function seedTenant(name: string): Promise<Seeded> {
    const account = await base.account.create({
      data: {
        name: `${TAG}-${name}`,
        email: `${TAG}-${name}-${randomUUID()}@test.local`,
        slug: `${TAG}-${name}-${randomUUID()}`,
      },
    });
    const project = await base.project.create({
      data: { accountId: account.id, name: `${TAG}-${name}-project` },
    });
    const token = `tok-${name}-${randomUUID()}`;
    const envelope = encryptChannelCredentials({ accessToken: token }, TEST_KEY);
    const channel = await base.channel.create({
      data: {
        projectId: project.id,
        accountId: account.id,
        provider: "X",
        handle: `${TAG}-${name}-handle`,
        ...envelope,
      },
    });
    return { accountId: account.id, projectId: project.id, channelId: channel.id, token };
  }

  before(async () => {
    base = createSeedPrismaClient();

    tenantA = await seedTenant("A");
    tenantB = await seedTenant("B");

    repo = createPrismaRepoAdapter({
      prisma: base,
      decryptChannelCredentials: (envelope: EncryptedChannelCredentialsEnvelope) => {
        decryptions += 1;
        return decryptChannelCredentials(envelope, TEST_KEY);
      },
    });
    resolver = new CredentialResolver(repo);
    recorder = new ChannelAuthFailureRecorder({ prisma: base });
    harness = createPublishWorkerHarness(base);

    const post = await repo.createPost({
      projectId: tenantA.projectId,
      locale: "es",
      body: `${TAG} body`,
    });
    assert.ok(post.ok, "seed post must be created");
    postId = post.value.id;
  });

  after(async () => {
    const channelIds = [tenantA.channelId, tenantB.channelId];
    const projectIds = [tenantA.projectId, tenantB.projectId];
    const accountIds = [tenantA.accountId, tenantB.accountId];
    // FK order: publish logs → publication records → outbox events → posts →
    // channels → projects → accounts.
    await base.publishLog
      .deleteMany({ where: { channelId: { in: channelIds } } })
      .catch(() => undefined);
    await base.postChannelPublication
      .deleteMany({ where: { channelId: { in: channelIds } } })
      .catch(() => undefined);
    await base.outboxEvent
      .deleteMany({ where: { aggregateId: { in: channelIds } } })
      .catch(() => undefined);
    await base.post.deleteMany({ where: { projectId: { in: projectIds } } }).catch(() => undefined);
    await base.channel.deleteMany({ where: { id: { in: channelIds } } }).catch(() => undefined);
    await base.project.deleteMany({ where: { id: { in: projectIds } } }).catch(() => undefined);
    await base.account.deleteMany({ where: { id: { in: accountIds } } }).catch(() => undefined);
    await repo.close();
  });

  describe("credential resolution is confined to the caller's tenant", () => {
    it("resolves each tenant's own channel to its own plaintext credentials", async () => {
      const ownA = await resolver.resolve(tenantA.channelId, tenantA.accountId);
      assert.ok(ownA.ok, "tenant A must resolve its own channel");
      assert.deepStrictEqual(ownA.value, { accessToken: tenantA.token });

      const ownB = await resolver.resolve(tenantB.channelId, tenantB.accountId);
      assert.ok(ownB.ok, "tenant B must resolve its own channel");
      assert.deepStrictEqual(ownB.value, { accessToken: tenantB.token });
    });

    it("returns AUTH and decrypts nothing when the tenant does not own the channel", async () => {
      const decryptionsBefore = decryptions;

      const foreign = await resolver.resolve(tenantA.channelId, tenantB.accountId);

      assert.strictEqual(foreign.ok, false, "a foreign tenant must not resolve credentials");
      if (!foreign.ok) {
        assert.strictEqual(foreign.error, "AUTH");
      }
      assert.strictEqual(
        decryptions,
        decryptionsBefore,
        "the scoped query returns no row, so no envelope may be decrypted"
      );
    });
  });

  describe("publish jobs", () => {
    /** The ordinal the owning tenant's episode was opened at; every job id carries it. */
    let ownEpisode: number;

    // Opened once for the block rather than inside the first case. Read from a
    // sibling it would be `undefined` in any filtered run, minting an id ending
    // `-eundefined`; the handler refuses an unreadable id and an absent tenant
    // through the SAME guard, so the third case would pass for a cause it does
    // not test while its own comment claimed otherwise.
    before(async () => {
      ownEpisode = await harness.openEpisode({
        accountId: tenantA.accountId,
        postId,
        channelIds: [tenantA.channelId],
      });
    });

    it("publishes with the owning tenant's credentials and logs OK", async () => {
      providerCredentials = [];
      const jobId = mintPublishJobId({ postId, channelId: tenantA.channelId, episode: ownEpisode });

      await buildHandler().handleJob({
        payload: { postId, channelId: tenantA.channelId, accountId: tenantA.accountId },
        dedupeKey: jobId,
        attemptsMade: 0,
      });

      assert.deepStrictEqual(
        providerCredentials,
        [{ accessToken: tenantA.token }],
        "the provider must receive exactly the owning tenant's credentials"
      );

      // The receipt mirror is keyed by the job id with its episode suffix removed,
      // so the key is read back through the same reader the worker used rather
      // than rebuilt here — a second derivation is what this change exists to end.
      const identity = readPublishJobId(jobId);
      assert.ok(identity, "the minted job id must name an episode");
      const okLog = await base.publishLog.findFirst({
        where: { dedupeKey: identity.mirrorKey, status: "OK" },
      });
      assert.ok(okLog, "an OK publish log must be written");
      assert.strictEqual(okLog.channelId, tenantA.channelId);

      // The record the mirror mirrors. `recordOutcome` returns false rather than
      // throwing when the record write fails, and `writeReceiptMirror` runs
      // unconditionally after it — so a mirror row is written whether or not the
      // record was. Asserting the mirror alone passes with the record writer
      // entirely dead, which was measured on this suite before this line existed.
      const record = await harness.readChannelRecord({
        accountId: tenantA.accountId,
        postId,
        channelId: tenantA.channelId,
      });
      assert.ok(record, "the publication record must hold this channel");
      assert.strictEqual(record.outcomeKind, PUBLICATION_OUTCOME_KINDS.PUBLISHED);
    });

    it("fails a job that claims a foreign tenant without decrypting or touching the victim", async () => {
      providerCredentials = [];
      const decryptionsBefore = decryptions;
      const jobId = mintPublishJobId({ postId, channelId: tenantA.channelId, episode: ownEpisode });
      const before = await harness.readChannelRecord({
        accountId: tenantA.accountId,
        postId,
        channelId: tenantA.channelId,
      });
      assert.ok(before, "the victim's record must exist before the attack, or nothing is at risk");

      await assert.rejects(
        buildHandler().handleJob({
          // The attack shape: tenant B's scope over a channel owned by tenant A.
          payload: { postId, channelId: tenantA.channelId, accountId: tenantB.accountId },
          dedupeKey: jobId,
          attemptsMade: 0,
        }),
        (error: unknown) => {
          assert.ok(error instanceof Error, "the refusal must be an Error");
          // The refusal now lands on the FIRST tenant-bound read the job makes —
          // the publication record — which tenant B cannot see. It never reaches
          // the credential resolver, so the AUTH the resolver would have answered
          // is a refusal this job no longer gets far enough to earn.
          assert.match(error.message, /Publication record unreadable/);
          assert.ok(
            !error.message.includes(tenantA.token),
            "no plaintext credential may reach the refusal"
          );
          return true;
        }
      );

      assert.deepStrictEqual(providerCredentials, [], "the provider must never be invoked");
      assert.strictEqual(
        decryptions,
        decryptionsBefore,
        "no credential envelope may be decrypted for a foreign tenant"
      );

      const after = await harness.readChannelRecord({
        accountId: tenantA.accountId,
        postId,
        channelId: tenantA.channelId,
      });
      assert.ok(after, "the victim's record must survive the attack");
      assert.deepStrictEqual(
        { episode: after.episode, outcome: after.outcomeKind, attempts: after.attempts },
        { episode: before.episode, outcome: before.outcomeKind, attempts: before.attempts },
        "a foreign tenant must move nothing on the victim's publication record"
      );

      const victim = await base.channel.findUniqueOrThrow({ where: { id: tenantA.channelId } });
      assert.strictEqual(victim.needsReauth, false, "the victim channel keeps its reauth state");
      assert.strictEqual(victim.authFailedAt, null);
    });

    it("refuses a payload that carries no accountId instead of resolving its owner", async () => {
      providerCredentials = [];
      const decryptionsBefore = decryptions;
      // A well-formed id naming an episode that really is open, so the ONLY thing
      // left for the handler to object to is the absent tenant.
      const jobId = mintPublishJobId({ postId, channelId: tenantA.channelId, episode: ownEpisode });
      // The shape of a job enqueued before the payload carried a tenant. The owner
      // lookup that used to fill it in is gone: a job may only act for the tenant
      // it names, and one that names none is content addressed at nobody.
      const untenanted = {
        postId,
        channelId: tenantA.channelId,
      } as PublishJobInput["payload"];

      await assert.rejects(
        buildHandler().handleJob({ payload: untenanted, dedupeKey: jobId, attemptsMade: 0 }),
        /publish job refused \(pre_change_job\)/
      );

      assert.deepStrictEqual(providerCredentials, [], "the provider must never be invoked");
      assert.strictEqual(
        decryptions,
        decryptionsBefore,
        "a job that names no tenant may decrypt nothing"
      );
    });
  });

  describe("auth-failure recorder", () => {
    it("is a no-op when the caller's tenant does not own the channel", async () => {
      await recorder.record(tenantA.channelId, "X", "revoked by provider", tenantB.accountId);

      const row = await base.channel.findUniqueOrThrow({ where: { id: tenantA.channelId } });
      assert.strictEqual(row.needsReauth, false, "a foreign tenant must not flip the reauth flag");
      assert.strictEqual(row.authFailureReason, null);
      const events = await base.outboxEvent.count({ where: { aggregateId: tenantA.channelId } });
      assert.strictEqual(events, 0, "a foreign tenant must emit no ChannelAuthFailed event");
    });

    it("flips the reauth flag and emits the event for the owning tenant", async () => {
      await recorder.record(tenantA.channelId, "X", "revoked by provider", tenantA.accountId);

      const row = await base.channel.findUniqueOrThrow({ where: { id: tenantA.channelId } });
      assert.strictEqual(row.needsReauth, true);
      assert.strictEqual(row.authFailureReason, "revoked by provider");
      assert.notStrictEqual(row.authFailedAt, null);
      const events = await base.outboxEvent.findMany({
        where: { aggregateId: tenantA.channelId },
      });
      assert.strictEqual(events.length, 1, "exactly one outbox event must be emitted");
      assert.strictEqual(events[0]?.eventType, "ChannelAuthFailed");
    });
  });
});
