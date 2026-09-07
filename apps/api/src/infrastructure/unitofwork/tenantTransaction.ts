/**
 * @file tenantTransaction.ts
 * @description The repository-side answer to nesting: join the caller's unit of work when one
 *   is open, and otherwise open a GUC-bound transaction of our own.
 *
 *   ## Why the seam does not do this by itself
 *
 *   `withGucBoundTransaction` deliberately never joins an ambient transaction. Some sites —
 *   the event store, the outbox claim loop, the saga primitives — open a transaction that
 *   commits independently of anything enclosing it, and silently enlisting them would change
 *   an atomicity guarantee behind their authors' backs. So the seam stays literal and the
 *   CALL SITE answers the question.
 *
 *   For a repository the answer is not open: the architecture canon has repositories detect
 *   the active unit-of-work transaction and use it, so that a write issued inside
 *   `executeInTransaction` rolls back with everything else the use case did. Three
 *   repositories already spelled that out inline as a ternary; this function is the same rule
 *   with a name, so a repository adopts it in one line instead of restating it.
 *
 *   The GUC needs no second thought in either branch: the unit of work binds the scope and
 *   holds the marker for its own transaction, and `withGucBoundTransaction` does both for the
 *   standalone one.
 * @layer infrastructure
 */
import type { Prisma, PrismaClient } from "@infra/prisma";
import {
  withGucBoundTransaction,
  type GucTransactionOptions,
} from "@infra/prisma/extensions/tenantGuc.js";
import { getAmbientGucScope } from "../../security/tenantContext.js";
import { PrismaUnitOfWork } from "./PrismaUnitOfWork.js";

type TxClient = Prisma.TransactionClient;

/**
 * @function withTenantTransaction
 * @description Runs `fn` on the active unit-of-work transaction when one is open; otherwise
 *   opens a transaction bound to the ambient tenant scope and runs `fn` on that.
 * @param prisma - The client a standalone transaction is opened on.
 * @param fn - Callback receiving the transaction client to issue writes on.
 * @param options - Transaction bounds, applied only when this call opens the transaction. An
 *   active unit of work already fixed its own bounds, and re-declaring them there would be a
 *   silent no-op rather than a setting.
 * @returns Whatever `fn` returns.
 */
export async function withTenantTransaction<T>(
  prisma: PrismaClient,
  fn: (tx: TxClient) => Promise<T>,
  options?: GucTransactionOptions
): Promise<T> {
  const activeTx = PrismaUnitOfWork.getTransactionClient();
  if (activeTx) {
    return fn(activeTx);
  }
  return withGucBoundTransaction(prisma, getAmbientGucScope(), fn, options);
}
