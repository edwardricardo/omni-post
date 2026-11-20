/**
 * @file frameworkRefusals.test.ts
 * @description The requests the framework refuses before it routes them answer the API's one error
 *   body, on the instance `createServer` builds, the one `createApp` registers everything on: a
 *   route parameter over the router's limit answers `ROUTE_PARAMETER_TOO_LONG` at 414, a path whose
 *   percent-encoding does not decode answers `PATH_NOT_DECODABLE` at 400, and a failing async route
 *   constraint answers `INTERNAL_ERROR` at 500, each with one line on the server's logger and no
 *   echo of the path in the body. A parameter at the limit still reaches its route, and a path no
 *   route matches still answers `ROUTE_NOT_FOUND`. The error and not-found handlers are set the way
 *   `createApp` sets them; the server's logger is held at `warn` and its two failure levels are
 *   recorded, so the lines are read as `sendProblem` writes them.
 * @layer infrastructure
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { FastifyInstance } from "fastify";
import { FIXED_CLOCK_ISO, fixedClock } from "@packages/vitest-shared/determinism";
import { captureError } from "../../../../src/observability/sentryInit.js";
import { createServer } from "../../../../src/index.js";
import {
  createErrorHandler,
  createNotFoundHandler,
} from "../../../../src/lib/errors/errorHandler.js";

vi.mock("../../../../src/observability/sentryInit.js", () => ({ captureError: vi.fn() }));

const PROBLEM_JSON = "application/problem+json; charset=utf-8";
const AT_LIMIT = "a".repeat(100);
const OVER_LIMIT = "b".repeat(101);
const UNDECODABLE = "%zz";
/** The request id Fastify generates when no header names one: no hook sets a correlation id here. */
const REQUEST_ID = /^req-[0-9a-z]+$/;

/** What a route constraint's storage holds per value, as the router's own types name it. */
type RouteHandlerOfConstraint = NonNullable<
  ReturnType<ReturnType<Parameters<FastifyInstance["addConstraintStrategy"]>[0]["storage"]>["get"]>
>;

/**
 * @description Builds the server as `createApp` does up to its routes: `createServer`, then the
 *   error and not-found handlers, with its logger held at `warn` so only failures are written.
 * @returns The server, not yet ready.
 */
function serverAsTheAppBuildsIt(): FastifyInstance {
  const app = createServer();
  app.log.level = "warn";
  app.setErrorHandler(createErrorHandler(app.log));
  app.setNotFoundHandler(createNotFoundHandler(app.log));
  return app;
}

/**
 * @description Records the server logger's two failure levels instead of writing them.
 * @param app - The server whose logger `sendProblem` writes to.
 * @returns The two spies, whose calls are the failure lines.
 */
