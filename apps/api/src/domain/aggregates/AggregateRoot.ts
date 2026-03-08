/**
 * Domain Layer - Aggregate Root Base Class
 *
 * Part of Sprint 5: DDD Architecture Implementation
 * Aggregates are clusters of domain objects that can be treated as a single unit.
 */

import { Entity } from "../entities/Entity.js";
import { EntityId } from "../value-objects/EntityId.js";
import { type DomainEvent } from "../events/DomainEvent.js";

/**
 * Base class for aggregate roots
 *
 * An aggregate is a cluster of domain objects that can be treated as a single unit.
 * The aggregate root is the entry point to the aggregate - all operations go through it.
 *
 * Key responsibilities:
 * - Enforce invariants across the aggregate
 * - Collect domain events for later dispatch
 * - Provide transactional consistency boundary
 *
 * @typeParam TId - The type of entity identifier
 */
export abstract class AggregateRoot<TId extends EntityId> extends Entity<TId> {
  private _domainEvents: DomainEvent[] = [];
  private _version: number = 0;

  protected constructor(id: TId, createdAt?: Date, version: number = 0) {
    super(id, createdAt);
    this._version = version;
  }

  /**
   * Get the aggregate version (for optimistic locking)
   */
  get version(): number {
    return this._version;
  }

  /**
   * Get uncommitted domain events
   */
  get domainEvents(): readonly DomainEvent[] {
    return [...this._domainEvents];
  }

  /**
   * Add a domain event to be dispatched
   */
  protected addDomainEvent(event: DomainEvent): void {
    this._domainEvents.push(event);
  }

  /**
   * Clear all domain events (called after successful persistence)
   */
  clearDomainEvents(): void {
    this._domainEvents = [];
  }

  /**
   * Increment version (called after successful persistence)
   */
  incrementVersion(): void {
    this._version += 1;
  }

  /**
   * Check if aggregate has uncommitted events
   */
  hasUncommittedEvents(): boolean {
    return this._domainEvents.length > 0;
  }

  /**
   * Get count of uncommitted events
   */
  get uncommittedEventCount(): number {
    return this._domainEvents.length;
  }
}

/**
 * Interface for aggregate snapshots (for event sourcing)
 */
export interface AggregateSnapshot<T> {
  aggregateId: string;
  version: number;
  state: T;
  createdAt: Date;
}
