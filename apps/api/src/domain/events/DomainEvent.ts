/**
 * @file DomainEvent.ts
 * @description Base domain event interface, abstract event class, handler contract, and in-memory event dispatcher for aggregate lifecycle notifications.
 * @layer domain
 */

import { randomUUID } from "crypto";

/**
 * Base interface for all domain events
 */
export interface DomainEvent {
  readonly eventId: string;
  readonly eventType: string;
  readonly aggregateId: string;
  readonly aggregateType: string;
  readonly occurredAt: Date;
  readonly version: number;
  readonly metadata?: Record<string, unknown>;
}

/**
 * Base class for domain events
 */
export abstract class BaseDomainEvent implements DomainEvent {
  readonly eventId: string;
  readonly occurredAt: Date;
  readonly version: number;

  abstract readonly eventType: string;
  abstract readonly aggregateId: string;
  abstract readonly aggregateType: string;

  protected constructor(version: number = 1, metadata?: Record<string, unknown>) {
    this.eventId = randomUUID();
    this.occurredAt = new Date();
    this.version = version;
    if (metadata) {
      (this as { metadata?: Record<string, unknown> }).metadata = metadata;
    }
  }

  /**
   * Get event payload for serialization
   */
  abstract toPayload(): Record<string, unknown>;

  /**
   * Serialize event to JSON
   */
  toJSON(): Record<string, unknown> {
    return {
      eventId: this.eventId,
      eventType: this.eventType,
      aggregateId: this.aggregateId,
      aggregateType: this.aggregateType,
      occurredAt: this.occurredAt.toISOString(),
      version: this.version,
      payload: this.toPayload(),
    };
  }
}

/**
 * Event handler interface
 */
export interface DomainEventHandler<T extends DomainEvent> {
  handle(event: T): Promise<void>;
}

/**
 * Event dispatcher interface
 */
export interface EventDispatcher {
  dispatch(event: DomainEvent): Promise<void>;
  dispatchAll(events: DomainEvent[]): Promise<void>;
  register<T extends DomainEvent>(eventType: string, handler: DomainEventHandler<T>): void;
}

/**
 * Simple in-memory event dispatcher for domain events
 */
export class InMemoryEventDispatcher implements EventDispatcher {
  private handlers: Map<string, DomainEventHandler<DomainEvent>[]> = new Map();

  register<T extends DomainEvent>(eventType: string, handler: DomainEventHandler<T>): void {
    const existing = this.handlers.get(eventType) ?? [];
    existing.push(handler as DomainEventHandler<DomainEvent>);
    this.handlers.set(eventType, existing);
  }

  async dispatch(event: DomainEvent): Promise<void> {
    const handlers = this.handlers.get(event.eventType) ?? [];
    await Promise.all(handlers.map((handler) => handler.handle(event)));
  }

  async dispatchAll(events: DomainEvent[]): Promise<void> {
    for (const event of events) {
      await this.dispatch(event);
    }
  }
}
