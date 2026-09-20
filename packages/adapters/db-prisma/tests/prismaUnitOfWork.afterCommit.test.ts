/**
 * @file prismaUnitOfWork.afterCommit.test.ts
 * @description The after-commit hook registry: it exists so in-memory state a
 *   transaction makes true is set only once that transaction has COMMITTED. These cases
 *   pin the two properties that make it safe to expose as a public API — a hook that
 *   throws neither swallows its siblings nor changes the transaction's outcome — because
 *   the alternative is the worst failure this seam can produce: a committed transaction
 *   reported to its caller as a failure. They also pin the shape of the API itself: the
 *   caller CAPTURES the transaction once and registers on that object, so a hook can
 *   never be registered against a context that is no longer the one it was written for.
 * @layer infrastructure
 */

import { describe, it, vi, beforeEach } from "vitest";
import assert from "node:assert/strict";

/**
 * The seam's own ERROR log is an assertion target here, not noise: one of its refusals
 * has no return value and no observable effect BUT the log, so a case that cannot read
 * the log cannot tell the refusal from the silence it replaced. Hoisted because
 * `vi.mock` is lifted above the imports, and spread over the real module so anything
 * else in the import graph keeps the exports it expects.
 */
const { loggedErrors } = vi.hoisted(() => ({
  // `msg` is required-and-nullable rather than optional: the logger's own signature makes
  // it omissible, so a call really can arrive without one, and under
  // `exactOptionalPropertyTypes` an optional property may not be ASSIGNED undefined.
  loggedErrors: [] as Array<{ obj: Record<string, unknown>; msg: string | undefined }>,
}));

vi.mock("@observability/logger", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@observability/logger")>();
  return {
    ...actual,
    createLogger: () => ({
      error: (obj: Record<string, unknown>, msg?: string) => {
        loggedErrors.push({ obj, msg });
      },
      warn: () => {},
      info: () => {},
      debug: () => {},
    }),
  };
});

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
    loggedErrors.length = 0;
    vi.clearAllMocks();
  });

  it("runs every hook after the transaction resolves", async () => {
    const order: string[] = [];
    const uow = new PrismaUnitOfWork(makePrisma() as never, noTenantProvider as never);

    const value = await uow.executeInTransaction(async () => {
      PrismaUnitOfWork.activeTransaction()?.onCommitted(() => order.push("first"));
      PrismaUnitOfWork.activeTransaction()?.onCommitted(() => order.push("second"));
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
      const active = PrismaUnitOfWork.activeTransaction();
      active?.onCommitted(() => {
        throw new Error("hook exploded");
      });
      active?.onCommitted(() => ran.push("second"));
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
      PrismaUnitOfWork.activeTransaction()?.onCommitted(() => {
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
          PrismaUnitOfWork.activeTransaction()?.onCommitted(() => ran.push("never"));
          return "done";
        }),
      /commit failed/
    );

    assert.deepStrictEqual(ran, [], "a rollback discharges nothing");
  });

  it("answers undefined outside a transaction, leaving the decision with the caller", async () => {
    // There is no transaction to wait for, and no hook list to push onto. The seam says
    // so plainly instead of running the work itself: what "already committed" means is
    // the caller's to decide — the narrow save, for one, has committed through its own
    // runner by this point and marks directly, which a hidden inline call would blur.
    assert.strictEqual(PrismaUnitOfWork.activeTransaction(), undefined);
    assert.strictEqual(PrismaUnitOfWork.getTransactionClient(), undefined);
  });

  it("registers on the CAPTURED transaction even from a detached async context", async () => {
    // The shape the two-read API made possible: read the client in one ambient read,
    // register the hook in a SECOND one, and let anything in between detach the async
    // context. The second read then answers `undefined`, the hook runs INLINE — inside
    // the transaction, the exact inversion the mark was moved to avoid — while the writes
    // went to the client the first read captured.
    //
    // The detach here is real, not simulated: the callback is scheduled from the TEST's
    // context BEFORE the transaction opens, so when it runs it is genuinely outside
    // `txStorage.run` and the ambient store is empty. It registers against the captured
    // transaction, which is the only handle a correct caller keeps.
    const ran: string[] = [];
    let captured: ReturnType<typeof PrismaUnitOfWork.activeTransaction>;
    let ambientDuringRegistration: unknown = "not-read";
    let release = (): void => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const uow = new PrismaUnitOfWork(makePrisma() as never, noTenantProvider as never);

    setTimeout(() => {
      ambientDuringRegistration = PrismaUnitOfWork.getTransactionClient();
      captured?.onCommitted(() => ran.push("deferred"));
      release();
    }, 0);

    const value = await uow.executeInTransaction(async () => {
      captured = PrismaUnitOfWork.activeTransaction();
      await gate;
      assert.deepStrictEqual(ran, [], "the hook has NOT run while the transaction is open");
      return "done";
    });

    assert.strictEqual(value, "done");
    assert.strictEqual(
      ambientDuringRegistration,
      undefined,
      "the registering context really had left the transaction's scope"
    );
    assert.deepStrictEqual(ran, ["deferred"], "and the hook still ran after ITS commit");
  });

  it("logs at ERROR and drops a hook registered AFTER its transaction settled", async () => {
    // The mirror image of the hazard the captured handle removed, and expressible only
    // because the handle is now capturable: hold it past the commit and register on it.
    // The drain has already walked the list, so the hook lands somewhere nothing will
    // read again — it never runs, and the state it was to set stays unset. Silence there
    // is the same defect as running inline, pointed the other way, so the registry is
    // emptied and marked settled and a late registration meets a refusal it can be
    // alerted on. The transaction ITSELF is untouched: it committed, and no report of it
    // changes, which is why this is an ERROR log and not a throw.
    const ran: string[] = [];
    let captured: ReturnType<typeof PrismaUnitOfWork.activeTransaction>;
    const uow = new PrismaUnitOfWork(makePrisma() as never, noTenantProvider as never);

    await uow.executeInTransaction(async () => {
      captured = PrismaUnitOfWork.activeTransaction();
      captured?.onCommitted(() => ran.push("in-time"));
      return "done";
    });

    assert.deepStrictEqual(ran, ["in-time"], "the hook registered while open ran");

    captured?.onCommitted(() => ran.push("too-late"));

    assert.deepStrictEqual(
      ran,
      ["in-time"],
      "the late hook never ran — not deferred to nothing, and not inline either"
    );
    const refusal = loggedErrors.find(({ msg }) => msg?.includes("ALREADY committed"));
    assert.ok(refusal, "the drop is LOGGED at ERROR; a dropped hook must not be silent");
    assert.strictEqual(
      refusal.obj.hooksRun,
      1,
      "and it reports how many hooks that transaction did run, so the gap is countable"
    );
  });

  it("hands the transaction client and the hook list to the SAME scope", async () => {
    // The two used to be independent stores co-scoped only by one call site. They are now
    // one store reached by one read, so a context holding the client always holds the
    // hook list that belongs to it.
    let sawClient = false;
    let registered = false;
    const ran: string[] = [];
    const uow = new PrismaUnitOfWork(makePrisma() as never, noTenantProvider as never);

    await uow.executeInTransaction(async () => {
      const active = PrismaUnitOfWork.activeTransaction();
      sawClient = active?.tx !== undefined;
      active?.onCommitted(() => ran.push("deferred"));
      registered = ran.length === 0;
      return "done";
    });

    assert.ok(sawClient, "the client is visible inside the transaction");
    assert.ok(registered, "and the hook it registered was deferred, not run inline");
    assert.deepStrictEqual(ran, ["deferred"]);
  });
});
