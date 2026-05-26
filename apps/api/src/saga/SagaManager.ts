/**
 * @file SagaManager.ts
 * @description Saga manager facade composing lifecycle and execution engine into
 *              the unified SagaManagerImpl public API.
 * @layer infrastructure
 */

import type { SagaManager, SagaDefinition, SagaInstance, SagaContext } from "@shared/saga";
import type { EventStoreEvent } from "@shared/events";
import {
  SagaManagerLifecycle,
  type SagaManagerConfig,
  type SagaMetrics,
} from "./SagaManagerLifecycle.js";
import { SagaExecutionEngine } from "./SagaManagerExecution.js";

export type { SagaManagerConfig, SagaMetrics };

export class SagaManagerImpl implements SagaManager {
  private lifecycle: SagaManagerLifecycle;
  private execution: SagaExecutionEngine;

  constructor(config: SagaManagerConfig) {
    this.lifecycle = new SagaManagerLifecycle(config);
    this.execution = new SagaExecutionEngine(config, this.lifecycle);

    // Wire modules together
    this.lifecycle.executionEngine = this.execution;
  }

  async initialize(): Promise<void> {
    return this.lifecycle.initialize();
  }

  registerSaga(definition: SagaDefinition): void {
    return this.lifecycle.registerSaga(definition);
  }

  async startSaga(definitionId: string, contextData: Partial<SagaContext>): Promise<SagaInstance> {
    return this.lifecycle.startSaga(definitionId, contextData);
  }

  async continueSaga(sagaId: string): Promise<SagaInstance> {
    return this.lifecycle.continueSaga(sagaId);
  }

  async compensateSaga(sagaId: string): Promise<SagaInstance> {
    return this.lifecycle.compensateSaga(sagaId);
  }

  async getSaga(sagaId: string): Promise<SagaInstance | null> {
    return this.lifecycle.getSaga(sagaId);
  }

  async handleEvent(event: EventStoreEvent): Promise<void> {
    return this.lifecycle.handleEvent(event);
  }

  getMetrics(): SagaMetrics & { definitions: string[] } {
    return this.lifecycle.getMetrics();
  }

  async healthCheck(): Promise<{
    status: "healthy" | "unhealthy";
    details: {
      definitionsRegistered: number;
      activeInstances: number;
      database: boolean;
      redis: boolean;
    };
  }> {
    return this.lifecycle.healthCheck();
  }

  async shutdown(): Promise<void> {
    return this.lifecycle.shutdown();
  }
}
