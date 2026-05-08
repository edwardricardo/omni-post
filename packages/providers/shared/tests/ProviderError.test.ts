/**
 * @file ProviderError.test.ts
 * @description Unit tests for the structured ProviderError class — covers all six
 *              factory helpers, the public field surface, the error-code mapping,
 *              and the optional `details` payload behavior.
 * @layer infrastructure
 */
import { describe, it, expect } from "vitest";
import { ProviderError, ProviderErrorCode } from "../src/ProviderError.js";

describe("ProviderError", () => {
  describe("constructor", () => {
    it("returns an Error instance", () => {
      const e = new ProviderError(ProviderErrorCode.INTERNAL, 500, "x", "boom");
      expect(e).toBeInstanceOf(ProviderError);
      expect(e).toBeInstanceOf(Error);
      expect(e.name).toBe("ProviderError");
      expect(e.message).toBe("boom");
    });

    it("populates code, statusCode, provider, isOperational, timestamp", () => {
      const e = new ProviderError(ProviderErrorCode.BAD_REQUEST, 400, "youtube", "msg");
      expect(e.code).toBe(ProviderErrorCode.BAD_REQUEST);
      expect(e.statusCode).toBe(400);
      expect(e.provider).toBe("youtube");
      expect(e.isOperational).toBe(true);
      expect(e.timestamp).toBeInstanceOf(Date);
    });

    it("leaves details undefined when not passed", () => {
      const e = new ProviderError(ProviderErrorCode.INTERNAL, 500, "x", "boom");
      expect(e.details).toBeUndefined();
    });

    it("attaches details when provided", () => {
      const e = new ProviderError(ProviderErrorCode.INTERNAL, 500, "x", "boom", false, {
        upstream: "tiktok",
      });
      expect(e.details).toEqual({ upstream: "tiktok" });
    });

    it("preserves isOperational=false when explicitly passed", () => {
      const e = new ProviderError(ProviderErrorCode.INTERNAL, 500, "x", "bug", false);
      expect(e.isOperational).toBe(false);
    });
  });

  describe("static factories", () => {
    const provider = "tiktok";

    it("externalService maps to EXTERNAL_SERVICE_ERROR / 502", () => {
      const e = ProviderError.externalService(provider, "API down");
      expect(e.code).toBe(ProviderErrorCode.EXTERNAL_SERVICE);
      expect(e.statusCode).toBe(502);
      expect(e.provider).toBe(provider);
      expect(e.message).toBe("API down");
      expect(e.isOperational).toBe(true);
    });

    it("badRequest maps to BAD_REQUEST / 400", () => {
      const e = ProviderError.badRequest(provider, "invalid videoId");
      expect(e.code).toBe(ProviderErrorCode.BAD_REQUEST);
      expect(e.statusCode).toBe(400);
    });

    it("notFound maps to RESOURCE_NOT_FOUND / 404 with `<resource> not found` message", () => {
      const e = ProviderError.notFound(provider, "Video");
      expect(e.code).toBe(ProviderErrorCode.NOT_FOUND);
      expect(e.statusCode).toBe(404);
      expect(e.message).toBe("Video not found");
    });

    it("unauthorized maps to AUTH_INVALID_CREDENTIALS / 401", () => {
      const e = ProviderError.unauthorized(provider, "token expired");
      expect(e.code).toBe(ProviderErrorCode.UNAUTHORIZED);
      expect(e.statusCode).toBe(401);
    });

    it("conflict maps to RESOURCE_CONFLICT / 409", () => {
      const e = ProviderError.conflict(provider, "already exists");
      expect(e.code).toBe(ProviderErrorCode.CONFLICT);
      expect(e.statusCode).toBe(409);
    });

    it("internal maps to INTERNAL_SERVER_ERROR / 500 with isOperational=false", () => {
      const e = ProviderError.internal(provider, "invariant violated");
      expect(e.code).toBe(ProviderErrorCode.INTERNAL);
      expect(e.statusCode).toBe(500);
      expect(e.isOperational).toBe(false);
    });

    it("forwards details across every factory", () => {
      const details = { traceId: "abc-123" };
      expect(ProviderError.externalService("p", "m", details).details).toEqual(details);
      expect(ProviderError.badRequest("p", "m", details).details).toEqual(details);
      expect(ProviderError.notFound("p", "Video", details).details).toEqual(details);
      expect(ProviderError.unauthorized("p", "m", details).details).toEqual(details);
      expect(ProviderError.conflict("p", "m", details).details).toEqual(details);
      expect(ProviderError.internal("p", "m", details).details).toEqual(details);
    });
  });

  describe("ProviderErrorCode enum", () => {
    it("uses the documented machine-readable string values", () => {
      expect(ProviderErrorCode.EXTERNAL_SERVICE).toBe("EXTERNAL_SERVICE_ERROR");
      expect(ProviderErrorCode.BAD_REQUEST).toBe("BAD_REQUEST");
      expect(ProviderErrorCode.NOT_FOUND).toBe("RESOURCE_NOT_FOUND");
      expect(ProviderErrorCode.UNAUTHORIZED).toBe("AUTH_INVALID_CREDENTIALS");
      expect(ProviderErrorCode.CONFLICT).toBe("RESOURCE_CONFLICT");
      expect(ProviderErrorCode.INTERNAL).toBe("INTERNAL_SERVER_ERROR");
    });
  });
});
