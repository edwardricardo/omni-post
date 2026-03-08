/**
 * @file sagaManagerTypes.ts
 * @description Shared type definitions for the Saga Manager.
 * Extracted to break the circular dependency between
 * SagaManagerLifecycle.ts and SagaManagerExecution.ts.
 *
 * @module saga/sagaManagerTypes
 */

import type { PrismaClient } from "@infra/prisma";
import type Redis from "ioredis";
import type { SagaInstance } from "@shared/saga";
import type { EventService } from "../events/EventService";

export interface SagaManagerConfig {
  prisma: PrismaClient;
  redis: Redis;
  eventService: EventService;
  enableMetrics?: boolean;
  defaultTimeout?: number;
  maxConcurrentSagas?: number;
}

export interface SagaMetrics {
  sagasStarted: number;
  sagasCompleted: number;
  sagasFailed: number;
  sagasCompensated: number;
  averageExecutionTime: number;
  activeInstances: number;
}

/**
 * Interface for the execution engine used by SagaManagerLifecycle.
 * Defined here (in sagaManagerTypes.ts) so that SagaManagerLifecycle.ts
 * does NOT need to import SagaManagerExecution.ts directly, breaking the
 * mutual import cycle between those two files.
 */
export interface ISagaExecutionEngine {
  executeSagaAsync(sagaId: string): void;
  compensateSagaAsync(sagaId: string): void;
  persistSagaInstance(instance: SagaInstance): Promise<void>;
  loadSagaInstance(sagaId: string): Promise<SagaInstance | null>;
  failSaga(instance: SagaInstance, error: string): Promise<void>;
}
