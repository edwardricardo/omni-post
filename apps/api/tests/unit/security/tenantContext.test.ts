/**
 * @file tenantContext.test.ts
 * @description Unit tests for the TenantContext / SystemContext
 *   AsyncLocalStorage holders. Verifies binding, isolation between concurrent
 *   async chains, fail-loud `requireTenantContext`, and the explicit-bypass
 *   `withSystemContext`.
 * @layer infrastructure
 */
import { describe, it, expect } from "vitest";
import assert from "node:assert/strict";
import { createDeferred } from "@packages/vitest-shared/determinism";
import {
  withTenantContext,
  enterTenantContext,
  withSystemContext,
  getTenantContext,
  getSystemContext,
  requireTenantContext,
  TenantContextMissingError,
  TenantContextMismatchError,
} from "../../../src/security/tenantContext.js";

/**
 * Runs `read` once in each scope, every scope suspended at one shared barrier until all of them
 * have entered, so each read happens while every other context is live too. The barrier opens
 * from the test's own chain, outside every scope, so a continuation that took its context from
 * whoever resumed it would read none at all.
 * @param scopes - The scope values, one concurrent chain each.
 * @param enter - Binds one scope value around a function, as `withTenantContext` does.
 * @param read - Reads the bound value back after the barrier.
 * @returns What each chain read, in the order of `scopes`.
 */
async function readWhileAllScopesSuspended<S>(
  scopes: readonly S[],
  enter: (scope: S, fn: () => Promise<string | undefined>) => Promise<string | undefined>,
  read: () => string | undefined
): Promise<Array<string | undefined>> {
  const barrier = createDeferred<void>();
  let entered = 0;
  const reads = Promise.all(
    scopes.map((scope) =>
      enter(scope, async () => {
        entered += 1;
        await barrier.promise;
        return read();
      })
    )
  );
  // The scopes run their function synchronously up to its first await, so every chain is
  // inside its own context and suspended at the barrier by now. The count is read before the
  // barrier opens and asserted after, so a failed assertion leaves no chain pending.
  const suspendedAtOpen = entered;
  barrier.resolve();
  const results = await reads;
  expect(suspendedAtOpen).toBe(scopes.length);
  return results;
}

describe("TenantContext", () => {
  describe("withTenantContext", () => {
    it("binds accountId for the duration of fn", async () => {
      let observed: string | undefined;
      await withTenantContext({ accountId: "acc-A" }, async () => {
        observed = getTenantContext()?.accountId;
      });
      expect(observed).toBe("acc-A");
    });

    it("unbinds after fn resolves", async () => {
      await withTenantContext({ accountId: "acc-A" }, async () => {
        getTenantContext();
      });
      expect(getTenantContext()).toBeUndefined();
    });

    it("propagates accountId to nested async operations", async () => {
      const observed: Array<string | undefined> = [];
      await withTenantContext({ accountId: "acc-A" }, async () => {
        observed.push(getTenantContext()?.accountId);
        await Promise.resolve();
        observed.push(getTenantContext()?.accountId);
        // One event-loop turn: the callback is a macrotask scheduled from inside the scope, so
        // it reads the context itself rather than only the continuation after it.
        observed.push(
          await new Promise<string | undefined>((resolve) => {
            setImmediate(() => resolve(getTenantContext()?.accountId));
          })
        );
        observed.push(getTenantContext()?.accountId);
      });
      expect(observed).toEqual(["acc-A", "acc-A", "acc-A", "acc-A"]);
    });

    it("isolates concurrent contexts (no cross-pollination)", async () => {
      const results = await readWhileAllScopesSuspended(
        ["acc-A", "acc-B", "acc-C"],
        (accountId, fn) => withTenantContext({ accountId }, fn),
        () => getTenantContext()?.accountId
      );
      expect(results).toEqual(["acc-A", "acc-B", "acc-C"]);
    });
  });

  describe("enterTenantContext", () => {
    it("binds context for the current async chain and beyond", async () => {
      // enterTenantContext lives inside its own scoped async chain in tests
      // so we don't pollute the outer scope.
      await withTenantContext({ accountId: "outer" }, async () => {
        // Nested: enterTenantContext shadows the run-scoped value.
        // This is the Fastify preHandler shape.
        await new Promise<void>((resolve) => {
          (async () => {
            enterTenantContext({ accountId: "entered" });
            assert.equal(getTenantContext()?.accountId, "entered");
            await Promise.resolve();
            assert.equal(getTenantContext()?.accountId, "entered");
            resolve();
          })();
        });
      });
    });
  });

  describe("requireTenantContext", () => {
    it("returns context when bound", async () => {
      await withTenantContext({ accountId: "acc-X" }, async () => {
        const ctx = requireTenantContext();
        expect(ctx.accountId).toBe("acc-X");
      });
    });

    it("throws TenantContextMissingError when no context is bound", () => {
      expect(() => requireTenantContext()).toThrow(TenantContextMissingError);
    });

    it("thrown error carries the correct code", () => {
      try {
        requireTenantContext();
        assert.fail("should have thrown");
      } catch (e) {
        expect(e).toBeInstanceOf(TenantContextMissingError);
        expect((e as TenantContextMissingError).code).toBe("TENANT_CONTEXT_MISSING");
      }
    });
  });
});

