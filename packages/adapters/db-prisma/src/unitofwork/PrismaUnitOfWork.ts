/**
 * @file PrismaUnitOfWork.ts
 * @description Prisma Unit of Work using AsyncLocalStorage to propagate the transaction
 *              client to all repositories within the same async context.
 * @layer infrastructure
 */

import { AsyncLocalStorage } from "node:async_hooks";
import type { PrismaClient } from "@infra/prisma";
import { Prisma } from "@infra/prisma";
import { resolveGucScope, runWithBoundGuc } from "@infra/prisma/extensions/tenantGuc.js";
import type { TenantContextProvider } from "@infra/prisma/extensions/tenantGuard.js";
import type { UnitOfWork } from "@core/domain/index.js";
import type { Result } from "@shared/types";
import { createLogger } from "@observability/logger";

type TxClient = Prisma.TransactionClient;

const logger = createLogger("adapter:db-prisma:unit-of-work");

/**
 * Transaction options for tuning the behaviour.
 */
export interface TransactionOptions {
  /** Maximum time (ms) to wait to acquire a transaction from the pool. Default: 5000 */
  maxWait?: number;
  /** Maximum transaction duration (ms) before the automatic rollback. Default: 30000 */
  timeout?: number;
  /** Transaction isolation level. Default: ReadCommitted */
  isolationLevel?: Prisma.TransactionIsolationLevel;
}

/**
 * Everything an async context needs to know about the transaction it is inside.
 *
 * The two halves are ONE value on purpose. They were two independent
 * `AsyncLocalStorage` instances, co-scoped only because a single call site happened to
 * enter both — so "inside the transaction but with no hook list" was a state the types
 * allowed and one edit at that call site could produce, and a hook registered in it would
 * have been silently dropped. Held together, entering one without the other is
 * unrepresentable: a context that can reach the client can always reach the hook list.
 */
export interface ActiveTransaction {
  /** The client every repository in this context must issue its statements on. */
  readonly tx: TxClient;
  /**
   * @method onCommitted
   * @description Registers work to run after THIS transaction commits, and never if it
   *   rolls back. For in-memory state, a write inside the transaction cannot be the
   *   moment that state becomes true: the statements can still be undone by what follows
   *   them and by the commit itself. An aggregate marked clean by a transaction that then
   *   rolled back is a lie the next save believes.
   *
   *   It hangs off the CAPTURED transaction rather than being a second ambient lookup,
   *   and that is the whole point. `AsyncLocalStorage.getStore()` answers for whichever
   *   context the CALLER is running in, so a caller that read the client in one ambient
   *   read and registered in another could be answered `undefined` by the second — after
   *   an `await` that resumed through a non-propagating callback, an EventEmitter, or a
   *   scheduled callback — and the hook would run INLINE, inside the very transaction it
   *   was meant to outlive, while the writes went to the client the first read captured.
   *   One read, one object, and that mixed state cannot be expressed.
   *
   *   The handle is capturable, so it can also be held too LONG. Registering after this
   *   transaction has already committed cannot be honoured — the drain has been and gone
   *   — and it is refused with an ERROR log rather than accepted into a list nothing will
   *   read again. Register while the transaction is open, which for the save that owns
   *   this seam means in the same statement sequence as the write.
   * @param hook - Work to run once this transaction has committed.
   */
  onCommitted(hook: () => void): void;
}

/**
 * The hooks awaiting a commit, and whether that commit has already been and gone.
 *
 * `settled` is `undefined` while the transaction is open and, once the drain has begun,
 * carries how many hooks it took. It is one value rather than a boolean beside a count so
 * the two cannot disagree — the same reason the client and the hook list became one value.
 */
interface HookRegistry {
  /** Emptied by the drain, so nothing it walked can be walked a second time. */
  hooks: Array<() => void>;
  settled: { readonly hooksRun: number } | undefined;
}

/**
 * What is actually held in the async context: the client, and the hook registry the drain
 * walks after the commit. `ActiveTransaction` is the face callers get; this is the state
 * behind it, kept unexported so no caller can push onto the list by another route.
 */
interface StoredTransaction {
  readonly tx: TxClient;
  readonly registry: HookRegistry;
}

/**
 * AsyncLocalStorage instance shared by every PrismaUnitOfWork instance.
 * It is static so repositories can reach the active transaction without
 * needing a direct reference to the UnitOfWork instance.
 */
const txStorage = new AsyncLocalStorage<StoredTransaction>();

/**
 * @function viewOf
 * @description The public face of a stored transaction: the client, and registration
 *   bound to THAT transaction's hook list rather than to whatever context asks later.
 * @param stored - The transaction held in the async context.
 * @returns The capturable handle callers keep.
 */
