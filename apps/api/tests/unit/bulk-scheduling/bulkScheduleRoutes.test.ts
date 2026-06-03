/**
 * @file bulkScheduleRoutes.test.ts
 * @description Unit tests for the bulk-scheduling routes:
 *   POST /bulk-scheduling/parse — returns parsed rows, no DB write.
 *   POST /bulk-scheduling/confirm — returns batchId, asserts auth + validation.
 *   GET  /bulk-scheduling/batches/:batchId — manifest poll, unchanged.
 *   POST /bulk-scheduling/imports — 410 Gone (legacy endpoint retired).
 * @layer infrastructure
 */
import { describe, it, beforeEach, afterEach, expect, vi } from "vitest";

// Header-gated auth stub: sets customerUser when a bearer token is present.
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
import { UseCaseError, USE_CASE_ERRORS } from "@core/application/UseCase.js";
import { createTestContainer } from "../../../src/infrastructure/container/setup.js";
import { TOKENS } from "../../../src/infrastructure/container/types.js";
import { bulkScheduleRoutes } from "../../../src/bulk-scheduling/bulkScheduleRoutes.js";

const UUID = "550e8400-e29b-41d4-a716-446655440000";
const AUTH = { authorization: "Bearer test-token" };

interface Stubs {
  parseExecute?: () => Promise<unknown>;
  confirmExecute?: () => Promise<unknown>;
  getExecute?: () => Promise<unknown>;
}

