/**
 * @file tenantGuc.test.ts
 * @description Unit tests for the GUC transaction seam: the AsyncLocalStorage marker that
 *   tells per-operation binding "this transaction already owns GUC adjudication", and the
 *   helper every non-unit-of-work transaction opens through. Pure logic — the transaction
 *   client is a double, so no PostgreSQL is involved. The real-database half (a write and a
 *   forced failure rolling back together) lives in the integration tier.
 * @layer infrastructure
 */
import { describe, it, expect } from "vitest";
import {
  SYSTEM_TENANT_SCOPE,
  getBoundGucScope,
  isGucBound,
  runWithBoundGuc,
  withGucBoundTransaction,
} from "../../../../../infra/prisma/src/extensions/tenantGuc.js";

interface FakeTransactionClient {
  $executeRaw(query: TemplateStringsArray, ...values: unknown[]): Promise<number>;
}

/**
 * A client whose `$transaction` records every transaction it opens and every statement
 * issued on it, so a test can count binds instead of inspecting a database.
 */
function makeFakeClient() {
  const boundValues: unknown[][] = [];
  const openedTransactions: Array<Record<string, unknown> | undefined> = [];

  const client = {
    async $transaction<T>(
      fn: (tx: FakeTransactionClient) => Promise<T>,
      options?: Record<string, unknown>
    ): Promise<T> {
      openedTransactions.push(options);
      const tx: FakeTransactionClient = {
        async $executeRaw(_query: TemplateStringsArray, ...values: unknown[]): Promise<number> {
          boundValues.push(values);
          return 1;
        },
      };
      return fn(tx);
    },
  };

  return { client, boundValues, openedTransactions };
}

describe("GUC transaction marker", () => {
  it("reports no ambient owner outside any adopted transaction", () => {
    expect(isGucBound()).toBe(false);
    expect(getBoundGucScope()).toBeUndefined();
  });

  it("holds the marker for a tenant scope", async () => {
    const { client, boundValues } = makeFakeClient();

    const observed = await withGucBoundTransaction(client, "account-1", async () => ({
      bound: isGucBound(),
      scope: getBoundGucScope(),
    }));

    expect(observed).toEqual({ bound: true, scope: "account-1" });
    expect(boundValues).toEqual([["account-1"]]);
  });

  it("holds the marker for the system scope", async () => {
    const { client, boundValues } = makeFakeClient();

    const observed = await withGucBoundTransaction(client, SYSTEM_TENANT_SCOPE, async () => ({
      bound: isGucBound(),
      scope: getBoundGucScope(),
    }));

    expect(observed).toEqual({ bound: true, scope: SYSTEM_TENANT_SCOPE });
    expect(boundValues).toEqual([[SYSTEM_TENANT_SCOPE]]);
  });

  it("holds the marker when the transaction deliberately binds nothing", async () => {
    const { client, boundValues } = makeFakeClient();

    const observed = await withGucBoundTransaction(client, undefined, async () => ({
      bound: isGucBound(),
      scope: getBoundGucScope(),
    }));

    // The connection is owned either way, so the marker is held; only the bind is skipped.
    expect(observed).toEqual({ bound: true, scope: undefined });
    expect(boundValues).toEqual([]);
  });

  it("releases the marker once the transaction returns", async () => {
    const { client } = makeFakeClient();

    await withGucBoundTransaction(client, "account-1", async () => undefined);

    expect(isGucBound()).toBe(false);
  });

  it("releases the marker when the transaction body throws", async () => {
    const { client } = makeFakeClient();

    await expect(
      withGucBoundTransaction(client, "account-1", async () => {
        throw new Error("body failed");
      })
    ).rejects.toThrow("body failed");

    expect(isGucBound()).toBe(false);
  });

  it("binds each transaction exactly once, including a nested helper call", async () => {
    const { client, boundValues, openedTransactions } = makeFakeClient();

    await withGucBoundTransaction(client, "account-1", async () => {
      await withGucBoundTransaction(client, "account-2", async () => {
        expect(isGucBound()).toBe(true);
      });
    });

    // One bind per transaction opened — never a second bind on the same connection, and
    // never a bind skipped for a transaction that owns one of its own.
    expect(openedTransactions).toHaveLength(2);
    expect(boundValues).toEqual([["account-1"], ["account-2"]]);
  });

  it("forwards transaction options verbatim", async () => {
    const { client, openedTransactions } = makeFakeClient();

    await withGucBoundTransaction(client, "account-1", async () => undefined, {
      timeout: 120_000,
      maxWait: 10_000,
      isolationLevel: "Serializable",
    });

    expect(openedTransactions).toEqual([
      { timeout: 120_000, maxWait: 10_000, isolationLevel: "Serializable" },
    ]);
  });

  it("marks a seam that adopts the marker without opening a transaction of its own", () => {
    const observed = runWithBoundGuc("account-1", () => ({
      bound: isGucBound(),
      scope: getBoundGucScope(),
    }));

    expect(observed).toEqual({ bound: true, scope: "account-1" });
    expect(isGucBound()).toBe(false);
  });
});
