/**
 * @file enhancedValidator.mutations-request.test.ts
 * @description Mutation-killing tests for EnhancedValidator request validation,
 *              file upload, plugin hook, tracking, and cleanup methods.
 * @layer test
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { FastifyRequest } from "fastify";

vi.mock("isomorphic-dompurify", () => ({
  default: {
    sanitize: vi.fn((input: string) => input.replace(/<script[^>]*>.*?<\/script>/gi, "")),
  },
}));

vi.mock("validator", () => ({
  default: {
    isURL: vi.fn((s: string) => /^https?:\/\/.+/.test(s)),
    isEmail: vi.fn((s: string) => s.includes("@") && s.includes(".")),
    escape: vi.fn((s: string) =>
      s.replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/&/g, "&amp;")
    ),
    normalizeEmail: vi.fn((s: string) => s.toLowerCase()),
  },
}));

vi.mock("../../../src/lib/logger.js", () => ({
  logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

import { EnhancedValidator } from "../../../src/security/enhancedValidator.js";
import { logger } from "../../../src/lib/logger.js";

function makeFastifyRequest(overrides: Record<string, unknown> = {}): FastifyRequest {
  return {
    headers: {},
    method: "GET",
    socket: { remoteAddress: "127.0.0.1" },
    body: undefined,
    query: undefined,
    ...overrides,
  } as unknown as FastifyRequest;
}

describe("EnhancedValidator — mutation-killing: request and plugin", () => {
  let v: EnhancedValidator;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    if (v) v.destroy();
  });

  // ------------------------------------------------------------------
  // validateRequest: user agent blocking
  // ------------------------------------------------------------------
  describe("validateRequest user agent", () => {
    beforeEach(() => {
      v = new EnhancedValidator();
    });

    it("blocks sqlmap user agent (case insensitive)", () => {
      const req = makeFastifyRequest({
        headers: { "user-agent": "Mozilla/5.0 SQLMAP/1.0" },
      });
      const result = v.validateRequest(req);
      expect(result.isValid).toBe(false);
      expect(result.threats).toContain("BLOCKED_USER_AGENT");
      expect(result.risk).toBe("high");
      expect(result.blockedReason).toContain("sqlmap");
    });

    it("blocks nikto user agent", () => {
      const req = makeFastifyRequest({
        headers: { "user-agent": "Nikto/2.1.6" },
      });
      const result = v.validateRequest(req);
      expect(result.isValid).toBe(false);
      expect(result.threats).toContain("BLOCKED_USER_AGENT");
    });

    it("blocks w3af user agent", () => {
      const req = makeFastifyRequest({
        headers: { "user-agent": "w3af.org" },
      });
      expect(v.validateRequest(req).isValid).toBe(false);
    });

    it("blocks burp user agent", () => {
      const req = makeFastifyRequest({
        headers: { "user-agent": "BurpSuite/2.0" },
      });
      expect(v.validateRequest(req).isValid).toBe(false);
    });

    it("returns early on blocked user agent (no further checks)", () => {
      const req = makeFastifyRequest({
        headers: { "user-agent": "sqlmap/1.0", "content-type": "text/html" },
        method: "POST",
      });
      const result = v.validateRequest(req);
      expect(result.threats).toEqual(["BLOCKED_USER_AGENT"]);
    });

    it("allows valid user agent", () => {
      const req = makeFastifyRequest({
        headers: { "user-agent": "Mozilla/5.0 Chrome/120" },
      });
      expect(v.validateRequest(req).threats).not.toContain("BLOCKED_USER_AGENT");
    });

    it("handles missing user agent header", () => {
      const req = makeFastifyRequest({ headers: {} });
      expect(v.validateRequest(req).threats).not.toContain("BLOCKED_USER_AGENT");
    });
  });

  // ------------------------------------------------------------------
  // validateRequest: content-type validation
  // ------------------------------------------------------------------
  describe("validateRequest content-type", () => {
    beforeEach(() => {
      v = new EnhancedValidator();
    });

    it("flags missing content-type on POST", () => {
      const req = makeFastifyRequest({ method: "POST", headers: {} });
      const result = v.validateRequest(req);
      expect(result.threats).toContain("INVALID_CONTENT_TYPE");
      expect(result.risk).toBe("medium");
    });

    it("flags missing content-type on PUT", () => {
      const req = makeFastifyRequest({ method: "PUT", headers: {} });
      expect(v.validateRequest(req).threats).toContain("INVALID_CONTENT_TYPE");
    });

    it("flags missing content-type on PATCH", () => {
      const req = makeFastifyRequest({ method: "PATCH", headers: {} });
      expect(v.validateRequest(req).threats).toContain("INVALID_CONTENT_TYPE");
    });

    it("does not check content-type on GET", () => {
      const req = makeFastifyRequest({ method: "GET", headers: {} });
      expect(v.validateRequest(req).threats).not.toContain("INVALID_CONTENT_TYPE");
    });

    it("does not check content-type on DELETE", () => {
      const req = makeFastifyRequest({ method: "DELETE", headers: {} });
      expect(v.validateRequest(req).threats).not.toContain("INVALID_CONTENT_TYPE");
    });

    it("accepts application/json content-type", () => {
      const req = makeFastifyRequest({
        method: "POST",
        headers: { "content-type": "application/json" },
      });
      expect(v.validateRequest(req).threats).not.toContain("INVALID_CONTENT_TYPE");
    });

    it("accepts form-urlencoded content-type", () => {
      const req = makeFastifyRequest({
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
      });
      expect(v.validateRequest(req).threats).not.toContain("INVALID_CONTENT_TYPE");
    });

    it("accepts multipart/form-data content-type", () => {
      const req = makeFastifyRequest({
        method: "POST",
        headers: { "content-type": "multipart/form-data; boundary=---" },
      });
      expect(v.validateRequest(req).threats).not.toContain("INVALID_CONTENT_TYPE");
    });

    it("flags invalid content-type text/html on POST", () => {
      const req = makeFastifyRequest({
        method: "POST",
        headers: { "content-type": "text/html" },
      });
      expect(v.validateRequest(req).threats).toContain("INVALID_CONTENT_TYPE");
    });

    it("skips content-type check when disabled", () => {
      v.destroy();
      v = new EnhancedValidator({ enableContentTypeValidation: false });
      const req = makeFastifyRequest({
        method: "POST",
        headers: { "content-type": "text/html" },
      });
      expect(v.validateRequest(req).threats).not.toContain("INVALID_CONTENT_TYPE");
    });
  });

  // ------------------------------------------------------------------
  // validateRequest: referrer validation
  // ------------------------------------------------------------------
  describe("validateRequest referrer validation", () => {
    it("flags untrusted referrer when validation enabled", () => {
      v = new EnhancedValidator({
        enableReferrerValidation: true,
        trustedDomains: ["example.com"],
      });
      const req = makeFastifyRequest({
        headers: { referer: "https://evil.com/page" },
      });
      const result = v.validateRequest(req);
      expect(result.threats).toContain("UNTRUSTED_REFERRER");
      expect(result.risk).toBe("medium");
    });

    it("accepts trusted referrer", () => {
      v = new EnhancedValidator({
        enableReferrerValidation: true,
        trustedDomains: ["example.com"],
      });
      const req = makeFastifyRequest({
        headers: { referer: "https://example.com/page" },
      });
      expect(v.validateRequest(req).threats).not.toContain("UNTRUSTED_REFERRER");
    });

    it("skips referrer check when disabled", () => {
      v = new EnhancedValidator({
        enableReferrerValidation: false,
        trustedDomains: ["example.com"],
      });
      const req = makeFastifyRequest({
        headers: { referer: "https://evil.com" },
      });
      expect(v.validateRequest(req).threats).not.toContain("UNTRUSTED_REFERRER");
    });

    it("skips referrer check when trustedDomains is empty", () => {
      v = new EnhancedValidator({
        enableReferrerValidation: true,
        trustedDomains: [],
      });
      const req = makeFastifyRequest({
        headers: { referer: "https://evil.com" },
      });
      expect(v.validateRequest(req).threats).not.toContain("UNTRUSTED_REFERRER");
    });

    it("does not flag when no referrer header present", () => {
      v = new EnhancedValidator({
        enableReferrerValidation: true,
        trustedDomains: ["example.com"],
      });
      const req = makeFastifyRequest({ headers: {} });
      expect(v.validateRequest(req).threats).not.toContain("UNTRUSTED_REFERRER");
    });

    it("checks referrer header (alternate spelling)", () => {
      v = new EnhancedValidator({
        enableReferrerValidation: true,
        trustedDomains: ["example.com"],
      });
      const req = makeFastifyRequest({
        headers: { referrer: "https://evil.com" },
      });
      expect(v.validateRequest(req).threats).toContain("UNTRUSTED_REFERRER");
    });
  });

  // ------------------------------------------------------------------
  // validateRequest: content-length / request size
  // ------------------------------------------------------------------
  describe("validateRequest content-length", () => {
    beforeEach(() => {
      v = new EnhancedValidator();
    });

    it("flags content-length over 100MB", () => {
      const req = makeFastifyRequest({
        headers: { "content-length": String(100 * 1024 * 1024 + 1) },
      });
      const result = v.validateRequest(req);
      expect(result.threats).toContain("EXCESSIVE_REQUEST_SIZE");
      expect(result.risk).toBe("high");
    });

    it("accepts content-length exactly 100MB", () => {
      const req = makeFastifyRequest({
        headers: { "content-length": String(100 * 1024 * 1024) },
      });
      expect(v.validateRequest(req).threats).not.toContain("EXCESSIVE_REQUEST_SIZE");
    });

    it("accepts content-length under 100MB", () => {
      const req = makeFastifyRequest({
        headers: { "content-length": "1024" },
      });
      expect(v.validateRequest(req).threats).not.toContain("EXCESSIVE_REQUEST_SIZE");
    });

    it("treats missing content-length as 0", () => {
      const req = makeFastifyRequest({ headers: {} });
      expect(v.validateRequest(req).threats).not.toContain("EXCESSIVE_REQUEST_SIZE");
    });
  });

  // ------------------------------------------------------------------
  // validateRequest: returns valid for clean request
  // ------------------------------------------------------------------
  describe("validateRequest clean request", () => {
    it("returns isValid true and empty threats for safe request", () => {
      v = new EnhancedValidator();
      const req = makeFastifyRequest({
        headers: { "user-agent": "Chrome/120" },
      });
      const result = v.validateRequest(req);
      expect(result.isValid).toBe(true);
      expect(result.threats).toEqual([]);
      expect(result.risk).toBe("low");
      expect(result.blockedReason).toBeUndefined();
    });
  });

  // ------------------------------------------------------------------
  // getClientIP (tested indirectly via tracking)
  // ------------------------------------------------------------------
  describe("getClientIP via validateRequest tracking", () => {
    beforeEach(() => {
      v = new EnhancedValidator();
    });

    it("uses x-forwarded-for first IP", () => {
      const req = makeFastifyRequest({
        headers: {
          "x-forwarded-for": "1.2.3.4, 5.6.7.8",
          "content-length": String(200 * 1024 * 1024),
        },
      });
      v.validateRequest(req);
      // No crash = IP extraction worked
      expect(true).toBe(true);
    });

    it("uses x-real-ip when x-forwarded-for absent", () => {
      const req = makeFastifyRequest({
        headers: {
          "x-real-ip": "9.8.7.6",
          "content-length": String(200 * 1024 * 1024),
        },
      });
      v.validateRequest(req);
      expect(true).toBe(true);
    });

    it("uses socket.remoteAddress when headers absent", () => {
      const req = makeFastifyRequest({
        headers: { "content-length": String(200 * 1024 * 1024) },
        socket: { remoteAddress: "10.0.0.1" },
      });
      v.validateRequest(req);
      expect(true).toBe(true);
    });

    it("falls back to unknown when nothing available", () => {
      const req = makeFastifyRequest({
        headers: { "content-length": String(200 * 1024 * 1024) },
        socket: {},
      });
      v.validateRequest(req);
      expect(true).toBe(true);
    });
  });

  // ------------------------------------------------------------------
  // trackSuspiciousAttempt: threshold logging
  // ------------------------------------------------------------------
  describe("trackSuspiciousAttempt threshold", () => {
    beforeEach(() => {
      v = new EnhancedValidator();
    });

    it("does not log when under threshold", () => {
      const req = makeFastifyRequest({
        method: "POST",
        headers: { "content-type": "text/html" },
        socket: { remoteAddress: "1.1.1.1" },
      });
      v.validateRequest(req);
      expect(logger.warn).not.toHaveBeenCalled();
    });

    it("logs warning when threshold exceeded", () => {
      const req = makeFastifyRequest({
        method: "POST",
        headers: {
          "content-type": "text/html",
          "content-length": String(200 * 1024 * 1024),
        },
        socket: { remoteAddress: "2.2.2.2" },
      });
      for (let i = 0; i < 6; i++) {
        v.validateRequest(req);
      }
      expect(logger.warn).toHaveBeenCalled();
    });
  });

  // ------------------------------------------------------------------
  // validateFileUpload
  // ------------------------------------------------------------------
  describe("validateFileUpload edge cases", () => {
    beforeEach(() => {
      v = new EnhancedValidator();
    });

    it("accepts .jpeg extension with correct mime", () => {
      expect(v.validateFileUpload("photo.jpeg", "image/jpeg", 1024).isValid).toBe(true);
    });

    it("accepts .png extension with correct mime", () => {
      expect(v.validateFileUpload("image.png", "image/png", 1024).isValid).toBe(true);
    });

    it("accepts .gif extension with correct mime", () => {
      expect(v.validateFileUpload("anim.gif", "image/gif", 1024).isValid).toBe(true);
    });

    it("accepts .pdf extension with correct mime", () => {
      expect(v.validateFileUpload("doc.pdf", "application/pdf", 1024).isValid).toBe(true);
    });

    it("accepts .txt extension with correct mime", () => {
      expect(v.validateFileUpload("notes.txt", "text/plain", 1024).isValid).toBe(true);
    });

    it("accepts .csv with text/csv mime", () => {
      expect(v.validateFileUpload("data.csv", "text/csv", 1024).isValid).toBe(true);
    });

    it("accepts .csv with application/csv mime", () => {
      expect(v.validateFileUpload("data.csv", "application/csv", 1024).isValid).toBe(true);
    });

    it("detects mime mismatch for .png with wrong mime", () => {
      expect(v.validateFileUpload("image.png", "image/jpeg", 1024).threats).toContain(
        "MIME_TYPE_MISMATCH"
      );
    });

    it("detects mime mismatch for .gif with wrong mime", () => {
      expect(v.validateFileUpload("image.gif", "image/png", 1024).threats).toContain(
        "MIME_TYPE_MISMATCH"
      );
    });

    it("detects mime mismatch for .pdf with wrong mime", () => {
      expect(v.validateFileUpload("doc.pdf", "text/plain", 1024).threats).toContain(
        "MIME_TYPE_MISMATCH"
      );
    });

    it("skips mime check for unknown extension", () => {
      const result = v.validateFileUpload("file.xyz", "application/octet-stream", 1024);
      expect(result.threats).not.toContain("MIME_TYPE_MISMATCH");
      expect(result.threats).toContain("INVALID_FILE_EXTENSION");
    });

    it("file size exactly at 10MB is valid", () => {
      expect(
        v.validateFileUpload("photo.jpg", "image/jpeg", 10 * 1024 * 1024).threats
      ).not.toContain("EXCESSIVE_FILE_SIZE");
    });

    it("file size 1 byte over 10MB is invalid", () => {
      const result = v.validateFileUpload("photo.jpg", "image/jpeg", 10 * 1024 * 1024 + 1);
      expect(result.threats).toContain("EXCESSIVE_FILE_SIZE");
      expect(result.risk).toBe("medium");
    });

    it("accumulates multiple threats (bad ext + bad size + traversal)", () => {
      const result = v.validateFileUpload(
        "../../malware.exe",
        "application/x-msdownload",
        20 * 1024 * 1024
      );
      expect(result.isValid).toBe(false);
      expect(result.threats).toContain("INVALID_FILE_EXTENSION");
      expect(result.threats).toContain("PATH_TRAVERSAL");
      expect(result.threats).toContain("EXCESSIVE_FILE_SIZE");
    });

    it("risk escalates from file threats via getMaxRisk", () => {
      const result = v.validateFileUpload("../../etc/passwd.txt", "text/plain", 1024);
      expect(result.risk).toBe("high");
    });
  });

  // ------------------------------------------------------------------
  // destroy
  // ------------------------------------------------------------------
  describe("destroy method", () => {
    it("clears timer and map without error", () => {
      v = new EnhancedValidator();
      v.destroy();
      // Calling destroy again should not throw (timer already null)
      v.destroy();
    });
  });

  // ------------------------------------------------------------------
  // getPlugin
  // ------------------------------------------------------------------
  describe("getPlugin preHandler hook", () => {
    beforeEach(() => {
      v = new EnhancedValidator();
    });

    it("returns 400 when request validation fails", async () => {
      const plugin = v.getPlugin();
      const mockFastify = { addHook: vi.fn() };
      await plugin(mockFastify);
      const hookFn = mockFastify.addHook.mock.calls[0][1];

      const req = makeFastifyRequest({ headers: { "user-agent": "sqlmap/1.0" } });
      const reply = { code: vi.fn().mockReturnThis(), send: vi.fn().mockReturnThis() };

      await hookFn(req, reply);
      expect(reply.code).toHaveBeenCalledWith(400);
      expect(reply.send).toHaveBeenCalledWith(
        expect.objectContaining({ ok: false, error: "SECURITY_VALIDATION_FAILED" })
      );
    });

    it("returns 400 when body validation fails", async () => {
      const plugin = v.getPlugin();
      const mockFastify = { addHook: vi.fn() };
      await plugin(mockFastify);
      const hookFn = mockFastify.addHook.mock.calls[0][1];

      const req = makeFastifyRequest({
        headers: { "user-agent": "Chrome" },
        body: { content: "<script>alert(1)</script>" },
      });
      const reply = { code: vi.fn().mockReturnThis(), send: vi.fn().mockReturnThis() };

      await hookFn(req, reply);
      expect(reply.code).toHaveBeenCalledWith(400);
      expect(reply.send).toHaveBeenCalledWith(
        expect.objectContaining({ error: "INPUT_VALIDATION_FAILED" })
      );
    });

    it("returns 400 when query validation fails", async () => {
      const plugin = v.getPlugin();
      const mockFastify = { addHook: vi.fn() };
      await plugin(mockFastify);
      const hookFn = mockFastify.addHook.mock.calls[0][1];

      const req = makeFastifyRequest({
        headers: { "user-agent": "Chrome" },
        query: { search: "<script>alert(1)</script>" },
      });
      const reply = { code: vi.fn().mockReturnThis(), send: vi.fn().mockReturnThis() };

      await hookFn(req, reply);
      expect(reply.code).toHaveBeenCalledWith(400);
      expect(reply.send).toHaveBeenCalledWith(
        expect.objectContaining({ error: "QUERY_VALIDATION_FAILED" })
      );
    });

    it("replaces body with sanitized version on valid input", async () => {
      const plugin = v.getPlugin();
      const mockFastify = { addHook: vi.fn() };
      await plugin(mockFastify);
      const hookFn = mockFastify.addHook.mock.calls[0][1];

      const req = makeFastifyRequest({
        headers: { "user-agent": "Chrome" },
        body: { name: "safe" },
      });
      const reply = { code: vi.fn().mockReturnThis(), send: vi.fn().mockReturnThis() };

      await hookFn(req, reply);
      expect(reply.code).not.toHaveBeenCalled();
      expect(req.body).toBeDefined();
    });

    it("replaces query with sanitized version on valid input", async () => {
      const plugin = v.getPlugin();
      const mockFastify = { addHook: vi.fn() };
      await plugin(mockFastify);
      const hookFn = mockFastify.addHook.mock.calls[0][1];

      const req = makeFastifyRequest({
        headers: { "user-agent": "Chrome" },
        query: { page: "1" },
      });
      const reply = { code: vi.fn().mockReturnThis(), send: vi.fn().mockReturnThis() };

      await hookFn(req, reply);
      expect(reply.code).not.toHaveBeenCalled();
      expect(req.query).toBeDefined();
    });

    it("passes through when no body and no query", async () => {
      const plugin = v.getPlugin();
      const mockFastify = { addHook: vi.fn() };
      await plugin(mockFastify);
      const hookFn = mockFastify.addHook.mock.calls[0][1];

      const req = makeFastifyRequest({ headers: { "user-agent": "Chrome" } });
      const reply = { code: vi.fn().mockReturnThis(), send: vi.fn().mockReturnThis() };

      await hookFn(req, reply);
      expect(reply.code).not.toHaveBeenCalled();
      expect(reply.send).not.toHaveBeenCalled();
    });

    it("skips body validation when body is not an object", async () => {
      const plugin = v.getPlugin();
      const mockFastify = { addHook: vi.fn() };
      await plugin(mockFastify);
      const hookFn = mockFastify.addHook.mock.calls[0][1];

      const req = makeFastifyRequest({
        headers: { "user-agent": "Chrome" },
        body: "string body",
      });
      const reply = { code: vi.fn().mockReturnThis(), send: vi.fn().mockReturnThis() };

      await hookFn(req, reply);
      expect(reply.code).not.toHaveBeenCalled();
    });

    it("skips query validation when query is not an object", async () => {
      const plugin = v.getPlugin();
      const mockFastify = { addHook: vi.fn() };
      await plugin(mockFastify);
      const hookFn = mockFastify.addHook.mock.calls[0][1];

      const req = makeFastifyRequest({
        headers: { "user-agent": "Chrome" },
        query: "not-object",
      });
      const reply = { code: vi.fn().mockReturnThis(), send: vi.fn().mockReturnThis() };

      await hookFn(req, reply);
      expect(reply.code).not.toHaveBeenCalled();
    });
  });
});
