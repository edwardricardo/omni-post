/**
 * Domain Layer - Base Entity Class
 *
 * Part of Sprint 4: DDD Architecture Implementation
 * Provides the base class for all domain entities.
 *
 * Entities are objects with identity that persists over time.
 * Two entities are equal if they have the same identity, regardless of attributes.
 */

import { EntityId } from "../value-objects/EntityId.js";

/**
 * Base class for all domain entities
 *
 * @typeParam TId - The type of entity identifier (extends EntityId)
 *
 * @example
 * class Post extends Entity<PostId> {
 *   constructor(id: PostId, props: PostProps) {
 *     super(id);
 *     // ...
 *   }
 * }
 */
export abstract class Entity<TId extends EntityId> {
  protected readonly _id: TId;
  protected readonly _createdAt: Date;
  protected _updatedAt: Date;

  protected constructor(id: TId, createdAt?: Date) {
    this._id = id;
    this._createdAt = createdAt ?? new Date();
    this._updatedAt = this._createdAt;
  }

  /**
   * Get the entity's unique identifier
   */
  get id(): TId {
    return this._id;
  }

  /**
   * Get the creation timestamp
   */
  get createdAt(): Date {
    return new Date(this._createdAt.getTime());
  }

  /**
   * Get the last update timestamp
   */
  get updatedAt(): Date {
    return new Date(this._updatedAt.getTime());
  }

  /**
   * Check equality based on identity
   * Two entities are equal if they have the same ID
   */
  equals(other: Entity<TId> | null | undefined): boolean {
    if (other === null || other === undefined) {
      return false;
    }
    if (this === other) {
      return true;
    }
    return this._id.equals(other._id);
  }

  /**
   * Mark entity as updated (for internal use)
   */
  protected markUpdated(): void {
    this._updatedAt = new Date();
  }

  /**
   * Get entity type name (for logging and debugging)
   */
  abstract get entityType(): string;

  /**
   * Convert to a plain object for serialization
   */
  abstract toJSON(): Record<string, unknown>;
}

/**
 * Props that all entities share
 */
export interface EntityProps {
  createdAt?: Date;
  updatedAt?: Date;
}

/**
 * Audit information for entities
 */
export interface AuditInfo {
  createdAt: Date;
  updatedAt: Date;
  createdBy?: string;
  updatedBy?: string;
}
