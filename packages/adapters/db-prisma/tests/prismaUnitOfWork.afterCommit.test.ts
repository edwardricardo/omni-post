/**
 * @file prismaUnitOfWork.afterCommit.test.ts
 * @description The after-commit hook registry: it exists so in-memory state a
 *   transaction makes true is set only once that transaction has COMMITTED. These cases
 *   pin the two properties that make it safe to expose as a public API — a hook that
 *   throws neither swallows its siblings nor changes the transaction's outcome — because
 *   the alternative is the worst failure this seam can produce: a committed transaction
 *   reported to its caller as a failure.
 * @layer infrastructure
 */

import { describe, it, vi, beforeEach } from "vitest";
import assert from "node:assert/strict";
import { PrismaUnitOfWork } from "../src/unitofwork/PrismaUnitOfWork.js";

/** A Prisma double whose `$transaction` runs the callback and resolves like a commit. */
function makePrisma(): { $transaction: ReturnType<typeof vi.fn> } {
  return {
    $transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) =>
      fn({ $queryRaw: vi.fn(async () => []) })
    ),
  };
}

/** No tenant and no system context: `resolveGucScope` answers undefined, which binds nothing. */
const noTenantProvider = {
  getTenantContext: () => undefined,
  getSystemContext: () => undefined,
};

describe("PrismaUnitOfWork — after-commit hooks", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("runs every hook after the transaction resolves", async () => {
    const order: string[] = [];
    const uow = new PrismaUnitOfWork(makePrisma() as never, noTenantProvider as never);

    const value = await uow.executeInTransaction(async () => {
      PrismaUnitOfWork.onCommitted(() => order.push("first"));
      PrismaUnitOfWork.onCommitted(() => order.push("second"));
      order.push("work");
      return "done";
    });

    assert.strictEqual(value, "done");
    assert.deepStrictEqual(order, ["work", "first", "second"], "hooks run AFTER the work");
  });

  it("runs the later hooks even when an earlier one throws", async () => {
    // A hook is someone else's code. One that throws must not take the others with it:
    // the state each hook sets is independent, and losing the second because the first
    // failed is a silent partial application of "the transaction committed".
    const ran: string[] = [];
    const uow = new PrismaUnitOfWork(makePrisma() as never, noTenantProvider as never);

    await uow.executeInTransaction(async () => {
      PrismaUnitOfWork.onCommitted(() => {
        throw new Error("hook exploded");
      });
      PrismaUnitOfWork.onCommitted(() => ran.push("second"));
      return "done";
    });

    assert.deepStrictEqual(ran, ["second"], "the throwing hook did not swallow its sibling");
  });

  it("still resolves with the callback's value when a hook throws", async () => {
    // The transaction COMMITTED. Letting a hook's failure propagate would report that
    // commit to the caller as a failure — a caller that then retries, or tells a customer
    // their write was lost, over work the database has already kept.
    const uow = new PrismaUnitOfWork(makePrisma() as never, noTenantProvider as never);

    const value = await uow.executeInTransaction(async () => {
      PrismaUnitOfWork.onCommitted(() => {
        throw new Error("hook exploded");
      });
      return "committed";
    });

    assert.strictEqual(value, "committed", "a hook cannot turn a commit into a failure");
  });

  it("does NOT run the hooks when the transaction rejects", async () => {
    const ran: string[] = [];
    const prisma = {
      $transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => {
        await fn({ $queryRaw: vi.fn(async () => []) });
        throw new Error("commit failed");
      }),
    };
    const uow = new PrismaUnitOfWork(prisma as never, noTenantProvider as never);

    await assert.rejects(
      () =>
        uow.executeInTransaction(async () => {
          PrismaUnitOfWork.onCommitted(() => ran.push("never"));
          return "done";
        }),
      /commit failed/
    );

    assert.deepStrictEqual(ran, [], "a rollback discharges nothing");
  });

  it("runs a hook immediately when there is no transaction to wait for", async () => {
    const ran: string[] = [];

    PrismaUnitOfWork.onCommitted(() => ran.push("immediate"));

    assert.deepStrictEqual(
      ran,
      ["immediate"],
      "outside a transaction the caller's own statements have already committed"
    );
  });

  it("hands the transaction client and the hook list to the SAME scope", async () => {
    // The two used to be independent stores co-scoped only by one call site. They are now
    // one store, so a context that can reach the client can always reach the hook list.
    let sawClient = false;
    let registered = false;
    const ran: string[] = [];
    const uow = new PrismaUnitOfWork(makePrisma() as never, noTenantProvider as never);

    await uow.executeInTransaction(async () => {
      sawClient = PrismaUnitOfWork.getTransactionClient() !== undefined;
      PrismaUnitOfWork.onCommitted(() => ran.push("deferred"));
      registered = ran.length === 0;
      return "done";
    });

    assert.ok(sawClient, "the client is visible inside the transaction");
    assert.ok(registered, "and the hook it registered was deferred, not run inline");
    assert.deepStrictEqual(ran, ["deferred"]);
  });
});
