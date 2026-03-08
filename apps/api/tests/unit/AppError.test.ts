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
 */

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
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

    assert.strictEqual(error.code, ErrorCode.VALIDATION_ERROR);
    assert.strictEqual(error.statusCode, 400);
    assert.strictEqual(error.message, "Validation failed");
    assert.strictEqual(error.isOperational, true);
    assert.deepStrictEqual(error.details, { field: "email" });
    assert.ok(error.timestamp instanceof Date);
  });

  it("should create error without optional details", () => {
    const error = new AppError(ErrorCode.BAD_REQUEST, 400, "Bad request", true);

    assert.strictEqual(error.code, ErrorCode.BAD_REQUEST);
    assert.strictEqual(error.details, undefined);
  });

  it("should default isOperational to true", () => {
    const error = new AppError(ErrorCode.BAD_REQUEST, 400, "Bad request");
    assert.strictEqual(error.isOperational, true);
  });

  it("should capture stack trace", () => {
    const error = new AppError(ErrorCode.INTERNAL_SERVER_ERROR, 500, "Error");
    assert.ok(error.stack);
    assert.ok(error.stack.includes("AppError"));
  });

  it("should set proper prototype chain", () => {
    const error = new AppError(ErrorCode.BAD_REQUEST, 400, "Error");
    assert.ok(error instanceof AppError);
    assert.ok(error instanceof Error);
  });
});

describe("AppError - Factory Methods", () => {
  it("should create bad request error", () => {
    const error = AppError.badRequest("Invalid input");
    assert.strictEqual(error.code, ErrorCode.BAD_REQUEST);
    assert.strictEqual(error.statusCode, 400);
    assert.strictEqual(error.message, "Invalid input");
    assert.strictEqual(error.isOperational, true);
  });

  it("should create bad request with default message", () => {
    const error = AppError.badRequest();
    assert.strictEqual(error.message, "Bad request");
  });

  it("should create unauthorized error", () => {
    const error = AppError.unauthorized("Invalid credentials");
    assert.strictEqual(error.code, ErrorCode.AUTH_INVALID_CREDENTIALS);
    assert.strictEqual(error.statusCode, 401);
    assert.strictEqual(error.message, "Invalid credentials");
  });

  it("should create forbidden error", () => {
    const error = AppError.forbidden("Access denied");
    assert.strictEqual(error.code, ErrorCode.FORBIDDEN);
    assert.strictEqual(error.statusCode, 403);
    assert.strictEqual(error.message, "Access denied");
  });

  it("should create not found error", () => {
    const error = AppError.notFound("User");
    assert.strictEqual(error.code, ErrorCode.RESOURCE_NOT_FOUND);
    assert.strictEqual(error.statusCode, 404);
    assert.strictEqual(error.message, "User not found");
  });

  it("should create not found with default resource", () => {
    const error = AppError.notFound();
    assert.strictEqual(error.message, "Resource not found");
  });

  it("should create conflict error", () => {
    const error = AppError.conflict("Email already exists");
    assert.strictEqual(error.code, ErrorCode.RESOURCE_CONFLICT);
    assert.strictEqual(error.statusCode, 409);
    assert.strictEqual(error.message, "Email already exists");
  });

  it("should create internal server error", () => {
    const error = AppError.internal("Database connection failed");
    assert.strictEqual(error.code, ErrorCode.INTERNAL_SERVER_ERROR);
    assert.strictEqual(error.statusCode, 500);
    assert.strictEqual(error.message, "Database connection failed");
    assert.strictEqual(error.isOperational, false);
  });

  it("should create validation error", () => {
    const error = AppError.validationFailed("Required fields missing", {
      fields: ["email", "password"],
    });
    assert.strictEqual(error.code, ErrorCode.VALIDATION_ERROR);
    assert.strictEqual(error.statusCode, 400);
    assert.deepStrictEqual(error.details, { fields: ["email", "password"] });
  });

  it("should create rate limit error with retryAfter", () => {
    const error = AppError.tooManyRequests("Rate limit exceeded", 60);
    assert.strictEqual(error.code, ErrorCode.RATE_LIMIT_EXCEEDED);
    assert.strictEqual(error.statusCode, 429);
    assert.deepStrictEqual(error.details, { retryAfter: 60 });
  });

  it("should create rate limit error without retryAfter", () => {
    const error = AppError.tooManyRequests();
    assert.strictEqual(error.message, "Too many requests");
    assert.strictEqual(error.details, undefined);
  });

  it("should create database error", () => {
    const error = AppError.database("Query timeout", { query: "SELECT *" });
    assert.strictEqual(error.code, ErrorCode.DATABASE_ERROR);
    assert.strictEqual(error.statusCode, 500);
    assert.deepStrictEqual(error.details, { query: "SELECT *" });
  });

  it("should create external service error", () => {
    const error = AppError.externalService("Twitter API", "Rate limited");
    assert.strictEqual(error.code, ErrorCode.EXTERNAL_SERVICE_ERROR);
    assert.strictEqual(error.statusCode, 502);
    assert.strictEqual(error.message, "Rate limited");
  });

  it("should create external service error with default message", () => {
    const error = AppError.externalService("Twitter API");
    assert.strictEqual(error.message, "External service 'Twitter API' unavailable");
  });
});

