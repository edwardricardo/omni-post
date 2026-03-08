/**
 * Application Layer - Event/CQRS/Saga Use Cases Types
 *
 * Part of Sprint 10: TDD Implementation
 * Type definitions for Event/CQRS/Saga integration use cases.
 */

/**
 * Event metadata
 */
export interface EventMetadata {
  userId?: string;
  source?: string;
  correlationId?: string;
  causationId?: string;
  sessionId?: string;
}

/**
 * Batch event item
 */
export interface BatchEventItem {
  eventType: string;
  aggregateId: string;
  aggregateType: string;
  data: Record<string, unknown>;
  metadata?: EventMetadata;
}

// ============ PublishEvent Types ============

export interface PublishEventInput {
  eventType: string;
  aggregateId: string;
  aggregateType: string;
  data: Record<string, unknown>;
  metadata?: EventMetadata;
  batch?: BatchEventItem[];
}

export interface PublishEventOutput {
  eventId: string;
  published: boolean;
  correlationId?: string;
  batchSize?: number;
  timestamp: Date;
}

// ============ DispatchCommand Types ============

export interface DispatchCommandInput {
  commandType: string;
  payload: Record<string, unknown>;
  correlationId?: string;
  userId?: string;
  metadata?: Record<string, unknown>;
}

export interface DispatchCommandOutput {
  success: boolean;
  data?: unknown;
  error?: string;
  correlationId?: string;
  userId?: string;
  executionTime?: number;
  events?: unknown[];
}

// ============ DispatchQuery Types ============

export interface DispatchQueryInput {
  queryType: string;
  payload: Record<string, unknown>;
  enableCache?: boolean;
  cacheTtl?: number;
  cacheKey?: string;
}

export interface QueryMetadata {
  fromCache?: boolean;
  executionTime?: number;
  totalCount?: number;
  page?: number;
  limit?: number;
}

export interface DispatchQueryOutput {
  success: boolean;
  data?: unknown;
  error?: string;
  fromCache?: boolean;
  metadata?: QueryMetadata;
}

// ============ StartWorkflow Types ============

export type WorkflowStatus =
  | "PENDING"
  | "RUNNING"
  | "COMPLETED"
  | "FAILED"
  | "COMPENSATING"
  | "COMPENSATED";

export interface StartWorkflowInput {
  workflowType: string;
  context: Record<string, unknown>;
  userId?: string;
  correlationId?: string;
  metadata?: Record<string, unknown>;
}

export interface StartWorkflowOutput {
  workflowId: string;
  workflowType: string;
  status: WorkflowStatus;
  correlationId?: string;
  startedAt: Date;
}
