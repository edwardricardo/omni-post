/**
 * @file oidcAdminRoutes.test.ts
 * @description Handler-level unit test for the OIDC-admin route plugin.
 *              Mocks the use case + Fastify reply to verify registration,
 *              success path (200 + audit success), validation/handshake
 *              failure (400 + audit failure), NOT_FOUND, INTERNAL.
 * @layer infrastructure
 */

import { describe, it, vi, beforeEach } from "vitest";
import assert from "node:assert/strict";
import type { FastifyRequest, FastifyReply } from "fastify";
import { ok, err } from "@shared/types";
import { oidcAdminRoutes } from "../../../src/admin/oidcAdminRoutes.js";
import { TOKENS } from "../../../src/infrastructure/container/types.js";
import type {
  ReplaceOidcClientSecretUseCase,
  ReplaceOidcClientSecretOutput,
} from "../../../src/application/auth/ReplaceOidcClientSecretUseCase.js";
import { UseCaseError, USE_CASE_ERRORS } from "../../../src/application/UseCase.js";

const ACCOUNT_ID = "acct-uuid-123";

vi.mock("../../../src/audit/auditService.js", () => ({
  auditService: { log: vi.fn().mockResolvedValue({ ok: true, value: {} }) },
}));

import { auditService } from "../../../src/audit/auditService.js";

interface CapturedRoute {
  url: string;
  options: Record<string, unknown>;
  handler: (req: FastifyRequest, reply: FastifyReply) => Promise<unknown>;
}

interface FastifyTestHarness {
  routes: CapturedRoute[];
  container: { resolve: ReturnType<typeof vi.fn> };
  post: ReturnType<typeof vi.fn>;
}

function makeFastifyHarness(useCase: ReplaceOidcClientSecretUseCase): FastifyTestHarness {
  const routes: CapturedRoute[] = [];
  return {
    routes,
    container: { resolve: vi.fn().mockReturnValue(useCase) },
    post: vi.fn(
      (
        url: string,
        options: Record<string, unknown>,
        handler: (req: FastifyRequest, reply: FastifyReply) => Promise<unknown>
      ) => {
        routes.push({ url, options, handler });
      }
    ),
  };
}

interface CapturedReply {
  status: number | null;
  body: unknown;
  reply: FastifyReply;
}

function makeReply(): CapturedReply {
  const captured: CapturedReply = { status: null, body: null, reply: {} as FastifyReply };
  captured.reply = {
    code: vi.fn((code: number) => {
      captured.status = code;
      return captured.reply;
    }),
    send: vi.fn((body: unknown) => {
      captured.body = body;
      return captured.reply;
    }),
    status: vi.fn(() => captured.reply),
    header: vi.fn(() => captured.reply),
  } as unknown as FastifyReply;
  return captured;
}

function makeRequest(
  params: Record<string, string>,
  body: Record<string, unknown> = {}
): FastifyRequest {
  return {
    log: { error: vi.fn(), info: vi.fn(), warn: vi.fn(), debug: vi.fn() },
    headers: {},
    method: "POST",
    url: "/admin/oidc/configurations/:accountId/replace-client-secret",
    params,
    body,
    adminUser: { id: "admin-user-uuid" },
  } as unknown as FastifyRequest;
}

function successOutput(): ReplaceOidcClientSecretOutput {
  return {
    accountId: ACCOUNT_ID,
    issuerUrl: "https://accounts.example.com",
    updatedAt: "2026-05-06T18:00:00.000Z",
    validation: "strict",
  };
}

