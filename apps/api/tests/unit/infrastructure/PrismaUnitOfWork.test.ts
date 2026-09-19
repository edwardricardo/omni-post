/**
 * Unit tests for PrismaUnitOfWork
 *
 * Verifies transaction propagation through AsyncLocalStorage.
 * Tier 0: no real database required.
 *
 * @file PrismaUnitOfWork.test.ts
 * @description Tests for PrismaUnitOfWork
 * @layer infrastructure
 */

import { describe, it, beforeAll, afterAll, vi, expect } from "vitest";
import { ok, err } from "@shared/types";
import { PrismaUnitOfWork } from "@adapters/db-prisma";
import {
  ambientTenantContextProvider,
  withTenantContext,
} from "../../../src/security/tenantContext.js";
// ── console.log suppression to avoid corrupting the TAP protocol ──────────────

let _originalConsoleLog: typeof console.log;
beforeAll(() => {
  _originalConsoleLog = console.log;
  console.log = () => {};
});
afterAll(() => {
  console.log = _originalConsoleLog;
});

// ── helpers ───────────────────────────────────────────────────────────────────

/**
 * Creates a PrismaClient mock with transaction support.
 * The mock implementation runs the $transaction callback with the internal
 * txClient, simulating Prisma's real behaviour.
 */
function createMockPrismaClient() {
  const mockTx = {
    post: { create: vi.fn(async () => ({})) },
    postContent: { create: vi.fn(async () => ({})) },
  };

  const client = {
    $transaction: vi.fn(async (fn: (tx: typeof mockTx) => Promise<unknown>, _opts?: unknown) =>
      fn(mockTx)
    ),
  };

  return { client, tx: mockTx };
}

/**
 * A Prisma mock that reports the transaction's OUTCOME, which the plain mock
 * above cannot: it records `commit` when the callback resolves and `rollback`
 * when it rejects, because an interactive transaction aborts only by rejecting.
 * `statements` records the order in which statements reached the tx client, so
 * "the GUC binding is the FIRST statement" is an assertion rather than a claim.
 */
function createOutcomeRecordingPrismaClient() {
  const statements: string[] = [];
  const outcomes: string[] = [];

  const mockTx = {
    $queryRaw: vi.fn(async () => {
      statements.push("set_config");
      return [];
    }),
  };

  const client = {
    $transaction: vi.fn(async (fn: (tx: typeof mockTx) => Promise<unknown>, _opts?: unknown) => {
      try {
        const value = await fn(mockTx);
        outcomes.push("commit");
        return value;
      } catch (error) {
        outcomes.push("rollback");
        throw error;
      }
    }),
  };

  return { client, tx: mockTx, statements, outcomes };
}

// ── tests ─────────────────────────────────────────────────────────────────────

