/**
 * @file types.test.ts
 * @description Smoke tests for the re-exported `ApiError` class — verifies the
 *              canonical (status, code, message, details?) signature works
 *              through the client's `lib/api/types` barrel.
 * @layer infrastructure
 */
import { describe, it, expect } from "vitest";
import { ApiError } from "../types";

describe("API Types", () => {
  describe("ApiError", () => {
    it("constructs with status, code, and message", () => {
      const error = new ApiError(404, null, "Not found");

      expect(error.message).toBe("Not found");
      expect(error.status).toBe(404);
      expect(error.code).toBeNull();
      expect(error.name).toBe("ApiError");
      expect(error).toBeInstanceOf(Error);
    });

    it("captures structured details when provided", () => {
      const details = [{ field: "email", message: "Invalid email format", code: "INVALID_EMAIL" }];

      const error = new ApiError(400, "VALIDATION_ERROR", "Validation failed", details);

      expect(error.message).toBe("Validation failed");
      expect(error.status).toBe(400);
      expect(error.code).toBe("VALIDATION_ERROR");
      expect(error.details).toEqual(details);
    });

    it("is catchable as a plain Error", () => {
      const error = new ApiError(500, null, "Test error");

      try {
        throw error;
      } catch (e) {
        expect(e).toBeInstanceOf(Error);
        expect(e).toBeInstanceOf(ApiError);
        expect((e as ApiError).status).toBe(500);
      }
    });
  });
});