function viewOf(stored: StoredTransaction): ActiveTransaction {
  return {
    tx: stored.tx,
    onCommitted: (hook: () => void): void => {
      const { settled } = stored.registry;
      if (settled !== undefined) {
        // The handle outlived its transaction. Pushing here would put the hook on a list
        // nothing will walk again: it would never run, and the state it was to set would
        // stay unset with nothing said — the mirror image of the inline-before-commit
        // hazard, and expressible only because the handle is capturable.
        //
        // LOGGED, not thrown, and the choice is the same one the drain makes. This runs
        // in the REGISTERING caller's context, which by definition reached a commit that
        // succeeded; throwing would report that committed transaction to its caller as a
        // failure — the false negative every rule in this seam exists to avoid. The state
        // left behind is fail-closed on its own (an aggregate that stays dirty is refused
        // by the next full save), so ERROR is the loud half of a failure that already
        // stops rather than spreads.
        logger.error(
          { hooksRun: settled.hooksRun },
          "After-commit hook registered on a transaction that had ALREADY committed: it will never run, and the state it was to set stays unset"
        );
        return;
      }
      stored.registry.hooks.push(hook);
    },
  };
}

/**
 * Rollback signal for `executeResultInTransaction`, private to this module.
 *
 * An interactive Prisma transaction aborts only when its callback rejects, so a
 * `Result` whose `err` must roll back has to leave the callback as a rejection.
 * A fresh instance is created per call and compared by identity, so the signal
 * cannot be confused with a failure the work itself raised, and it is unwrapped
 * by the same method that created it: it never reaches a caller, and no
 * application code ever has to know it exists. The domain port keeps returning
 * `Result`; this is the one place where the abort is expressed as a rejection,
 * and it lives in infrastructure.
 */
class TransactionRollbackSignal extends Error {
  constructor() {
    super("PrismaUnitOfWork: rolling back because the work returned an err Result");
    this.name = "TransactionRollbackSignal";
  }
}

/**
 * PrismaUnitOfWork — Prisma implementation of the UnitOfWork port.
 *
 * Wraps `prisma.$transaction()` and uses `AsyncLocalStorage` to propagate
 * the transaction client to every repository operating in the same async
 * context.
 *
 * Repositories detect an active UoW transaction through the static
 * `PrismaUnitOfWork.getTransactionClient()` method and use the tx client
 * directly, avoiding nested transactions.
 *
 * @example
 * const uow = new PrismaUnitOfWork(prisma, tenantProvider);
 * await uow.executeInTransaction(async () => {
 *   await postRepository.save(post);       // uses the UoW tx
 *   await projectRepository.save(project); // the same UoW tx
 * });
 */
