/**
 * @file errorHandler.test.ts
 * @description The error handler and the not-found handler answer through `sendProblem` with the
 *   logger they were built with, the not-found one with ROUTE_NOT_FOUND; the body's OpenAPI
 *   component is the problem's schema at the OpenAPI 3.0 target, with a code held to its pattern;
 *   and the helpers beside them: `asyncHandler`, the Prisma and Zod converters, `handleAnyError`
 *   and `shouldTerminateProcess`. The bodies the handlers send are proved through inject in
 *   `errorHandler.inject.test.ts`.
 * @layer infrastructure
 */

import { describe, it, beforeEach, expect, vi } from "vitest";
import pino from "pino";
import { ERROR_CODE_PATTERN, HTTP_ERRORS, RegisteredError } from "@shared/types";
import {
  createErrorHandler,
  createNotFoundHandler,
  PROBLEM_OPENAPI_SCHEMA,
  asyncHandler,
  convertPrismaError,
  convertZodError,
  handleAnyError,
  shouldTerminateProcess,
} from "../../src/lib/errors/errorHandler.js";
import { sendProblem } from "../../src/lib/errors/sendProblem.js";
import { AppError, ErrorCode, AuthenticationError } from "../../src/lib/errors/AppError.js";
import {
  foreignKeyViolationOnIndex,
  uniqueViolationOnFields,
  uniqueViolationOnIndex,
} from "./helpers/prismaKnownRequestErrors.js";
import type { FastifyRequest, FastifyReply } from "fastify";

const { SENT_REPLY } = vi.hoisted(() => ({ SENT_REPLY: { sent: true } }));
vi.mock("../../src/lib/errors/sendProblem.js", () => ({ sendProblem: vi.fn(() => SENT_REPLY) }));

// Mock logger
class MockLogger {
  public logs: Array<{ level: string; context: any; message?: string }> = [];

  warn(context: any, message?: string) {
    this.logs.push({ level: "warn", context, message });
  }

  error(context: any, message?: string) {
    this.logs.push({ level: "error", context, message });
  }

  clear() {
    this.logs = [];
  }
}

// Mock request
function createMockRequest(overrides: Partial<FastifyRequest> = {}): FastifyRequest {
  return {
    id: "req-123",
    method: "GET",
    url: "/test",
    ip: "127.0.0.1",
    ...overrides,
  } as FastifyRequest;
}

// Mock reply
function createMockReply(): FastifyReply {
  let statusCode = 200;
  let sentPayload: any = null;

  return {
    status: (code: number) => {
      statusCode = code;
      return {
        send: (payload: any) => {
          sentPayload = payload;
          return {} as any;
        },
      } as any;
    },
    getStatusCode: () => statusCode,
    getSentPayload: () => sentPayload,
  } as any;
}

describe("Error Handler - createErrorHandler and createNotFoundHandler", () => {
  const logger = pino({ enabled: false });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("answers whatever is raised through sendProblem, with the logger it was built with", () => {
    const request = createMockRequest();
    const reply = createMockReply();
    const error = new Error("Database connection failed at /internal/path");

    const answered = createErrorHandler(logger)(error, request, reply);

    expect(vi.mocked(sendProblem).mock.calls).toEqual([[request, reply, error, logger]]);
    expect(answered).toBe(SENT_REPLY);
  });

  it("answers a path no route matches with ROUTE_NOT_FOUND through sendProblem, with the logger it was built with", () => {
    const request = createMockRequest();
    const reply = createMockReply();

    const answered = createNotFoundHandler(logger)(request, reply);

    expect(vi.mocked(sendProblem).mock.calls).toEqual([
      [request, reply, RegisteredError.of(HTTP_ERRORS.ROUTE_NOT_FOUND), logger],
    ]);
    expect(vi.mocked(sendProblem).mock.calls[0]?.[2]).toBeInstanceOf(RegisteredError);
    expect(answered).toBe(SENT_REPLY);
  });
});

describe("Error Handler - PROBLEM_OPENAPI_SCHEMA", () => {
  it("publishes every member of the body at the OpenAPI 3.0 target, requires the ones every problem carries, and holds code to a pattern rather than a list", () => {
    const { properties, required, additionalProperties, type } = PROBLEM_OPENAPI_SCHEMA;

    expect([type, additionalProperties]).toEqual(["object", false]);
    expect(PROBLEM_OPENAPI_SCHEMA).not.toHaveProperty("$schema");
    expect(Object.keys(properties ?? {})).toEqual([
      "type",
      "title",
      "status",
      "detail",
      "code",
      "correlationId",
      "timestamp",
      "params",
      "issues",
    ]);
    expect(required).toEqual([
      "type",
      "title",
      "status",
      "detail",
      "code",
      "correlationId",
      "timestamp",
    ]);
    expect(properties?.["code"]).toEqual({
      type: "string",
      maxLength: 63,
      pattern: ERROR_CODE_PATTERN.source,
    });
    expect(properties?.["status"]).toEqual({ type: "integer", minimum: 400, maximum: 599 });
  });
});

