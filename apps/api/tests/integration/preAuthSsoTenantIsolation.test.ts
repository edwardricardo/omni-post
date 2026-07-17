/**
 * @file preAuthSsoTenantIsolation.test.ts
 * @layer infrastructure
 * @description MERGE-BLOCKING two-tenant integration proof for the FIVE public
 *   SSO routes that derive their tenant from the `:accountId` path param via
 *   `makeTenantParamPreHandler`. Drives the live `samlRoutes` + `oidcRoutes`
 *   public flows THROUGH HTTP (`app.inject`) against a REAL database with two
 *   tenants (A, B), proving the param-derived tenant seam on every route:
 *
 *   SAML — `/auth/saml/:accountId/{metadata,login,callback}`:
 *   - metadata/login return ONLY the URL account's own config (A's entityId /
 *     idpSsoUrl, never B's) — the config read is scoped by the URL account;
 *   - callback with an invalid body reaches SAML validation (401) — proving the
 *     scoped config read succeeded under a bound context, not a 500 context-miss;
 *   - an absent config resolves to 404, never a 500.
 *
 *   OIDC — `/auth/oidc/:accountId/{login,callback}`:
 *   - callback for the URL account reads that account's own `oidcConfiguration`
 *     (reaching the "Missing state parameter" 400), while a foreign account that
 *     has no config resolves to 404 — one account cannot surface another's config;
 *   - login/callback for an absent account resolve to 404, never a 500.
 *
 *   The config repositories are the guarded clients, wired exactly like
 *   production. The public routes carry no auth, so the preHandler seam is the
 *   only thing that binds a tenant context for the enrolled read; a 500 on any of
 *   these would be a `TenantContextMissingError` the seam is here to prevent.
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import Fastify, { type FastifyInstance } from "fastify";
import { createTestPrismaClient, type PrismaClient } from "@infra/prisma";
import { tenantGuardExtension } from "@infra/prisma/extensions/tenantGuard.js";
import { getTenantContext, getSystemContext } from "../../src/security/tenantContext.js";
import { Container } from "../../src/infrastructure/container/Container.js";
import { TOKENS } from "../../src/infrastructure/container/types.js";
import { PrismaSamlConfigurationRepository } from "../../src/infrastructure/repositories/PrismaSamlConfigurationRepository.js";
import { PrismaOidcConfigurationRepository } from "../../src/infrastructure/repositories/PrismaOidcConfigurationRepository.js";
import { EncryptionService } from "../../src/security/EncryptionService.js";
import { samlRoutes } from "../../src/auth/samlRoutes.js";
import { oidcRoutes } from "../../src/auth/oidcRoutes.js";

const TAG = `preauth-sso-${Date.now()}`;
const FIXTURE_CERT = "MIICmTCCAgKgAwIBAgIBADANBgkqhkiG9w0BAQsFADB9example-cert-data-long-enough";

interface SeededTenant {
  accountId: string;
  entityId: string;
  idpSsoUrl: string;
}

/** Inert instance for a DI token the public SSO routes never invoke. */
function inertToken<T>(): T {
  return {} as unknown as T;
}

