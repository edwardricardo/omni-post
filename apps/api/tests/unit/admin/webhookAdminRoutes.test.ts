/**
 * @file webhookAdminRoutes.test.ts
 * @description Handler-level unit test for the webhook-admin route plugin.
 *              Mocks the use case + Fastify reply to verify registration,
 *              success path (200 + audit success log), and error paths.
 * @layer infrastructure
 */

import { describe, it, vi, beforeEach } from "vitest";
import assert from "node:assert/strict";
import type { FastifyRequest, FastifyReply } from "fastify";
import { ok, err } from "@shared/types";
import { webhookAdminRoutes } from "../../../src/admin/webhookAdminRoutes.js";
import { TOKENS } from "../../../src/infrastructure/container/types.js";
import type {
  RotateWebhookSecretKeyUseCase,
  RotateWebhookSecretKeyOutput,
} from "../../../src/application/webhooks/RotateWebhookSecretKeyUseCase.js";
import { UseCaseError, USE_CASE_ERRORS } from "../../../src/application/UseCase.js";

const SUB_ID = "550e8400-e29b-41d4-a716-446655440099";

interface CapturedRoute {
  url: string;
  options: Record<string, unknown>;
  handler: (req: FastifyRequest, reply: FastifyReply) => Promise<unknown>;
}

interface FastifyTestHarness {
  routes: CapturedRoute[];
  container: { resolve: ReturnType<typeof vi.fn> };
  post: ReturnType<typeof vi.fn>;
  auditLog: ReturnType<typeof vi.fn>;
}

function makeFastifyHarness(useCase: RotateWebhookSecretKeyUseCase): FastifyTestHarness {
  const routes: CapturedRoute[] = [];
  const auditLog = vi.fn().mockResolvedValue(undefined);
  const auditService = { log: auditLog };
  return {
    routes,
    auditLog,
    container: {
      resolve: vi.fn((token: symbol) => (token === TOKENS.AuditService ? auditService : useCase)),
    },
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
    url: "/admin/webhooks/:id/rotate-secret",
    params,
    body,
    adminUser: { id: "admin-user-uuid" },
  } as unknown as FastifyRequest;
}

function successOutput(): RotateWebhookSecretKeyOutput {
  return {
    webhookSubscriptionId: SUB_ID,
    newSecretKey: "shiny-new-secret-hex",
    previousSecretKeyExpiresAt: "2026-05-07T12:00:00.000Z",
    graceWindowHours: 24,
  };
}

