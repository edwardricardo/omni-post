#!/usr/bin/env tsx
/**
 * Comprehensive Unit Tests for AppError
 * Target Coverage: 95%+
 *
 * Testing:
 * - AppError class construction
 * - Error code enumeration
 * - Factory methods
 * - Predefined error classes
 * - Error utilities (isOperational, getSafeErrorMessage, etc.)
 * - JSON serialization
 *
 * Converted to node:test standard
 *
 * @file AppError.test.ts
 * @description Tests for AppError - Construction
 * @layer infrastructure
 */

import { describe, it, beforeAll, afterAll, expect } from "vitest";
import {
  AppError,
  ErrorCode,
  AuthenticationError,
  AuthorizationError,
  ValidationError,
  NotFoundError,
  ConflictError,
  RateLimitError,
  DatabaseError,
  ExternalServiceError,
  isOperationalError,
  getSafeErrorMessage,
  getErrorCode,
  getStatusCode,
} from "../../src/lib/errors/AppError.js";

describe("AppError - Construction", () => {
  it("should create error with all properties", () => {
    const error = new AppError(ErrorCode.VALIDATION_ERROR, 400, "Validation failed", true, {
      field: "email",
    });

    expect(error.code).toBe(ErrorCode.VALIDATION_ERROR);
    expect(error.statusCode).toBe(400);
    expect(error.message).toBe("Validation failed");
    expect(error.isOperational).toBe(true);
    expect(error.details).toStrictEqual({ field: "email" });
    expect(error.timestamp instanceof Date).toBeTruthy();
  });

  it("should create error without optional details", () => {
    const error = new AppError(ErrorCode.BAD_REQUEST, 400, "Bad request", true);

    expect(error.code).toBe(ErrorCode.BAD_REQUEST);
    expect(error.details).toBe(undefined);
  });

  it("should default isOperational to true", () => {
    const error = new AppError(ErrorCode.BAD_REQUEST, 400, "Bad request");
    expect(error.isOperational).toBe(true);
  });

  it("should capture stack trace", () => {
    const error = new AppError(ErrorCode.INTERNAL_SERVER_ERROR, 500, "Error");
    expect(error.stack).toBeTruthy();
    expect(error.stack.includes("AppError")).toBeTruthy();
  });

  it("should set proper prototype chain", () => {
    const error = new AppError(ErrorCode.BAD_REQUEST, 400, "Error");
    expect(error instanceof AppError).toBeTruthy();
    expect(error instanceof Error).toBeTruthy();
  });
});

describe("AppError - Factory Methods", () => {
  it("should create bad request error", () => {
    const error = AppError.badRequest("Invalid input");
    expect(error.code).toBe(ErrorCode.BAD_REQUEST);
    expect(error.statusCode).toBe(400);
    expect(error.message).toBe("Invalid input");
    expect(error.isOperational).toBe(true);
  });

  it("should create bad request with default message", () => {
    const error = AppError.badRequest();
    expect(error.message).toBe("Bad request");
  });

  it("should create unauthorized error", () => {
    const error = AppError.unauthorized("Invalid credentials");
    expect(error.code).toBe(ErrorCode.AUTH_INVALID_CREDENTIALS);
    expect(error.statusCode).toBe(401);
    expect(error.message).toBe("Invalid credentials");
  });

  it("should create forbidden error", () => {
    const error = AppError.forbidden("Access denied");
    expect(error.code).toBe(ErrorCode.FORBIDDEN);
    expect(error.statusCode).toBe(403);
    expect(error.message).toBe("Access denied");
  });

  it("should create not found error", () => {
    const error = AppError.notFound("User");
    expect(error.code).toBe(ErrorCode.RESOURCE_NOT_FOUND);
    expect(error.statusCode).toBe(404);
    expect(error.message).toBe("User not found");
  });

  it("should create not found with default resource", () => {
    const error = AppError.notFound();
    expect(error.message).toBe("Resource not found");
  });

  it("should create conflict error", () => {
    const error = AppError.conflict("Email already exists");
    expect(error.code).toBe(ErrorCode.RESOURCE_CONFLICT);
    expect(error.statusCode).toBe(409);
    expect(error.message).toBe("Email already exists");
  });

  it("should create internal server error", () => {
    const error = AppError.internal("Database connection failed");
    expect(error.code).toBe(ErrorCode.INTERNAL_SERVER_ERROR);
    expect(error.statusCode).toBe(500);
    expect(error.message).toBe("Database connection failed");
    expect(error.isOperational).toBe(false);
  });

  it("should create validation error", () => {
    const error = AppError.validationFailed("Required fields missing", {
      fields: ["email", "password"],
    });
    expect(error.code).toBe(ErrorCode.VALIDATION_ERROR);
    expect(error.statusCode).toBe(400);
    expect(error.details).toStrictEqual({ fields: ["email", "password"] });
  });

  it("should create rate limit error with retryAfter", () => {
    const error = AppError.tooManyRequests("Rate limit exceeded", 60);
    expect(error.code).toBe(ErrorCode.RATE_LIMIT_EXCEEDED);
    expect(error.statusCode).toBe(429);
    expect(error.details).toStrictEqual({ retryAfter: 60 });
  });

  it("should create rate limit error without retryAfter", () => {
    const error = AppError.tooManyRequests();
    expect(error.message).toBe("Too many requests");
    expect(error.details).toBe(undefined);
  });

  it("should create database error", () => {
    const error = AppError.database("Query timeout", { query: "SELECT *" });
    expect(error.code).toBe(ErrorCode.DATABASE_ERROR);
    expect(error.statusCode).toBe(500);
    expect(error.details).toStrictEqual({ query: "SELECT *" });
  });

  it("should create external service error", () => {
    const error = AppError.externalService("Twitter API", "Rate limited");
    expect(error.code).toBe(ErrorCode.EXTERNAL_SERVICE_ERROR);
    expect(error.statusCode).toBe(502);
    expect(error.message).toBe("Rate limited");
  });

  it("should create external service error with default message", () => {
    const error = AppError.externalService("Twitter API");
    expect(error.message).toBe("External service 'Twitter API' unavailable");
  });
});

