/**
 * Domain Layer - TrackedLink Entity
 *
 * Part of Sprint 19: Link Tracking Feature
 * Represents a shortened/tracked URL with analytics.
 */

import { type Result, ok, err } from "@shared/types";
import { Entity, type EntityProps } from "./Entity.js";
import { TrackedLinkId, ProjectId } from "../value-objects/EntityId.js";
import { ShortCode } from "../value-objects/ShortCode.js";
import { DomainError } from "../errors/index.js";

/**
 * Error for invalid URL
 */
class InvalidUrlError extends DomainError {
  constructor(url: string) {
    super(`Invalid URL: ${url}`, "INVALID_URL");
  }
}

/**
 * Props for creating a TrackedLink
 */
export interface TrackedLinkCreateProps {
  projectId: ProjectId;
  originalUrl: string;
  vanitySlug?: string;
}

/**
 * Props for reconstituting a TrackedLink from persistence
 */
export interface TrackedLinkProps extends EntityProps {
  id: TrackedLinkId;
  projectId: ProjectId;
  originalUrl: string;
  shortCode: ShortCode;
  vanitySlug?: string;
  clicks: number;
  isActive: boolean;
}

/**
 * TrackedLink Entity
 *
 * Represents a URL that is being tracked for analytics.
 * Supports both auto-generated short codes and custom vanity slugs.
 */
export class TrackedLink extends Entity<TrackedLinkId> {
  private readonly _projectId: ProjectId;
  private readonly _originalUrl: string;
  private readonly _shortCode: ShortCode;
  private readonly _vanitySlug?: string;
  private _clicks: number;
  private _isActive: boolean;

  private constructor(props: TrackedLinkProps) {
    super(props.id, props.createdAt);
    this._projectId = props.projectId;
    this._originalUrl = props.originalUrl;
    this._shortCode = props.shortCode;
    if (props.vanitySlug !== undefined) {
      this._vanitySlug = props.vanitySlug;
    }
    this._clicks = props.clicks;
    this._isActive = props.isActive;
  }

  /**
   * Create a new TrackedLink
   */
  static create(props: TrackedLinkCreateProps): Result<TrackedLink, InvalidUrlError> {
    // Validate URL
    if (!TrackedLink.isValidUrl(props.originalUrl)) {
      return err(new InvalidUrlError(props.originalUrl));
    }

    // Generate or validate short code
    let shortCode: ShortCode;
    if (props.vanitySlug) {
      const result = ShortCode.fromString(props.vanitySlug);
      if (!result.ok) {
        return err(new InvalidUrlError(`Invalid vanity slug: ${props.vanitySlug}`));
      }
      shortCode = result.value;
    } else {
      shortCode = ShortCode.generate();
    }

    return ok(
      new TrackedLink({
        id: TrackedLinkId.generate(),
        projectId: props.projectId,
        originalUrl: props.originalUrl,
        shortCode,
        ...(props.vanitySlug && { vanitySlug: props.vanitySlug }),
        clicks: 0,
        isActive: true,
      })
    );
  }

  /**
   * Reconstitute from persistence
   */
  static fromPersistence(props: TrackedLinkProps): TrackedLink {
    return new TrackedLink(props);
  }

  /**
   * Validate URL format
   */
  private static isValidUrl(url: string): boolean {
    try {
      const parsed = new URL(url);
      return parsed.protocol === "http:" || parsed.protocol === "https:";
    } catch {
      return false;
    }
  }

  // Getters

  get projectId(): ProjectId {
    return this._projectId;
  }

  get originalUrl(): string {
    return this._originalUrl;
  }

  get shortCode(): ShortCode {
    return this._shortCode;
  }

  get vanitySlug(): string | undefined {
    return this._vanitySlug;
  }

  get clicks(): number {
    return this._clicks;
  }

  get isActive(): boolean {
    return this._isActive;
  }

  get entityType(): string {
    return "TrackedLink";
  }

  /**
   * Get the effective short code (vanity or generated)
   */
  get effectiveCode(): string {
    return this._vanitySlug ?? this._shortCode.value;
  }

  // Commands

  /**
   * Record a click on this link
   */
  recordClick(): void {
    this._clicks += 1;
    this.markUpdated();
  }

  /**
   * Deactivate the link (stops redirects)
   */
  deactivate(): void {
    this._isActive = false;
    this.markUpdated();
  }

  /**
   * Reactivate the link
   */
  activate(): void {
    this._isActive = true;
    this.markUpdated();
  }

  /**
   * Serialize to JSON
   */
  toJSON(): Record<string, unknown> {
    return {
      id: this._id.value,
      projectId: this._projectId.value,
      originalUrl: this._originalUrl,
      shortCode: this._shortCode.value,
      vanitySlug: this._vanitySlug,
      clicks: this._clicks,
      isActive: this._isActive,
      createdAt: this._createdAt.toISOString(),
      updatedAt: this._updatedAt.toISOString(),
    };
  }
}
