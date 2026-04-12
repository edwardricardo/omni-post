/**
 * @file PrismaUnitOfWork.ts
 * @description Prisma Unit of Work using AsyncLocalStorage to propagate the transaction
 *              client to all repositories within the same async context.
 * @layer infrastructure
 */

import { AsyncLocalStorage } from "node:async_hooks";
import type { PrismaClient } from "@infra/prisma";
import { Prisma } from "@infra/prisma";
import type { UnitOfWork } from "../../domain/index.js";

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

    return this.prisma.$transaction(async (tx) => txStorage.run(tx, fn), {
      ...(opts.maxWait !== undefined && { maxWait: opts.maxWait }),
      ...(opts.timeout !== undefined && { timeout: opts.timeout }),
      ...(opts.isolationLevel !== undefined && { isolationLevel: opts.isolationLevel }),
    });
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
