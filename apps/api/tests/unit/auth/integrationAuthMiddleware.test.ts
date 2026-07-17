/**
 * @file integrationAuthMiddleware.test.ts
 * @description Unit tests for the two-hook integration API-key auth seam. Proves
 *   the pre-auth context ordering mandated for the tenant guard: the resolve hook
 *   runs the key lookup + hash verification under an explicit SYSTEM context (the
 *   account is not yet known) and binds NO tenant context; the bind hook then
 *   enters a TENANT context scoped to the matched key's account BEFORE the
 *   `lastUsedAt` write, so that write is itself tenant-scoped. The tenant scope
 *   observed at save time (via `getTenantContext`) is the behavioral proof the
 *   sync bind propagated a fully-populated context. A matched key with no account
 *   fails closed with 401 and never populates `integrationAuth`.
 * @layer infrastructure
 */
import { describe, it, expect, beforeEach } from "vitest";
import type { FastifyReply, FastifyRequest } from "fastify";
import { IntegrationApiKey } from "@core/domain/entities/IntegrationApiKey.js";
import type { IntegrationApiKeyRepository } from "@core/domain/repositories/IntegrationApiKeyRepository.js";
import { hashPassword } from "../../../src/auth/passwordHashing.js";
import { TOKENS } from "../../../src/infrastructure/container/types.js";
import { getSystemContext, getTenantContext } from "../../../src/security/tenantContext.js";
import {
  integrationAuthResolve,
  integrationAuthBind,
} from "../../../src/auth/integrationAuthMiddleware.js";

// Fabricated fixture value, not a real credential.
const TOKEN = "zap_livekey1234567890abcdef"; // gitleaks:allow

interface Captured {
  systemReasonAtLookup?: string;
  tenantAtLookup?: string;
  tenantAtSave?: string;
  saveCalled: boolean;
  lastUsedAtWasStampedBeforeSave: boolean;
}

function makeKey(accountId: string, keyHash: string): IntegrationApiKey {
  return IntegrationApiKey.reconstitute({
    id: "key-1",
    accountId,
    platform: "ZAPIER",
    keyHash,
    keyPrefix: TOKEN.substring(0, 12),
    label: null,
    lastUsedAt: null,
    createdAt: new Date("2024-01-01T00:00:00Z"),
    revokedAt: null,
  });
}

function fakeRepo(
  candidates: IntegrationApiKey[],
  captured: Captured
): IntegrationApiKeyRepository {
  return {
    findById: async () => null,
    findActiveByAccountId: async () => [],
    findByKeyPrefix: async () => {
      captured.systemReasonAtLookup = getSystemContext()?.reason;
      captured.tenantAtLookup = getTenantContext()?.accountId;
      return candidates;
    },
    save: async (key: IntegrationApiKey) => {
      captured.saveCalled = true;
      captured.tenantAtSave = getTenantContext()?.accountId;
      captured.lastUsedAtWasStampedBeforeSave = key.lastUsedAt !== null;
      return { ok: true, value: undefined } as const;
    },
    countActiveByAccountId: async () => 0,
  } as unknown as IntegrationApiKeyRepository;
}

function fakeReq(repo: IntegrationApiKeyRepository): FastifyRequest {
  const req = {
    headers: { authorization: `Bearer ${TOKEN}` },
    server: {
      container: {
        resolve: (token: symbol) => (token === TOKENS.IntegrationApiKeyRepository ? repo : null),
      },
    },
    user: undefined as unknown,
    integrationAuth: undefined as unknown,
  };
  return req as unknown as FastifyRequest;
}

function fakeReply(): FastifyReply & { statusCode?: number; body?: unknown } {
  const reply = {
    statusCode: undefined as number | undefined,
    body: undefined as unknown,
    code(n: number) {
      this.statusCode = n;
      return this;
    },
    send(b: unknown) {
      this.body = b;
      return this;
    },
  };
  return reply as unknown as FastifyReply & { statusCode?: number; body?: unknown };
}

describe("integration API-key auth — two-hook pre-auth context ordering", () => {
  let hash: string;
  let captured: Captured;

  beforeEach(async () => {
    hash = await hashPassword(TOKEN);
    captured = {
      saveCalled: false,
      lastUsedAtWasStampedBeforeSave: false,
    };
  });

  it("runs the key lookup + verify under the integration-key-auth system context, binding no tenant scope", async () => {
    const repo = fakeRepo([makeKey("acct-A", hash)], captured);
    const req = fakeReq(repo);

    await integrationAuthResolve(req, fakeReply());

    expect(captured.systemReasonAtLookup).toBe("system:integration-key-auth");
    // The resolve hook must NOT bind a tenant scope — that is the bind hook's job.
    expect(captured.tenantAtLookup).toBeUndefined();
  });

  it("resolve stashes the matched account and user without binding a tenant context", async () => {
    const repo = fakeRepo([makeKey("acct-A", hash)], captured);
    const req = fakeReq(repo);
    const reply = fakeReply();

    await integrationAuthResolve(req, reply);

    expect(reply.statusCode).toBeUndefined();
    expect(req.integrationAuth?.accountId).toBe("acct-A");
    expect(req.integrationAuth?.keyId).toBe("key-1");
    expect((req.user as { accountId?: string }).accountId).toBe("acct-A");
    // No save yet — the tenant-scoped write happens only in the bind hook.
    expect(captured.saveCalled).toBe(false);
  });

  it("bind enters a tenant context scoped to the matched account before the lastUsedAt write", async () => {
    const repo = fakeRepo([makeKey("acct-A", hash)], captured);
    const req = fakeReq(repo);
    const reply = fakeReply();

    await integrationAuthResolve(req, reply);
    await integrationAuthBind(req, reply);

    expect(reply.statusCode).toBeUndefined();
    // The tenant scope observed at save time proves the sync bind propagated a
    // fully-populated context (no empty holder, no by-reference mutation).
    expect(captured.saveCalled).toBe(true);
    expect(captured.tenantAtSave).toBe("acct-A");
    expect(captured.lastUsedAtWasStampedBeforeSave).toBe(true);
    // The bound context is observable synchronously right after the bind.
    expect(getTenantContext()?.accountId).toBe("acct-A");
  });

  it("fails closed with 401 when the matched key has no account and never stashes auth", async () => {
    const repo = fakeRepo([makeKey("", hash)], captured);
    const req = fakeReq(repo);
    const reply = fakeReply();

    await integrationAuthResolve(req, reply);

    expect(reply.statusCode).toBe(401);
    expect(req.integrationAuth).toBeUndefined();
    expect(req.user).toBeUndefined();
    expect(captured.saveCalled).toBe(false);
  });

  it("returns 401 when no candidate key matches the presented token", async () => {
    const otherHash = await hashPassword("zap_someotherkey_000000000");
    const repo = fakeRepo([makeKey("acct-A", otherHash)], captured);
    const req = fakeReq(repo);
    const reply = fakeReply();

    await integrationAuthResolve(req, reply);

    expect(reply.statusCode).toBe(401);
    expect(req.integrationAuth).toBeUndefined();
    expect(captured.saveCalled).toBe(false);
  });

  it("bind fails closed with 401 when resolution is absent (hooks mis-wired)", async () => {
    const repo = fakeRepo([makeKey("acct-A", hash)], captured);
    const req = fakeReq(repo);
    const reply = fakeReply();

    // Invoke bind without a preceding successful resolve.
    await integrationAuthBind(req, reply);

    expect(reply.statusCode).toBe(401);
    expect(captured.saveCalled).toBe(false);
  });
});
