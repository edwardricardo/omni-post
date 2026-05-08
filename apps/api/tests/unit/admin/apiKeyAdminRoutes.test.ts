/**
 * @file apiKeyAdminRoutes.test.ts
 * @description Handler-level unit test for the admin ApiKey rotation route
 *              plugin. Mocks the use case + Fastify reply to verify
 *              registration, success path (200 + audit success + raw key
 *              returned), error paths (NOT_FOUND, INTERNAL).
 * @layer infrastructure
 */

import { describe, it, vi, beforeEach } from "vitest";
import assert from "node:assert/strict";
import type { FastifyRequest, FastifyReply } from "fastify";
import { ok, err } from "@shared/types";
import { apiKeyAdminRoutes } from "../../../src/admin/apiKeyAdminRoutes.js";
import { TOKENS } from "../../../src/infrastructure/container/types.js";
import type { RotateApiKeyUseCase } from "../../../src/application/apiKeys/ApiKeyUseCases.js";
import { UseCaseError, USE_CASE_ERRORS } from "../../../src/application/UseCase.js";

const KEY_ID = "ak-uuid-789";

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

function makeFastifyHarness(useCase: RotateApiKeyUseCase): FastifyTestHarness {
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

function makeRequest(params: Record<string, string>): FastifyRequest {
  return {
    log: { error: vi.fn(), info: vi.fn(), warn: vi.fn(), debug: vi.fn() },
    headers: {},
    method: "POST",
    url: "/admin/api-keys/:id/rotate",
    params,
    body: {},
    adminUser: { id: "admin-user-uuid" },
  } as unknown as FastifyRequest;
}

describe("apiKeyAdminRoutes plugin", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("registers POST /admin/api-keys/:id/rotate with admin auth + permission", async () => {
    const useCase = { execute: vi.fn() } as unknown as RotateApiKeyUseCase;
    const harness = makeFastifyHarness(useCase);
    await apiKeyAdminRoutes(harness as never, {});
    assert.equal(harness.routes.length, 1);
    assert.equal(harness.routes[0]!.url, "/admin/api-keys/:id/rotate");
    const preHandler = harness.routes[0]!.options.preHandler as unknown[];
    assert.ok(Array.isArray(preHandler) && preHandler.length === 2);
  });

  it("resolves RotateApiKeyUseCase from DI", async () => {
    const useCase = { execute: vi.fn() } as unknown as RotateApiKeyUseCase;
    const harness = makeFastifyHarness(useCase);
    await apiKeyAdminRoutes(harness as never, {});
    assert.equal(harness.container.resolve.mock.calls[0]?.[0], TOKENS.RotateApiKeyUseCase);
  });

  it("returns 200 with rawKey + emits audit success", async () => {
    const useCase = {
      execute: vi.fn().mockResolvedValue(
        ok({
          key: { accountId: "acct-1" } as unknown,
          rawKey: "ak_raw_NEW_KEY",
        })
      ),
    } as unknown as RotateApiKeyUseCase;
    const harness = makeFastifyHarness(useCase);
    await apiKeyAdminRoutes(harness as never, {});

    const reply = makeReply();
    await harness.routes[0]!.handler(makeRequest({ id: KEY_ID }), reply.reply);

    const body = reply.body as {
      ok: boolean;
      data?: { rotation: { rawKey: string; apiKeyId: string; accountId?: string } };
    };
    assert.equal(body.ok, true);
    assert.equal(body.data?.rotation.apiKeyId, KEY_ID);
    assert.equal(body.data?.rotation.rawKey, "ak_raw_NEW_KEY");
    assert.equal(body.data?.rotation.accountId, "acct-1");

    const auditCall = (auditService.log as ReturnType<typeof vi.fn>).mock.calls[0]?.[0];
    assert.equal(auditCall?.action, "APIKEY_ADMIN_ROTATED");
    assert.equal(auditCall?.success, true);
    assert.equal(auditCall?.userId, "admin-user-uuid");
    assert.equal(auditCall?.details?.accountId, "acct-1");
  });

  it("returns 404 + audit failure on NOT_FOUND", async () => {
    const useCase = {
      execute: vi
        .fn()
        .mockResolvedValue(err(new UseCaseError("API key not found", USE_CASE_ERRORS.NOT_FOUND))),
    } as unknown as RotateApiKeyUseCase;
    const harness = makeFastifyHarness(useCase);
    await apiKeyAdminRoutes(harness as never, {});

    const reply = makeReply();
    await harness.routes[0]!.handler(makeRequest({ id: KEY_ID }), reply.reply);
    assert.equal(reply.status, 404);
    const auditCall = (auditService.log as ReturnType<typeof vi.fn>).mock.calls[0]?.[0];
    assert.equal(auditCall?.success, false);
  });

  it("returns 500 on INTERNAL_ERROR", async () => {
    const useCase = {
      execute: vi
        .fn()
        .mockResolvedValue(err(new UseCaseError("DB exploded", USE_CASE_ERRORS.INTERNAL_ERROR))),
    } as unknown as RotateApiKeyUseCase;
    const harness = makeFastifyHarness(useCase);
    await apiKeyAdminRoutes(harness as never, {});

    const reply = makeReply();
    await harness.routes[0]!.handler(makeRequest({ id: KEY_ID }), reply.reply);
    assert.equal(reply.status, 500);
  });
});