describe("AppError - Predefined Error Classes", () => {
  it("should create AuthenticationError", () => {
    const error = new AuthenticationError("Invalid token");
    assert.ok(error instanceof AppError);
    assert.strictEqual(error.code, ErrorCode.AUTH_INVALID_CREDENTIALS);
    assert.strictEqual(error.statusCode, 401);
    assert.strictEqual(error.message, "Invalid token");
  });

  it("should create AuthenticationError with default message", () => {
    const error = new AuthenticationError();
    assert.strictEqual(error.message, "Authentication failed");
  });

  it("should create AuthorizationError", () => {
    const error = new AuthorizationError("Admin only");
    assert.ok(error instanceof AppError);
    assert.strictEqual(error.code, ErrorCode.AUTH_INSUFFICIENT_PERMISSIONS);
    assert.strictEqual(error.statusCode, 403);
    assert.strictEqual(error.message, "Admin only");
  });

  it("should create ValidationError", () => {
    const error = new ValidationError("Invalid email format");
    assert.ok(error instanceof AppError);
    assert.strictEqual(error.code, ErrorCode.VALIDATION_ERROR);
    assert.strictEqual(error.statusCode, 400);
  });

  it("should create NotFoundError", () => {
    const error = new NotFoundError("Post");
    assert.ok(error instanceof AppError);
    assert.strictEqual(error.code, ErrorCode.RESOURCE_NOT_FOUND);
    assert.strictEqual(error.statusCode, 404);
    assert.strictEqual(error.message, "Post not found");
  });

  it("should create ConflictError", () => {
    const error = new ConflictError("Duplicate entry");
    assert.ok(error instanceof AppError);
    assert.strictEqual(error.code, ErrorCode.RESOURCE_CONFLICT);
    assert.strictEqual(error.statusCode, 409);
  });

  it("should create RateLimitError", () => {
    const error = new RateLimitError(120);
    assert.ok(error instanceof AppError);
    assert.strictEqual(error.code, ErrorCode.RATE_LIMIT_EXCEEDED);
    assert.strictEqual(error.statusCode, 429);
    assert.ok(error.details?.retryAfter === 120);
  });

  it("should create RateLimitError with additional details", () => {
    const error = new RateLimitError(60, { endpoint: "/api/posts" });
    assert.deepStrictEqual(error.details, {
      retryAfter: 60,
      endpoint: "/api/posts",
    });
  });

  it("should create DatabaseError", () => {
    const error = new DatabaseError("Connection lost");
    assert.ok(error instanceof AppError);
    assert.strictEqual(error.code, ErrorCode.DATABASE_ERROR);
    assert.strictEqual(error.statusCode, 500);
  });

  it("should create ExternalServiceError", () => {
    const error = new ExternalServiceError("Facebook API");
    assert.ok(error instanceof AppError);
    assert.strictEqual(error.code, ErrorCode.EXTERNAL_SERVICE_ERROR);
    assert.strictEqual(error.statusCode, 502);
    assert.ok(error.message.includes("Facebook API"));
  });
});

