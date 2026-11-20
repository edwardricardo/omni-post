/**
 * @file errorHandler.inject.test.ts
 * @description Drives the production error and not-found handlers through Fastify's inject the way
 *              index.ts wires them (`setErrorHandler(createErrorHandler(app.log))`, then
 *              `setNotFoundHandler(createNotFoundHandler(app.log))`, with the API's Zod compilers):
 *              each step of `toProblem` answers its problem, at its status, as problem JSON; a path
 *              no route matches, under any prefix, answers ROUTE_NOT_FOUND; a route's response
 *              schema never reads a raised failure's problem; a failure raised before the hook that
 *              sets the correlation id carries the request id; a successful route passes through;
 *              and no message, path, stack, Prisma code or detail of an unexpected failure reaches
 *              the body, in any environment.
 * @layer infrastructure
 */
import { describe, it, beforeAll, afterAll, afterEach, expect, vi } from "vitest";
import Fastify, { type FastifyInstance, type InjectOptions } from "fastify";
import { serializerCompiler, validatorCompiler } from "fastify-type-provider-zod";
import { z } from "zod";
import { COMMON_ERRORS, HTTP_ERRORS, RegisteredError } from "@shared/types";
import { createErrorHandler, createNotFoundHandler } from "../../src/lib/errors/errorHandler.js";
import { AppError, ConflictError, ErrorCode } from "../../src/lib/errors/AppError.js";

const REQUEST_ID = "req-0001";
const PROBLEM_JSON = "application/problem+json; charset=utf-8";
const INTERNAL_TEXT = "The server could not complete the request";
const ISO_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

/** The members every problem of a code carries; the instant is any ISO one. */
function problemOf(code: string, title: string, status: number, detail: string) {
  return {
    type: `https://omnipost.app/problems/${code}`,
    title,
    status,
    detail,
    code,
    correlationId: REQUEST_ID,
    timestamp: expect.stringMatching(ISO_INSTANT),
  };
}

const INTERNAL_PROBLEM = problemOf("INTERNAL_ERROR", "Internal error", 500, INTERNAL_TEXT);

