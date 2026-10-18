/**
 * @file requireCallerOwnsAccountParam.test.ts
 * @description Unit tests for `requireCallerOwnsAccountParam`, the own-account preHandler of the
 *   account and project routes, driven through a real Fastify instance: a route whose path names
 *   an account sits behind a stand-in for `requireClientAuth` that binds the principal a test
 *   chooses, then the gate, then a handler spy. The route suites pin the gate in place; this one
 *   pins each of its answers, the cross-tenant log entry, and that a refused request never reaches
 *   the handler even while an async `onSend` hook holds the response open.
 * @layer infrastructure
 */

import { describe, it, beforeEach, afterEach, expect, vi } from "vitest";

const { loggerDouble } = vi.hoisted(() => ({
  loggerDouble: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    trace: vi.fn(),
    fatal: vi.fn(),
  },
}));

vi.mock("../../../src/lib/logger.js", () => ({
  logger: loggerDouble,
  authLogger: loggerDouble,
  createLogger: () => loggerDouble,
}));

const Fastify = (await import("fastify")).default;
const { requireCallerOwnsAccountParam } =
  await import("../../../src/auth/requireCallerOwnsAccountParam.js");

import type { FastifyInstance, FastifyRequest } from "fastify";
import type { CustomerRequestUser } from "../../../src/auth/customerAuthMiddleware.js";

const CALLER_ACCOUNT_ID = "c0000000-0000-4000-8000-000000000001";
const FOREIGN_ACCOUNT_ID = "c0000000-0000-4000-8000-000000000002";

/** The principal the stand-in authentication binds; `undefined` binds none. */
let boundAccountId: string | undefined;
const handler = vi.fn(async () => ({ reached: true }));

/** Binds a customer principal the way `requireClientAuth` does, or none at all. */
async function bindPrincipal(request: FastifyRequest): Promise<void> {
  if (boundAccountId === undefined) return;
  const principal: CustomerRequestUser = {
    id: "customer-user-1",
    accountId: boundAccountId,
    roleId: "role-owner",
    roleName: "OWNER",
    permissions: ["account:manage"],
  };
  request.customerUser = principal;
}

/**
 * Builds the probe app. With `slowOnSend`, an async `onSend` hook holds every response open for a
 * tick after `send` returns: the shape in which Fastify, which skips the handler only once the
 * response has ended, would still run it for a gate that does not wait for its reply.
 */
async function createProbeApp(options: { slowOnSend: boolean }): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  if (options.slowOnSend) {
    app.addHook("onSend", async (_request, _reply, payload) => {
      await new Promise<void>((resolve) => setImmediate(resolve));
      return payload;
    });
  }
  app.get(
    "/accounts/:accountId/probe",
    { preHandler: [bindPrincipal, requireCallerOwnsAccountParam("probes")] },
    handler
  );
  await app.ready();
  return app;
}

let app: FastifyInstance;

describe("requireCallerOwnsAccountParam", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    boundAccountId = CALLER_ACCOUNT_ID;
    app = await createProbeApp({ slowOnSend: false });
  });

  afterEach(async () => {
    await app.close();
  });

  it("lets the request through to the handler when the path names the caller's own account", async () => {
    const response = await app.inject({
      method: "GET",
      url: `/accounts/${CALLER_ACCOUNT_ID}/probe`,
    });

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body)).toEqual({ reached: true });
    expect(handler).toHaveBeenCalledTimes(1);
    expect(loggerDouble.error).not.toHaveBeenCalled();
  });

  it("returns 404 with the handlers' not-found body and logs both ids when the path names another account", async () => {
    const response = await app.inject({
      method: "GET",
      url: `/accounts/${FOREIGN_ACCOUNT_ID}/probe`,
    });

    expect(response.statusCode).toBe(404);
    expect(response.body).toBe(JSON.stringify({ ok: false, error: "Account not found" }));
    expect(handler).not.toHaveBeenCalled();
    expect(loggerDouble.error).toHaveBeenCalledWith(
      expect.objectContaining({
        route: "probes",
        message: "Cross-tenant account access refused",
        principalAccountId: CALLER_ACCOUNT_ID,
        requestedAccountId: FOREIGN_ACCOUNT_ID,
      })
    );
  });

  it("returns 401 and never reaches the handler when no principal is bound", async () => {
    boundAccountId = undefined;

    const response = await app.inject({
      method: "GET",
      url: `/accounts/${CALLER_ACCOUNT_ID}/probe`,
    });

    expect(response.statusCode).toBe(401);
    expect(response.body).toBe(JSON.stringify({ ok: false, error: "Authentication required" }));
    expect(handler).not.toHaveBeenCalled();
  });

  it("returns 400 and never reaches the handler when the path's account id is malformed", async () => {
    const response = await app.inject({ method: "GET", url: "/accounts/not-a-uuid/probe" });

    expect(response.statusCode).toBe(400);
    expect(response.body).toBe(JSON.stringify({ ok: false, error: "Invalid account ID" }));
    expect(handler).not.toHaveBeenCalled();
  });

  it("keeps a refused request from the handler while an async onSend hook holds the response open", async () => {
    await app.close();
    app = await createProbeApp({ slowOnSend: true });

    const response = await app.inject({
      method: "GET",
      url: `/accounts/${FOREIGN_ACCOUNT_ID}/probe`,
    });

    expect(response.statusCode).toBe(404);
    expect(handler).not.toHaveBeenCalled();
  });
});
