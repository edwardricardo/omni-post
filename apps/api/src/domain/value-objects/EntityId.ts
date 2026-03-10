/**
 * Domain Layer - Base Entity Identifier
 *
 * Part of Sprint 3: DDD Architecture Implementation
 * Provides a strongly-typed base class for all entity identifiers.
 */

import { randomUUID } from "crypto";
import { type Result, ok, err } from "@shared/types";
import { InvalidIdError } from "../errors/index.js";

// UUID v4 validation regex
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Base class for strongly-typed entity identifiers
 *
 * @example
 * class PostId extends EntityId {
 *   protected entityType = 'PostId';
 * }
 */
export abstract class EntityId {
  protected abstract readonly entityType: string;
  protected readonly _value: string;

  protected constructor(value: string) {
    this._value = value;
  }

  /**
   * Get the raw string value of the identifier
   */
  get value(): string {
    return this._value;
  }

  /**
   * Convert to string representation
   */
  toString(): string {
    return this._value;
  }

  /**
   * Check equality with another identifier
   */
  equals(other: EntityId): boolean {
    if (other === null || other === undefined) {
      return false;
    }
    if (this.entityType !== other.entityType) {
      return false;
    }
    return this._value === other._value;
  }

  /**
   * Validate a UUID string format
   */
  protected static isValidUUID(value: string): boolean {
    return UUID_REGEX.test(value);
  }

  /**
   * Generate a new UUID
   */
  protected static generateUUID(): string {
    return randomUUID();
  }

  /**
   * JSON serialization
   */
  toJSON(): string {
    return this._value;
  }
}

/**
 * PostId - Strongly-typed identifier for Post entities
 */
export class PostId extends EntityId {
  protected readonly entityType = "PostId";

  private constructor(value: string) {
    super(value);
  }

  /**
   * Generate a new PostId
   */
  static generate(): PostId {
    return new PostId(EntityId.generateUUID());
  }

  /**
   * Create PostId from an existing string value
   */
  static fromString(id: string): Result<PostId, InvalidIdError> {
    if (!id || id.trim().length === 0) {
      return err(new InvalidIdError("PostId", id));
    }
    if (!EntityId.isValidUUID(id)) {
      return err(new InvalidIdError("PostId", id));
    }
    return ok(new PostId(id));
  }

  /**
   * Create PostId without validation (use only when id is known to be valid)
   */
  static fromStringUnsafe(id: string): PostId {
    return new PostId(id);
  }
}

/**
 * ChannelId - Strongly-typed identifier for Channel entities
 */
export class ChannelId extends EntityId {
  protected readonly entityType = "ChannelId";

  private constructor(value: string) {
    super(value);
  }

  static generate(): ChannelId {
    return new ChannelId(EntityId.generateUUID());
  }

  static fromString(id: string): Result<ChannelId, InvalidIdError> {
    if (!id || id.trim().length === 0) {
      return err(new InvalidIdError("ChannelId", id));
    }
    if (!EntityId.isValidUUID(id)) {
      return err(new InvalidIdError("ChannelId", id));
    }
    return ok(new ChannelId(id));
  }

  static fromStringUnsafe(id: string): ChannelId {
    return new ChannelId(id);
  }
}

/**
 * AccountId - Strongly-typed identifier for Account entities
 */
export class AccountId extends EntityId {
  protected readonly entityType = "AccountId";

  private constructor(value: string) {
    super(value);
  }

  static generate(): AccountId {
    return new AccountId(EntityId.generateUUID());
  }

  static fromString(id: string): Result<AccountId, InvalidIdError> {
    if (!id || id.trim().length === 0) {
      return err(new InvalidIdError("AccountId", id));
    }
    if (!EntityId.isValidUUID(id)) {
      return err(new InvalidIdError("AccountId", id));
    }
    return ok(new AccountId(id));
  }

  static fromStringUnsafe(id: string): AccountId {
    return new AccountId(id);
  }
}

/**
 * ProjectId - Strongly-typed identifier for Project entities
 */
export class ProjectId extends EntityId {
  protected readonly entityType = "ProjectId";

  private constructor(value: string) {
    super(value);
  }

  static generate(): ProjectId {
    return new ProjectId(EntityId.generateUUID());
  }

  static fromString(id: string): Result<ProjectId, InvalidIdError> {
    if (!id || id.trim().length === 0) {
      return err(new InvalidIdError("ProjectId", id));
    }
    if (!EntityId.isValidUUID(id)) {
      return err(new InvalidIdError("ProjectId", id));
    }
    return ok(new ProjectId(id));
  }

  static fromStringUnsafe(id: string): ProjectId {
    return new ProjectId(id);
  }
}

/**
 * ContentId - Strongly-typed identifier for Content versions
 */
export class ContentId extends EntityId {
  protected readonly entityType = "ContentId";

  private constructor(value: string) {
    super(value);
  }

  static generate(): ContentId {
    return new ContentId(EntityId.generateUUID());
  }

  static fromString(id: string): Result<ContentId, InvalidIdError> {
    if (!id || id.trim().length === 0) {
      return err(new InvalidIdError("ContentId", id));
    }
    if (!EntityId.isValidUUID(id)) {
      return err(new InvalidIdError("ContentId", id));
    }
    return ok(new ContentId(id));
  }

