/**
 * @file channelTenantIsolation.test.ts
 * @description MERGE-BLOCKING two-tenant integration test for the `Channel`
 *   tenant-guard enrollment (Slice 7, N-SEC-3). Exercises the live channel
 *   routes THROUGH HTTP (`app.inject`) against a REAL database with two
 *   tenants (A, B), proving every credential-bearing IDOR path is closed:
 *   read / list / update / delete by id resolve to NOT_FOUND for a foreign
 *   caller, and BOTH create paths reject a foreign `projectId` — the Bluesky
 *   connect (JSON route) with a literal 404 via `assertCallerOwnsProject`, the
 *   OAuth callback (browser-redirect flow) with the standard error redirect
 *   (302) before any external token exchange, in each case persisting no
 *   channel under B's project. Because `Channel` carries four AES-GCM
 *   credential columns, the suite also asserts NO decrypted provider
 *   credential of B ever crosses the boundary (body, error, log-free payload).
 *
 *   The guarded client is built exactly like production: a base client
 *   extended with `tenantGuardExtension`, wired into the same DI the routes
 *   resolve from. Seeding runs on the raw (unguarded) base client.
 *
 *   Reconciliation note: the OAuth-callback create scenario asserts an ERROR
 *   REDIRECT (302), not a literal 404 — `handleCallback` converts every error
 *   into a redirect (`providerOAuthFlow.ts` catch), so a literal 404 there is
 *   unsatisfiable. The Bluesky JSON route keeps the literal 404.
 *
 * @layer infrastructure
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID, randomBytes } from "node:crypto";
import Fastify, { type FastifyInstance } from "fastify";
import { createTestPrismaClient, type PrismaClient } from "@infra/prisma";
import {
  tenantGuardExtension,
  TenantContextMissingError,
} from "@infra/prisma/extensions/tenantGuard.js";
import { InMemoryCacheAdapter } from "@adapters/cache-redis";
import { ChannelId, ProjectId } from "@core/domain/index.js";
import { SetPrimaryChannelUseCase } from "@core/channels/index.js";
import {
  getTenantContext,
  getSystemContext,
  withTenantContext,
} from "../../src/security/tenantContext.js";
import { Container } from "../../src/infrastructure/container/Container.js";
import { TOKENS } from "../../src/infrastructure/container/types.js";
import { PrismaUnitOfWork } from "../../src/infrastructure/unitofwork/PrismaUnitOfWork.js";
import { PrismaProjectRepository } from "../../src/infrastructure/repositories/PrismaProjectRepository.js";
import { PrismaChannelRepository } from "../../src/infrastructure/repositories/PrismaChannelRepository.js";
import { EncryptionService } from "../../src/security/EncryptionService.js";
import { ChannelCredentialsCrypto } from "../../src/security/ChannelCredentialsCrypto.js";
import { channelRoutes } from "../../src/channels/channelRoutes.js";
import { registerOAuthRoutes } from "../../src/auth/providerOAuth.js";
import { OAuthFlowStore } from "../../src/auth/oauth/OAuthFlowStore.js";
import { signCustomerAccessToken } from "../../src/auth/customerJwt.js";

const TAG = `chan-iso-${Date.now()}`;

// Deterministic crypto so A's OWN channel decrypts on read (recordId is bound
// as AAD, so the recordId MUST equal the row id — see ChannelCredentialsCrypto).
const TEST_KEY = randomBytes(32).toString("base64");
const credentialsCrypto = new ChannelCredentialsCrypto(
  new EncryptionService({ activeKeyBase64: TEST_KEY, activeKeyVersion: 1 })
);

interface Seeded {
  accountId: string;
  projectId: string;
  channelId: string;
}

const bearerFor = (accountId: string): string =>
  `Bearer ${signCustomerAccessToken({
    sub: `chan-user-${accountId}`,
    accountId,
    roleId: "role-test",
    roleName: "OWNER",
    permissions: [],
  })}`;

describe("Channel — two-tenant isolation (MERGE-BLOCKING)", () => {
  let base: PrismaClient;
  let app: FastifyInstance;
  let guarded: PrismaClient;
  let channelRepo: PrismaChannelRepository;
  let oauthCache: InMemoryCacheAdapter;

  let tenantA: Seeded;
  let tenantB: Seeded;

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
    const channelId = randomUUID();
    const enc = credentialsCrypto.encrypt(
      { accessToken: `tok-${name}` },
      { recordId: channelId, caller: "channelTenantIsolation.seed" }
    );
    await base.channel.create({
      data: {
        id: channelId,
        projectId: project.id,
        // Tenant scope — now a NOT-NULL column post-Migration A (Slice 7).
        accountId: account.id,
        provider: "X",
        handle: `${TAG}-${name}-handle`,
        credentialsCiphertext: enc.credentialsCiphertext,
        credentialsIv: enc.credentialsIv,
        credentialsAuthTag: enc.credentialsAuthTag,
        credentialsKeyVersion: enc.credentialsKeyVersion,
      },
    });
    return { accountId: account.id, projectId: project.id, channelId };
  }

  before(async () => {
    base = createTestPrismaClient();

    tenantA = await seedTenant("A");
    tenantB = await seedTenant("B");

    // Guarded client — EXACTLY as production wires it (base + tenant guard).
    guarded = base.$extends(
      tenantGuardExtension({ getTenantContext, getSystemContext })
    ) as unknown as PrismaClient;

    channelRepo = new PrismaChannelRepository(guarded, credentialsCrypto);
    const projectRepo = new PrismaProjectRepository(guarded);
    const setPrimaryUseCase = new SetPrimaryChannelUseCase(
      channelRepo,
      new PrismaUnitOfWork(guarded)
    );

    const container = new Container();
    container.registerInstance(TOKENS.PrismaClient, guarded);
    container.registerInstance(TOKENS.ChannelRepository, channelRepo);
    container.registerInstance(TOKENS.ProjectRepository, projectRepo);
    container.registerInstance(TOKENS.SetPrimaryChannelUseCase, setPrimaryUseCase);
    container.registerInstance(TOKENS.ChannelCredentialsCrypto, credentialsCrypto);

    app = Fastify();
    app.decorate("container", container);
    await app.register(channelRoutes);

    // OAuth routes: the callback is public and consumes a flow record from the
    // cache. Seeding the flow record on the SAME cache instance the routes read
    // from lets us drive the guarded-probe IDOR end-to-end (a foreign projectId
    // fails the probe BEFORE any external token exchange).
    oauthCache = new InMemoryCacheAdapter();
    await registerOAuthRoutes(app, oauthCache, channelRepo, projectRepo);

    await app.ready();
  });

  after(async () => {
    await app?.close();
    const accountIds = [tenantA.accountId, tenantB.accountId];
    const projectIds = [tenantA.projectId, tenantB.projectId];
    // FK order: channel → project → account.
    await base.channel
      .deleteMany({ where: { projectId: { in: projectIds } } })
      .catch(() => undefined);
    await base.project
      .deleteMany({ where: { accountId: { in: accountIds } } })
      .catch(() => undefined);
    await base.account.deleteMany({ where: { id: { in: accountIds } } }).catch(() => undefined);
    await base.$disconnect();
  });

  describe("cross-tenant IDOR paths are closed (A attacks B)", () => {
    it("A reading B's channel by id resolves to 404 and leaks no B data", async () => {
      const res = await app.inject({
        method: "GET",
        url: `/channels/${tenantB.channelId}`,
        headers: { authorization: bearerFor(tenantA.accountId) },
      });
      assert.strictEqual(res.statusCode, 404);
      assert.ok(!res.payload.includes(`${TAG}-B-handle`), "no B channel handle may leak");
      assert.ok(!res.payload.includes("tok-B"), "no decrypted B credential may leak");
    });

    it("A updating B's channel resolves to 404 and B's handle is unchanged", async () => {
      const res = await app.inject({
        method: "PUT",
        url: `/channels/${tenantB.channelId}`,
        headers: {
          authorization: bearerFor(tenantA.accountId),
          "content-type": "application/json",
        },
        payload: { name: "hijacked" },
      });
      assert.strictEqual(res.statusCode, 404);
      const still = await base.channel.findUnique({ where: { id: tenantB.channelId } });
      assert.strictEqual(still?.handle, `${TAG}-B-handle`, "B's handle must be untouched");
    });

    it("A deleting B's channel resolves to 404 and B stays undeleted", async () => {
      const res = await app.inject({
        method: "DELETE",
        url: `/channels/${tenantB.channelId}`,
        headers: { authorization: bearerFor(tenantA.accountId) },
      });
      assert.strictEqual(res.statusCode, 404);
      const still = await base.channel.findUnique({ where: { id: tenantB.channelId } });
      assert.strictEqual(still?.deletedAt, null, "B's channel must not be soft-deleted");
    });

    it("A listing with B's projectId resolves to 404 (ownership gate) and leaks no B channel", async () => {
      // Unlike the guard-natural empty-list precedent (RecurringPost), Channel's
      // list route runs an explicit assertCallerOwnsProject gate that resolves a
      // foreign/unowned projectId to 404 BEFORE any channel query — strictly
      // stronger than an empty 200. The guard-natural empty result (the spec's
      // literal claim) is proven directly at the repository layer below.
      const res = await app.inject({
        method: "GET",
        url: `/projects/${tenantB.projectId}/channels`,
        headers: { authorization: bearerFor(tenantA.accountId) },
      });
      assert.strictEqual(res.statusCode, 404);
      assert.ok(!res.payload.includes(`${TAG}-B-handle`), "no B channel may leak");
    });

    it("no decrypted credential of B is materialized on ANY cross-tenant Channel route", async () => {
      const auth = { authorization: bearerFor(tenantA.accountId) };
      const responses = await Promise.all([
        app.inject({ method: "GET", url: `/channels/${tenantB.channelId}`, headers: auth }),
        app.inject({
          method: "PUT",
          url: `/channels/${tenantB.channelId}`,
          headers: { ...auth, "content-type": "application/json" },
          payload: { credentials: { accessToken: "probe" } },
        }),
        app.inject({ method: "DELETE", url: `/channels/${tenantB.channelId}`, headers: auth }),
        app.inject({
          method: "GET",
          url: `/projects/${tenantB.projectId}/channels`,
          headers: auth,
        }),
      ]);
      for (const res of responses) {
        assert.strictEqual(res.statusCode, 404, "every cross-tenant route must resolve 404");
        assert.ok(
          !res.payload.includes("tok-B"),
          "no decrypted B credential may cross the boundary"
        );
        assert.ok(
          !res.payload.includes(`${TAG}-B-handle`),
          "no B channel identifier may cross the boundary"
        );
      }
    });
  });

  describe("create paths validate parent ownership (both Channel create paths)", () => {
    it("A creating a channel under B's project resolves to 404 (never 500/403) and persists no row", async () => {
      const before = await base.channel.count({ where: { projectId: tenantB.projectId } });
      const res = await app.inject({
        method: "POST",
        url: "/channels",
        headers: {
          authorization: bearerFor(tenantA.accountId),
          "content-type": "application/json",
        },
        payload: { projectId: tenantB.projectId, name: "pwn-channel", platform: "X" },
      });
      assert.strictEqual(res.statusCode, 404, "foreign-project create MUST be 404, never 500/403");
      const after = await base.channel.count({ where: { projectId: tenantB.projectId } });
      assert.strictEqual(after, before, "no channel may be persisted under B's project");
    });

    it("A connecting Bluesky into B's project resolves to 404 before any login and persists no row", async () => {
      const before = await base.channel.count({ where: { projectId: tenantB.projectId } });
      const res = await app.inject({
        method: "POST",
        url: "/channels/bluesky/connect",
        headers: {
          authorization: bearerFor(tenantA.accountId),
          "content-type": "application/json",
        },
        // Valid App-Password shape so validation passes; the ownership gate
        // fires (404) BEFORE BlueskyClient.login(), so no external call is made.
        payload: {
          projectId: tenantB.projectId,
          identifier: "attacker.bsky.social",
          appPassword: "abcd-abcd-abcd-abcd",
        },
      });
      assert.strictEqual(res.statusCode, 404, "assertCallerOwnsProject gates before login()");
      const after = await base.channel.count({ where: { projectId: tenantB.projectId } });
      assert.strictEqual(after, before, "no channel may be persisted under B's project");
    });

    it("A completing an OAuth callback carrying B's projectId gets an error redirect and persists no channel", async () => {
      const state = randomUUID();
      // Seed the in-flight OAuth record: A initiated the flow, but the consumed
      // state carries B's projectId (attacker-influenced, per initiateOAuth).
      await new OAuthFlowStore(oauthCache).put(
        state,
        {
          providerId: "x",
          accountId: tenantA.accountId,
          projectId: tenantB.projectId,
          codeVerifier: "test-verifier",
          createdAt: new Date().toISOString(),
        },
        600
      );
      const before = await base.channel.count({ where: { projectId: tenantB.projectId } });
      const res = await app.inject({
        method: "GET",
        url: `/auth/callback/x?code=fake-code&state=${state}`,
      });
      // Browser-redirect flow: the NotFound from the guarded probe surfaces as
      // the standard error redirect (302), never a literal 404 status.
      assert.strictEqual(res.statusCode, 302, "callback surfaces NotFound as a 302 redirect");
      const location = res.headers.location ?? "";
      assert.ok(location.includes("error="), "the redirect must carry an error param");
      assert.ok(!location.includes("status=connected"), "must NOT be the success redirect");
      const after = await base.channel.count({ where: { projectId: tenantB.projectId } });
      assert.strictEqual(after, before, "no channel may be persisted under B's project");
    });

    it("A creating a channel under its OWN project persists a row whose accountId === Project.accountId", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/channels",
        headers: {
          authorization: bearerFor(tenantA.accountId),
          "content-type": "application/json",
        },
        payload: { projectId: tenantA.projectId, name: "owned-channel", platform: "X" },
      });
      assert.strictEqual(res.statusCode, 201);
      const body = res.json() as { ok: boolean; data: { id: string } };
      const persisted = await base.channel.findUnique({ where: { id: body.data.id } });
      assert.ok(persisted, "the own-project channel must be persisted");
      assert.strictEqual(
        persisted?.accountId,
        tenantA.accountId,
        "persisted row must satisfy accountId === Project.accountId"
      );
    });
  });

  describe("own-tenant regression — the owner path still works after the guard flip", () => {
    it("A can read its OWN channel (200, credentials decrypt without leaking into the view)", async () => {
      const res = await app.inject({
        method: "GET",
        url: `/channels/${tenantA.channelId}`,
        headers: { authorization: bearerFor(tenantA.accountId) },
      });
      assert.strictEqual(res.statusCode, 200);
      assert.ok(res.payload.includes(`${TAG}-A-handle`), "A must see its own channel");
      assert.ok(!res.payload.includes("tok-A"), "the view never exposes the decrypted token");
    });

    it("A can list its OWN project's channels", async () => {
      const res = await app.inject({
        method: "GET",
        url: `/projects/${tenantA.projectId}/channels`,
        headers: { authorization: bearerFor(tenantA.accountId) },
      });
      assert.strictEqual(res.statusCode, 200);
      const body = res.json() as { ok: boolean; data: unknown[] };
      assert.ok(body.data.length >= 1, "A must see its own channels");
    });
  });

  describe("data-layer guard behavior (guard-natural empty + fail-loud)", () => {
    it("listing B's channels through the guarded repo under A's context returns empty (guard-natural)", async () => {
      const rows = await withTenantContext({ accountId: tenantA.accountId }, () =>
        channelRepo.findByProjectId(ProjectId.fromStringUnsafe(tenantB.projectId))
      );
      assert.strictEqual(
        rows.length,
        0,
        "the guard auto-scopes A's context away from B's channels"
      );
    });

    it("reading B's channel through the guarded repo with NO bound context fails with TenantContextMissingError", async () => {
      await assert.rejects(
        () => channelRepo.findById(ChannelId.fromStringUnsafe(tenantB.channelId)),
        (error: unknown) => error instanceof TenantContextMissingError,
        "an unscoped read must fail loud, never return unscoped rows"
      );
    });
  });

  describe("data-layer invariant", () => {
    it("every persisted Channel row satisfies accountId === Project.accountId", async () => {
      const rows = await base.channel.findMany({
        where: { accountId: { in: [tenantA.accountId, tenantB.accountId] } },
        include: { project: { select: { accountId: true } } },
      });
      assert.ok(rows.length >= 2, "both tenants' channels must be present");
      for (const row of rows) {
        assert.strictEqual(
          row.accountId,
          row.project.accountId,
          `row ${row.id} must be parent-consistent`
        );
      }
    });

    it("no Channel row has a NULL accountId (backfill / NOT NULL invariant)", async () => {
      const result = await base.$queryRawUnsafe<Array<{ count: bigint }>>(
        `SELECT count(*)::bigint AS count FROM "Channel" WHERE "accountId" IS NULL`
      );
      assert.strictEqual(Number(result[0]?.count ?? 0), 0);
    });
  });
});