describe("AppError - Predefined Error Classes", () => {
  it("should create AuthenticationError", () => {
    const error = new AuthenticationError("Invalid token");
    expect(error instanceof AppError).toBeTruthy();
    expect(error.code).toBe(ErrorCode.AUTH_INVALID_CREDENTIALS);
    expect(error.statusCode).toBe(401);
    expect(error.message).toBe("Invalid token");
  });

  it("should create AuthenticationError with default message", () => {
    const error = new AuthenticationError();
    expect(error.message).toBe("Authentication failed");
  });

  it("should create AuthorizationError", () => {
    const error = new AuthorizationError("Admin only");
    expect(error instanceof AppError).toBeTruthy();
    expect(error.code).toBe(ErrorCode.AUTH_INSUFFICIENT_PERMISSIONS);
    expect(error.statusCode).toBe(403);
    expect(error.message).toBe("Admin only");
  });

  it("should create ValidationError", () => {
    const error = new ValidationError("Invalid email format");
    expect(error instanceof AppError).toBeTruthy();
    expect(error.code).toBe(ErrorCode.VALIDATION_ERROR);
    expect(error.statusCode).toBe(400);
  });

  it("should create NotFoundError", () => {
    const error = new NotFoundError("Post");
    expect(error instanceof AppError).toBeTruthy();
    expect(error.code).toBe(ErrorCode.RESOURCE_NOT_FOUND);
    expect(error.statusCode).toBe(404);
    expect(error.message).toBe("Post not found");
  });

  it("should create ConflictError", () => {
    const error = new ConflictError("Duplicate entry");
    expect(error instanceof AppError).toBeTruthy();
    expect(error.code).toBe(ErrorCode.RESOURCE_CONFLICT);
    expect(error.statusCode).toBe(409);
  });

  it("should create RateLimitError", () => {
    const error = new RateLimitError(120);
    expect(error instanceof AppError).toBeTruthy();
    expect(error.code).toBe(ErrorCode.RATE_LIMIT_EXCEEDED);
    expect(error.statusCode).toBe(429);
    expect(error.details?.retryAfter === 120).toBeTruthy();
  });

  it("should create RateLimitError with additional details", () => {
    const error = new RateLimitError(60, { endpoint: "/api/posts" });
    expect(error.details).toStrictEqual({
      retryAfter: 60,
      endpoint: "/api/posts",
    });
  });

  it("should create DatabaseError", () => {
    const error = new DatabaseError("Connection lost");
    expect(error instanceof AppError).toBeTruthy();
    expect(error.code).toBe(ErrorCode.DATABASE_ERROR);
    expect(error.statusCode).toBe(500);
  });

  it("should create ExternalServiceError", () => {
    const error = new ExternalServiceError("Facebook API");
    expect(error instanceof AppError).toBeTruthy();
    expect(error.code).toBe(ErrorCode.EXTERNAL_SERVICE_ERROR);
    expect(error.statusCode).toBe(502);
    expect(error.message.includes("Facebook API")).toBeTruthy();
  });
});