describe("PrismaUnitOfWork", () => {
  // ── executeInTransaction ──────────────────────────────────────────────────

  describe("executeInTransaction", () => {
    it("runs the callback inside a Prisma transaction", async (_t) => {
      const { client } = createMockPrismaClient();
      const uow = new PrismaUnitOfWork(client as never, ambientTenantContextProvider);

      let executed = false;
      await uow.executeInTransaction(async () => {
        executed = true;
      });

      expect(executed).toBeTruthy();
      expect(client.$transaction.mock.calls.length).toBe(1);
    });

    it("returns the value the callback returned", async (_t) => {
      const { client } = createMockPrismaClient();
      const uow = new PrismaUnitOfWork(client as never, ambientTenantContextProvider);

      const result = await uow.executeInTransaction(async () => 42);

      expect(result).toBe(42);
    });

    it("propagates an error thrown inside the callback", async (_t) => {
      const { client } = createMockPrismaClient();
      const uow = new PrismaUnitOfWork(client as never, ambientTenantContextProvider);

      await expect(() =>
        uow.executeInTransaction(async () => {
          throw new Error("test error");
        })
      ).rejects.toThrow("test error");
    });

    it("passes the transaction options through to Prisma", async (_t) => {
      const { client } = createMockPrismaClient();
      const uow = new PrismaUnitOfWork(client as never, ambientTenantContextProvider);

      await uow.executeInTransaction(async () => {}, { timeout: 10_000, maxWait: 2_000 });

      const callArgs = client.$transaction.mock.calls[0];
      expect(callArgs).toBeTruthy();
      expect((callArgs[1] as Record<string, unknown> | undefined)?.timeout).toBe(10_000);
      expect((callArgs[1] as Record<string, unknown> | undefined)?.maxWait).toBe(2_000);
    });

    it("merges the per-call options over the default options", async (_t) => {
      const { client } = createMockPrismaClient();
      // Default options: timeout=5000, maxWait=1000
      const uow = new PrismaUnitOfWork(client as never, ambientTenantContextProvider, {
        timeout: 5_000,
        maxWait: 1_000,
      });

      // Per-call options: only timeout is overridden
      await uow.executeInTransaction(async () => {}, { timeout: 15_000 });

      const callArgs = client.$transaction.mock.calls[0];
      expect(callArgs).toBeTruthy();
      const opts = callArgs[1] as Record<string, unknown> | undefined;
      expect(opts?.timeout).toBe(15_000);
      expect(opts?.maxWait).toBe(1_000);
    });

    it("omits undefined options from the object passed to Prisma", async (_t) => {
      const { client } = createMockPrismaClient();
      const uow = new PrismaUnitOfWork(client as never, ambientTenantContextProvider);

      await uow.executeInTransaction(async () => {});

      const callArgs = client.$transaction.mock.calls[0];
      expect(callArgs).toBeTruthy();
      const opts = callArgs[1] as Record<string, unknown>;
      // Under exactOptionalPropertyTypes, undefined keys must not appear
      expect("timeout" in opts).toBeFalsy();
      expect("maxWait" in opts).toBeFalsy();
      expect("isolationLevel" in opts).toBeFalsy();
    });
  });

  // ── tenant scope from the injected provider ───────────────────────────────

  describe("tenant scope from the injected provider", () => {
    it("binds the accountId the INJECTED provider reports, with no ambient context bound", async () => {
      const { client, tx, statements } = createOutcomeRecordingPrismaClient();
      // A fixed double, never the ambient one: the ambient storage is empty here, so
      // a unit of work still reading it would bind nothing and this would fail.
      const injectedProvider = {
        getTenantContext: () => ({ accountId: "acc-injected" }),
        getSystemContext: () => undefined,
      };
      const uow = new PrismaUnitOfWork(client as never, injectedProvider);

      await uow.executeInTransaction(async () => {
        statements.push("work");
      });

      expect(statements).toEqual(["set_config", "work"]);
      const gucCall = tx.$queryRaw.mock.calls[0] as unknown as
        [TemplateStringsArray, string] | undefined;
      expect(gucCall?.[1]).toBe("acc-injected");
    });

    it("binds the __system__ sentinel when the injected provider reports a system context", async () => {
      const { client, tx } = createOutcomeRecordingPrismaClient();
      const systemProvider = {
        getTenantContext: () => undefined,
        getSystemContext: () => ({ reason: "retention sweep" }),
      };
      const uow = new PrismaUnitOfWork(client as never, systemProvider);

      await uow.executeInTransaction(async () => {});

      const gucCall = tx.$queryRaw.mock.calls[0] as unknown as
        [TemplateStringsArray, string] | undefined;
      expect(gucCall?.[1]).toBe("__system__");
    });
  });

  // ── executeResultInTransaction ────────────────────────────────────────────

  describe("executeResultInTransaction", () => {
    it("rolls back and returns the same err object when the work resolves to err", async () => {
      const { client, outcomes } = createOutcomeRecordingPrismaClient();
      const uow = new PrismaUnitOfWork(client as never, ambientTenantContextProvider);
      const failure = err(new Error("save failed after the first statement"));

      const result = await uow.executeResultInTransaction(async () => failure);

      // The transaction aborted: an interactive Prisma transaction commits
      // unless its callback rejects, so `rollback` here IS the rollback proof.
      expect(outcomes).toEqual(["rollback"]);
      // Identity, not shape: the err the work produced is handed back untouched.
      expect(result).toBe(failure);
    });

    it("commits and returns the same ok object when the work resolves to ok", async () => {
      const { client, outcomes } = createOutcomeRecordingPrismaClient();
      const uow = new PrismaUnitOfWork(client as never, ambientTenantContextProvider);
      const success = ok({ postId: "post-1" });

      const result = await uow.executeResultInTransaction(async () => success);

      expect(outcomes).toEqual(["commit"]);
      expect(result).toBe(success);
    });

    it("propagates a genuine thrown error instead of converting it into an err", async () => {
      const { client, outcomes } = createOutcomeRecordingPrismaClient();
      const uow = new PrismaUnitOfWork(client as never, ambientTenantContextProvider);
      const connectionLost = new Error("connection lost");

      // A rejection is the assertion: had the method swallowed the failure into
      // an err Result, the caller would have received a value and this would
      // not reject at all.
      await expect(
        uow.executeResultInTransaction(async () => {
          throw connectionLost;
        })
      ).rejects.toBe(connectionLost);
      expect(outcomes).toEqual(["rollback"]);
    });

    it("binds the GUC as the first statement of the transaction, as executeInTransaction does", async () => {
      const { client, statements } = createOutcomeRecordingPrismaClient();
      const uow = new PrismaUnitOfWork(client as never, ambientTenantContextProvider);

      await withTenantContext({ accountId: "acc-guc-0001" }, async () =>
        uow.executeResultInTransaction(async () => {
          statements.push("work");
          return ok(undefined);
        })
      );

      expect(statements).toEqual(["set_config", "work"]);
    });
  });

  // ── getTransactionClient ──────────────────────────────────────────────────

  describe("getTransactionClient", () => {
    it("returns undefined when no transaction is active", async () => {
      const result = PrismaUnitOfWork.getTransactionClient();
      expect(result).toBe(undefined);
    });

    it("returns the tx client when called inside a transaction", async (_t) => {
      const { client, tx } = createMockPrismaClient();
      const uow = new PrismaUnitOfWork(client as never, ambientTenantContextProvider);

      let capturedClient: unknown;
      await uow.executeInTransaction(async () => {
        capturedClient = PrismaUnitOfWork.getTransactionClient();
      });

      expect(capturedClient !== undefined).toBeTruthy();
      expect(capturedClient).toBe(tx);
    });

    it("returns undefined after the transaction ends", async (_t) => {
      const { client } = createMockPrismaClient();
      const uow = new PrismaUnitOfWork(client as never, ambientTenantContextProvider);

      await uow.executeInTransaction(async () => {});

      const result = PrismaUnitOfWork.getTransactionClient();
      expect(result).toBe(undefined);
    });

    it("isolates tx clients across concurrent async contexts", async (_t) => {
      // Two concurrent unit-of-work transactions must not see each other's tx client
      const mock1 = createMockPrismaClient();
      const mock2 = createMockPrismaClient();
      const uow1 = new PrismaUnitOfWork(mock1.client as never, ambientTenantContextProvider);
      const uow2 = new PrismaUnitOfWork(mock2.client as never, ambientTenantContextProvider);

      let client1: unknown;
      let client2: unknown;

      await Promise.all([
        uow1.executeInTransaction(async () => {
          client1 = PrismaUnitOfWork.getTransactionClient();
          // Yield control so the other transaction can run
          await new Promise<void>((r) => setTimeout(r, 10));
          // It must still be the same client after yielding control
          const afterYield = PrismaUnitOfWork.getTransactionClient();
          expect(afterYield).toBe(client1);
        }),
        uow2.executeInTransaction(async () => {
          client2 = PrismaUnitOfWork.getTransactionClient();
        }),
      ]);

      expect(client1 !== undefined).toBeTruthy();
      expect(client2 !== undefined).toBeTruthy();
      expect(client1).not.toBe(client2);
    });
  });

  // ── integration with repositories ─────────────────────────────────────────

  describe(
    "integration with repository code (active unit of work detection)",
    {
      concurrency: 1,
    },
    () => {
      it("exposes the active unit of work's tx client to the code inside it", async (_t) => {
        const { client, tx } = createMockPrismaClient();
        const uow = new PrismaUnitOfWork(client as never, ambientTenantContextProvider);

        let innerClient: unknown;
        await uow.executeInTransaction(async () => {
          // Simulates what a repository does: check whether a unit of work is active
          innerClient = PrismaUnitOfWork.getTransactionClient();
        });

        expect(innerClient).toBe(tx);
      });

      it("shares one tx client across multiple operations inside executeInTransaction", async (_t) => {
        const { client, tx } = createMockPrismaClient();
        const uow = new PrismaUnitOfWork(client as never, ambientTenantContextProvider);

        const capturedClients: unknown[] = [];
        await uow.executeInTransaction(async () => {
          // Simulates multiple repository calls
          capturedClients.push(PrismaUnitOfWork.getTransactionClient());
          await Promise.resolve(); // yield the event loop briefly
          capturedClients.push(PrismaUnitOfWork.getTransactionClient());
        });

        expect(capturedClients.length).toBe(2);
        expect(capturedClients[0]).toBe(tx);
        expect(capturedClients[1]).toBe(tx);
        // Both captures are of the same client
        expect(capturedClients[0]).toBe(capturedClients[1]);
      });
    }
  );
});