  static fromStringUnsafe(id: string): ContentId {
    return new ContentId(id);
  }
}

/**
 * MediaId - Strongly-typed identifier for Media entities
 */
export class MediaId extends EntityId {
  protected readonly entityType = "MediaId";

  private constructor(value: string) {
    super(value);
  }

  static generate(): MediaId {
    return new MediaId(EntityId.generateUUID());
  }

  static fromString(id: string): Result<MediaId, InvalidIdError> {
    if (!id || id.trim().length === 0) {
      return err(new InvalidIdError("MediaId", id));
    }
    if (!EntityId.isValidUUID(id)) {
      return err(new InvalidIdError("MediaId", id));
    }
    return ok(new MediaId(id));
  }

  static fromStringUnsafe(id: string): MediaId {
    return new MediaId(id);
  }
}

/**
 * TrackedLinkId - Strongly-typed identifier for TrackedLink entities
 * Part of Sprint 19: Link Tracking Feature
 */
export class TrackedLinkId extends EntityId {
  protected readonly entityType = "TrackedLinkId";

  private constructor(value: string) {
    super(value);
  }

  static generate(): TrackedLinkId {
    return new TrackedLinkId(EntityId.generateUUID());
  }

  static fromString(id: string): Result<TrackedLinkId, InvalidIdError> {
    if (!id || id.trim().length === 0) {
      return err(new InvalidIdError("TrackedLinkId", id));
    }
    if (!EntityId.isValidUUID(id)) {
      return err(new InvalidIdError("TrackedLinkId", id));
    }
    return ok(new TrackedLinkId(id));
  }

  static fromStringUnsafe(id: string): TrackedLinkId {
    return new TrackedLinkId(id);
  }
}

/**
 * LinkClickId - Strongly-typed identifier for LinkClick entities
 * Part of Sprint 19: Link Tracking Feature
 */
export class LinkClickId extends EntityId {
  protected readonly entityType = "LinkClickId";

  private constructor(value: string) {
    super(value);
  }

  static generate(): LinkClickId {
    return new LinkClickId(EntityId.generateUUID());
  }

  static fromString(id: string): Result<LinkClickId, InvalidIdError> {
    if (!id || id.trim().length === 0) {
      return err(new InvalidIdError("LinkClickId", id));
    }
    if (!EntityId.isValidUUID(id)) {
      return err(new InvalidIdError("LinkClickId", id));
    }
    return ok(new LinkClickId(id));
  }

  static fromStringUnsafe(id: string): LinkClickId {
    return new LinkClickId(id);
  }
}

/**
 * CampaignId - Strongly-typed identifier for Campaign entities
 * Part of Phase 3: Analytics & Reporting
 */
export class CampaignId extends EntityId {
  protected readonly entityType = "CampaignId";

  private constructor(value: string) {
    super(value);
  }

  static generate(): CampaignId {
    return new CampaignId(EntityId.generateUUID());
  }

  static fromString(id: string): Result<CampaignId, InvalidIdError> {
    if (!id || id.trim().length === 0) {
      return err(new InvalidIdError("CampaignId", id));
    }
    if (!EntityId.isValidUUID(id)) {
      return err(new InvalidIdError("CampaignId", id));
    }
    return ok(new CampaignId(id));
  }

  static fromStringUnsafe(id: string): CampaignId {
    return new CampaignId(id);
  }
}

/**
 * ScheduledReportId - Strongly-typed identifier for ScheduledReport entities
 * Part of Phase 3: Analytics & Reporting
 */
export class ScheduledReportId extends EntityId {
  protected readonly entityType = "ScheduledReportId";

  private constructor(value: string) {
    super(value);
  }

  static generate(): ScheduledReportId {
    return new ScheduledReportId(EntityId.generateUUID());
  }

  static fromString(id: string): Result<ScheduledReportId, InvalidIdError> {
    if (!id || id.trim().length === 0) {
      return err(new InvalidIdError("ScheduledReportId", id));
    }
    if (!EntityId.isValidUUID(id)) {
      return err(new InvalidIdError("ScheduledReportId", id));
    }
    return ok(new ScheduledReportId(id));
  }

  static fromStringUnsafe(id: string): ScheduledReportId {
    return new ScheduledReportId(id);
  }
}

/**
 * RecurringPostId - Strongly-typed identifier for RecurringPost entities
 * Part of Recurring Posts feature
 */
export class RecurringPostId extends EntityId {
  protected readonly entityType = "RecurringPostId";

  private constructor(value: string) {
    super(value);
  }

  static generate(): RecurringPostId {
    return new RecurringPostId(EntityId.generateUUID());
  }

  static fromString(id: string): Result<RecurringPostId, InvalidIdError> {
    if (!id || id.trim().length === 0) {
      return err(new InvalidIdError("RecurringPostId", id));
    }
    if (!EntityId.isValidUUID(id)) {
      return err(new InvalidIdError("RecurringPostId", id));
    }
    return ok(new RecurringPostId(id));
  }

  static fromStringUnsafe(id: string): RecurringPostId {
    return new RecurringPostId(id);
  }
}