describe("AppError - JSON Serialization", () => {
  const originalNodeEnv = process.env.NODE_ENV;

  beforeAll(() => {
    process.env.NODE_ENV = "production";
  });

  afterAll(() => {
    process.env.NODE_ENV = originalNodeEnv ?? "test";
  });

  it("should serialize to JSON without details in production", () => {
    const error = new AppError(ErrorCode.VALIDATION_ERROR, 400, "Validation failed", true, {
      field: "email",
    });

    const json = error.toJSON();

    expect(json.error.code).toBe(ErrorCode.VALIDATION_ERROR);
    expect(json.error.message).toBe("Validation failed");
    expect(json.error.timestamp).toBeTruthy();
    expect(json.error.details).toBe(undefined);
  });

  it("should include details in development", () => {
    process.env.NODE_ENV = "development";

    const error = new AppError(ErrorCode.VALIDATION_ERROR, 400, "Validation failed", true, {
      field: "email",
    });

    const json = error.toJSON();

    expect(json.error.details).toStrictEqual({ field: "email" });

    process.env.NODE_ENV = "production";
  });

  it("should format timestamp as ISO string", () => {
    const error = new AppError(ErrorCode.BAD_REQUEST, 400, "Error");
    const json = error.toJSON();

    expect(json.error.timestamp.match(/^\d{4}-\d{2}-\d{2}T/)).toBeTruthy();
  });
});

describe("AppError - isOperationalError", () => {
  it("should return true for operational AppError", () => {
    const error = new AppError(ErrorCode.VALIDATION_ERROR, 400, "Error", true);
    expect(isOperationalError(error)).toBe(true);
  });

  it("should return false for non-operational AppError", () => {
    const error = new AppError(ErrorCode.INTERNAL_SERVER_ERROR, 500, "Error", false);
    expect(isOperationalError(error)).toBe(false);
  });

  it("should return false for standard Error", () => {
    const error = new Error("Standard error");
    expect(isOperationalError(error)).toBe(false);
  });

  it("should return false for non-Error objects", () => {
    expect(isOperationalError({ message: "Not an error" } as any)).toBe(false);
  });
});

describe("AppError - getSafeErrorMessage", () => {
  it("should return message from AppError", () => {
    const error = new AppError(ErrorCode.VALIDATION_ERROR, 400, "Validation failed");
    expect(getSafeErrorMessage(error)).toBe("Validation failed");
  });

  it("should return safe message for Prisma errors", () => {
    const prismaError = new Error("Prisma error");
    (prismaError as any).constructor = { name: "PrismaClientKnownRequestError" };
    expect(getSafeErrorMessage(prismaError)).toBe("Database operation failed");
  });

  it("should return safe message for validation errors", () => {
    const validationError = new Error("Validation error");
    validationError.name = "ValidationError";
    expect(getSafeErrorMessage(validationError)).toBe("Validation failed");
  });

  it("should return safe message for Zod errors", () => {
    const zodError = new Error("Zod error");
    zodError.name = "ZodError";
    expect(getSafeErrorMessage(zodError)).toBe("Validation failed");
  });

  it("should return generic message for standard Error", () => {
    const error = new Error("Internal error details");
    expect(getSafeErrorMessage(error)).toBe("An unexpected error occurred");
  });

  it("should return generic message for non-Error objects", () => {
    expect(getSafeErrorMessage({ message: "Not an error" })).toBe("An unexpected error occurred");
  });

  it("should return generic message for null", () => {
    expect(getSafeErrorMessage(null)).toBe("An unexpected error occurred");
  });
});