describe("webhookAdminRoutes plugin", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("registers POST /admin/webhooks/:id/rotate-secret with admin auth + permission", async () => {
    const useCase = { execute: vi.fn() } as unknown as RotateWebhookSecretKeyUseCase;
    const harness = makeFastifyHarness(useCase);
    await webhookAdminRoutes(harness as never, {});
    assert.equal(harness.routes.length, 1);
    assert.equal(harness.routes[0]!.url, "/admin/webhooks/:id/rotate-secret");
    const preHandler = harness.routes[0]!.options.preHandler as unknown[];
    assert.ok(Array.isArray(preHandler) && preHandler.length === 2);
  });

  it("resolves RotateWebhookSecretKeyUseCase from DI", async () => {
    const useCase = { execute: vi.fn() } as unknown as RotateWebhookSecretKeyUseCase;
    const harness = makeFastifyHarness(useCase);
    await webhookAdminRoutes(harness as never, {});
    assert.equal(
      harness.container.resolve.mock.calls[0]?.[0],
      TOKENS.RotateWebhookSecretKeyUseCase
    );
  });

  it("returns 200 + emits audit success when use case succeeds", async () => {
    const execute = vi.fn().mockResolvedValue(ok(successOutput()));
    const useCase = { execute } as unknown as RotateWebhookSecretKeyUseCase;
    const harness = makeFastifyHarness(useCase);
    await webhookAdminRoutes(harness as never, {});

    const reply = makeReply();
    await harness.routes[0]!.handler(
      makeRequest({ id: SUB_ID }, { graceWindowHours: 24 }),
      reply.reply
    );

    const body = reply.body as {
      ok: boolean;
      data?: { rotation: RotateWebhookSecretKeyOutput };
    };
    assert.equal(body.ok, true);
    assert.equal(body.data?.rotation.webhookSubscriptionId, SUB_ID);

    const auditCall = harness.auditLog.mock.calls[0]?.[0];
    assert.equal(auditCall?.action, "WEBHOOK_SECRET_ROTATED");
    assert.equal(auditCall?.success, true);
    assert.equal(auditCall?.userId, "admin-user-uuid");
    assert.equal(auditCall?.details?.graceWindowHours, 24);
  });

  it("forwards graceWindowHours from body to use case execute()", async () => {
    const execute = vi.fn().mockResolvedValue(ok(successOutput()));
    const useCase = { execute } as unknown as RotateWebhookSecretKeyUseCase;
    const harness = makeFastifyHarness(useCase);
    await webhookAdminRoutes(harness as never, {});

    const reply = makeReply();
    await harness.routes[0]!.handler(
      makeRequest({ id: SUB_ID }, { graceWindowHours: 48 }),
      reply.reply
    );

    const arg = execute.mock.calls[0]?.[0];
    assert.equal(arg.graceWindowHours, 48);
    assert.equal(arg.webhookSubscriptionId, SUB_ID);
  });

  it("omits graceWindowHours from execute() when body lacks it (use case applies default)", async () => {
    const execute = vi.fn().mockResolvedValue(ok(successOutput()));
    const useCase = { execute } as unknown as RotateWebhookSecretKeyUseCase;
    const harness = makeFastifyHarness(useCase);
    await webhookAdminRoutes(harness as never, {});

    const reply = makeReply();
    await harness.routes[0]!.handler(makeRequest({ id: SUB_ID }), reply.reply);

    const arg = execute.mock.calls[0]?.[0];
    assert.equal(arg.graceWindowHours, undefined);
  });

  it("returns 404 + emits audit failure when use case returns NOT_FOUND", async () => {
    const useCase = {
      execute: vi
        .fn()
        .mockResolvedValue(err(new UseCaseError("not found", USE_CASE_ERRORS.NOT_FOUND))),
    } as unknown as RotateWebhookSecretKeyUseCase;
    const harness = makeFastifyHarness(useCase);
    await webhookAdminRoutes(harness as never, {});

    const reply = makeReply();
    await harness.routes[0]!.handler(makeRequest({ id: SUB_ID }), reply.reply);

    assert.equal(reply.status, 404);
    const auditCall = harness.auditLog.mock.calls[0]?.[0];
    assert.equal(auditCall?.success, false);
  });

  it("returns 400 when use case returns VALIDATION_FAILED", async () => {
    const useCase = {
      execute: vi
        .fn()
        .mockResolvedValue(
          err(new UseCaseError("invalid grace window", USE_CASE_ERRORS.VALIDATION_FAILED))
        ),
    } as unknown as RotateWebhookSecretKeyUseCase;
    const harness = makeFastifyHarness(useCase);
    await webhookAdminRoutes(harness as never, {});

    const reply = makeReply();
    await harness.routes[0]!.handler(makeRequest({ id: SUB_ID }), reply.reply);
    assert.equal(reply.status, 400);
  });

  it("returns 500 when use case returns INTERNAL_ERROR", async () => {
    const useCase = {
      execute: vi
        .fn()
        .mockResolvedValue(err(new UseCaseError("DB exploded", USE_CASE_ERRORS.INTERNAL_ERROR))),
    } as unknown as RotateWebhookSecretKeyUseCase;
    const harness = makeFastifyHarness(useCase);
    await webhookAdminRoutes(harness as never, {});

    const reply = makeReply();
    await harness.routes[0]!.handler(makeRequest({ id: SUB_ID }), reply.reply);
    assert.equal(reply.status, 500);
  });
});
