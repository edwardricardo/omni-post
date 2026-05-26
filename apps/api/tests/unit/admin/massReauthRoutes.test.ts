/**
 * @file massReauthRoutes.test.ts
 * @description Handler-level unit test for the mass-reauth admin route plugin.
 *              Mocks use case + Fastify reply to verify registration, body
 *              parsing, success path with audit-success, and error paths
 *              (validation 400, internal 500).
 * @layer infrastructure
 */

import { describe, it, vi, beforeEach } from "vitest";
import assert from "node:assert/strict";
import type { FastifyRequest, FastifyReply } from "fastify";
import { ok, err } from "@shared/types";
import { massReauthRoutes } from "../../../src/admin/massReauthRoutes.js";
import { TOKENS } from "../../../src/infrastructure/container/types.js";
import type {
  MassForceReauthByProviderUseCase,
  MassForceReauthOutput,
} from "@core/application/providers/MassForceReauthByProviderUseCase.js";
import { UseCaseError, USE_CASE_ERRORS } from "@core/application/UseCase.js";

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

function makeFastifyHarness(useCase: MassForceReauthByProviderUseCase): FastifyTestHarness {
  const routes: CapturedRoute[] = [];
  // AuditService is resolved from the container (not a module singleton), so the
  // harness registers a spy and resolves it for TOKENS.AuditService.
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
    url: "/admin/providers/:provider/force-mass-reauth",
    params,
    body,
    adminUser: { id: "admin-user-uuid" },
  } as unknown as FastifyRequest;
}

function successOutput(): MassForceReauthOutput {
  return {
    provider: "FACEBOOK",
    tiers: {
      flagChannels: true,
      softDeleteChannels: false,
    },
    channelsFlagged: 12,
    channelsSoftDeleted: 0,
    channelIds: ["c1", "c2"],
  };
}

describe("massReauthRoutes plugin", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("registers POST /admin/providers/:provider/force-mass-reauth with admin auth + permission", async () => {
    const useCase = { execute: vi.fn() } as unknown as MassForceReauthByProviderUseCase;
    const harness = makeFastifyHarness(useCase);
    await massReauthRoutes(harness as never, {});
    assert.equal(harness.routes.length, 1);
    assert.equal(harness.routes[0]!.url, "/admin/providers/:provider/force-mass-reauth");
    const preHandler = harness.routes[0]!.options.preHandler as unknown[];
    assert.ok(Array.isArray(preHandler) && preHandler.length === 2);
  });

  it("resolves MassForceReauthByProviderUseCase from DI", async () => {
    const useCase = { execute: vi.fn() } as unknown as MassForceReauthByProviderUseCase;
    const harness = makeFastifyHarness(useCase);
    await massReauthRoutes(harness as never, {});
    assert.equal(
      harness.container.resolve.mock.calls[0]?.[0],
      TOKENS.MassForceReauthByProviderUseCase
    );
  });

  it("returns 200 + emits audit success with aggregated counts", async () => {
    const useCase = {
      execute: vi.fn().mockResolvedValue(ok(successOutput())),
    } as unknown as MassForceReauthByProviderUseCase;
    const harness = makeFastifyHarness(useCase);
    await massReauthRoutes(harness as never, {});

    const reply = makeReply();
    await harness.routes[0]!.handler(
      makeRequest({ provider: "FACEBOOK" }, { reason: "rotation" }),
      reply.reply
    );

    const body = reply.body as {
      ok: boolean;
      data?: { rotation: MassForceReauthOutput };
    };
    assert.equal(body.ok, true);
    assert.equal(body.data?.rotation.provider, "FACEBOOK");
    assert.equal(body.data?.rotation.channelsFlagged, 12);

    const auditCall = harness.auditLog.mock.calls[0]?.[0];
    assert.equal(auditCall?.action, "PROVIDER_MASS_FORCE_REAUTH");
    assert.equal(auditCall?.success, true);
    assert.equal(auditCall?.userId, "admin-user-uuid");
    assert.equal(auditCall?.details?.channelsFlagged, 12);
    assert.equal(auditCall?.details?.tiers?.flagChannels, true);
    assert.equal(auditCall?.details?.reason, "rotation");
  });

  it("returns 400 + audit failure when use case returns VALIDATION_FAILED", async () => {
    const useCase = {
      execute: vi
        .fn()
        .mockResolvedValue(
          err(new UseCaseError("Invalid provider", USE_CASE_ERRORS.VALIDATION_FAILED))
        ),
    } as unknown as MassForceReauthByProviderUseCase;
    const harness = makeFastifyHarness(useCase);
    await massReauthRoutes(harness as never, {});

    const reply = makeReply();
    await harness.routes[0]!.handler(
      makeRequest({ provider: "BOGUS" }, { reason: "x" }),
      reply.reply
    );
    assert.equal(reply.status, 400);
    const auditCall = harness.auditLog.mock.calls[0]?.[0];
    assert.equal(auditCall?.success, false);
  });

  it("returns 400 when body is missing reason (no use case call)", async () => {
    const execute = vi.fn();
    const useCase = { execute } as unknown as MassForceReauthByProviderUseCase;
    const harness = makeFastifyHarness(useCase);
    await massReauthRoutes(harness as never, {});

    const reply = makeReply();
    await harness.routes[0]!.handler(makeRequest({ provider: "FACEBOOK" }, {}), reply.reply);
    assert.equal(reply.status, 400);
    assert.equal(execute.mock.calls.length, 0);
  });

  it("returns 500 on INTERNAL_ERROR", async () => {
    const useCase = {
      execute: vi
        .fn()
        .mockResolvedValue(err(new UseCaseError("DB exploded", USE_CASE_ERRORS.INTERNAL_ERROR))),
    } as unknown as MassForceReauthByProviderUseCase;
    const harness = makeFastifyHarness(useCase);
    await massReauthRoutes(harness as never, {});

    const reply = makeReply();
    await harness.routes[0]!.handler(
      makeRequest({ provider: "FACEBOOK" }, { reason: "x" }),
      reply.reply
    );
    assert.equal(reply.status, 500);
  });
});
