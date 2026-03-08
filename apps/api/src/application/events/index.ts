/**
 * Application Layer - Events Module
 *
 * Types for Event/CQRS/Saga integration.
 * Note: Use case wrappers (PublishDomainEvent, DispatchCommand, DispatchQuery,
 * StartWorkflow) were removed — the underlying infrastructure services
 * (EventService, CQRSBus, SagaManager) should be used directly.
 */

// Types
export type {
  EventMetadata,
  BatchEventItem,
  PublishEventInput,
  PublishEventOutput,
  DispatchCommandInput,
  DispatchCommandOutput,
  DispatchQueryInput,
  DispatchQueryOutput,
  QueryMetadata,
  StartWorkflowInput,
  StartWorkflowOutput,
  WorkflowStatus,
} from "./types.js";
