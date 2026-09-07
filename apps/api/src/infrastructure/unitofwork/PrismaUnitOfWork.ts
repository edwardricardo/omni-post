/**
 * @file PrismaUnitOfWork.ts
 * @description Prisma Unit of Work using AsyncLocalStorage to propagate the transaction
 *              client to all repositories within the same async context.
 * @layer infrastructure
 */

import { AsyncLocalStorage } from "node:async_hooks";
import type { PrismaClient } from "@infra/prisma";
import { Prisma } from "@infra/prisma";
import { runWithBoundGuc } from "@infra/prisma/extensions/tenantGuc.js";
import type { UnitOfWork } from "@core/domain/index.js";
import { getAmbientGucScope } from "../../security/tenantContext.js";

type TxClient = Prisma.TransactionClient;

/**
 * Opciones de transacción para ajustar el comportamiento.
 */
export interface TransactionOptions {
  /** Tiempo máximo (ms) para esperar adquirir una transacción del pool. Por defecto: 5000 */
  maxWait?: number;
  /** Duración máxima de la transacción (ms) antes del rollback automático. Por defecto: 30000 */
  timeout?: number;
  /** Nivel de aislamiento de la transacción. Por defecto: ReadCommitted */
  isolationLevel?: Prisma.TransactionIsolationLevel;
}

/**
 * Instancia de AsyncLocalStorage compartida por todas las instancias de PrismaUnitOfWork.
 * Es estática para que los repositorios puedan acceder a la transacción activa
 * sin necesidad de una referencia directa a la instancia de UnitOfWork.
 */
const txStorage = new AsyncLocalStorage<TxClient>();

/**
 * PrismaUnitOfWork — Implementación Prisma del puerto UnitOfWork.
 *
 * Envuelve `prisma.$transaction()` y usa `AsyncLocalStorage` para propagar
 * el cliente de transacción a todos los repositorios que operan en el mismo
 * contexto async.
 *
 * Los repositorios detectan una transacción UoW activa mediante el método
 * estático `PrismaUnitOfWork.getTransactionClient()` y usan el cliente tx
 * directamente, evitando transacciones anidadas.
 *
 * @example
 * const uow = new PrismaUnitOfWork(prisma);
 * await uow.executeInTransaction(async () => {
 *   await postRepository.save(post);       // usa la tx del UoW
 *   await projectRepository.save(project); // misma tx del UoW
 * });
 */
export class PrismaUnitOfWork implements UnitOfWork {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly defaultOptions?: TransactionOptions
  ) {}

  /**
   * Ejecuta una función dentro de una transacción interactiva de Prisma.
   * Todas las operaciones de repositorio dentro del callback que usen
   * `PrismaUnitOfWork.getTransactionClient()` participarán en la misma
   * transacción de base de datos.
   */
  async executeInTransaction<T>(fn: () => Promise<T>, options?: TransactionOptions): Promise<T> {
    const opts = { ...this.defaultOptions, ...options };

    return this.prisma.$transaction(
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
        const scope = getAmbientGucScope();
        if (scope !== undefined) {
          await tx.$queryRaw`SELECT set_config('app.account_id', ${scope}, true)`;
        }

        // This transaction OWNS GUC adjudication for everything inside it. The
        // marker says so to the per-operation binding, which then passes
        // operations through instead of wrapping them in transactions of their
        // own — a wrap would move the operation onto a second pooled connection,
        // where it would commit even when this transaction rolls back. Held in
        // the unbound branch too: the connection is owned either way.
        return runWithBoundGuc(scope, () => txStorage.run(tx, fn));
      },
      {
        ...(opts.maxWait !== undefined && { maxWait: opts.maxWait }),
        ...(opts.timeout !== undefined && { timeout: opts.timeout }),
        ...(opts.isolationLevel !== undefined && { isolationLevel: opts.isolationLevel }),
      }
    );
  }

  /**
   * Obtiene el cliente de transacción Prisma activo si estamos dentro de un UoW.
   * Devuelve `undefined` si no hay ninguna transacción activa en el contexto async actual.
   *
   * Este es el punto de integración principal para los repositorios.
   *
   * @example
   * const txClient = PrismaUnitOfWork.getTransactionClient();
   * if (txClient) {
   *   // Usar txClient directamente — estamos dentro de un UoW
   * } else {
   *   // Crear propia transacción o usar PrismaClient directamente
   * }
   */
  static getTransactionClient(): TxClient | undefined {
    return txStorage.getStore();
  }
}