describe("Public SSO (SAML + OIDC) — two-tenant isolation across all 5 param-seam routes (MERGE-BLOCKING)", () => {
  let base: PrismaClient;
  let app: FastifyInstance;

  // Explicit key so the OIDC repo can round-trip the seeded clientSecret without
  // depending on the ambient PLATFORM_ENCRYPTION_KEY.
  const encryption = new EncryptionService({
    activeKeyBase64: EncryptionService.generateKey(),
    activeKeyVersion: 1,
    priorKeys: new Map(),
  });

  let tenantA: SeededTenant;
  let tenantB: SeededTenant;

  async function seedAccount(name: string): Promise<string> {
    const account = await base.account.create({
      data: {
        name: `${TAG}-${name}`,
        email: `${TAG}-${name}-${randomUUID()}@test.local`,
        slug: `${TAG}-${name}-${randomUUID()}`,
      },
    });
    return account.id;
  }

  async function seedSaml(
    accountId: string,
    name: string
  ): Promise<{ entityId: string; idpSsoUrl: string }> {
    const entityId = `${TAG}-entity-${name}`;
    // Distinguisher lives in the PATH (case-preserved) — URL hosts are normalized
    // to lowercase by the parser, which would erase an `A`/`B` host distinction.
    const idpSsoUrl = `https://idp.example/sso/${name}`;
    await base.samlConfiguration.create({
      data: {
        accountId,
        entityId,
        idpEntityId: `${TAG}-idp-${name}`,
        idpSsoUrl,
        idpCertificate: FIXTURE_CERT,
        attributeMapping: { email: "email" },
        isActive: true,
      },
    });
    return { entityId, idpSsoUrl };
  }

  async function seedOidc(accountId: string, name: string): Promise<void> {
    const encrypted = encryption.encrypt("client-secret", {
      fieldName: "OidcConfiguration.clientSecret",
      recordId: accountId,
    });
    await base.oidcConfiguration.create({
      data: {
        accountId,
        issuerUrl: `https://idp-${name}.example/oidc`,
        clientId: `${TAG}-client-${name}`,
        clientSecretCiphertext: encrypted.encryptedValue,
        clientSecretIv: encrypted.iv,
        clientSecretAuthTag: encrypted.authTag,
        clientSecretKeyVersion: encrypted.keyVersion,
        scopes: ["openid", "email"],
        attributeMapping: { email: "email" },
        isActive: true,
      },
    });
  }

  before(async () => {
    base = createTestPrismaClient();

    // Tenant A carries BOTH a SAML and an OIDC config; tenant B carries only
    // SAML. The OIDC-only-for-A split lets the OIDC routes prove that B (no
    // config) cannot surface A's oidcConfiguration — a scoped 404, never a leak.
    const accountA = await seedAccount("A");
    const samlA = await seedSaml(accountA, "A");
    await seedOidc(accountA, "A");
    tenantA = { accountId: accountA, ...samlA };

    const accountB = await seedAccount("B");
    const samlB = await seedSaml(accountB, "B");
    tenantB = { accountId: accountB, ...samlB };

    const guarded = base.$extends(
      tenantGuardExtension({ getTenantContext, getSystemContext })
    ) as unknown as PrismaClient;

    const container = new Container();
    container.registerInstance(
      TOKENS.SamlConfigurationRepository,
      new PrismaSamlConfigurationRepository(guarded)
    );
    container.registerInstance(
      TOKENS.OidcConfigurationRepository,
      new PrismaOidcConfigurationRepository(guarded, encryption)
    );
    // Tokens the plugins resolve at registration but the public routes never
    // invoke — inert instances keep plugin registration happy.
    container.registerInstance(TOKENS.ConfigureSamlUseCase, inertToken());
    container.registerInstance(TOKENS.EnableSsoUseCase, inertToken());
    container.registerInstance(TOKENS.DisableSsoUseCase, inertToken());
    container.registerInstance(TOKENS.GetSamlConfigurationQuery, inertToken());
    container.registerInstance(TOKENS.ConfigureOidcUseCase, inertToken());
    container.registerInstance(TOKENS.EnableOidcSsoUseCase, inertToken());
    container.registerInstance(TOKENS.DisableOidcSsoUseCase, inertToken());
    container.registerInstance(TOKENS.GetOidcConfigurationQuery, inertToken());
    container.registerInstance(TOKENS.AuthService, inertToken());

    app = Fastify();
    app.decorate("container", container);
    await app.register(samlRoutes);
    await app.register(oidcRoutes);
    await app.ready();
  });

  after(async () => {
    await app?.close();
    const accountIds = [tenantA.accountId, tenantB.accountId];
    await base.oidcConfiguration
      .deleteMany({ where: { accountId: { in: accountIds } } })
      .catch(() => undefined);
    await base.samlConfiguration
      .deleteMany({ where: { accountId: { in: accountIds } } })
      .catch(() => undefined);
    await base.account.deleteMany({ where: { id: { in: accountIds } } }).catch(() => undefined);
    await base.$disconnect();
  });

  // ── SAML metadata ──────────────────────────────────────────────────────────

  it("SAML metadata: serves A's own SP metadata and never leaks B's config", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/auth/saml/${tenantA.accountId}/metadata`,
    });

    assert.strictEqual(res.statusCode, 200, "A's public metadata must be served (seam binds ctx)");
    assert.ok(res.body.includes(tenantA.entityId), "metadata must carry A's entityId");
    assert.ok(!res.body.includes(tenantB.entityId), "A's metadata must never surface B's entityId");
  });

  it("SAML metadata: serves B's own SP metadata scoped to B", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/auth/saml/${tenantB.accountId}/metadata`,
    });

    assert.strictEqual(res.statusCode, 200);
    assert.ok(res.body.includes(tenantB.entityId), "metadata must carry B's entityId");
    assert.ok(!res.body.includes(tenantA.entityId), "B's metadata must never surface A's entityId");
  });

  it("SAML metadata: absent config resolves to a scoped 404, never a 500 context-miss", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/auth/saml/${randomUUID()}/metadata`,
    });

    assert.strictEqual(
      res.statusCode,
      404,
      "absent config must be a scoped 404, not a context-miss"
    );
  });

  // ── SAML login ───────────────────────────────────────────────────────────────

  it("SAML login: redirects A to A's own IdP SSO URL, never B's", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/auth/saml/${tenantA.accountId}/login`,
    });

    assert.strictEqual(res.statusCode, 302, "A's login must redirect (seam binds ctx)");
    const location = res.headers.location ?? "";
    assert.ok(location.includes(tenantA.idpSsoUrl), "login must redirect to A's own IdP");
    assert.ok(!location.includes(tenantB.idpSsoUrl), "A's login must never redirect to B's IdP");
  });

  it("SAML login: absent config resolves to a scoped 404, never a 500 context-miss", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/auth/saml/${randomUUID()}/login`,
    });

    assert.strictEqual(
      res.statusCode,
      404,
      "absent config must be a scoped 404, not a context-miss"
    );
  });

  // ── SAML callback ────────────────────────────────────────────────────────────

  it("SAML callback: reaches SAML validation (401) for A under a bound context, not a 500 context-miss", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/auth/saml/${tenantA.accountId}/callback`,
      payload: { SAMLResponse: "not-a-valid-saml-response" },
    });

    // The scoped config read for A succeeds (past the 404), so the invalid body
    // reaches SAML validation and fails with 401 — never a 500 context-miss.
    assert.strictEqual(
      res.statusCode,
      401,
      "A's callback must reach SAML validation, not context-miss"
    );
  });

  it("SAML callback: absent config resolves to a scoped 404, never a 500 context-miss", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/auth/saml/${randomUUID()}/callback`,
      payload: { SAMLResponse: "not-a-valid-saml-response" },
    });

    assert.strictEqual(
      res.statusCode,
      404,
      "absent config must be a scoped 404, not a context-miss"
    );
  });

  // ── OIDC login ───────────────────────────────────────────────────────────────

  it("OIDC login: absent config resolves to a scoped 404, never a 500 context-miss", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/auth/oidc/${randomUUID()}/login`,
    });

    assert.strictEqual(
      res.statusCode,
      404,
      "absent config must be a scoped 404, not a context-miss"
    );
  });

  it("OIDC login: an account without OIDC config cannot surface another account's config (404)", async () => {
    // B has SAML but no OIDC config; A does. B's OIDC login must scope to B and
    // find nothing — never leak A's oidcConfiguration.
    const res = await app.inject({
      method: "GET",
      url: `/auth/oidc/${tenantB.accountId}/login`,
    });

    assert.strictEqual(res.statusCode, 404, "B must not see A's oidcConfiguration");
  });

  // ── OIDC callback ────────────────────────────────────────────────────────────

  it("OIDC callback: reads A's own oidcConfiguration under a bound context (reaches Missing state 400)", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/auth/oidc/${tenantA.accountId}/callback`,
    });

    // The scoped read finds A's config (past the 404) under a bound context, so
    // the handler reaches the state check and fails with 400 — proving the read
    // succeeded (no context-miss) and read A's own config.
    assert.strictEqual(
      res.statusCode,
      400,
      "A's callback must reach the state check, not context-miss"
    );
    const body = res.json() as { error?: string };
    assert.strictEqual(body.error, "Missing state parameter");
  });

  it("OIDC callback: an account without OIDC config cannot surface another account's config (404)", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/auth/oidc/${tenantB.accountId}/callback`,
    });

    assert.strictEqual(res.statusCode, 404, "B must not see A's oidcConfiguration");
  });

  it("OIDC callback: absent config resolves to a scoped 404, never a 500 context-miss", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/auth/oidc/${randomUUID()}/callback`,
    });

    assert.strictEqual(
      res.statusCode,
      404,
      "absent config must be a scoped 404, not a context-miss"
    );
  });
});
