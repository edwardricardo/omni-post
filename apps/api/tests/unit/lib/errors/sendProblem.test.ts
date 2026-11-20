/**
 * @file sendProblem.test.ts
 * @description `sendProblem` is the one writer of the API's error body, and a route answers a failure
 *   through it: the failure's problem at its status as `application/problem+json`, stamped with the
 *   correlation id a hook set or else the request id, and with the clock; the headers the answer
 *   names; one log line, through the logger it is given, at the answer's severity; a report to
 *   Sentry for an unexpected failure only; and a body no response schema of the route reads. The
 *   routes run on a real Fastify with the API's Zod compilers.
 * @layer infrastructure
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import Fastify, { type FastifyBaseLogger, type FastifyInstance } from "fastify";
import { serializerCompiler, validatorCompiler } from "fastify-type-provider-zod";
import { z } from "zod";
import { COMMON_ERRORS, RegisteredError } from "@shared/types";
import { FIXED_CLOCK_ISO, fixedClock } from "@packages/vitest-shared/determinism";
import { captureError } from "../../../../src/observability/sentryInit.js";
import * as problemModule from "../../../../src/lib/errors/problem.js";
// A route imports the reply function from the error module's index, so the suite does too.
import { sendProblem } from "../../../../src/lib/errors/index.js";

vi.mock("../../../../src/observability/sentryInit.js", () => ({ captureError: vi.fn() }));
vi.mock("../../../../src/lib/errors/problem.js", async (importOriginal) => {
  const actual = await importOriginal<typeof problemModule>();
  return { ...actual, toProblem: vi.fn(actual.toProblem) };
});

const { PROBLEM_MEDIA_TYPE, toProblem } = problemModule;

const REQUEST_ID = "req-0001";
const CONFLICT = RegisteredError.of(COMMON_ERRORS.CONFLICT);
const TRANSIENT = RegisteredError.of(COMMON_ERRORS.TRANSIENT_FAILURE);
const UNEXPECTED = Object.assign(new Error("connection refused at /var/run/db.sock"), {
  code: "LEGACY_STORE_DOWN",
});

const CONFLICT_PROBLEM = {
  type: "https://omnipost.app/problems/CONFLICT",
  title: "Conflict",
  status: 409,
  detail: "The request conflicts with the current state of the resource",
  code: "CONFLICT",
  correlationId: REQUEST_ID,
  timestamp: FIXED_CLOCK_ISO,
};

interface LogLine {
  readonly level: "warn" | "error";
  readonly fields: unknown;
  readonly message: unknown;
}

/** A logger that keeps what is written at warn and error, and drops the rest. */
function recordingLogger(lines: LogLine[]): FastifyBaseLogger {
  const record =
    (level: LogLine["level"]) =>
    (fields: unknown, message?: unknown): void => {
      lines.push({ level, fields, message });
    };
  const drop = (): void => undefined;
  const logger: FastifyBaseLogger = {
    level: "trace",
    fatal: drop,
    error: record("error"),
    warn: record("warn"),
    info: drop,
    debug: drop,
    trace: drop,
    silent: drop,
    child: () => logger,
  };
  return logger;
}

