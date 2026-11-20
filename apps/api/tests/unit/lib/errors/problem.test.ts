/**
 * @file problem.test.ts
 * @description `toProblem` turns any failure into the API's one error body, step by step: a
 *   registered code answers its registry entry (an internal or configuration one collapses to
 *   `INTERNAL_ERROR`); a request the route's schema refuses answers `VALIDATION_FAILED` with its
 *   issues; the framework's own refusals answer the `http` code of their cause, and one whose cause
 *   no code names is a carrier of its status; a legacy `AppError` keeps its status; any other
 *   carrier of a failure status keeps it with `INTERNAL_ERROR`'s text; and anything else is
 *   `INTERNAL_ERROR`. Every answer at 500 or above is logged at error, as is every answer the
 *   registry does not classify; a client's failure is logged at warn. The request's own refusals are produced by a real Fastify
 *   with the API's Zod validator, so the shape the installed versions give is what is proved. No
 *   domain declares a parameter yet, so the parameter rules run on a registry whose `platform`
 *   table is replaced, for one case, by a table `defineErrors` builds here.
 * @layer infrastructure
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import Fastify, {
  errorCodes,
  type FastifyInstance,
  type FastifyReply,
  type InjectOptions,
} from "fastify";
import {
  ResponseSerializationError,
  serializerCompiler,
  validatorCompiler,
} from "fastify-type-provider-zod";
import { z } from "zod";
import { UseCaseError, USE_CASE_ERRORS } from "@core/application/UseCase.js";
import { ProviderError } from "@providers/shared";
import {
  COMMON_ERRORS,
  ERROR_CATEGORY,
  HTTP_ERRORS,
  PARAM_KIND,
  PLATFORM_ERRORS,
  RegisteredError,
} from "@shared/types";
import { defineErrors } from "@shared/types/error-registry/definition.js";
import {
  AppError,
  ConflictError,
  DatabaseError,
  ErrorCode,
} from "../../../../src/lib/errors/AppError.js";
import {
  PROBLEM_MEDIA_TYPE,
  problemSchema,
  toProblem,
  type ProblemAnswer,
  type ProblemContext,
} from "../../../../src/lib/errors/problem.js";

const CONTEXT: ProblemContext = {
  correlationId: "corr-0001",
  now: new Date("2026-11-20T08:00:00.000Z"),
};

const INTERNAL_TEXT = "The server could not complete the request";

/** The text a thrown plain object carries, which must reach no body. */
const LOCKED_TEXT = "draft 42 of tenant acme is locked by user 7";

/** `INTERNAL_ERROR`'s problem at a status, as every collapsed answer sends it. */
function internalProblem(status: number) {
  return {
    type: "https://omnipost.app/problems/INTERNAL_ERROR",
    title: "Internal error",
    status,
    detail: INTERNAL_TEXT,
    code: "INTERNAL_ERROR",
    correlationId: "corr-0001",
    timestamp: "2026-11-20T08:00:00.000Z",
  };
}

const PARAMS_TABLE = "@shared/types/error-registry/domains/platform.js";

/** A table that declares parameters, put in the registry's place for a case. */
const FIXTURE_ERRORS = defineErrors("platform", {
  FIXTURE_VARIABLES_REFUSED: {
    category: ERROR_CATEGORY.CONFIGURATION,
    status: 500,
    message: "Refused {variables}",
    params: { variables: PARAM_KIND.STRING_LIST },
    fronts: [],
  },
  FIXTURE_QUOTA_REACHED: {
    category: ERROR_CATEGORY.RATE_LIMIT,
    status: 429,
    message: "Reached {limit} calls to {service}",
    params: { limit: PARAM_KIND.NUMBER, service: PARAM_KIND.STRING },
    fronts: [],
  },
  FIXTURE_UPSTREAM_TIMED_OUT: {
    category: ERROR_CATEGORY.UPSTREAM,
    status: 504,
    message: "The upstream did not answer in time",
    params: {},
    fronts: [],
  },
});

/**
 * @description Loads `toProblem` over a registry whose `platform` table is the fixture's.
 * @returns The freshly loaded module.
 */
async function loadProblemWithParams() {
  vi.resetModules();
  vi.doMock(PARAMS_TABLE, () => ({ PLATFORM_ERRORS: FIXTURE_ERRORS }));
  return import("../../../../src/lib/errors/problem.js");
}