describe("createErrorHandler and createNotFoundHandler through Fastify inject", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = Fastify({ logger: false, genReqId: () => REQUEST_ID });
    app.setValidatorCompiler(validatorCompiler);
    app.setSerializerCompiler(serializerCompiler);
    app.setErrorHandler(createErrorHandler(app.log));
    app.setNotFoundHandler(createNotFoundHandler(app.log));

    app.get("/registered/internal", async () => {
      throw RegisteredError.of(COMMON_ERRORS.INTERNAL_ERROR);
    });
    app.get("/registered/conflict", async () => {
      throw RegisteredError.of(COMMON_ERRORS.CONFLICT);
    });
    app.post(
      "/drafts",
      { schema: { body: z.object({ title: z.string() }) }, bodyLimit: 64 },
      async () => ({})
    );
    app.get("/app-error", async () => {
      throw new ConflictError("The post was published already");
    });
    app.get("/app-error/details", async () => {
      throw new AppError(ErrorCode.VALIDATION_ERROR, 400, "Validation failed", true, {
        field: "email",
      });
    });
    app.get("/status-carrier", async () => {
      throw Object.assign(new Error("upstream down at 10.0.0.4"), { statusCode: 503 });
    });
    app.get("/plain-error", async () => {
      throw new Error("Connection failed at /var/lib/postgresql/data");
    });
    app.get("/stack-trace", async () => {
      const error = new Error("Internal error");
      error.stack = "Error: Internal error\n    at /app/src/sensitive/file.ts:123:45";
      throw error;
    });
    app.get("/prisma-error", async () => {
      throw Object.assign(new Error("Unique constraint failed on the fields: (`email`)"), {
        code: "P2002",
        meta: { target: ["email"] },
      });
    });
    app.get(
      "/health",
      { schema: { response: { 503: z.object({ status: z.literal("degraded") }) } } },
      async () => {
        throw RegisteredError.of(COMMON_ERRORS.TRANSIENT_FAILURE);
      }
    );
    app.get(
      "/correlated",
      {
        onRequest: (request, _reply, done) => {
          if (request.headers["x-fail-early"] === "yes") {
            done(RegisteredError.of(COMMON_ERRORS.UNAUTHORIZED));
            return;
          }
          done();
        },
        preHandler: (request, _reply, done) => {
          request.correlationId = "corr-0042";
          done();
        },
      },
      async () => {
        throw RegisteredError.of(COMMON_ERRORS.UNAUTHORIZED);
      }
    );
    app.get("/success", async () => ({ success: true }));
    const factories: ReadonlyArray<[string, () => AppError]> = [
      ["bad-request", () => AppError.badRequest("Bad request")],
      ["unauthorized", () => AppError.unauthorized("Unauthorized")],
      ["forbidden", () => AppError.forbidden("Forbidden")],
      ["not-found", () => AppError.notFound("User")],
      ["conflict", () => AppError.conflict("Conflict")],
      ["too-many-requests", () => AppError.tooManyRequests("Rate limited", 60)],
      ["internal", () => AppError.internal("Internal error")],
      ["external-service", () => AppError.externalService("Twitter API")],
    ];
    for (const [route, make] of factories) {
      app.get(`/factory/${route}`, async () => {
        throw make();
      });
    }
    // index.ts registers its prefixed route plugins after the not-found handler is set.
    await app.register(
      async (prefixed) => {
        prefixed.get("/known", async () => ({ known: true }));
      },
      { prefix: "/ai" }
    );
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  // Every NODE_ENV the suite sets goes through vi.stubEnv, so the ambient value, set or unset, comes
  // back exactly, and no case depends on the shell the suite runs in.
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  /** The status, media type and body of one request's answer. */
  async function answerTo(request: InjectOptions) {
    const response = await app.inject(request);
    return {
      status: response.statusCode,
      contentType: response.headers["content-type"],
      body: response.json(),
    };
  }

  it("answers a registered internal code with INTERNAL_ERROR at 500", async () => {
    expect(await answerTo({ method: "GET", url: "/registered/internal" })).toEqual({
      status: 500,
      contentType: PROBLEM_JSON,
      body: INTERNAL_PROBLEM,
    });
  });

  it("answers any other registered code with its registry entry", async () => {
    expect(await answerTo({ method: "GET", url: "/registered/conflict" })).toEqual({
      status: 409,
      contentType: PROBLEM_JSON,
      body: problemOf(
        "CONFLICT",
        "Conflict",
        409,
        "The request conflicts with the current state of the resource"
      ),
    });
  });

  it("answers a request the route's schema refuses with VALIDATION_FAILED and each issue", async () => {
    const { status, contentType, body } = await answerTo({
      method: "POST",
      url: "/drafts",
      payload: { title: 7 },
    });

    expect([status, contentType]).toEqual([400, PROBLEM_JSON]);
    expect(body).toEqual({
      ...problemOf("VALIDATION_FAILED", "Validation failed", 400, "The request is not valid"),
      issues: [
        { part: "body", pointer: "/title", code: "invalid_type", detail: expect.any(String) },
      ],
    });
  });

  it.each([
    [
      "malformed JSON",
      { headers: { "content-type": "application/json" }, payload: "{" },
      HTTP_ERRORS.MALFORMED_REQUEST,
      "Malformed request",
    ],
    [
      "a content type no parser takes",
      { headers: { "content-type": "text/csv" }, payload: "a,b" },
      HTTP_ERRORS.UNSUPPORTED_MEDIA_TYPE,
      "Unsupported media type",
    ],
    [
      "a body over the route's limit",
      { payload: { title: "x".repeat(80) } },
      HTTP_ERRORS.PAYLOAD_TOO_LARGE,
      "Payload too large",
    ],
  ])(
    "answers the framework's refusal of %s with its http code",
    async (_name, request, code, title) => {
      expect(await answerTo({ method: "POST", url: "/drafts", ...request })).toEqual({
        status: code.status,
        contentType: PROBLEM_JSON,
        body: problemOf(code.code, title, code.status, code.message),
      });
    }
  );

  it.each(["/nowhere", "/ai/nowhere"])(
    "answers %s, which no route matches, with ROUTE_NOT_FOUND",
    async (url) => {
      expect(await answerTo({ method: "GET", url })).toEqual({
        status: 404,
        contentType: PROBLEM_JSON,
        body: problemOf(
          "ROUTE_NOT_FOUND",
          "Route not found",
          404,
          "No route matches this method and path"
        ),
      });
    }
  );

  it("answers an AppError whose code nobody registered with its own status, code and message", async () => {
    expect(await answerTo({ method: "GET", url: "/app-error" })).toEqual({
      status: 409,
      contentType: PROBLEM_JSON,
      body: problemOf(
        "RESOURCE_CONFLICT",
        "Resource conflict",
        409,
        "The post was published already"
      ),
    });
  });

  it.each([
    ["bad-request", 400, ErrorCode.BAD_REQUEST],
    ["unauthorized", 401, ErrorCode.AUTH_INVALID_CREDENTIALS],
    ["forbidden", 403, ErrorCode.FORBIDDEN],
    ["not-found", 404, ErrorCode.RESOURCE_NOT_FOUND],
    ["conflict", 409, ErrorCode.RESOURCE_CONFLICT],
    ["too-many-requests", 429, ErrorCode.RATE_LIMIT_EXCEEDED],
    ["internal", 500, ErrorCode.INTERNAL_SERVER_ERROR],
    ["external-service", 502, ErrorCode.EXTERNAL_SERVICE_ERROR],
  ])("keeps the %s factory at HTTP %i with code %s", async (route, status, code) => {
    const answer = await answerTo({ method: "GET", url: `/factory/${route}` });

    expect([answer.status, answer.contentType, answer.body.status, answer.body.code]).toEqual([
      status,
      PROBLEM_JSON,
      status,
      code,
    ]);
  });

  it("keeps the failure status any other value carries, with INTERNAL_ERROR's code and text", async () => {
    expect(await answerTo({ method: "GET", url: "/status-carrier" })).toEqual({
      status: 503,
      contentType: PROBLEM_JSON,
      body: { ...INTERNAL_PROBLEM, status: 503 },
    });
  });

  it("answers anything else with INTERNAL_ERROR at 500, and hides its message and its path", async () => {
    const response = await app.inject({ method: "GET", url: "/plain-error" });

    expect([response.statusCode, response.headers["content-type"]]).toEqual([500, PROBLEM_JSON]);
    expect(response.json()).toEqual(INTERNAL_PROBLEM);
    expect(response.body).not.toContain("Connection failed");
    expect(response.body).not.toContain("/var/lib/postgresql");
  });

  it("hides the stack trace from the body", async () => {
    const response = await app.inject({ method: "GET", url: "/stack-trace" });

    expect(response.json()).toEqual(INTERNAL_PROBLEM);
    expect(response.body).not.toContain("file.ts");
    expect(response.body).not.toContain("at /app/src");
  });

  it.each(["production", "development"])(
    "hides a Prisma error's code and meta under NODE_ENV=%s",
    async (environment) => {
      vi.stubEnv("NODE_ENV", environment);
      const response = await app.inject({ method: "GET", url: "/prisma-error" });

      expect(response.json()).toEqual(INTERNAL_PROBLEM);
      expect(response.body).not.toContain("P2002");
      expect(response.body).not.toContain("email");
    }
  );

  it.each(["development", "production", "test"])(
    "sends no member of an AppError's details under NODE_ENV=%s",
    async (environment) => {
      vi.stubEnv("NODE_ENV", environment);
      const response = await app.inject({ method: "GET", url: "/app-error/details" });

      expect(Object.keys(response.json()).sort()).toEqual(
        ["code", "correlationId", "detail", "status", "timestamp", "title", "type"].sort()
      );
      expect(response.body).not.toContain("email");
    }
  );

  it("sends a raised failure's problem as it is when the route's response schema for that status describes another body", async () => {
    expect(await answerTo({ method: "GET", url: "/health" })).toEqual({
      status: 503,
      contentType: PROBLEM_JSON,
      body: problemOf(
        "TRANSIENT_FAILURE",
        "Transient failure",
        503,
        "The operation failed for a reason that may pass: try it again"
      ),
    });
  });

  it("stamps a failure raised after the hook that sets the correlation id with it, and one raised before with the request id", async () => {
    const late = await answerTo({ method: "GET", url: "/correlated" });
    const early = await answerTo({
      method: "GET",
      url: "/correlated",
      headers: { "x-fail-early": "yes" },
    });

    expect([late.status, late.body.code, late.body.correlationId]).toEqual([
      401,
      "UNAUTHORIZED",
      "corr-0042",
    ]);
    expect([early.status, early.body.code, early.body.correlationId]).toEqual([
      401,
      "UNAUTHORIZED",
      REQUEST_ID,
    ]);
  });

  it("leaves a successful response untouched", async () => {
    const response = await app.inject({ method: "GET", url: "/success" });

    expect(response.statusCode).toBe(200);
    expect(response.headers["content-type"]).toContain("application/json");
    expect(response.json()).toStrictEqual({ success: true });
  });

  it("leaves a prefixed route that exists untouched", async () => {
    const response = await app.inject({ method: "GET", url: "/ai/known" });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toStrictEqual({ known: true });
  });
});