describe("sendProblem", () => {
  const lines: LogLine[] = [];
  const logger = recordingLogger(lines);
  let app: FastifyInstance;
  let replied: unknown;
  let returned: unknown;
  let replyAfter: unknown;

  beforeAll(async () => {
    app = Fastify({ logger: false, genReqId: () => REQUEST_ID });
    app.setValidatorCompiler(validatorCompiler);
    app.setSerializerCompiler(serializerCompiler);
    app.post("/posts/:id", (request, reply) => sendProblem(request, reply, CONFLICT, logger));
    app.get(
      "/correlated",
      {
        preHandler: (request, _reply, done) => {
          request.correlationId = "corr-0042";
          done();
        },
      },
      (request, reply) => sendProblem(request, reply, CONFLICT, logger)
    );
    app.get("/broken", (request, reply) => sendProblem(request, reply, UNEXPECTED, logger));
    app.get(
      "/health",
      { schema: { response: { 503: z.object({ status: z.literal("degraded") }) } } },
      (request, reply) => sendProblem(request, reply, TRANSIENT, logger)
    );
    app.get("/returned", (request, reply) => {
      replied = reply;
      returned = sendProblem(request, reply, CONFLICT, logger);
      return returned;
    });
    app.get("/answered-first", (request, reply) => {
      reply.code(200).send({ ok: true });
      replied = reply;
      returned = sendProblem(request, reply, CONFLICT, logger);
      replyAfter = [reply.statusCode, reply.getHeader("content-type")];
      return returned;
    });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    lines.splice(0);
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(fixedClock());
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("answers a route's failure with its problem, at the problem's status, as problem JSON", async () => {
    const response = await app.inject({ method: "POST", url: "/posts/7?draft=1" });

    expect(response.statusCode).toBe(409);
    expect(response.headers["content-type"]).toBe("application/problem+json; charset=utf-8");
    expect(response.json()).toEqual(CONFLICT_PROBLEM);
  });

  it("stamps the correlation id a hook set on the request, and the request id when none was set", async () => {
    const correlated = await app.inject({ method: "GET", url: "/correlated" });
    const uncorrelated = await app.inject({ method: "POST", url: "/posts/7" });

    expect(correlated.json()).toEqual({ ...CONFLICT_PROBLEM, correlationId: "corr-0042" });
    expect(uncorrelated.json()).toEqual(CONFLICT_PROBLEM);
  });

  it("writes one line at warn for a client's failure, with its codes, status, source and request, and reports nothing", async () => {
    await app.inject({ method: "POST", url: "/posts/7?draft=1" });

    expect(lines).toEqual([
      {
        level: "warn",
        fields: {
          code: "CONFLICT",
          wireCode: "CONFLICT",
          status: 409,
          source: "registered",
          correlationId: REQUEST_ID,
          method: "POST",
          url: "/posts/7?draft=1",
          error: { name: "RegisteredError", message: CONFLICT.message, stack: CONFLICT.stack },
        },
        message: "Request failed",
      },
    ]);
    expect(captureError).not.toHaveBeenCalled();
  });

  it("writes one line at error for an unexpected failure under the code it carried, and reports it to Sentry", async () => {
    const response = await app.inject({ method: "GET", url: "/broken" });

    expect(response.statusCode).toBe(500);
    expect(response.json()).toEqual({
      type: "https://omnipost.app/problems/INTERNAL_ERROR",
      title: "Internal error",
      status: 500,
      detail: "The server could not complete the request",
      code: "INTERNAL_ERROR",
      correlationId: REQUEST_ID,
      timestamp: FIXED_CLOCK_ISO,
    });
    expect(lines).toEqual([
      {
        level: "error",
        fields: {
          code: "LEGACY_STORE_DOWN",
          wireCode: "INTERNAL_ERROR",
          status: 500,
          source: "unregistered",
          correlationId: REQUEST_ID,
          method: "GET",
          url: "/broken",
          error: { name: "Error", message: UNEXPECTED.message, stack: UNEXPECTED.stack },
        },
        message: "Request failed",
      },
    ]);
    expect(vi.mocked(captureError).mock.calls).toEqual([
      [
        UNEXPECTED,
        {
          requestId: REQUEST_ID,
          correlationId: REQUEST_ID,
          code: "LEGACY_STORE_DOWN",
          method: "GET",
          url: "/broken",
          ip: "127.0.0.1",
        },
      ],
    ]);
  });

  it("sets every header the answer names", async () => {
    const answer = (
      await vi.importActual<typeof problemModule>("../../../../src/lib/errors/problem.js")
    ).toProblem(CONFLICT, { correlationId: REQUEST_ID, now: fixedClock() });
    vi.mocked(toProblem).mockReturnValueOnce({
      ...answer,
      headers: { "retry-after": "30", "x-problem-origin": "registry" },
    });

    const response = await app.inject({ method: "POST", url: "/posts/7" });

    expect(response.statusCode).toBe(409);
    expect([response.headers["retry-after"], response.headers["x-problem-origin"]]).toEqual([
      "30",
      "registry",
    ]);
    expect(response.json()).toEqual(CONFLICT_PROBLEM);
  });

  it("sends the problem as it is when the route's response schema for that status describes another body", async () => {
    const response = await app.inject({ method: "GET", url: "/health" });

    expect(response.statusCode).toBe(503);
    expect(response.headers["content-type"]).toBe(PROBLEM_MEDIA_TYPE);
    expect(response.json()).toEqual({
      type: "https://omnipost.app/problems/TRANSIENT_FAILURE",
      title: "Transient failure",
      status: 503,
      detail: "The operation failed for a reason that may pass: try it again",
      code: "TRANSIENT_FAILURE",
      correlationId: REQUEST_ID,
      timestamp: FIXED_CLOCK_ISO,
    });
  });

  it("returns the reply it sent, so a route can return it", async () => {
    const response = await app.inject({ method: "GET", url: "/returned" });

    expect(response.statusCode).toBe(409);
    expect(returned).toBe(replied);
  });

  it("leaves a reply already sent untouched, and writes one line saying the failure came after the answer", async () => {
    const response = await app.inject({ method: "GET", url: "/answered-first" });

    expect([response.statusCode, response.headers["content-type"]]).toEqual([
      200,
      "application/json; charset=utf-8",
    ]);
    expect(response.json()).toEqual({ ok: true });
    expect(replyAfter).toEqual([200, "application/json; charset=utf-8"]);
    expect(lines).toEqual([
      {
        level: "warn",
        fields: {
          code: "CONFLICT",
          wireCode: "CONFLICT",
          status: 409,
          source: "registered",
          correlationId: REQUEST_ID,
          method: "GET",
          url: "/answered-first",
          error: { name: "RegisteredError", message: CONFLICT.message, stack: CONFLICT.stack },
        },
        message: "Request failed after its answer was sent",
      },
    ]);
    expect(returned).toBe(replied);
  });
});
