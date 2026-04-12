/**
 * @file IntegrationEvent.ts
 * @description Versioned, JSON-serializable DTO for cross-process event delivery via BullMQ.
 *              Includes the toIntegrationEvent mapper from DomainEvent to this DTO.
 * @layer infrastructure
 */

import type { DomainEvent } from "../../domain/events/DomainEvent.js";

/**
 * Integration Event — serializable DTO for cross-process delivery via BullMQ.
 * All fields are JSON-safe: no Date objects, no class instances, no methods.
 * Used as BullMQ job data payload.
 */
export interface IntegrationEvent {
  /** Unique event identifier (matches domain event's eventId). Used for BullMQ job dedup. */
  readonly eventId: string;
  /** Event type discriminator (e.g., "PostCreated", "PostPublished") */
  readonly eventType: string;
  /** ID of the aggregate that emitted the event */
  readonly aggregateId: string;
  /** Type of aggregate (e.g., "Post", "Project") */
  readonly aggregateType: string;
  /** ISO 8601 timestamp of when the event occurred (string, not Date) */
  readonly occurredAt: string;
  /** Schema version for event evolution and backward compatibility */
  readonly schemaVersion: number;
  /** Serialized event payload — the event-specific data */
  readonly payload: Record<string, unknown>;
  /** Optional metadata (correlation ID, causation ID, tracing context, etc.) */
  readonly metadata: Record<string, unknown>;
  /** Source identifier for the publishing service */
  readonly source: string;
}

/** Default source identifier for this service */
const SOURCE = "omnipost-api";

/**
 * Convert a DomainEvent to an IntegrationEvent DTO.
 *
 * Extracts the serializable payload by calling `toPayload()` if available
 * (BaseDomainEvent subclasses), falling back to `metadata` for plain
 * DomainEvent objects (e.g., those reconstructed from the outbox table).
 *
 * @param domainEvent - The domain event to convert
 * @returns A fully serializable IntegrationEvent DTO
 */
export function toIntegrationEvent(domainEvent: DomainEvent): IntegrationEvent {
  // Extract payload: prefer toPayload() (rich domain events) over metadata fallback
  const payload =
    "toPayload" in domainEvent && typeof domainEvent.toPayload === "function"
      ? (domainEvent as { toPayload(): Record<string, unknown> }).toPayload()
      : (domainEvent.metadata ?? {});

  // occurredAt is always a Date in the DomainEvent interface but may arrive as
  // a Date instance (live events) or — after JSON round-trip — as a string.
  // We always normalise to ISO 8601 string.
  const occurredAt =
    domainEvent.occurredAt instanceof Date
      ? domainEvent.occurredAt.toISOString()
      : String(domainEvent.occurredAt);

  return {
    eventId: domainEvent.eventId,
    eventType: domainEvent.eventType,
    aggregateId: domainEvent.aggregateId,
    aggregateType: domainEvent.aggregateType,
    occurredAt,
    schemaVersion: domainEvent.version,
    payload,
    metadata: domainEvent.metadata ?? {},
    source: SOURCE,
  };
}
