/**
 * @file secretsRotationRoutes.test.ts
 * @description Handler-level unit test for the secrets-rotation routes plugin.
 *              Mocks the query and Fastify reply to verify success and error
 *              paths without standing up a Fastify server (real-server
 *              coverage lives in the integration test).
 * @layer infrastructure
 */

import { describe, it, vi, beforeEach } from "vitest";
import assert from "node:assert/strict";
import type { FastifyRequest, FastifyReply } from "fastify";
import type { Result } from "@shared/types";
import { secretsRotationRoutes } from "../../../src/admin/secretsRotationRoutes.js";
import { TOKENS } from "../../../src/infrastructure/container/types.js";
import {
  GetSecretRotationStatusQuery,
  type GetSecretRotationStatusOutput,
  type SecretRotationLogReadRepository,
} from "@core/security/GetSecretRotationStatusQuery.js";
import { UseCaseError, USE_CASE_ERRORS } from "@core/application/UseCase.js";

interface CapturedRoute {
  url: string;
  options: Record<string, unknown>;
  handler: (req: FastifyRequest, reply: FastifyReply) => Promise<unknown>;
}

interface FastifyTestHarness {
  routes: CapturedRoute[];
  container: {
    resolve: ReturnType<typeof vi.fn>;
  };
  get: ReturnType<typeof vi.fn>;
}

function makeFastifyHarness(query: GetSecretRotationStatusQuery): FastifyTestHarness {
  const routes: CapturedRoute[] = [];
  const harness = {
    routes,
    container: {
      resolve: vi.fn().mockReturnValue(query),
    },
    get: vi.fn(
      (
        url: string,
        options: Record<string, unknown>,
        handler: (req: FastifyRequest, reply: FastifyReply) => Promise<unknown>
      ) => {
        routes.push({ url, options, handler });
      }
    ),
  };
  return harness;
}

interface CapturedReply {
  status: number | null;
  body: unknown;
  reply: FastifyReply;
}

function makeReply(): CapturedReply {
  const captured: CapturedReply = { status: null, body: null, reply: {} as FastifyReply };
  captured.reply = {
    code: vi.fn((statusCode: number) => {
      captured.status = statusCode;
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

function makeRequest(): FastifyRequest {
  return {
    log: { error: vi.fn(), info: vi.fn(), warn: vi.fn(), debug: vi.fn() },
    headers: {},
    method: "GET",
    url: "/admin/security/secrets/rotation-status",
  } as unknown as FastifyRequest;
}

function emptyRepo(): SecretRotationLogReadRepository {
  return {
    async findLatestBySecretNames() {
      return new Map();
    },
  };
}

describe("secretsRotationRoutes plugin", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("registers GET /admin/security/secrets/rotation-status with admin auth + SECRETS_VIEW", async () => {
    const query = new GetSecretRotationStatusQuery(emptyRepo());
    const harness = makeFastifyHarness(query);
    await secretsRotationRoutes(harness as never, {});
    assert.equal(harness.routes.length, 1);
    assert.equal(harness.routes[0]!.url, "/admin/security/secrets/rotation-status");
    const preHandler = harness.routes[0]!.options.preHandler as unknown[];
    assert.ok(Array.isArray(preHandler) && preHandler.length === 2);
  });

  it("resolves the GetSecretRotationStatusQuery from DI", async () => {
    const query = new GetSecretRotationStatusQuery(emptyRepo());
    const harness = makeFastifyHarness(query);
    await secretsRotationRoutes(harness as never, {});
    assert.equal(harness.container.resolve.mock.calls[0]?.[0], TOKENS.GetSecretRotationStatusQuery);
  });

  it("returns 200 with { secrets } when query succeeds", async () => {
    const query = new GetSecretRotationStatusQuery(emptyRepo());
    const harness = makeFastifyHarness(query);
    await secretsRotationRoutes(harness as never, {});

    const reply = makeReply();
    await harness.routes[0]!.handler(makeRequest(), reply.reply);

    const body = reply.body as { ok: boolean; data?: { secrets: GetSecretRotationStatusOutput } };
    assert.ok(body);
    assert.equal(body.ok, true);
    assert.ok(Array.isArray(body.data?.secrets), "expected data.secrets to be an array");
  });

  it("returns 500 when the query yields an error", async () => {
    const failingQuery = {
      execute: vi.fn(
        async (): Promise<Result<GetSecretRotationStatusOutput, UseCaseError>> => ({
          ok: false,
          error: new UseCaseError("boom", USE_CASE_ERRORS.INTERNAL_ERROR),
        })
      ),
    } as unknown as GetSecretRotationStatusQuery;
    const harness = makeFastifyHarness(failingQuery);
    await secretsRotationRoutes(harness as never, {});

    const reply = makeReply();
    await harness.routes[0]!.handler(makeRequest(), reply.reply);

    assert.equal(reply.status, 500);
    const body = reply.body as { ok: boolean; error: string };
    assert.equal(body.ok, false);
    assert.equal(body.error, "boom");
  });
});
