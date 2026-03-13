#!/usr/bin/env tsx
/**
 * Comprehensive Unit Tests for Error Handler
 * Target Coverage: 95%+
 *
 * Testing:
 * - createErrorHandler functionality
 * - Error sanitization and safe messages
 * - Prisma error conversion
 * - Zod error conversion
 * - Global error handling
 * - Process termination decisions
 *
 * Converted to node:test standard
 */

import { describe, it, beforeEach, expect } from "vitest";
import {
  createErrorHandler,
  asyncHandler,
  convertPrismaError,
  convertZodError,
  handleAnyError,
  shouldTerminateProcess,
} from "../../src/lib/errors/errorHandler.js";
import { AppError, ErrorCode, AuthenticationError } from "../../src/lib/errors/AppError.js";
import type { FastifyRequest, FastifyReply } from "fastify";

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

describe("Error Handler - createErrorHandler", () => {
  let mockLogger: MockLogger;

  beforeEach(() => {
    mockLogger = new MockLogger();
  });

  it("should handle AppError and return safe response", async () => {
    const errorHandler = createErrorHandler(mockLogger);
    const request = createMockRequest();
    const reply = createMockReply();

    const error = new AppError(ErrorCode.VALIDATION_ERROR, 400, "Validation failed", true, {
      field: "email",
    });

    await errorHandler(error, request, reply);

    const payload = (reply as any).getSentPayload();
    expect((reply as any).getStatusCode()).toBe(400);
    expect(payload.ok).toBe(false);
    expect(payload.error.code).toBe(ErrorCode.VALIDATION_ERROR);
    expect(payload.error.message).toBe("Validation failed");
    expect(payload.error.requestId).toBe("req-123");
    expect(payload.error.timestamp).toBeTruthy();
  });

  it("should log operational errors as warnings", async () => {
    const errorHandler = createErrorHandler(mockLogger);
    const request = createMockRequest();
    const reply = createMockReply();

    const error = new AppError(ErrorCode.VALIDATION_ERROR, 400, "Validation failed", true);

    await errorHandler(error, request, reply);

    expect(mockLogger.logs.length).toBe(1);
    expect(mockLogger.logs[0].level).toBe("warn");
    expect(mockLogger.logs[0].message).toBe("Operational error occurred");
  });

  it("should log non-operational errors as errors", async () => {
    const errorHandler = createErrorHandler(mockLogger);
    const request = createMockRequest();
    const reply = createMockReply();

    const error = new AppError(ErrorCode.INTERNAL_SERVER_ERROR, 500, "Internal error", false);

    await errorHandler(error, request, reply);

    expect(mockLogger.logs.length).toBe(1);
    expect(mockLogger.logs[0].level).toBe("error");
    expect(mockLogger.logs[0].message).toBe("Unexpected error occurred");
  });

  it("should log standard errors as errors", async () => {
    const errorHandler = createErrorHandler(mockLogger);
    const request = createMockRequest();
    const reply = createMockReply();

    const error = new Error("Standard error");

    await errorHandler(error, request, reply);

    expect(mockLogger.logs.length).toBe(1);
    expect(mockLogger.logs[0].level).toBe("error");
  });

  it("should include request context in logs", async () => {
    const errorHandler = createErrorHandler(mockLogger);
    const request = createMockRequest({
      id: "req-456",
      method: "POST",
      url: "/api/posts",
      ip: "192.168.1.1",
    });
    const reply = createMockReply();

    const error = new Error("Test error");

    await errorHandler(error, request, reply);

    const logContext = mockLogger.logs[0].context;
    expect(logContext.requestId).toBe("req-456");
    expect(logContext.method).toBe("POST");
    expect(logContext.url).toBe("/api/posts");
    expect(logContext.ip).toBe("192.168.1.1");
  });

  it("should include error details in development", async () => {
    process.env.NODE_ENV = "development";

    const errorHandler = createErrorHandler(mockLogger);
    const request = createMockRequest();
    const reply = createMockReply();

    const error = new AppError(ErrorCode.VALIDATION_ERROR, 400, "Validation failed", true, {
      field: "email",
    });

    await errorHandler(error, request, reply);

    const payload = (reply as any).getSentPayload();
    expect(payload.error.details).toStrictEqual({ field: "email" });

    process.env.NODE_ENV = "test";
  });

  it("should not include error details in production", async () => {
    process.env.NODE_ENV = "production";

    const errorHandler = createErrorHandler(mockLogger);
    const request = createMockRequest();
    const reply = createMockReply();

    const error = new AppError(ErrorCode.VALIDATION_ERROR, 400, "Validation failed", true, {
      field: "email",
    });

    await errorHandler(error, request, reply);

    const payload = (reply as any).getSentPayload();
    expect(payload.error.details).toBe(undefined);

    process.env.NODE_ENV = "test";
  });

  it("should return 500 for unknown errors", async () => {
    const errorHandler = createErrorHandler(mockLogger);
    const request = createMockRequest();
    const reply = createMockReply();

    const error = new Error("Unknown error");

    await errorHandler(error, request, reply);

    expect((reply as any).getStatusCode()).toBe(500);
  });

  it("should sanitize error messages", async () => {
    const errorHandler = createErrorHandler(mockLogger);
    const request = createMockRequest();
    const reply = createMockReply();

    const error = new Error("Database connection failed at /internal/path");

    await errorHandler(error, request, reply);

    const payload = (reply as any).getSentPayload();
    expect(payload.error.message).toBe("An unexpected error occurred");
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
    const prismaError = {
      code: "P2002",
      meta: { target: ["email"] },
    };

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
    const prismaError = {
      code: "P2003",
      meta: { field_name: "userId" },
    };

    const appError = convertPrismaError(prismaError);

    expect(appError.code).toBe(ErrorCode.VALIDATION_ERROR);
    expect(appError.statusCode).toBe(400);
    expect(appError.message).toBe("Invalid reference");
  });

  it("should convert P2011 null constraint violation", () => {
    const prismaError = {
      code: "P2011",
      meta: { constraint: "email" },
    };

    const appError = convertPrismaError(prismaError);

    expect(appError.code).toBe(ErrorCode.VALIDATION_MISSING_FIELD);
    expect(appError.statusCode).toBe(400);
    expect(appError.message).toBe("Required field is missing");
  });

  it("should include field details in development", () => {
    process.env.NODE_ENV = "development";

    const prismaError = {
      code: "P2002",
      meta: { target: ["email"] },
    };

    const appError = convertPrismaError(prismaError);
    expect(appError.details).toBeTruthy();
    expect(appError.details.field).toStrictEqual(["email"]);

    process.env.NODE_ENV = "test";
  });

  it("should not include field details in production", () => {
    process.env.NODE_ENV = "production";

    const prismaError = {
      code: "P2002",
      meta: { target: ["email"] },
    };

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
    const prismaError = {
      code: "P2002",
      meta: { target: ["email"] },
    };

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