describe("toProblem", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.doUnmock(PARAMS_TABLE);
    vi.resetModules();
  });

  describe("a registered code", () => {
    it("answers its registry entry, worded by the registry and stamped by the context", () => {
      const answer = toProblem(RegisteredError.of(COMMON_ERRORS.CONFLICT), CONTEXT);

      expect(answer).toEqual({
        problem: {
          type: "https://omnipost.app/problems/CONFLICT",
          title: "Conflict",
          status: 409,
          detail: "The request conflicts with the current state of the resource",
          code: "CONFLICT",
          correlationId: "corr-0001",
          timestamp: "2026-11-20T08:00:00.000Z",
        },
        headers: {},
        source: "registered",
        loggedCode: "CONFLICT",
        severity: "warn",
      });
    });

    it("answers the registry's status and text whatever built the error, never its own sentence", () => {
      const builtTheOldWay = new UseCaseError("Post 42 of acme is gone", USE_CASE_ERRORS.NOT_FOUND);
      const appError = AppError.forbidden("Only the owner acme may do this");

      const answers = [builtTheOldWay, appError].map((error) => toProblem(error, CONTEXT));

      expect(answers.map(({ problem }) => [problem.code, problem.status, problem.detail])).toEqual([
        ["NOT_FOUND", 404, "The requested resource was not found"],
        ["FORBIDDEN", 403, "The caller is not allowed to do this"],
      ]);
      expect(answers.map(({ source, severity }) => [source, severity])).toEqual([
        ["registered", "warn"],
        ["registered", "warn"],
      ]);
    });

    it("collapses an internal code to INTERNAL_ERROR and logs it at error", () => {
      const answer = toProblem(RegisteredError.of(COMMON_ERRORS.INTERNAL_ERROR), CONTEXT);

      expect(answer).toEqual({
        problem: internalProblem(500),
        headers: {},
        source: "registered",
        loggedCode: "INTERNAL_ERROR",
        severity: "error",
      });
    });

    it("collapses a configuration code to INTERNAL_ERROR with no parameters, and logs its own code", async () => {
      const fresh = await loadProblemWithParams();

      const answer = fresh.toProblem(
        { code: "FIXTURE_VARIABLES_REFUSED", params: { variables: ["DATABASE_URL"] } },
        CONTEXT
      );

      expect(answer).toEqual({
        problem: internalProblem(500),
        headers: {},
        source: "registered",
        loggedCode: "FIXTURE_VARIABLES_REFUSED",
        severity: "error",
      });
    });

    it("sends the declared parameters it carries and words the text with them", async () => {
      const fresh = await loadProblemWithParams();

      const answer = fresh.toProblem(
        { code: "FIXTURE_QUOTA_REACHED", params: { limit: 100, service: "publisher", extra: "x" } },
        CONTEXT
      );

      expect(answer.problem).toEqual({
        type: "https://omnipost.app/problems/FIXTURE_QUOTA_REACHED",
        title: "Fixture quota reached",
        status: 429,
        detail: "Reached 100 calls to publisher",
        code: "FIXTURE_QUOTA_REACHED",
        correlationId: "corr-0001",
        timestamp: "2026-11-20T08:00:00.000Z",
        params: { limit: 100, service: "publisher" },
      });
      expect(answer.severity).toBe("warn");
    });

    it("logs a registered failure of the server or of a service it depends on at error, by its status, and a client's at warn", () => {
      const errors = [
        RegisteredError.of(COMMON_ERRORS.TRANSIENT_FAILURE),
        RegisteredError.of(COMMON_ERRORS.NOT_IMPLEMENTED),
        RegisteredError.of(PLATFORM_ERRORS.DATABASE_UNREACHABLE),
        RegisteredError.of(HTTP_ERRORS.SERVER_CLOSING),
        RegisteredError.of(COMMON_ERRORS.OPERATION_TOO_LARGE),
        RegisteredError.of(HTTP_ERRORS.REQUEST_TIMEOUT),
      ];

      const answers = errors.map((error) => toProblem(error, CONTEXT));

      expect(
        answers.map(({ problem, severity }) => `${problem.code} ${problem.status} ${severity}`)
      ).toEqual([
        "TRANSIENT_FAILURE 503 error",
        "NOT_IMPLEMENTED 501 error",
        "DATABASE_UNREACHABLE 503 error",
        "SERVER_CLOSING 503 error",
        "OPERATION_TOO_LARGE 413 warn",
        "REQUEST_TIMEOUT 408 warn",
      ]);
    });

    it("logs a registered failure of an upstream at error", async () => {
      const fresh = await loadProblemWithParams();

      const answer = fresh.toProblem({ code: "FIXTURE_UPSTREAM_TIMED_OUT" }, CONTEXT);

      expect([answer.problem.status, answer.problem.code, answer.severity]).toEqual([
        504,
        "FIXTURE_UPSTREAM_TIMED_OUT",
        "error",
      ]);
    });

    it("keeps the placeholder of a declared parameter it does not carry, and logs at error", async () => {
      const fresh = await loadProblemWithParams();

      const answer = fresh.toProblem(
        { code: "FIXTURE_QUOTA_REACHED", params: { limit: 100, service: 7 } },
        CONTEXT
      );

      expect(answer.problem.detail).toBe("Reached 100 calls to {service}");
      expect(answer.problem.params).toEqual({ limit: 100 });
      expect(answer.severity).toBe("error");
    });
  });

  describe("what the framework refuses", () => {
    const draftBody = z.object({ title: z.string(), tags: z.array(z.string()) });
    let app: FastifyInstance;

    beforeAll(async () => {
      const answerWithProblem = (error: unknown, reply: FastifyReply) => {
        const answer = toProblem(error, CONTEXT);
        return reply.status(answer.problem.status).send(answer);
      };
      // The framework's refusals of a URL reach `frameworkErrors`, not the error handler: both
      // answer through `toProblem` here, so every refusal the framework can raise is read.
      app = Fastify({
        logger: false,
        routerOptions: { maxParamLength: 8 },
        frameworkErrors: (error, _request, reply) => answerWithProblem(error, reply),
      });
      app.setValidatorCompiler(validatorCompiler);
      app.setSerializerCompiler(serializerCompiler);
      app.setErrorHandler(async (error, _request, reply) => answerWithProblem(error, reply));
      app.post("/drafts", { schema: { body: draftBody }, bodyLimit: 64 }, async () => ({}));
      app.get("/drafts/:id", async () => ({}));
      // A thrown plain object, not an Error: what some libraries reject with.
      app.get("/locked/:status", async (request) => {
        const { status } = request.params as { status: string };
        return Promise.reject({ statusCode: Number(status), message: LOCKED_TEXT });
      });
      app.get(
        "/drafts",
        { schema: { querystring: z.object({ page: z.coerce.number() }) } },
        async () => ({})
      );
      await app.ready();
    });

    afterAll(async () => {
      await app.close();
    });

    /** The answer the error handler sent for one request. */
    async function answerTo(request: InjectOptions) {
      const response = await app.inject(request);
      return { status: response.statusCode, answer: JSON.parse(response.body) };
    }

    it("answers VALIDATION_FAILED with each issue's part, pointer, code and the validator's text", async () => {
      const payload = { title: 7, tags: ["launch", 3] };
      const zodIssues = draftBody.safeParse(payload).error?.issues ?? [];

      const { status, answer } = await answerTo({ method: "POST", url: "/drafts", payload });

      expect(status).toBe(400);
      expect(answer).toEqual({
        problem: {
          type: "https://omnipost.app/problems/VALIDATION_FAILED",
          title: "Validation failed",
          status: 400,
          detail: "The request is not valid",
          code: "VALIDATION_FAILED",
          correlationId: "corr-0001",
          timestamp: "2026-11-20T08:00:00.000Z",
          issues: [
            {
              part: "body",
              pointer: "/title",
              code: "invalid_type",
              detail: zodIssues[0]?.message,
            },
            {
              part: "body",
              pointer: "/tags/1",
              code: "invalid_type",
              detail: zodIssues[1]?.message,
            },
          ],
        },
        headers: {},
        source: "validation",
        loggedCode: "FST_ERR_VALIDATION",
        severity: "warn",
      });
    });

    it("points at the part itself when the issue is about the whole part, and names the part", async () => {
      const missingBody = await answerTo({ method: "POST", url: "/drafts" });
      const badQuery = await answerTo({ method: "GET", url: "/drafts?page=many" });

      expect(missingBody.answer.problem.issues).toEqual([
        expect.objectContaining({ part: "body", pointer: "", code: "invalid_type" }),
      ]);
      expect(badQuery.answer.problem.issues).toEqual([
        expect.objectContaining({ part: "querystring", pointer: "/page", code: "invalid_type" }),
      ]);
    });

    it("answers the http code of its own cause for each refusal of the framework, and logs Fastify's code", async () => {
      const json = { "content-type": "application/json" };
      const refusals: readonly InjectOptions[] = [
        { method: "POST", url: "/drafts", headers: json, payload: "{" },
        { method: "POST", url: "/drafts", headers: json, payload: "" },
        {
          method: "POST",
          url: "/drafts",
          headers: { ...json, "content-length": "10" },
          payload: "{}",
        },
        { method: "POST", url: "/drafts", headers: { "content-type": "text/csv" }, payload: "a,b" },
        { method: "POST", url: "/drafts", headers: { "content-type": "not a type" }, payload: "a" },
        { method: "POST", url: "/drafts", payload: { title: "x".repeat(80), tags: [] } },
        { method: "GET", url: "/drafts/%E0%A4%A" },
        { method: "GET", url: "/drafts/a-long-draft-id" },
      ];

      // The inject's types take no QUERY request; Fastify's own error for one is read as raised.
      const missingContentType = {
        status: 400,
        answer: toProblem(new errorCodes.FST_ERR_ROUTE_MISSING_CONTENT_TYPE("QUERY"), CONTEXT),
      };

      const injected: Array<{ status: number; answer: ProblemAnswer }> = await Promise.all(
        refusals.map((r) => answerTo(r))
      );
      injected.splice(3, 0, missingContentType);

      expect(
        injected.map(
          ({ status, answer: { problem, loggedCode, source, severity } }) =>
            `${status} ${problem.status} ${problem.code} ${loggedCode} ${source}/${severity}`
        )
      ).toEqual([
        "400 400 JSON_BODY_NOT_PARSABLE FST_ERR_CTP_INVALID_JSON_BODY framework/warn",
        "400 400 JSON_BODY_EMPTY FST_ERR_CTP_EMPTY_JSON_BODY framework/warn",
        "400 400 BODY_LENGTH_MISMATCH FST_ERR_CTP_INVALID_CONTENT_LENGTH framework/warn",
        "400 400 CONTENT_TYPE_MISSING FST_ERR_ROUTE_MISSING_CONTENT_TYPE framework/warn",
        "415 415 UNSUPPORTED_MEDIA_TYPE FST_ERR_CTP_INVALID_MEDIA_TYPE framework/warn",
        "415 415 UNSUPPORTED_MEDIA_TYPE FST_ERR_CTP_INVALID_MEDIA_TYPE framework/warn",
        "413 413 PAYLOAD_TOO_LARGE FST_ERR_CTP_BODY_TOO_LARGE framework/warn",
        "400 400 PATH_NOT_DECODABLE FST_ERR_BAD_URL framework/warn",
        "414 414 ROUTE_PARAMETER_TOO_LONG FST_ERR_MAX_PARAM_LENGTH framework/warn",
      ]);
      expect(injected.map(({ answer }) => answer.problem.detail)).toEqual([
        HTTP_ERRORS.JSON_BODY_NOT_PARSABLE.message,
        HTTP_ERRORS.JSON_BODY_EMPTY.message,
        HTTP_ERRORS.BODY_LENGTH_MISMATCH.message,
        HTTP_ERRORS.CONTENT_TYPE_MISSING.message,
        HTTP_ERRORS.UNSUPPORTED_MEDIA_TYPE.message,
        HTTP_ERRORS.UNSUPPORTED_MEDIA_TYPE.message,
        HTTP_ERRORS.PAYLOAD_TOO_LARGE.message,
        HTTP_ERRORS.PATH_NOT_DECODABLE.message,
        HTTP_ERRORS.ROUTE_PARAMETER_TOO_LONG.message,
      ]);
    });

    it("answers a refusal of the framework whose cause no http code names as a carrier of its status, logged at error", () => {
      // Fastify raises it only when the router matched not even the not-found handler's catch-all
      // route, which it reports as a defect of its own.
      const answer = toProblem(new errorCodes.FST_ERR_NOT_FOUND(), CONTEXT);

      expect(answer).toEqual({
        problem: internalProblem(404),
        headers: {},
        source: "status-carrier",
        loggedCode: "FST_ERR_NOT_FOUND",
        severity: "error",
      });
    });

    it("keeps the status of a refusal no http code holds, with INTERNAL_ERROR's text", () => {
      // Every status of Fastify's own refusals has an http code, so the refusal is a plugin's, raised
      // with the framework's code prefix and a status of its own.
      const pluginRefusal = Object.assign(new Error("No Authorization was found in the headers"), {
        code: "FST_JWT_NO_AUTHORIZATION_IN_HEADER",
        statusCode: 401,
      });

      const answer = toProblem(pluginRefusal, CONTEXT);

      expect(answer).toEqual({
        problem: internalProblem(401),
        headers: {},
        source: "status-carrier",
        loggedCode: "FST_JWT_NO_AUTHORIZATION_IN_HEADER",
        severity: "error",
      });
    });

    it("keeps the failure status a thrown plain object carries, and never sends its text", async () => {
      const carried = await answerTo({ method: "GET", url: "/locked/409" });
      const outOfRange = await answerTo({ method: "GET", url: "/locked/302" });

      expect([carried.status, carried.answer.problem]).toEqual([409, internalProblem(409)]);
      expect(carried.answer.source).toBe("status-carrier");
      expect([outOfRange.status, outOfRange.answer.problem]).toEqual([500, internalProblem(500)]);
      expect(JSON.stringify([carried.answer, outOfRange.answer])).not.toContain(LOCKED_TEXT);
    });

    it("reads an issue the validator does not describe as unknown, at the part itself", () => {
      const error = Object.assign(new Error("refused"), {
        code: "FST_ERR_VALIDATION",
        statusCode: 400,
        validation: [{}],
        validationContext: "headers",
      });

      expect(toProblem(error, CONTEXT).problem.issues).toEqual([
        { part: "headers", pointer: "", code: "unknown", detail: "The request is not valid" },
      ]);
    });

    it("does not read a validation list outside a request part as the request's issues", () => {
      const error = Object.assign(new Error("refused"), {
        code: "FST_ERR_VALIDATION",
        statusCode: 400,
        validation: [{ keyword: "required", instancePath: "/a", message: "x" }],
        validationContext: "cookies",
      });

      const answer = toProblem(error, CONTEXT);

      expect([answer.problem, answer.source, answer.severity]).toEqual([
        internalProblem(400),
        "status-carrier",
        "error",
      ]);
    });
  });

  describe("a legacy AppError", () => {
    it("keeps its status and code, and shows its message when operational and below 500", () => {
      const answer = toProblem(new ConflictError("The post was published already"), CONTEXT);

      expect(answer).toEqual({
        problem: {
          type: "https://omnipost.app/problems/RESOURCE_CONFLICT",
          title: "Resource conflict",
          status: 409,
          detail: "The post was published already",
          code: "RESOURCE_CONFLICT",
          correlationId: "corr-0001",
          timestamp: "2026-11-20T08:00:00.000Z",
        },
        headers: {},
        source: "app-error",
        loggedCode: "RESOURCE_CONFLICT",
        severity: "warn",
      });
    });

    it("hides its message at 500 or above, or when not operational, and logs both at error", () => {
      const errors = [
        new DatabaseError("relation tenant_a.posts does not exist"),
        new AppError(ErrorCode.BAD_REQUEST, 400, "stack at /srv/app.ts:12", false),
      ];

      const answers = errors.map((error) => toProblem(error, CONTEXT));

      expect(answers.map(({ problem }) => [problem.code, problem.status, problem.detail])).toEqual([
        ["DATABASE_ERROR", 500, INTERNAL_TEXT],
        ["BAD_REQUEST", 400, INTERNAL_TEXT],
      ]);
      expect(answers.map(({ severity }) => severity)).toEqual(["error", "error"]);
    });

    it("answers INTERNAL_ERROR when its status is not a failure status", () => {
      const answer = toProblem(new AppError(ErrorCode.BAD_REQUEST, 302, "moved", true), CONTEXT);

      expect([answer.problem, answer.source, answer.severity]).toEqual([
        internalProblem(500),
        "unregistered",
        "error",
      ]);
    });
  });

  describe("any other failure", () => {
    it("keeps the failure status a value carries, with INTERNAL_ERROR's code and text, and logs its code", () => {
      const providerError = ProviderError.badRequest("youtube", "quota of project 123 exhausted");
      const carrier = Object.assign(new Error("upstream down"), { statusCode: 503 });
      const serialization = new ResponseSerializationError("GET", "/drafts", {
        cause: new z.ZodError([]),
      });

      const answers = [providerError, carrier, serialization].map((error) =>
        toProblem(error, CONTEXT)
      );

      expect(answers.map(({ problem }) => problem)).toEqual([
        internalProblem(400),
        internalProblem(503),
        internalProblem(500),
      ]);
      expect(
        answers.map(({ source, loggedCode, severity }) => [source, loggedCode, severity])
      ).toEqual([
        ["status-carrier", "BAD_REQUEST", "error"],
        ["status-carrier", "INTERNAL_ERROR", "error"],
        ["status-carrier", "FST_ERR_RESPONSE_SERIALIZATION", "error"],
      ]);
    });

    it("answers INTERNAL_ERROR at 500 for anything else, and logs a code the value carries", () => {
      const values: readonly unknown[] = [
        new Error("connection refused at /var/run/db.sock"),
        z.string().safeParse(1).error,
        new UseCaseError("User 42 not found", "USER_NOT_FOUND"),
        Object.assign(new Error("odd"), { statusCode: 600 }),
        Object.assign(new Error("odd"), { statusCode: 429.5 }),
        Object.assign(new Error("odd"), { statusCode: "503" }),
        { code: "FST_ERR_X", statusCode: 399 },
        "a raised string",
        undefined,
      ];

      const answers = values.map((value) => toProblem(value, CONTEXT));

      expect(answers.map(({ problem }) => problem)).toEqual(values.map(() => internalProblem(500)));
      expect(answers.map(({ source, severity }) => `${source}/${severity}`)).toEqual(
        values.map(() => "unregistered/error")
      );
      expect(answers.map(({ loggedCode }) => loggedCode)).toEqual([
        "INTERNAL_ERROR",
        "INTERNAL_ERROR",
        "USER_NOT_FOUND",
        "INTERNAL_ERROR",
        "INTERNAL_ERROR",
        "INTERNAL_ERROR",
        "FST_ERR_X",
        "INTERNAL_ERROR",
        "INTERNAL_ERROR",
      ]);
    });
  });

  describe("the body's contract", () => {
    it("is served as RFC 9457 problem JSON", () => {
      expect(PROBLEM_MEDIA_TYPE).toBe("application/problem+json; charset=utf-8");
    });

    it("accepts every body toProblem sends and refuses a code outside the grammar or a status that is no failure", () => {
      const bodies = [
        RegisteredError.of(COMMON_ERRORS.CONFLICT),
        Object.assign(new Error("refused"), { validation: [{}], validationContext: "body" }),
        new errorCodes.FST_ERR_NOT_FOUND(),
        new ConflictError("x"),
        Object.assign(new Error("x"), { statusCode: 502 }),
        null,
      ].map((value) => toProblem(value, CONTEXT).problem);
      const conflict = toProblem(RegisteredError.of(COMMON_ERRORS.CONFLICT), CONTEXT).problem;

      expect(bodies.map((body) => problemSchema.safeParse(body).success)).toEqual(
        bodies.map(() => true)
      );
      expect(problemSchema.safeParse({ ...conflict, code: "conflict" }).success).toBe(false);
      expect(problemSchema.safeParse({ ...conflict, status: 200 }).success).toBe(false);
    });
  });

  describe("the http domain", () => {
    it("holds the thirteen failures the HTTP boundary raises itself, one per cause, for operators only", () => {
      const definitions = Object.values(HTTP_ERRORS);

      expect(
        definitions.map(
          ({ code, domain, category, status, message }) =>
            `${code} ${domain} ${category} ${status}: ${message}`
        )
      ).toEqual([
        "PAYLOAD_TOO_LARGE http too_large 413: The request body is larger than this route accepts",
        "UNSUPPORTED_MEDIA_TYPE http validation 415: The request's content type is not one this route accepts",
        "ROUTE_NOT_FOUND http not_found 404: No route matches this method and path",
        "PATH_NOT_DECODABLE http validation 400: The request's path holds a percent-encoded sequence that does not decode",
        "ROUTE_PARAMETER_TOO_LONG http too_large 414: A parameter of the request's path is longer than the router accepts",
        "JSON_BODY_EMPTY http validation 400: The request declares a JSON body and sends an empty one",
        "JSON_BODY_NOT_PARSABLE http validation 400: The request body is not valid JSON",
        "BODY_LENGTH_MISMATCH http validation 400: The request body's length differs from the one its Content-Length header declares",
        "CONTENT_TYPE_MISSING http validation 400: A request of this method must declare the content type of its body",
        "REQUEST_NOT_PARSABLE http validation 400: The request is not valid HTTP: its request line or its headers could not be read",
        "REQUEST_HEADERS_TOO_LARGE http too_large 431: The request's headers are larger than the server accepts",
        "REQUEST_TIMEOUT http too_large 408: The request was not received in full within the time the server waits for one",
        "SERVER_CLOSING http unavailable 503: The server is shutting down and takes no new request: send it again on a new connection",
      ]);
      expect(definitions.map(({ params, fronts }) => [params, fronts])).toEqual(
        definitions.map(() => [{}, []])
      );
    });
  });
});