export class PrismaUnitOfWork implements UnitOfWork {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly tenantProvider: TenantContextProvider,
    private readonly defaultOptions?: TransactionOptions
  ) {}

  /**
   * Runs a function inside a Prisma interactive transaction.
   * Every repository operation inside the callback that uses
   * `PrismaUnitOfWork.getTransactionClient()` takes part in the same
   * database transaction.
   */
  async executeInTransaction<T>(fn: () => Promise<T>, options?: TransactionOptions): Promise<T> {
    const opts = { ...this.defaultOptions, ...options };
    const registry: HookRegistry = { hooks: [], settled: undefined };

    const result = await this.prisma.$transaction(
      async (tx) => {
        // RLS layer 2. Bind `app.account_id` as a transaction-local GUC
        // so the `tenant_isolation` policy on every tenant-scoped table
        // gates every statement inside this tx.
        //   - SystemContext active  → sentinel '__system__' (policy bypass).
        //   - TenantContext bound   → real accountId from the customer JWT.
        //   - Neither               → leave unset; `current_setting(...,true)`
        //                             returns NULL, RLS evaluates to false,
        //                             tenant-scoped queries return 0 rows /
        //                             reject writes (fail-closed default).
        // `set_config(name, value, is_local)` with is_local=true is the SQL
        // function form of `SET LOCAL` — scoped to this tx, auto-reset on
        // COMMIT/ROLLBACK, safe under pgbouncer/connection-pooled deploys.
        const scope = resolveGucScope(this.tenantProvider);
        if (scope !== undefined) {
          await tx.$queryRaw`SELECT set_config('app.account_id', ${scope}, true)`;
        }

        // This transaction OWNS GUC adjudication for everything inside it. The
        // marker says so to the per-operation binding, which then passes
        // operations through instead of wrapping them in transactions of their
        // own — a wrap would move the operation onto a second pooled connection,
        // where it would commit even when this transaction rolls back. Held in
        // the unbound branch too: the connection is owned either way.
        return runWithBoundGuc(scope, () => txStorage.run({ tx, registry }, fn));
      },
      {
        ...(opts.maxWait !== undefined && { maxWait: opts.maxWait }),
        ...(opts.timeout !== undefined && { timeout: opts.timeout }),
        ...(opts.isolationLevel !== undefined && { isolationLevel: opts.isolationLevel }),
      }
    );

    // Reached only when `$transaction` RESOLVED, which is the commit. A rollback —
    // including the `err` path of `executeResultInTransaction`, which aborts by
    // rejecting — leaves this unreached and every registered hook unrun.
    //
    // Each hook is ISOLATED, and both halves of that matter. A hook is someone else's
    // code: letting one throw skip the rest would apply "the transaction committed"
    // partially, and letting it propagate would report a COMMITTED transaction to its
    // caller as a failure — a caller that then retries, or tells a customer their write
    // was lost, over work the database has already kept. The transaction's outcome is
    // decided before this loop and nothing here may change it; a failing hook is logged
    // at ERROR with its position, never swallowed in silence.
    //
    // The hooks are taken OUT of the registry and the registry is marked settled before
    // any of them runs. Walking the list in place would leave it populated and accepting:
    // a handle still held after this point could push onto an array nothing will read
    // again, and a hook registered by a hook would land in the same void. Emptied and
    // marked, a late registration meets the refusal in `viewOf` instead of silence.
    const pending = registry.hooks.splice(0);
    registry.settled = { hooksRun: pending.length };
    for (const [index, hook] of pending.entries()) {
      try {
        hook();
      } catch (error: unknown) {
        logger.error(
          { err: error, hookIndex: index, hookCount: pending.length },
          "After-commit hook failed; the transaction COMMITTED and its outcome is unchanged"
        );
      }
    }
    return result;
  }

  /**
   * @method activeTransaction
   * @description The transaction this async context is inside, CAPTURED in one read.
   *
   *   Callers that need both the client and after-commit registration must take this
   *   handle and use it for both. Two ambient reads — one for the client, one to register
   *   — are not equivalent: `AsyncLocalStorage.getStore()` answers for the context the
   *   caller is in at that moment, so the second can answer `undefined` while the first
   *   returned a client, and the hook then runs inline inside the transaction it was
   *   meant to outlive. There is no ambient registration function to reach for, so that
   *   pairing is not expressible.
   *
   *   `undefined` means there is no transaction to wait for, and the CALLER decides what
   *   that means for it — the narrow save, for instance, has already committed through
   *   its own runner by then and marks directly. Deciding here would hide the difference.
   * @returns The active transaction, or undefined outside one.
   */
  static activeTransaction(): ActiveTransaction | undefined {
    const stored = txStorage.getStore();
    return stored === undefined ? undefined : viewOf(stored);
  }

  /**
   * @method executeResultInTransaction
   * @description Runs `fn` in a transaction whose outcome is decided by the `Result` it
   *   resolves to: `ok` commits, `err` rolls back and is returned unchanged, and a genuine
   *   failure raised by the work propagates untouched. Implemented ON TOP of
   *   `executeInTransaction`, so the GUC binding, the `runWithBoundGuc` marker and the
   *   AsyncLocalStorage transaction client are the same ones every repository already sees —
   *   there is no second `$transaction` call and no second way to open a unit of work.
   * @param fn - The work to run inside the transaction.
   * @returns The `Result` the work produced, with its identity preserved on both branches.
   */
  async executeResultInTransaction<T, E>(fn: () => Promise<Result<T, E>>): Promise<Result<T, E>> {
    const rollbackSignal = new TransactionRollbackSignal();
    let failure: Result<T, E> | undefined;

    try {
      return await this.executeInTransaction(async () => {
        const result = await fn();
        if (!result.ok) {
          // Captured before the rejection so the caller receives the SAME object
          // the work produced — the signal carries no payload of its own.
          failure = result;
          throw rollbackSignal;
        }
        return result;
      });
    } catch (error: unknown) {
      if (error === rollbackSignal && failure !== undefined) {
        return failure;
      }
      throw error;
    }
  }

  /**
   * Returns the active Prisma transaction client when we are inside a UoW.
   * Returns `undefined` when no transaction is active in the current async context.
   *
   * This is the main integration point for repositories, and it is enough for the ones
   * that only issue statements. A caller that ALSO needs to defer work until the commit
   * must take {@link PrismaUnitOfWork.activeTransaction} instead and use the one handle
   * for both — pairing this read with a second ambient lookup is the shape that lets the
   * two disagree.
   *
   * @example
   * const txClient = PrismaUnitOfWork.getTransactionClient();
   * if (txClient) {
   *   // Use txClient directly — we are inside a UoW
   * } else {
   *   // Open a transaction of our own, or use PrismaClient directly
   * }
   */
  static getTransactionClient(): TxClient | undefined {
    return txStorage.getStore()?.tx;
  }
}