function recordFailureLines(app: FastifyInstance) {
  return {
    warn: vi.spyOn(app.log, "warn").mockImplementation(() => undefined),
    error: vi.spyOn(app.log, "error").mockImplementation(() => undefined),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(fixedClock());
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("the framework's refusals on the server createServer builds", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = serverAsTheAppBuildsIt();
    app.get("/things/:id", async (request) => request.params);
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it("answers the route when a route parameter is at the router's limit, and writes no failure line", async () => {
    const lines = recordFailureLines(app);

    const response = await app.inject({ method: "GET", url: `/things/${AT_LIMIT}` });

    expect([response.statusCode, response.json()]).toEqual([200, { id: AT_LIMIT }]);
    expect([lines.warn.mock.calls, lines.error.mock.calls]).toEqual([[], []]);
  });

  it("answers ROUTE_PARAMETER_TOO_LONG at 414 when a route parameter is over the router's limit, with one warn line", async () => {
    const lines = recordFailureLines(app);

    const response = await app.inject({ method: "GET", url: `/things/${OVER_LIMIT}?draft=1` });
    const body = response.json();

    expect([response.statusCode, response.headers["content-type"]]).toEqual([414, PROBLEM_JSON]);
    expect(body).toEqual({
      type: "https://omnipost.app/problems/ROUTE_PARAMETER_TOO_LONG",
      title: "Route parameter too long",
      status: 414,
      detail: "A parameter of the request's path is longer than the router accepts",
      code: "ROUTE_PARAMETER_TOO_LONG",
      correlationId: expect.stringMatching(REQUEST_ID),
      timestamp: FIXED_CLOCK_ISO,
    });
    expect(response.body.includes(OVER_LIMIT)).toBe(false);
    expect(lines.warn.mock.calls).toEqual([
      [
        {
          code: "FST_ERR_MAX_PARAM_LENGTH",
          wireCode: "ROUTE_PARAMETER_TOO_LONG",
          status: 414,
          source: "framework",
          correlationId: body.correlationId,
          method: "GET",
          url: `/things/${OVER_LIMIT}?draft=1`,
          error: {
            name: "FastifyError",
            message: `'/things/${OVER_LIMIT}' is exceeding the max param length`,
            stack: expect.any(String),
          },
        },
        "Request failed",
      ],
    ]);
    expect([lines.error.mock.calls, vi.mocked(captureError).mock.calls]).toEqual([[], []]);
  });

  it("answers PATH_NOT_DECODABLE at 400 when the path's percent-encoding does not decode, with one warn line", async () => {
    const lines = recordFailureLines(app);

    const response = await app.inject({ method: "GET", url: `/things/${UNDECODABLE}?draft=1` });
    const body = response.json();

    expect([response.statusCode, response.headers["content-type"]]).toEqual([400, PROBLEM_JSON]);
    expect(body).toEqual({
      type: "https://omnipost.app/problems/PATH_NOT_DECODABLE",
      title: "Path not decodable",
      status: 400,
      detail: "The request's path holds a percent-encoded sequence that does not decode",
      code: "PATH_NOT_DECODABLE",
      correlationId: expect.stringMatching(REQUEST_ID),
      timestamp: FIXED_CLOCK_ISO,
    });
    expect(response.body.includes(UNDECODABLE)).toBe(false);
    expect(lines.warn.mock.calls).toEqual([
      [
        {
          code: "FST_ERR_BAD_URL",
          wireCode: "PATH_NOT_DECODABLE",
          status: 400,
          source: "framework",
          correlationId: body.correlationId,
          method: "GET",
          url: `/things/${UNDECODABLE}?draft=1`,
          error: {
            name: "FastifyError",
            message: `'/things/${UNDECODABLE}?draft=1' is not a valid url component`,
            stack: expect.any(String),
          },
        },
        "Request failed",
      ],
    ]);
    expect([lines.error.mock.calls, vi.mocked(captureError).mock.calls]).toEqual([[], []]);
  });

  it("answers ROUTE_NOT_FOUND at 404 when no route matches the path, with one warn line", async () => {
    const lines = recordFailureLines(app);

    const response = await app.inject({ method: "GET", url: "/nowhere/7" });
    const body = response.json();

    expect([response.statusCode, response.headers["content-type"]]).toEqual([404, PROBLEM_JSON]);
    expect(body).toEqual({
      type: "https://omnipost.app/problems/ROUTE_NOT_FOUND",
      title: "Route not found",
      status: 404,
      detail: "No route matches this method and path",
      code: "ROUTE_NOT_FOUND",
      correlationId: expect.stringMatching(REQUEST_ID),
      timestamp: FIXED_CLOCK_ISO,
    });
    expect(lines.warn.mock.calls).toEqual([
      [
        {
          code: "ROUTE_NOT_FOUND",
          wireCode: "ROUTE_NOT_FOUND",
          status: 404,
          source: "registered",
          correlationId: body.correlationId,
          method: "GET",
          url: "/nowhere/7",
          error: {
            name: "RegisteredError",
            message: "No route matches this method and path",
            stack: expect.any(String),
          },
        },
        "Request failed",
      ],
    ]);
    expect(lines.error.mock.calls).toEqual([]);
  });
});

describe("a failing async route constraint on the server createServer builds", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = serverAsTheAppBuildsIt();
    // The API registers no constraint strategy: this one is what would make the router raise
    // FST_ERR_ASYNC_CONSTRAINT, the third refusal the framework hands to `frameworkErrors`.
    app.addConstraintStrategy({
      name: "region",
      storage() {
        const handlers = new Map<unknown, RouteHandlerOfConstraint>();
        return {
          get: (value) => handlers.get(value) ?? null,
          set: (value, handler) => {
            handlers.set(value, handler);
          },
        };
      },
      deriveConstraint(_request, _context, done?: (error: Error) => void) {
        done?.(new Error("The region lookup failed"));
        return undefined;
      },
      mustMatchWhenDerived: true,
    });
    app.get("/regional", { constraints: { region: "eu" } }, async () => ({}));
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it("answers INTERNAL_ERROR at 500, writes one error line under Fastify's code and reports it to Sentry", async () => {
    const lines = recordFailureLines(app);

    const response = await app.inject({ method: "GET", url: "/regional" });
    const body = response.json();

    expect([response.statusCode, response.headers["content-type"]]).toEqual([500, PROBLEM_JSON]);
    expect(body).toEqual({
      type: "https://omnipost.app/problems/INTERNAL_ERROR",
      title: "Internal error",
      status: 500,
      detail: "The server could not complete the request",
      code: "INTERNAL_ERROR",
      correlationId: expect.stringMatching(REQUEST_ID),
      timestamp: FIXED_CLOCK_ISO,
    });
    expect(lines.error.mock.calls).toEqual([
      [
        {
          code: "FST_ERR_ASYNC_CONSTRAINT",
          wireCode: "INTERNAL_ERROR",
          status: 500,
          source: "status-carrier",
          correlationId: body.correlationId,
          method: "GET",
          url: "/regional",
          error: {
            name: "FastifyError",
            message: "Unexpected error from async constraint",
            stack: expect.any(String),
          },
        },
        "Request failed",
      ],
    ]);
    expect(lines.warn.mock.calls).toEqual([]);
    expect(vi.mocked(captureError).mock.calls).toEqual([
      [
        expect.objectContaining({ code: "FST_ERR_ASYNC_CONSTRAINT" }),
        {
          requestId: body.correlationId,
          correlationId: body.correlationId,
          code: "FST_ERR_ASYNC_CONSTRAINT",
          method: "GET",
          url: "/regional",
          ip: "127.0.0.1",
        },
      ],
    ]);
  });
});