describe("AppError - JSON Serialization", () => {
  const originalNodeEnv = process.env.NODE_ENV;

  before(() => {
    process.env.NODE_ENV = "production";
  });

  after(() => {
    process.env.NODE_ENV = originalNodeEnv ?? "test";
  });

  it("should serialize to JSON without details in production", () => {
    const error = new AppError(ErrorCode.VALIDATION_ERROR, 400, "Validation failed", true, {
      field: "email",
    });

    const json = error.toJSON();

    assert.strictEqual(json.error.code, ErrorCode.VALIDATION_ERROR);
    assert.strictEqual(json.error.message, "Validation failed");
    assert.ok(json.error.timestamp);
    assert.strictEqual(json.error.details, undefined);
  });

  it("should include details in development", () => {
    process.env.NODE_ENV = "development";

    const error = new AppError(ErrorCode.VALIDATION_ERROR, 400, "Validation failed", true, {
      field: "email",
    });

    const json = error.toJSON();

    assert.deepStrictEqual(json.error.details, { field: "email" });

    process.env.NODE_ENV = "production";
  });

  it("should format timestamp as ISO string", () => {
    const error = new AppError(ErrorCode.BAD_REQUEST, 400, "Error");
    const json = error.toJSON();

    assert.ok(json.error.timestamp.match(/^\d{4}-\d{2}-\d{2}T/));
  });
});

describe("AppError - isOperationalError", () => {
  it("should return true for operational AppError", () => {
    const error = new AppError(ErrorCode.VALIDATION_ERROR, 400, "Error", true);
    assert.strictEqual(isOperationalError(error), true);
  });

  it("should return false for non-operational AppError", () => {
    const error = new AppError(ErrorCode.INTERNAL_SERVER_ERROR, 500, "Error", false);
    assert.strictEqual(isOperationalError(error), false);
  });

  it("should return false for standard Error", () => {
    const error = new Error("Standard error");
    assert.strictEqual(isOperationalError(error), false);
  });

  it("should return false for non-Error objects", () => {
    assert.strictEqual(isOperationalError({ message: "Not an error" } as any), false);
  });
});

describe("AppError - getSafeErrorMessage", () => {
  it("should return message from AppError", () => {
    const error = new AppError(ErrorCode.VALIDATION_ERROR, 400, "Validation failed");
    assert.strictEqual(getSafeErrorMessage(error), "Validation failed");
  });

  it("should return safe message for Prisma errors", () => {
    const prismaError = new Error("Prisma error");
    (prismaError as any).constructor = { name: "PrismaClientKnownRequestError" };
    assert.strictEqual(getSafeErrorMessage(prismaError), "Database operation failed");
  });

  it("should return safe message for validation errors", () => {
    const validationError = new Error("Validation error");
    validationError.name = "ValidationError";
    assert.strictEqual(getSafeErrorMessage(validationError), "Validation failed");
  });

  it("should return safe message for Zod errors", () => {
    const zodError = new Error("Zod error");
    zodError.name = "ZodError";
    assert.strictEqual(getSafeErrorMessage(zodError), "Validation failed");
  });

  it("should return generic message for standard Error", () => {
    const error = new Error("Internal error details");
    assert.strictEqual(getSafeErrorMessage(error), "An unexpected error occurred");
  });

  it("should return generic message for non-Error objects", () => {
    assert.strictEqual(
      getSafeErrorMessage({ message: "Not an error" }),
      "An unexpected error occurred"
    );
  });

  it("should return generic message for null", () => {
    assert.strictEqual(getSafeErrorMessage(null), "An unexpected error occurred");
  });
});

describe("AppError - getErrorCode", () => {
  it("should return code from AppError", () => {
    const error = new AppError(ErrorCode.VALIDATION_ERROR, 400, "Validation failed");
    assert.strictEqual(getErrorCode(error), ErrorCode.VALIDATION_ERROR);
  });

  it("should return DATABASE_ERROR for Prisma errors", () => {
    const prismaError = new Error("Prisma error");
    (prismaError as any).constructor = { name: "PrismaClientKnownRequestError" };
    assert.strictEqual(getErrorCode(prismaError), ErrorCode.DATABASE_ERROR);
  });

  it("should return VALIDATION_ERROR for ValidationError", () => {
    const validationError = new Error("Validation error");
    validationError.name = "ValidationError";
    assert.strictEqual(getErrorCode(validationError), ErrorCode.VALIDATION_ERROR);
  });

  it("should return VALIDATION_ERROR for ZodError", () => {
    const zodError = new Error("Zod error");
    zodError.name = "ZodError";
    assert.strictEqual(getErrorCode(zodError), ErrorCode.VALIDATION_ERROR);
  });

  it("should return INTERNAL_SERVER_ERROR for unknown errors", () => {
    const error = new Error("Unknown error");
    assert.strictEqual(getErrorCode(error), ErrorCode.INTERNAL_SERVER_ERROR);
  });

  it("should return INTERNAL_SERVER_ERROR for non-Error objects", () => {
    assert.strictEqual(getErrorCode({ message: "Not an error" }), ErrorCode.INTERNAL_SERVER_ERROR);
  });
});