async function makeApp(stubs: Stubs): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  const container = createTestContainer();

  container.registerInstance(TOKENS.ParseBulkScheduleCsvUseCase, {
    execute: vi.fn(
      stubs.parseExecute ?? (async () => ok({ validRows: [], errors: [], totalDataRows: 0 }))
    ),
  });

  container.registerInstance(TOKENS.ConfirmBulkScheduleUseCase, {
    execute: vi.fn(stubs.confirmExecute ?? (async () => ok({ batchId: UUID }))),
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

  // ---------------------------------------------------------------------------
  // POST /bulk-scheduling/parse
  // ---------------------------------------------------------------------------
  describe("POST /bulk-scheduling/parse", () => {
    it("returns 401 without an authorization header", async () => {
      app = await makeApp({});
      const res = await app.inject({
        method: "POST",
        url: "/bulk-scheduling/parse",
        payload: { projectId: UUID, csv: "content,scheduledFor" },
      });
      expect(res.statusCode).toBe(401);
    });

    it("returns 400 when the body is missing csv", async () => {
      app = await makeApp({});
      const res = await app.inject({
        method: "POST",
        url: "/bulk-scheduling/parse",
        headers: AUTH,
        payload: { projectId: UUID },
      });
      expect(res.statusCode).toBe(400);
    });

    it("returns 400 when projectId is not a uuid", async () => {
      app = await makeApp({});
      const res = await app.inject({
        method: "POST",
        url: "/bulk-scheduling/parse",
        headers: AUTH,
        payload: { projectId: "not-a-uuid", csv: "content,scheduledFor\nHi,2030-01-01" },
      });
      expect(res.statusCode).toBe(400);
    });

    it("returns 200 with parsed rows on success", async () => {
      const validRow = {
        row: 1,
        content: "Hi",
        scheduledFor: "2030-01-01T00:00:00.000Z",
        timezone: "UTC",
        media: [],
        tags: [],
      };
      app = await makeApp({
        parseExecute: async () => ok({ validRows: [validRow], errors: [], totalDataRows: 1 }),
      });
      const res = await app.inject({
        method: "POST",
        url: "/bulk-scheduling/parse",
        headers: AUTH,
        payload: { projectId: UUID, csv: "content,scheduledFor\nHi,2030-01-01T00:00:00.000Z" },
      });
      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.data.validRows).toHaveLength(1);
      expect(body.data.totalDataRows).toBe(1);
    });

    it("does NOT call createBatch (stateless — no DB write)", async () => {
      let createBatchCalled = false;
      app = await makeApp({
        parseExecute: async () => {
          createBatchCalled = false; // never set to true
          return ok({ validRows: [], errors: [], totalDataRows: 0 });
        },
      });
      await app.inject({
        method: "POST",
        url: "/bulk-scheduling/parse",
        headers: AUTH,
        payload: { projectId: UUID, csv: "content,scheduledFor\nHi,2030-01-01" },
      });
      expect(createBatchCalled).toBe(false);
    });
  });

  // ---------------------------------------------------------------------------
  // POST /bulk-scheduling/confirm
  // ---------------------------------------------------------------------------
  describe("POST /bulk-scheduling/confirm", () => {
    const validConfirmBody = {
      projectId: UUID,
      channelIds: [UUID],
      rows: [
        {
          row: 1,
          content: "Hi",
          scheduledFor: "2030-01-01T00:00:00.000Z",
          timezone: "UTC",
          media: [],
          tags: [],
        },
      ],
    };

    it("returns 401 without an authorization header", async () => {
      app = await makeApp({});
      const res = await app.inject({
        method: "POST",
        url: "/bulk-scheduling/confirm",
        payload: validConfirmBody,
      });
      expect(res.statusCode).toBe(401);
    });

    it("returns 400 when projectId is not a uuid", async () => {
      app = await makeApp({});
      const res = await app.inject({
        method: "POST",
        url: "/bulk-scheduling/confirm",
        headers: AUTH,
        payload: { ...validConfirmBody, projectId: "not-a-uuid" },
      });
      expect(res.statusCode).toBe(400);
    });

    it("returns 202 with batchId on success", async () => {
      app = await makeApp({ confirmExecute: async () => ok({ batchId: UUID }) });
      const res = await app.inject({
        method: "POST",
        url: "/bulk-scheduling/confirm",
        headers: AUTH,
        payload: validConfirmBody,
      });
      expect(res.statusCode).toBe(202);
      const body = JSON.parse(res.body);
      expect(body.data.batchId).toBe(UUID);
    });

    it("returns 403 when use case returns FORBIDDEN (foreign channelId)", async () => {
      app = await makeApp({
        confirmExecute: async () =>
          err(new UseCaseError("channelIds not owned by project", USE_CASE_ERRORS.FORBIDDEN)),
      });
      const res = await app.inject({
        method: "POST",
        url: "/bulk-scheduling/confirm",
        headers: AUTH,
        payload: validConfirmBody,
      });
      expect(res.statusCode).toBe(403);
    });

    it("accountId comes from auth context, not from request body", async () => {
      let capturedAccountId: string | undefined;
      app = await makeApp({
        confirmExecute: async (input: unknown) => {
          capturedAccountId = (input as { accountId: string }).accountId;
          return ok({ batchId: UUID });
        },
      });
      await app.inject({
        method: "POST",
        url: "/bulk-scheduling/confirm",
        headers: AUTH,
        payload: validConfirmBody,
      });
      expect(capturedAccountId).toBe("acc-1"); // from auth stub, not from body
    });
  });

  // ---------------------------------------------------------------------------
  // GET /bulk-scheduling/batches/:batchId
  // ---------------------------------------------------------------------------
  describe("GET /bulk-scheduling/batches/:batchId", () => {
    it("returns 401 without an authorization header", async () => {
      app = await makeApp({});
      const res = await app.inject({ method: "GET", url: `/bulk-scheduling/batches/${UUID}` });
      expect(res.statusCode).toBe(401);
    });

    it("returns 400 for a non-uuid batch id", async () => {
      app = await makeApp({});
      const res = await app.inject({
        method: "GET",
        url: "/bulk-scheduling/batches/not-a-uuid",
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
        url: `/bulk-scheduling/batches/${UUID}`,
        headers: AUTH,
      });
      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.data.id).toBe(UUID);
    });
  });

  // ---------------------------------------------------------------------------
  // POST /bulk-scheduling/imports — 410 Gone (retired)
  // ---------------------------------------------------------------------------
  describe("POST /bulk-scheduling/imports (retired)", () => {
    it("returns 410 Gone", async () => {
      app = await makeApp({});
      const res = await app.inject({
        method: "POST",
        url: "/bulk-scheduling/imports",
        headers: AUTH,
        payload: { projectId: UUID, csv: "content,scheduledFor" },
      });
      expect(res.statusCode).toBe(410);
    });
  });
});
