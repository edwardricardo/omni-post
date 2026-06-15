/**
 * @file ApiError.test.ts
 * @description Unit tests for the canonical ApiError class and parsing helpers
 *              — covers constructor + status getters, fromResponse JSON
 *              parsing, parseApiError type coercion paths, and the shortcut
 *              predicates (isPermissionDenied / isNotFoundError).
 * @layer infrastructure
 */

import { describe, it, expect } from "vitest";
import {
  ApiError,
  parseApiError,
  getErrorMessage,
  isPermissionDenied,
  isNotFoundError,
} from "../src/index.js";

describe("ApiError class", () => {
  it("constructs with status, code, message, and optional details", () => {
    const error = new ApiError(404, "NOT_FOUND", "Not found", { resourceId: "x-1" });
    expect(error.status).toBe(404);
    expect(error.code).toBe("NOT_FOUND");
    expect(error.message).toBe("Not found");
    expect(error.details).toEqual({ resourceId: "x-1" });
    expect(error.name).toBe("ApiError");
  });

  it("leaves details undefined when not supplied", () => {
    const error = new ApiError(500, null, "Boom");
    expect(error.details).toBeUndefined();
  });

  it("exposes status predicates", () => {
    expect(new ApiError(401, null, "x").isUnauthorized).toBe(true);
    expect(new ApiError(403, null, "x").isPermissionDenied).toBe(true);
    expect(new ApiError(404, null, "x").isNotFound).toBe(true);
    expect(new ApiError(500, null, "x").isServerError).toBe(true);
    expect(new ApiError(200, null, "x").isServerError).toBe(false);
  });
});

describe("ApiError.fromResponse", () => {
  it("maps a known error code to its curated message", () => {
    const error = ApiError.fromResponse(
      403,
      JSON.stringify({ error: { code: "PERMISSION_DENIED" } })
    );
    expect(error.code).toBe("PERMISSION_DENIED");
    expect(error.message).toMatch(/permission/i);
  });

  it("never trusts raw server text for 401 / 403", () => {
    const error = ApiError.fromResponse(
      401,
      JSON.stringify({ error: { message: "internal token validation failed at db.users.index" } })
    );
    expect(error.message).not.toContain("internal token");
  });

  it("falls back to the curated status message for other 4xx", () => {
    const error = ApiError.fromResponse(409, "{}");
    expect(error.message).toMatch(/conflicts/);
  });

  it("returns the server message when it looks safe", () => {
    const error = ApiError.fromResponse(
      400,
      JSON.stringify({ error: { message: "Invalid email format" } })
    );
    expect(error.message).toBe("Invalid email format");
  });

  it("rejects server messages that look like JSON or contain prisma traces", () => {
    const error = ApiError.fromResponse(
      400,
      JSON.stringify({ error: { message: "{ leaked: 'json' }" } })
    );
    expect(error.message).not.toContain("leaked");
  });

  it("uses the generic server-error fallback for 5xx without a body", () => {
    const error = ApiError.fromResponse(500, "");
    expect(error.message).toMatch(/unexpected error/i);
  });

  it("captures structured details when the body provides them", () => {
    const details = [{ field: "email", message: "Required" }];
    const error = ApiError.fromResponse(
      400,
      JSON.stringify({ error: { code: "VALIDATION_ERROR", details } })
    );
    expect(error.details).toEqual(details);
  });
});

describe("parseApiError", () => {
  it("returns ApiError instances unchanged", () => {
    const error = new ApiError(403, "PERMISSION_DENIED", "no");
    expect(parseApiError(error)).toBe(error);
  });

  it("decodes 'HTTP NNN: <body>' Error messages", () => {
    const result = parseApiError(
      new Error('HTTP 404: {"error":{"code":"NOT_FOUND","message":"missing"}}')
    );
    expect(result.status).toBe(404);
    expect(result.code).toBe("NOT_FOUND");
  });

  it("matches embedded UPPER_SNAKE_CASE codes in plain Error messages", () => {
    const result = parseApiError(new Error("PERMISSION_DENIED while loading X"));
    expect(result.code).toBe("PERMISSION_DENIED");
    expect(result.message).toMatch(/permission/i);
  });

  it("preserves short, JSON-free Error messages verbatim", () => {
    const result = parseApiError(new Error("Network down"));
    expect(result.message).toBe("Network down");
    expect(result.status).toBe(0);
  });

  it("collapses long / JSON-laden Error messages to the generic default", () => {
    const result = parseApiError(new Error('{ "really long": "blob".repeat() }'));
    expect(result.message).toMatch(/something went wrong/i);
  });

  it("decodes string inputs that match the HTTP NNN: prefix", () => {
    const result = parseApiError("HTTP 500: oops");
    expect(result.status).toBe(500);
  });

  it("treats unknown thrown values as a generic ApiError", () => {
    const result = parseApiError({ weird: true });
    expect(result.status).toBe(0);
    expect(result.message).toMatch(/something went wrong/i);
  });
});

describe("shortcut helpers", () => {
  it("getErrorMessage returns parseApiError(...).message", () => {
    expect(getErrorMessage(new Error("Network down"))).toBe("Network down");
  });

  it("isPermissionDenied is true for 403 errors", () => {
    expect(isPermissionDenied(new ApiError(403, null, "x"))).toBe(true);
    expect(isPermissionDenied(new ApiError(404, null, "x"))).toBe(false);
  });

  it("isNotFoundError is true for 404 errors", () => {
    expect(isNotFoundError(new ApiError(404, null, "x"))).toBe(true);
    expect(isNotFoundError(new ApiError(403, null, "x"))).toBe(false);
  });
});
