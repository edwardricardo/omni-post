/**
 * @file decryptAuditContext.test.ts
 * @description Verifies the AsyncLocalStorage-backed request-scoped audit
 *   context helper. Asserts: get returns undefined outside scope; values
 *   set inside scope flow through async hops; setAuthenticatedUserId
 *   mutates the live context (post-auth middleware pattern).
 * @layer infrastructure
 */
import { describe, it, expect } from "vitest";
import {
  withRequestAuditContext,
  getRequestAuditContext,
  setAuthenticatedUserId,
} from "../../../src/security/decryptAuditContext.js";

describe("decryptAuditContext", () => {
  it("getRequestAuditContext returns undefined when called outside any scope", () => {
    expect(getRequestAuditContext()).toBeUndefined();
  });

  it("values set in withRequestAuditContext are visible synchronously inside fn", () => {
    const ctx = { correlationId: "req-1", ipAddress: "1.2.3.4" };
    const result = withRequestAuditContext(ctx, () => getRequestAuditContext());
    expect(result).toEqual(ctx);
  });

  it("context propagates through async/await", async () => {
    const ctx = { correlationId: "req-2" };
    const result = await withRequestAuditContext(ctx, async () => {
      await new Promise((r) => setImmediate(r));
      return getRequestAuditContext();
    });
    expect(result).toEqual(ctx);
  });

  it("context is isolated between concurrent withRequestAuditContext invocations", async () => {
    const results = await Promise.all([
      withRequestAuditContext({ correlationId: "A" }, async () => {
        await new Promise((r) => setImmediate(r));
        return getRequestAuditContext()?.correlationId;
      }),
      withRequestAuditContext({ correlationId: "B" }, async () => {
        await new Promise((r) => setImmediate(r));
        return getRequestAuditContext()?.correlationId;
      }),
    ]);
    expect(results).toEqual(["A", "B"]);
  });

  it("setAuthenticatedUserId mutates the live context inside scope", () => {
    withRequestAuditContext({ correlationId: "req-3" }, () => {
      expect(getRequestAuditContext()?.userId).toBeUndefined();
      setAuthenticatedUserId("user-42");
      expect(getRequestAuditContext()?.userId).toBe("user-42");
    });
  });

  it("setAuthenticatedUserId outside scope is a silent no-op", () => {
    // Should NOT throw when called outside any active request.
    expect(() => setAuthenticatedUserId("user-99")).not.toThrow();
    expect(getRequestAuditContext()).toBeUndefined();
  });

  it("once scope exits, getRequestAuditContext returns undefined again", () => {
    withRequestAuditContext({ correlationId: "transient" }, () => {
      expect(getRequestAuditContext()).toBeDefined();
    });
    expect(getRequestAuditContext()).toBeUndefined();
  });
});