describe("AppError - getStatusCode", () => {
  it("should return status code from AppError", () => {
    const error = new AppError(ErrorCode.VALIDATION_ERROR, 400, "Error");
    assert.strictEqual(getStatusCode(error), 400);
  });

  it("should return 500 for standard Error", () => {
    const error = new Error("Standard error");
    assert.strictEqual(getStatusCode(error), 500);
  });

  it("should return 500 for non-Error objects", () => {
    assert.strictEqual(getStatusCode({ message: "Not an error" }), 500);
  });

  it("should return 500 for null", () => {
    assert.strictEqual(getStatusCode(null), 500);
  });
});

describe("AppError - ErrorCode Enum", () => {
  it("should have authentication error codes", () => {
    assert.strictEqual(ErrorCode.AUTH_INVALID_CREDENTIALS, "AUTH_INVALID_CREDENTIALS");
    assert.strictEqual(ErrorCode.AUTH_USER_NOT_FOUND, "AUTH_USER_NOT_FOUND");
    assert.strictEqual(ErrorCode.AUTH_TOKEN_EXPIRED, "AUTH_TOKEN_EXPIRED");
    assert.strictEqual(ErrorCode.AUTH_TOKEN_INVALID, "AUTH_TOKEN_INVALID");
    assert.strictEqual(ErrorCode.AUTH_INSUFFICIENT_PERMISSIONS, "AUTH_INSUFFICIENT_PERMISSIONS");
    assert.strictEqual(ErrorCode.AUTH_MFA_REQUIRED, "AUTH_MFA_REQUIRED");
    assert.strictEqual(ErrorCode.AUTH_MFA_INVALID, "AUTH_MFA_INVALID");
  });

  it("should have validation error codes", () => {
    assert.strictEqual(ErrorCode.VALIDATION_ERROR, "VALIDATION_ERROR");
    assert.strictEqual(ErrorCode.VALIDATION_MISSING_FIELD, "VALIDATION_MISSING_FIELD");
    assert.strictEqual(ErrorCode.VALIDATION_INVALID_FORMAT, "VALIDATION_INVALID_FORMAT");
  });

  it("should have resource error codes", () => {
    assert.strictEqual(ErrorCode.RESOURCE_NOT_FOUND, "RESOURCE_NOT_FOUND");
    assert.strictEqual(ErrorCode.RESOURCE_ALREADY_EXISTS, "RESOURCE_ALREADY_EXISTS");
    assert.strictEqual(ErrorCode.RESOURCE_CONFLICT, "RESOURCE_CONFLICT");
  });

  it("should have rate limiting error code", () => {
    assert.strictEqual(ErrorCode.RATE_LIMIT_EXCEEDED, "RATE_LIMIT_EXCEEDED");
  });

  it("should have database error codes", () => {
    assert.strictEqual(ErrorCode.DATABASE_ERROR, "DATABASE_ERROR");
    assert.strictEqual(ErrorCode.DATABASE_CONNECTION_FAILED, "DATABASE_CONNECTION_FAILED");
  });

  it("should have external service error codes", () => {
    assert.strictEqual(ErrorCode.EXTERNAL_SERVICE_ERROR, "EXTERNAL_SERVICE_ERROR");
    assert.strictEqual(ErrorCode.PROVIDER_ERROR, "PROVIDER_ERROR");
  });

  it("should have generic error codes", () => {
    assert.strictEqual(ErrorCode.INTERNAL_SERVER_ERROR, "INTERNAL_SERVER_ERROR");
    assert.strictEqual(ErrorCode.BAD_REQUEST, "BAD_REQUEST");
    assert.strictEqual(ErrorCode.FORBIDDEN, "FORBIDDEN");
  });
});