describe("Error Handler - asyncHandler", () => {
  it("should execute handler successfully", async () => {
    const handler = asyncHandler(async () => ({ data: "success" }));
    const request = createMockRequest();
    const reply = createMockReply();

    const result = await handler(request, reply);
    expect(result).toStrictEqual({ data: "success" });
  });

  it("should propagate async errors", async () => {
    const handler = asyncHandler(async () => {
      throw new Error("Async error");
    });
    const request = createMockRequest();
    const reply = createMockReply();

    await expect(handler(request, reply)).rejects.toThrow("Async error");
  });

  it("should handle Promise rejections", async () => {
    const handler = asyncHandler(async () => {
      return Promise.reject(new Error("Rejected"));
    });
    const request = createMockRequest();
    const reply = createMockReply();

    await expect(handler(request, reply)).rejects.toThrow("Rejected");
  });
});

describe("Error Handler - convertPrismaError", () => {
  it("should convert P2002 unique constraint violation", () => {
    const prismaError = uniqueViolationOnIndex("Account_email_key", "Account");

    const appError = convertPrismaError(prismaError);

    expect(appError.code).toBe(ErrorCode.RESOURCE_CONFLICT);
    expect(appError.statusCode).toBe(409);
    expect(appError.message).toBe("Resource already exists");
  });

  it("should convert P2025 record not found", () => {
    const prismaError = {
      code: "P2025",
      meta: {},
    };

    const appError = convertPrismaError(prismaError);

    expect(appError.code).toBe(ErrorCode.RESOURCE_NOT_FOUND);
    expect(appError.statusCode).toBe(404);
    expect(appError.message).toBe("Resource not found");
  });

  it("should convert P2003 foreign key constraint violation", () => {
    const prismaError = foreignKeyViolationOnIndex("Project_accountId_fkey", "Project");

    const appError = convertPrismaError(prismaError);

    expect(appError.code).toBe(ErrorCode.VALIDATION_ERROR);
    expect(appError.statusCode).toBe(400);
    expect(appError.message).toBe("Invalid reference");
  });

  it("should convert P2011 null constraint violation", () => {
    // `@prisma/adapter-pg` maps SQLSTATE 23502 to a NullConstraintViolation whose columns it
    // parses from a `Key (...)` detail, which a not-null violation does not carry: no constraint.
    const prismaError = {
      code: "P2011",
      meta: {
        driverAdapterError: {
          name: "DriverAdapterError",
          cause: { originalCode: "23502", kind: "NullConstraintViolation" },
        },
      },
    };

    const appError = convertPrismaError(prismaError);

    expect(appError.code).toBe(ErrorCode.VALIDATION_MISSING_FIELD);
    expect(appError.statusCode).toBe(400);
    expect(appError.message).toBe("Required field is missing");
  });

  it("names the violated index in development when Prisma 7.10.0 reports it", () => {
    process.env.NODE_ENV = "development";

    const appError = convertPrismaError(uniqueViolationOnIndex("Account_email_key", "Account"));

    expect(appError.details).toStrictEqual({ constraint: { index: "Account_email_key" } });

    process.env.NODE_ENV = "test";
  });

  it("names the violated columns, unquoted, in development when Prisma 7.9.1 reports them", () => {
    process.env.NODE_ENV = "development";

    const appError = convertPrismaError(
      uniqueViolationOnFields(['"accountId"', "name"], "Project_accountId_name_key", "Project")
    );

    expect(appError.details).toStrictEqual({ constraint: { fields: ["accountId", "name"] } });

    process.env.NODE_ENV = "test";
  });

  it("names the violated foreign key in development", () => {
    process.env.NODE_ENV = "development";

    const appError = convertPrismaError(
      foreignKeyViolationOnIndex("Project_accountId_fkey", "Project")
    );

    expect(appError.details).toStrictEqual({ constraint: { index: "Project_accountId_fkey" } });

    process.env.NODE_ENV = "test";
  });

  it("should not include field details in production", () => {
    process.env.NODE_ENV = "production";

    const prismaError = uniqueViolationOnIndex("Account_email_key", "Account");

    const appError = convertPrismaError(prismaError);
    expect(appError.details).toBe(undefined);

    process.env.NODE_ENV = "test";
  });

  it("should handle unknown Prisma errors", () => {
    const prismaError = {
      code: "P9999",
      meta: {},
    };

    const appError = convertPrismaError(prismaError);

    expect(appError.code).toBe(ErrorCode.DATABASE_ERROR);
    expect(appError.statusCode).toBe(500);
    expect(appError.message).toBe("Database operation failed");
  });
});