describe("oidcAdminRoutes plugin", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("registers POST /admin/oidc/configurations/:accountId/replace-client-secret", async () => {
    const useCase = { execute: vi.fn() } as unknown as ReplaceOidcClientSecretUseCase;
    const harness = makeFastifyHarness(useCase);
    await oidcAdminRoutes(harness as never, {});
    assert.equal(harness.routes.length, 1);
    assert.equal(
      harness.routes[0]!.url,
      "/admin/oidc/configurations/:accountId/replace-client-secret"
    );
    const preHandler = harness.routes[0]!.options.preHandler as unknown[];
    assert.ok(Array.isArray(preHandler) && preHandler.length === 2);
  });

  it("resolves ReplaceOidcClientSecretUseCase from DI", async () => {
    const useCase = { execute: vi.fn() } as unknown as ReplaceOidcClientSecretUseCase;
    const harness = makeFastifyHarness(useCase);
    await oidcAdminRoutes(harness as never, {});
    assert.equal(
      harness.container.resolve.mock.calls[0]?.[0],
      TOKENS.ReplaceOidcClientSecretUseCase
    );
  });

  it("returns 200 + emits audit success when use case succeeds", async () => {
    const useCase = {
      execute: vi.fn().mockResolvedValue(ok(successOutput())),
    } as unknown as ReplaceOidcClientSecretUseCase;
    const harness = makeFastifyHarness(useCase);
    await oidcAdminRoutes(harness as never, {});

    const reply = makeReply();
    await harness.routes[0]!.handler(
      makeRequest({ accountId: ACCOUNT_ID }, { newClientSecret: "new-secret" }),
      reply.reply
    );

    const body = reply.body as {
      ok: boolean;
      data?: { rotation: ReplaceOidcClientSecretOutput };
    };
    assert.equal(body.ok, true);
    assert.equal(body.data?.rotation.accountId, ACCOUNT_ID);

    const auditCall = (auditService.log as ReturnType<typeof vi.fn>).mock.calls[0]?.[0];
    assert.equal(auditCall?.action, "OIDC_CLIENT_SECRET_REPLACED");
    assert.equal(auditCall?.success, true);
    assert.equal(auditCall?.userId, "admin-user-uuid");
  });

  it("returns 400 + emits audit failure when handshake validation fails", async () => {
    const useCase = {
      execute: vi
        .fn()
        .mockResolvedValue(
          err(
            new UseCaseError(
              "IdP handshake failed: invalid_client",
              USE_CASE_ERRORS.VALIDATION_FAILED
            )
          )
        ),
    } as unknown as ReplaceOidcClientSecretUseCase;
    const harness = makeFastifyHarness(useCase);
    await oidcAdminRoutes(harness as never, {});

    const reply = makeReply();
    await harness.routes[0]!.handler(
      makeRequest({ accountId: ACCOUNT_ID }, { newClientSecret: "wrong-secret" }),
      reply.reply
    );
    assert.equal(reply.status, 400);
    const auditCall = (auditService.log as ReturnType<typeof vi.fn>).mock.calls[0]?.[0];
    assert.equal(auditCall?.success, false);
    assert.ok(auditCall?.error?.includes("invalid_client"));
  });

  it("returns 404 when no OIDC config exists", async () => {
    const useCase = {
      execute: vi
        .fn()
        .mockResolvedValue(err(new UseCaseError("not found", USE_CASE_ERRORS.NOT_FOUND))),
    } as unknown as ReplaceOidcClientSecretUseCase;
    const harness = makeFastifyHarness(useCase);
    await oidcAdminRoutes(harness as never, {});

    const reply = makeReply();
    await harness.routes[0]!.handler(
      makeRequest({ accountId: ACCOUNT_ID }, { newClientSecret: "x" }),
      reply.reply
    );
    assert.equal(reply.status, 404);
  });

  it("returns 500 on INTERNAL_ERROR", async () => {
    const useCase = {
      execute: vi
        .fn()
        .mockResolvedValue(err(new UseCaseError("DB exploded", USE_CASE_ERRORS.INTERNAL_ERROR))),
    } as unknown as ReplaceOidcClientSecretUseCase;
    const harness = makeFastifyHarness(useCase);
    await oidcAdminRoutes(harness as never, {});

    const reply = makeReply();
    await harness.routes[0]!.handler(
      makeRequest({ accountId: ACCOUNT_ID }, { newClientSecret: "x" }),
      reply.reply
    );
    assert.equal(reply.status, 500);
  });

  it("rejects invalid body (missing newClientSecret) with 400 — no use case call", async () => {
    const execute = vi.fn();
    const useCase = { execute } as unknown as ReplaceOidcClientSecretUseCase;
    const harness = makeFastifyHarness(useCase);
    await oidcAdminRoutes(harness as never, {});

    const reply = makeReply();
    await harness.routes[0]!.handler(makeRequest({ accountId: ACCOUNT_ID }, {}), reply.reply);
    assert.equal(reply.status, 400);
    assert.equal(execute.mock.calls.length, 0);
  });
});