describe("SystemContext", () => {
  describe("withSystemContext", () => {
    it("binds the reason for the duration of fn", async () => {
      let observed: string | undefined;
      await withSystemContext("admin-impersonation:userId=admin1", async () => {
        observed = getSystemContext()?.reason;
      });
      expect(observed).toBe("admin-impersonation:userId=admin1");
    });

    it("unbinds after fn resolves", async () => {
      await withSystemContext("test", async () => {
        getSystemContext();
      });
      expect(getSystemContext()).toBeUndefined();
    });

    it("is independent of TenantContext (can coexist)", async () => {
      await withTenantContext({ accountId: "acc-A" }, async () => {
        await withSystemContext("system:test", async () => {
          expect(getTenantContext()?.accountId).toBe("acc-A");
          expect(getSystemContext()?.reason).toBe("system:test");
        });
      });
    });

    it("isolates concurrent system contexts", async () => {
      const results = await readWhileAllScopesSuspended(
        ["reason-A", "reason-B"],
        withSystemContext,
        () => getSystemContext()?.reason
      );
      expect(results).toEqual(["reason-A", "reason-B"]);
    });
  });
});

describe("TenantContextMismatchError", () => {
  it("constructs with model + context + query accountIds", () => {
    const error = new TenantContextMismatchError("Post", "acc-A", "acc-B");
    expect(error.code).toBe("TENANT_CONTEXT_MISMATCH");
    expect(error.model).toBe("Post");
    expect(error.contextAccountId).toBe("acc-A");
    expect(error.queryAccountId).toBe("acc-B");
    expect(error.message).toContain("Post");
    expect(error.message).toContain("acc-A");
    expect(error.message).toContain("acc-B");
  });

  it("is a proper Error subclass (instanceof Error)", () => {
    const error = new TenantContextMismatchError("Post", "acc-A", "acc-B");
    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe("TenantContextMismatchError");
  });
});

describe("integration: tenant + audit context coexistence", () => {
  it("both ALS stores work independently for the same async chain", async () => {
    // Import audit context lazily to avoid module init order issues.
    const { withRequestAuditContext, getRequestAuditContext } =
      await import("../../../src/security/decryptAuditContext.js");

    await withRequestAuditContext({ correlationId: "req-123", ipAddress: "1.2.3.4" }, async () => {
      await withTenantContext({ accountId: "acc-A" }, async () => {
        expect(getRequestAuditContext()?.correlationId).toBe("req-123");
        expect(getTenantContext()?.accountId).toBe("acc-A");
      });
      // Audit context still present after tenant scope exits.
      expect(getRequestAuditContext()?.correlationId).toBe("req-123");
      expect(getTenantContext()).toBeUndefined();
    });
  });
});