describe("Error Handler - convertZodError", () => {
  it("should convert Zod validation error", () => {
    const zodError = {
      issues: [
        { path: ["email"], message: "Invalid email" },
        { path: ["password"], message: "Too short" },
      ],
    };

    const appError = convertZodError(zodError);

    expect(appError.code).toBe(ErrorCode.VALIDATION_ERROR);
    expect(appError.statusCode).toBe(400);
    expect(appError.message).toBe("Validation failed");
  });

  it("should include issues in development", () => {
    process.env.NODE_ENV = "development";

    const zodError = {
      issues: [{ path: ["email"], message: "Invalid email" }],
    };

    const appError = convertZodError(zodError);
    expect(appError.details).toBeTruthy();
    expect(Array.isArray(appError.details.issues)).toBeTruthy();
    expect(appError.details.issues[0].message).toBe("Invalid email");

    process.env.NODE_ENV = "test";
  });

  it("should not include issues in production", () => {
    process.env.NODE_ENV = "production";

    const zodError = {
      issues: [{ path: ["email"], message: "Invalid email" }],
    };

    const appError = convertZodError(zodError);
    expect(appError.details).toBe(undefined);

    process.env.NODE_ENV = "test";
  });
});

describe("Error Handler - handleAnyError", () => {
  let mockLogger: MockLogger;

  beforeEach(() => {
    mockLogger = new MockLogger();
  });

  it("should return AppError unchanged", () => {
    const error = new AppError(ErrorCode.VALIDATION_ERROR, 400, "Validation failed");
    const result = handleAnyError(error, mockLogger);

    expect(result).toBe(error);
  });

  it("should convert Prisma errors", () => {
    const prismaError = uniqueViolationOnIndex("Account_email_key", "Account");

    const result = handleAnyError(prismaError, mockLogger);

    expect(result instanceof AppError).toBeTruthy();
    expect(result.code).toBe(ErrorCode.RESOURCE_CONFLICT);
  });

  it("should convert Zod errors", () => {
    const zodError = {
      issues: [{ path: ["email"], message: "Invalid email" }],
    };

    const result = handleAnyError(zodError, mockLogger);

    expect(result instanceof AppError).toBeTruthy();
    expect(result.code).toBe(ErrorCode.VALIDATION_ERROR);
  });

  it("should handle standard Error", () => {
    const error = new Error("Standard error");
    const result = handleAnyError(error, mockLogger);

    expect(result instanceof AppError).toBeTruthy();
    expect(result.code).toBe(ErrorCode.INTERNAL_SERVER_ERROR);
    expect(result.statusCode).toBe(500);
  });

  it("should log standard errors", () => {
    const error = new Error("Test error");
    handleAnyError(error, mockLogger);

    expect(mockLogger.logs.length).toBe(1);
    expect(mockLogger.logs[0].level).toBe("error");
  });

  it("should handle unknown error types", () => {
    const unknownError = { something: "unexpected" };
    const result = handleAnyError(unknownError, mockLogger);

    expect(result instanceof AppError).toBeTruthy();
    expect(result.code).toBe(ErrorCode.INTERNAL_SERVER_ERROR);
  });

  it("should log unknown error types", () => {
    const unknownError = { something: "unexpected" };
    handleAnyError(unknownError, mockLogger);

    expect(mockLogger.logs.length).toBe(1);
    expect(mockLogger.logs[0].level).toBe("error");
  });
});

describe("Error Handler - shouldTerminateProcess", () => {
  it("should return false for operational errors", () => {
    const error = new AppError(ErrorCode.VALIDATION_ERROR, 400, "Validation failed", true);
    expect(shouldTerminateProcess(error)).toBe(false);
  });

  it("should return true for non-operational errors", () => {
    const error = new AppError(ErrorCode.INTERNAL_SERVER_ERROR, 500, "Internal error", false);
    expect(shouldTerminateProcess(error)).toBe(true);
  });

  it("should return true for standard errors", () => {
    const error = new Error("Standard error");
    expect(shouldTerminateProcess(error)).toBe(true);
  });

  it("should return false for authentication errors", () => {
    const error = new AuthenticationError("Invalid token");
    expect(shouldTerminateProcess(error)).toBe(false);
  });
});
