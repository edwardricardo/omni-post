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
interface ActiveTransaction {
  /** The client every repository in this context must issue its statements on. */
  readonly tx: TxClient;
  /**
   * Work that must run only if this transaction COMMITS.
   *
   * It exists because some state lives on the in-memory aggregate rather than in the
   * database, and a write inside the transaction cannot be the moment that state becomes
   * true: the statements can still be rolled back by anything that follows them, and by
   * the commit itself. An aggregate marked clean by a transaction that then rolled back
   * is a lie the next save believes.
   */
  readonly afterCommit: Array<() => void>;
}

/**
 * AsyncLocalStorage instance shared by every PrismaUnitOfWork instance.
 * It is static so repositories can reach the active transaction without
 * needing a direct reference to the UnitOfWork instance.
 */
const txStorage = new AsyncLocalStorage<ActiveTransaction>();

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
    const afterCommit: Array<() => void> = [];

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
        return runWithBoundGuc(scope, () => txStorage.run({ tx, afterCommit }, fn));
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
    for (const [index, hook] of afterCommit.entries()) {
      try {
        hook();
      } catch (error: unknown) {
        logger.error(
          { err: error, hookIndex: index, hookCount: afterCommit.length },
          "After-commit hook failed; the transaction COMMITTED and its outcome is unchanged"
        );
      }
    }
    return result;
  }

  /**
   * @method onCommitted
   * @description Registers work to run after the ACTIVE transaction commits, and never
   *   if it rolls back. For in-memory state a write inside the transaction cannot make
   *   true: the statements can still be undone by what follows them and by the commit.
   *
   *   Outside a transaction there is nothing to wait for — the caller's own statements
   *   have already committed — so the hook runs immediately. That is the honest answer
   *   rather than a silent no-op, which would leave the state unset for every caller
   *   that does not open a unit of work.
   * @param hook - Work to run once the transaction has committed.
   */
  static onCommitted(hook: () => void): void {
    const active = txStorage.getStore();
    if (active === undefined) {
      hook();
      return;
    }
    active.afterCommit.push(hook);
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
   * This is the main integration point for repositories.
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
