/**
 * @file channelReauthRoutes.test.ts
 * @description Handler-level unit test for the channel force-reauth admin
 *              route plugin. Mocks the use case + Fastify reply to verify
 *              registration, success path (200 + audit success log), and
 *              error paths (validation 400, not-found 404, internal 500 +
 *              audit failure log).
 * @layer infrastructure
 */

import { describe, it, vi, beforeEach } from "vitest";
import assert from "node:assert/strict";
import type { FastifyRequest, FastifyReply } from "fastify";
import { ok, err } from "@shared/types";
import { channelReauthRoutes } from "../../../src/admin/channelReauthRoutes.js";
import { TOKENS } from "../../../src/infrastructure/container/types.js";
import {
  UpdateChannelAuthStateUseCase,
  type UpdateChannelAuthStateOutput,
} from "../../../src/application/channels/index.js";
import { UseCaseError, USE_CASE_ERRORS } from "../../../src/application/UseCase.js";

const VALID_CHANNEL_ID = "550e8400-e29b-41d4-a716-446655440001";

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

function makeFastifyHarness(useCase: UpdateChannelAuthStateUseCase): FastifyTestHarness {
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
    url: "/admin/channels/:id/force-reauth",
    params,
    body,
    adminUser: { id: "admin-user-uuid" },
  } as unknown as FastifyRequest;
}

function successOutput(): UpdateChannelAuthStateOutput {
  return {
    channelId: VALID_CHANNEL_ID,
    projectId: "proj-uuid",
    provider: "X",
    needsReauth: true,
    authFailedAt: "2026-05-06T17:00:00.000Z",
  };
}

describe("channelReauthRoutes plugin", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("registers POST /admin/channels/:id/force-reauth with admin auth + permission", async () => {
    const useCase = { execute: vi.fn() } as unknown as UpdateChannelAuthStateUseCase;
    const harness = makeFastifyHarness(useCase);
    await channelReauthRoutes(harness as never, {});
    assert.equal(harness.routes.length, 1);
    assert.equal(harness.routes[0]!.url, "/admin/channels/:id/force-reauth");
    const preHandler = harness.routes[0]!.options.preHandler as unknown[];
    assert.ok(Array.isArray(preHandler) && preHandler.length === 2);
  });

  it("resolves UpdateChannelAuthStateUseCase from DI", async () => {
    const useCase = { execute: vi.fn() } as unknown as UpdateChannelAuthStateUseCase;
    const harness = makeFastifyHarness(useCase);
    await channelReauthRoutes(harness as never, {});
    assert.equal(
      harness.container.resolve.mock.calls[0]?.[0],
      TOKENS.UpdateChannelAuthStateUseCase
    );
  });

  it("returns 200 + emits audit success when use case succeeds", async () => {
    const useCase = {
      execute: vi.fn().mockResolvedValue(ok(successOutput())),
    } as unknown as UpdateChannelAuthStateUseCase;
    const harness = makeFastifyHarness(useCase);
    await channelReauthRoutes(harness as never, {});

    const reply = makeReply();
    await harness.routes[0]!.handler(
      makeRequest({ id: VALID_CHANNEL_ID }, { reason: "rotation" }),
      reply.reply
    );

    const body = reply.body as { ok: boolean; data?: { channel: UpdateChannelAuthStateOutput } };
    assert.equal(body.ok, true);
    assert.equal(body.data?.channel.channelId, VALID_CHANNEL_ID);

    const auditCall = (auditService.log as ReturnType<typeof vi.fn>).mock.calls[0]?.[0];
    assert.equal(auditCall?.action, "CHANNEL_FORCE_REAUTH");
    assert.equal(auditCall?.success, true);
    assert.equal(auditCall?.userId, "admin-user-uuid");
  });

  it("returns 404 + emits audit failure when use case returns NOT_FOUND", async () => {
    const useCase = {
      execute: vi
        .fn()
        .mockResolvedValue(err(new UseCaseError("Channel not found", USE_CASE_ERRORS.NOT_FOUND))),
    } as unknown as UpdateChannelAuthStateUseCase;
    const harness = makeFastifyHarness(useCase);
    await channelReauthRoutes(harness as never, {});

    const reply = makeReply();
    await harness.routes[0]!.handler(makeRequest({ id: VALID_CHANNEL_ID }), reply.reply);

    assert.equal(reply.status, 404);
    const auditCall = (auditService.log as ReturnType<typeof vi.fn>).mock.calls[0]?.[0];
    assert.equal(auditCall?.success, false);
  });

  it("returns 400 when use case returns VALIDATION_FAILED", async () => {
    const useCase = {
      execute: vi
        .fn()
        .mockResolvedValue(
          err(new UseCaseError("Invalid channel ID", USE_CASE_ERRORS.VALIDATION_FAILED))
        ),
    } as unknown as UpdateChannelAuthStateUseCase;
    const harness = makeFastifyHarness(useCase);
    await channelReauthRoutes(harness as never, {});

    const reply = makeReply();
    await harness.routes[0]!.handler(makeRequest({ id: VALID_CHANNEL_ID }), reply.reply);

    assert.equal(reply.status, 400);
  });

  it("returns 500 when use case returns INTERNAL_ERROR", async () => {
    const useCase = {
      execute: vi
        .fn()
        .mockResolvedValue(err(new UseCaseError("DB exploded", USE_CASE_ERRORS.INTERNAL_ERROR))),
    } as unknown as UpdateChannelAuthStateUseCase;
    const harness = makeFastifyHarness(useCase);
    await channelReauthRoutes(harness as never, {});

    const reply = makeReply();
    await harness.routes[0]!.handler(makeRequest({ id: VALID_CHANNEL_ID }), reply.reply);

    assert.equal(reply.status, 500);
  });

  it("uses default reason when body omits it", async () => {
    const useCaseSpy = vi.fn().mockResolvedValue(ok(successOutput()));
    const useCase = { execute: useCaseSpy } as unknown as UpdateChannelAuthStateUseCase;
    const harness = makeFastifyHarness(useCase);
    await channelReauthRoutes(harness as never, {});

    const reply = makeReply();
    await harness.routes[0]!.handler(makeRequest({ id: VALID_CHANNEL_ID }, {}), reply.reply);

    const callArg = useCaseSpy.mock.calls[0]?.[0] as { reason?: string };
    assert.ok(callArg.reason && callArg.reason.length > 0);
  });
});
