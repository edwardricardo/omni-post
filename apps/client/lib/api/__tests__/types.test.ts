import { describe, it, expect } from "vitest";
import { ApiError } from "../types";

describe("API Types", () => {
  describe("ApiError", () => {
    it("should create ApiError with message and status", () => {
      const error = new ApiError("Not found", 404);

      expect(error.message).toBe("Not found");
      expect(error.status).toBe(404);
      expect(error.name).toBe("ApiError");
      expect(error).toBeInstanceOf(Error);
    });

    it("should create ApiError with code and details", () => {
      const details = [{ field: "email", message: "Invalid email format", code: "INVALID_EMAIL" }];

      const error = new ApiError("Validation failed", 400, "VALIDATION_ERROR", details);

      expect(error.message).toBe("Validation failed");
      expect(error.status).toBe(400);
      expect(error.code).toBe("VALIDATION_ERROR");
      expect(error.details).toEqual(details);
    });

    it("should be catchable as Error", () => {
      const error = new ApiError("Test error", 500);

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
