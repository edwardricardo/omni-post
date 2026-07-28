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
 *     - foreign `(channelId, accountId)` pair: the job fails with AUTH, the
 *       provider is never invoked, NOTHING is decrypted (the decrypt callback
 *       is never entered), no plaintext reaches the error log, and the victim
 *       channel's reauth state is untouched;
 *     - legacy payload without `accountId`: the owner lookup resolves the
 *       channel's tenant and the publish proceeds — the deploy-compat path for
 *       jobs enqueued before the payload carried the tenant;
 *     - reauth recorder: a foreign tenant flips no flag and emits no outbox
 *       event, while the owner flips both.
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
import { createTestPrismaClient, type PrismaClient } from "@infra/prisma";
import { createPrismaRepoAdapter } from "@adapters/db-prisma";
import {
  encryptChannelCredentials,
  decryptChannelCredentials,
  type EncryptedChannelCredentialsEnvelope,
} from "@shared/types";
import { CredentialResolver } from "../../../../apps/workers/src/services/CredentialResolver.js";
import { ChannelAuthFailureRecorder } from "../../../../apps/workers/src/services/ChannelAuthFailureRecorder.js";
import { PublishHandler } from "../../../../apps/workers/src/publishHandler.js";
import type { PublishProvider } from "../../../../apps/workers/src/publishHandlerTypes.js";
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
    base = createTestPrismaClient();

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
    // FK order: publish logs → outbox events → posts → channels → projects → accounts.
    await base.publishLog
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
    it("publishes with the owning tenant's credentials and logs OK", async () => {
      providerCredentials = [];
      const dedupeKey = `${TAG}-own`;

      await buildHandler().handleJob({
        payload: { postId, channelId: tenantA.channelId, accountId: tenantA.accountId },
        dedupeKey,
      });

      assert.deepStrictEqual(
        providerCredentials,
        [{ accessToken: tenantA.token }],
        "the provider must receive exactly the owning tenant's credentials"
      );
      const okLog = await base.publishLog.findFirst({ where: { dedupeKey, status: "OK" } });
      assert.ok(okLog, "an OK publish log must be written");
      assert.strictEqual(okLog.channelId, tenantA.channelId);
    });

    it("fails a job that claims a foreign tenant without decrypting or touching the victim", async () => {
      providerCredentials = [];
      const decryptionsBefore = decryptions;
      const dedupeKey = `${TAG}-foreign`;

      await assert.rejects(
        buildHandler().handleJob({
          // The attack shape: tenant B's scope over a channel owned by tenant A.
          payload: { postId, channelId: tenantA.channelId, accountId: tenantB.accountId },
          dedupeKey,
        }),
        /AUTH/
      );

      assert.deepStrictEqual(providerCredentials, [], "the provider must never be invoked");
      assert.strictEqual(
        decryptions,
        decryptionsBefore,
        "no credential envelope may be decrypted for a foreign tenant"
      );

      const errLog = await base.publishLog.findFirst({ where: { dedupeKey, status: "ERR" } });
      assert.ok(errLog, "an ERR publish log must record the failure");
      assert.strictEqual((errLog.payload as { error?: string }).error, "AUTH");
      assert.ok(
        !JSON.stringify(errLog.payload).includes(tenantA.token),
        "no plaintext credential may reach the error log"
      );

      const victim = await base.channel.findUniqueOrThrow({ where: { id: tenantA.channelId } });
      assert.strictEqual(victim.needsReauth, false, "the victim channel keeps its reauth state");
      assert.strictEqual(victim.authFailedAt, null);
    });

    it("resolves the owner for a legacy payload that carries no accountId", async () => {
      providerCredentials = [];
      const dedupeKey = `${TAG}-legacy`;

      await buildHandler().handleJob({
        payload: { postId, channelId: tenantA.channelId },
        dedupeKey,
      });

      assert.deepStrictEqual(
        providerCredentials,
        [{ accessToken: tenantA.token }],
        "the owner lookup must supply the tenant a legacy payload omits"
      );
      const okLog = await base.publishLog.findFirst({ where: { dedupeKey, status: "OK" } });
      assert.ok(okLog, "a legacy job must still publish and log OK");
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
