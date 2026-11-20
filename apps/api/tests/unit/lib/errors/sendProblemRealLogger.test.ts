/**
 * @file sendProblemRealLogger.test.ts
 * @description The error handler, the not-found handler and a route answering through
 *   `sendProblem`, on a Fastify whose logger is the real pino the API runs (`logger: true` in
 *   index.ts), writing to a stream the suite reads. Each failure answers its own status with exactly
 *   one line at its severity, warn for a client's failure and error for one of the server or of a
 *   service it depends on, which parses as JSON, carries the client's address, and carries the
 *   failure and each of its causes as an allow-listed projection with its code when it has one:
 *   the line never serializes the error object, so neither a frozen field nor an
 *   `AppError`'s details, a provider's response, a Prisma error's meta or a raised value's content
 *   reaches the log or the body.
 * @layer infrastructure
 */
import { Writable } from "node:stream";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import { serializerCompiler, validatorCompiler } from "fastify-type-provider-zod";
import { z } from "zod";
import { UseCaseError } from "@core/application/UseCase.js";
import { ProviderError } from "@providers/shared";
import { COMMON_ERRORS, RegisteredError } from "@shared/types";
import { AppError, ErrorCode } from "../../../../src/lib/errors/AppError.js";
import {
  createErrorHandler,
  createNotFoundHandler,
} from "../../../../src/lib/errors/errorHandler.js";
import { sendProblem } from "../../../../src/lib/errors/index.js";
import { uniqueViolationOnFields } from "../../helpers/prismaKnownRequestErrors.js";

const REQUEST_ID = "req-0001";
/** The client's address as `resolveClientIp` derives it from an inject, whose peer is the loopback. */
const CLIENT_IP = "127.0.0.1";
const PROBLEM_JSON = "application/problem+json; charset=utf-8";
const WARN = 40;
const ERROR = 50;

const PASSWORD = "planted password 7f3a91";
const TOKEN = "ya29.token-9b1c44";
const CONSTRAINT = "LeakConstraint_8e2d_key";
const MODEL = "LeakModel8e2d";
const RAISED_TEXT = "raw-secret-c0ffee";

/** The projection of an `Error` the line carries; the stack is whichever the error has. */
function projectionOf(
  name: string,
  message: string,
  extra: Readonly<Record<string, unknown>> = {}
) {
  return { name, message, stack: expect.any(String), ...extra };
}

