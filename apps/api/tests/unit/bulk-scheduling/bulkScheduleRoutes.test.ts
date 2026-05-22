/**
 * @file bulkScheduleRoutes.test.ts
 * @description Unit tests for the bulk-scheduling routes: auth required, body /
 *              param validation, status mapping (202 / 400 / 401 / 404), and
 *              account scoping. Use cases are stubbed in the DI container; no DB.
 * @layer infrastructure
 */
import { describe, it, beforeEach, afterEach, expect, vi } from "vitest";

// Header-gated auth stub: sets customerUser when a bearer token is present,
// otherwise rejects with 401 — lets us exercise both the authed and anon paths.
vi.mock("../../../src/auth/customerAuthMiddleware.js", () => ({
  requireClientAuth: async (
    req: { headers: Record<string, string | undefined>; customerUser?: unknown },
    reply: { code: (n: number) => { send: (b: unknown) => void } }
  ) => {
    if (!req.headers.authorization) {
      reply.code(401).send({ ok: false, error: "Authorization token required" });
      return;
    }
    req.customerUser = {
      id: "user-1",
      accountId: "acc-1",
      roleId: "role-1",
      roleName: "owner",
      permissions: [],
    };
  },
}));

import Fastify, { type FastifyInstance } from "fastify";
import { ok, err } from "@shared/types";
import { UseCaseError, USE_CASE_ERRORS } from "../../../src/application/UseCase.js";
import { createTestContainer } from "../../../src/infrastructure/container/setup.js";
import { TOKENS } from "../../../src/infrastructure/container/types.js";
import { bulkScheduleRoutes } from "../../../src/bulk-scheduling/bulkScheduleRoutes.js";

const UUID = "550e8400-e29b-41d4-a716-446655440000";
const AUTH = { authorization: "Bearer test-token" };

interface Stubs {
  importExecute?: () => Promise<unknown>;
  getExecute?: () => Promise<unknown>;
}

async function makeApp(stubs: Stubs): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  const container = createTestContainer();
  container.registerInstance(TOKENS.ImportSchedulingCsvUseCase, {
    execute: vi.fn(
      stubs.importExecute ??
        (async () => ok({ batchId: UUID, totalRows: 0, validRows: 0, invalidRows: 0 }))
    ),
  });
  container.registerInstance(TOKENS.GetBulkScheduleBatchQuery, {
    execute: vi.fn(stubs.getExecute ?? (async () => ok({ id: UUID, items: [] }))),
  });
  app.decorate("container", container);
  await app.register(bulkScheduleRoutes);
  await app.ready();
  return app;
}

let app: FastifyInstance;

describe("bulkScheduleRoutes", () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(async () => {
    if (app) await app.close();
  });

  describe("POST /bulk-scheduling/imports", () => {
    it("returns 401 without an authorization header", async () => {
      app = await makeApp({});
      const res = await app.inject({
        method: "POST",
        url: "/bulk-scheduling/imports",
        payload: { projectId: UUID, csv: "provider,content,scheduledFor" },
      });
      expect(res.statusCode).toBe(401);
    });

    it("returns 400 when the body is missing csv", async () => {
      app = await makeApp({});
      const res = await app.inject({
        method: "POST",
        url: "/bulk-scheduling/imports",
        headers: AUTH,
        payload: { projectId: UUID },
      });
      expect(res.statusCode).toBe(400);
    });

    it("returns 400 when projectId is not a uuid", async () => {
      app = await makeApp({});
      const res = await app.inject({
        method: "POST",
        url: "/bulk-scheduling/imports",
        headers: AUTH,
        payload: { projectId: "not-a-uuid", csv: "x" },
      });
      expect(res.statusCode).toBe(400);
    });

    it("returns 202 with the batch summary on success", async () => {
      app = await makeApp({
        importExecute: async () =>
          ok({ batchId: UUID, totalRows: 3, validRows: 2, invalidRows: 1 }),
      });
      const res = await app.inject({
        method: "POST",
        url: "/bulk-scheduling/imports",
        headers: AUTH,
        payload: {
          projectId: UUID,
          csv: "provider,content,scheduledFor\nX,Hi,2030-01-01T00:00:00Z",
        },
      });
      expect(res.statusCode).toBe(202);
      const body = JSON.parse(res.body);
      expect(body.data.batchId).toBe(UUID);
      expect(body.data.validRows).toBe(2);
    });

    it("maps a NOT_FOUND use-case error to 404", async () => {
      app = await makeApp({
        importExecute: async () =>
          err(new UseCaseError("Project not found", USE_CASE_ERRORS.NOT_FOUND)),
      });
      const res = await app.inject({
        method: "POST",
        url: "/bulk-scheduling/imports",
        headers: AUTH,
        payload: { projectId: UUID, csv: "x" },
      });
      expect(res.statusCode).toBe(404);
    });
  });

  describe("GET /bulk-scheduling/imports/:batchId", () => {
    it("returns 401 without an authorization header", async () => {
      app = await makeApp({});
      const res = await app.inject({ method: "GET", url: `/bulk-scheduling/imports/${UUID}` });
      expect(res.statusCode).toBe(401);
    });

    it("returns 400 for a non-uuid batch id", async () => {
      app = await makeApp({});
      const res = await app.inject({
        method: "GET",
        url: "/bulk-scheduling/imports/not-a-uuid",
        headers: AUTH,
      });
      expect(res.statusCode).toBe(400);
    });

    it("returns 200 with the manifest when found", async () => {
      app = await makeApp({
        getExecute: async () =>
          ok({ id: UUID, accountId: "acc-1", items: [{ id: "i1", rowNumber: 1 }] }),
      });
      const res = await app.inject({
        method: "GET",
        url: `/bulk-scheduling/imports/${UUID}`,
        headers: AUTH,
      });
      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.data.id).toBe(UUID);
    });

    it("maps a NOT_FOUND use-case error to 404", async () => {
      app = await makeApp({
        getExecute: async () => err(new UseCaseError("not found", USE_CASE_ERRORS.NOT_FOUND)),
      });
      const res = await app.inject({
        method: "GET",
        url: `/bulk-scheduling/imports/${UUID}`,
        headers: AUTH,
      });
      expect(res.statusCode).toBe(404);
    });
  });
});
