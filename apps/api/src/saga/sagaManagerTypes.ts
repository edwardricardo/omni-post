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
import type { EventStoreEvent } from "@shared/events";
import type { BackgroundTaskScheduler } from "@observability/background-scheduler";
import type { SemanticLockPort } from "@ports/core";
import type { EventService } from "../events/EventService";

export interface SagaManagerConfig {
  prisma: PrismaClient;
  redis: Redis;
  eventService: EventService;
  scheduler: BackgroundTaskScheduler;
  enableMetrics?: boolean;
  defaultTimeout?: number;
  maxConcurrentSagas?: number;
  /**
   * Optional semantic-lock backend (Azure > 15-20). When provided, steps
   * that declare a `semanticLock` countermeasure are gated through
   * lockStore.acquire() and released on terminal-state transitions.
   * When omitted, semanticLock declarations are silently skipped — useful
   * for tests that opt out of the concurrency check.
   */
  lockStore?: SemanticLockPort;
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
export interface SagaExecutionEnginePort {
  executeSagaAsync(sagaId: string): void;
  compensateSagaAsync(sagaId: string): void;
  persistSagaInstance(instance: SagaInstance, events?: EventStoreEvent[]): Promise<void>;
  loadSagaInstance(sagaId: string): Promise<SagaInstance | null>;
  failSaga(instance: SagaInstance, error: string): Promise<void>;
}