describe("sendProblem on the real pino logger", () => {
  const written: string[] = [];
  let app: FastifyInstance;

  beforeAll(async () => {
    const stream = new Writable({
      write(chunk: Buffer, _encoding, callback) {
        written.push(chunk.toString("utf8"));
        callback();
      },
    });
    app = Fastify({ logger: { level: "info", stream }, genReqId: () => REQUEST_ID });
    app.setValidatorCompiler(validatorCompiler);
    app.setSerializerCompiler(serializerCompiler);
    app.setErrorHandler(createErrorHandler(app.log));
    app.setNotFoundHandler(createNotFoundHandler(app.log));

    app.get("/registered", async () => {
      throw RegisteredError.of(COMMON_ERRORS.CONFLICT);
    });
    app.get("/use-case", async () => {
      throw UseCaseError.of(COMMON_ERRORS.NOT_FOUND);
    });
    app.get(
      "/health",
      { schema: { response: { 503: z.object({ status: z.literal("degraded") }) } } },
      async () => {
        throw RegisteredError.of(COMMON_ERRORS.TRANSIENT_FAILURE);
      }
    );
    app.get("/answered", (request, reply) =>
      sendProblem(request, reply, RegisteredError.of(COMMON_ERRORS.FORBIDDEN), request.log)
    );
    app.get("/leak/app-error", async () => {
      throw new AppError(ErrorCode.VALIDATION_ERROR, 400, "Validation failed", true, {
        password: PASSWORD,
      });
    });
    app.get("/leak/provider", async () => {
      throw ProviderError.badRequest("youtube", "The upstream refused the request", {
        response: { access_token: TOKEN },
      });
    });
    app.get("/leak/prisma", async () => {
      throw uniqueViolationOnFields(["email"], CONSTRAINT, MODEL);
    });
    app.get("/leak/string", async () => {
      // A raised value that is not an Error, as a library can raise one.
      throw RAISED_TEXT;
    });
    app.get("/caused", async () => {
      const root = new AppError(ErrorCode.VALIDATION_ERROR, 400, "Validation failed", true, {
        password: PASSWORD,
      });
      throw UseCaseError.of(COMMON_ERRORS.INTERNAL_ERROR, {
        cause: new Error("The query failed", { cause: root }),
      });
    });
    app.get("/caused/by-a-value", async () => {
      throw new Error("The call failed", { cause: RAISED_TEXT });
    });
    app.get("/caused/by-a-coded-value", async () => {
      // A driver can reject with a plain object that carries a code.
      throw new Error("The query failed", { cause: { code: "ECONNREFUSED", detail: RAISED_TEXT } });
    });
    app.get("/caused/in-a-circle", async () => {
      const first = new Error("first");
      first.cause = new Error("second", { cause: first });
      throw first;
    });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    written.splice(0);
  });

  /** Every line written since the case began, parsed. */
  function lines(): Array<Record<string, unknown>> {
    return written
      .join("")
      .split("\n")
      .filter((line) => line !== "")
      .map((line) => JSON.parse(line) as Record<string, unknown>);
  }

  /** The lines at warn or above: the failures' own lines. */
  function failureLines() {
    return lines().filter((line) => typeof line["level"] === "number" && line["level"] >= WARN);
  }

  it.each([
    ["a raised registered error", "/registered", 409, "CONFLICT", "RegisteredError", WARN],
    ["a raised use-case error", "/use-case", 404, "NOT_FOUND", "UseCaseError", WARN],
    ["a path no route matches", "/nowhere", 404, "ROUTE_NOT_FOUND", "RegisteredError", WARN],
    [
      "a raised error under a 503 response schema, a failure a retry may pass",
      "/health",
      503,
      "TRANSIENT_FAILURE",
      "RegisteredError",
      ERROR,
    ],
    [
      "a route answering through sendProblem",
      "/answered",
      403,
      "FORBIDDEN",
      "RegisteredError",
      WARN,
    ],
  ])(
    "answers %s at its own status, with one line at its severity that carries the address and the failure's projection",
    async (_name, url, status, code, errorName, level) => {
      const response = await app.inject({ method: "GET", url });
      const body = response.json();

      expect([
        response.statusCode,
        response.headers["content-type"],
        body.status,
        body.code,
      ]).toEqual([status, PROBLEM_JSON, status, code]);
      expect(failureLines()).toEqual([
        expect.objectContaining({
          level,
          msg: "Request failed",
          code,
          wireCode: code,
          status,
          source: "registered",
          correlationId: REQUEST_ID,
          method: "GET",
          url,
          ip: CLIENT_IP,
          error: projectionOf(errorName, body.detail, { code }),
        }),
      ]);
    }
  );

  it.each([
    [
      "an AppError's details",
      "/leak/app-error",
      400,
      WARN,
      projectionOf("Error", "Validation failed", {
        code: "VALIDATION_ERROR",
        isOperational: true,
      }),
      [PASSWORD],
    ],
    [
      "a provider error's details",
      "/leak/provider",
      400,
      ERROR,
      projectionOf("ProviderError", "The upstream refused the request", { code: "BAD_REQUEST" }),
      [TOKEN],
    ],
    [
      "a Prisma error's meta",
      "/leak/prisma",
      500,
      ERROR,
      projectionOf(
        "PrismaClientKnownRequestError",
        "Unique constraint failed on the fields: (`email`)",
        { code: "P2002" }
      ),
      [CONSTRAINT, MODEL],
    ],
    ["a raised value's content", "/leak/string", 500, ERROR, { type: "string" }, [RAISED_TEXT]],
  ])(
    "keeps %s out of the line and the body, and logs the failure's projection",
    async (_name, url, status, level, error, secrets) => {
      const response = await app.inject({ method: "GET", url });
      const everything = `${written.join("")}${response.body}`;

      expect([response.statusCode, response.headers["content-type"]]).toEqual([
        status,
        PROBLEM_JSON,
      ]);
      expect(failureLines()).toEqual([expect.objectContaining({ level, url, error })]);
      expect(secrets.filter((secret) => everything.includes(secret))).toEqual([]);
    }
  );

  it("logs each cause of the failure as its own projection with its code when it has one, and none of a cause's other fields", async () => {
    const response = await app.inject({ method: "GET", url: "/caused" });
    const everything = `${written.join("")}${response.body}`;

    expect([response.statusCode, response.json().code]).toEqual([500, "INTERNAL_ERROR"]);
    expect(failureLines()).toEqual([
      expect.objectContaining({
        level: ERROR,
        url: "/caused",
        error: projectionOf("UseCaseError", response.json().detail, {
          code: "INTERNAL_ERROR",
          cause: projectionOf("Error", "The query failed", {
            cause: projectionOf("Error", "Validation failed", {
              code: "VALIDATION_ERROR",
              isOperational: true,
            }),
          }),
        }),
      }),
    ]);
    expect(everything.includes(PASSWORD)).toBe(false);
  });

  it("logs a cause that is not an Error as its type and its code, never its content", async () => {
    const response = await app.inject({ method: "GET", url: "/caused/by-a-coded-value" });

    expect(response.statusCode).toBe(500);
    expect(failureLines()).toEqual([
      expect.objectContaining({
        error: projectionOf("Error", "The query failed", {
          cause: { type: "object", code: "ECONNREFUSED" },
        }),
      }),
    ]);
    expect(`${written.join("")}${response.body}`.includes(RAISED_TEXT)).toBe(false);
  });

  it("logs a cause that is not an Error as its type, never its content", async () => {
    const response = await app.inject({ method: "GET", url: "/caused/by-a-value" });

    expect(response.statusCode).toBe(500);
    expect(failureLines()).toEqual([
      expect.objectContaining({
        error: projectionOf("Error", "The call failed", { cause: { type: "string" } }),
      }),
    ]);
    expect(`${written.join("")}${response.body}`.includes(RAISED_TEXT)).toBe(false);
  });

  it("follows five causes and no more, so a chain that circles ends the line", async () => {
    const response = await app.inject({ method: "GET", url: "/caused/in-a-circle" });
    const [line] = failureLines();
    const messages: unknown[] = [];
    for (
      let failure = line?.["error"];
      typeof failure === "object" && failure !== null;
      failure = (failure as Record<string, unknown>)["cause"]
    ) {
      messages.push((failure as Record<string, unknown>)["message"]);
    }

    expect(response.statusCode).toBe(500);
    expect(messages).toEqual(["first", "second", "first", "second", "first", "second"]);
  });
});