describe("AppError - getErrorCode", () => {
  it("should return code from AppError", () => {
    const error = new AppError(ErrorCode.VALIDATION_ERROR, 400, "Validation failed");
    expect(getErrorCode(error)).toBe(ErrorCode.VALIDATION_ERROR);
  });

  it("should return DATABASE_ERROR for Prisma errors", () => {
    const prismaError = new Error("Prisma error");
    (prismaError as any).constructor = { name: "PrismaClientKnownRequestError" };
    expect(getErrorCode(prismaError)).toBe(ErrorCode.DATABASE_ERROR);
  });

  it("should return VALIDATION_ERROR for ValidationError", () => {
    const validationError = new Error("Validation error");
    validationError.name = "ValidationError";
    expect(getErrorCode(validationError)).toBe(ErrorCode.VALIDATION_ERROR);
  });

  it("should return VALIDATION_ERROR for ZodError", () => {
    const zodError = new Error("Zod error");
    zodError.name = "ZodError";
    expect(getErrorCode(zodError)).toBe(ErrorCode.VALIDATION_ERROR);
  });

  it("should return INTERNAL_SERVER_ERROR for unknown errors", () => {
    const error = new Error("Unknown error");
    expect(getErrorCode(error)).toBe(ErrorCode.INTERNAL_SERVER_ERROR);
  });

  it("should return INTERNAL_SERVER_ERROR for non-Error objects", () => {
    expect(getErrorCode({ message: "Not an error" })).toBe(ErrorCode.INTERNAL_SERVER_ERROR);
  });
});

describe("AppError - getStatusCode", () => {
  it("should return status code from AppError", () => {
    const error = new AppError(ErrorCode.VALIDATION_ERROR, 400, "Error");
    expect(getStatusCode(error)).toBe(400);
  });

  it("should return 500 for standard Error", () => {
    const error = new Error("Standard error");
    expect(getStatusCode(error)).toBe(500);
  });

  it("should return 500 for non-Error objects", () => {
    expect(getStatusCode({ message: "Not an error" })).toBe(500);
  });

  it("should return 500 for null", () => {
    expect(getStatusCode(null)).toBe(500);
  });
});

describe("AppError - ErrorCode Enum", () => {
  it("should have authentication error codes", () => {
    expect(ErrorCode.AUTH_INVALID_CREDENTIALS).toBe("AUTH_INVALID_CREDENTIALS");
    expect(ErrorCode.AUTH_USER_NOT_FOUND).toBe("AUTH_USER_NOT_FOUND");
    expect(ErrorCode.AUTH_TOKEN_EXPIRED).toBe("AUTH_TOKEN_EXPIRED");
    expect(ErrorCode.AUTH_TOKEN_INVALID).toBe("AUTH_TOKEN_INVALID");
    expect(ErrorCode.AUTH_INSUFFICIENT_PERMISSIONS).toBe("AUTH_INSUFFICIENT_PERMISSIONS");
    expect(ErrorCode.AUTH_MFA_REQUIRED).toBe("AUTH_MFA_REQUIRED");
    expect(ErrorCode.AUTH_MFA_INVALID).toBe("AUTH_MFA_INVALID");
  });

  it("should have validation error codes", () => {
    expect(ErrorCode.VALIDATION_ERROR).toBe("VALIDATION_ERROR");
    expect(ErrorCode.VALIDATION_MISSING_FIELD).toBe("VALIDATION_MISSING_FIELD");
    expect(ErrorCode.VALIDATION_INVALID_FORMAT).toBe("VALIDATION_INVALID_FORMAT");
  });

  it("should have resource error codes", () => {
    expect(ErrorCode.RESOURCE_NOT_FOUND).toBe("RESOURCE_NOT_FOUND");
    expect(ErrorCode.RESOURCE_ALREADY_EXISTS).toBe("RESOURCE_ALREADY_EXISTS");
    expect(ErrorCode.RESOURCE_CONFLICT).toBe("RESOURCE_CONFLICT");
  });

  it("should have rate limiting error code", () => {
    expect(ErrorCode.RATE_LIMIT_EXCEEDED).toBe("RATE_LIMIT_EXCEEDED");
  });

  it("should have database error codes", () => {
    expect(ErrorCode.DATABASE_ERROR).toBe("DATABASE_ERROR");
    expect(ErrorCode.DATABASE_CONNECTION_FAILED).toBe("DATABASE_CONNECTION_FAILED");
  });

  it("should have external service error codes", () => {
    expect(ErrorCode.EXTERNAL_SERVICE_ERROR).toBe("EXTERNAL_SERVICE_ERROR");
    expect(ErrorCode.PROVIDER_ERROR).toBe("PROVIDER_ERROR");
  });

  it("should have generic error codes", () => {
    expect(ErrorCode.INTERNAL_SERVER_ERROR).toBe("INTERNAL_SERVER_ERROR");
    expect(ErrorCode.BAD_REQUEST).toBe("BAD_REQUEST");
    expect(ErrorCode.FORBIDDEN).toBe("FORBIDDEN");
  });
});
