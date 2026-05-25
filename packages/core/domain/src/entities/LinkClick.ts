/**
 * @file LinkClick.ts
 * @description Domain entity representing a single click event on a tracked link — captures referrer, geolocation, and user-agent metadata.
 * @layer domain
 */

import { type Result, ok } from "@shared/types";
import { Entity, type EntityProps } from "./Entity.js";
import { LinkClickId, TrackedLinkId } from "../value-objects/EntityId.js";

/**
 * Props for creating a LinkClick
 */
export interface LinkClickCreateProps {
  trackedLinkId: TrackedLinkId;
  referrer?: string;
  userAgent?: string;
  ipAddress?: string;
  country?: string;
  city?: string;
}

/**
 * Props for reconstituting a LinkClick from persistence
 */
export interface LinkClickProps extends EntityProps {
  id: LinkClickId;
  trackedLinkId: TrackedLinkId;
  timestamp: Date;
  referrer?: string;
  userAgent?: string;
  ipAddress?: string;
  country?: string;
  city?: string;
}

/**
 * LinkClick Entity
 *
 * Immutable record of a click event on a tracked link.
 * Captures geo and device information for analytics.
 */
export class LinkClick extends Entity<LinkClickId> {
  private readonly _trackedLinkId: TrackedLinkId;
  private readonly _timestamp: Date;
  private readonly _referrer?: string;
  private readonly _userAgent?: string;
  private readonly _ipAddress?: string;
  private readonly _country?: string;
  private readonly _city?: string;

  private constructor(props: LinkClickProps) {
    super(props.id, props.createdAt);
    this._trackedLinkId = props.trackedLinkId;
    this._timestamp = props.timestamp;
    if (props.referrer !== undefined) this._referrer = props.referrer;
    if (props.userAgent !== undefined) this._userAgent = props.userAgent;
    if (props.ipAddress !== undefined) this._ipAddress = props.ipAddress;
    if (props.country !== undefined) this._country = props.country;
    if (props.city !== undefined) this._city = props.city;
  }

  /**
   * Create a new LinkClick
   */
  static create(props: LinkClickCreateProps): Result<LinkClick, never> {
    const now = new Date();
    return ok(
      new LinkClick({
        id: LinkClickId.generate(),
        trackedLinkId: props.trackedLinkId,
        timestamp: now,
        ...(props.referrer && { referrer: props.referrer }),
        ...(props.userAgent && { userAgent: props.userAgent }),
        ...(props.ipAddress && { ipAddress: props.ipAddress }),
        ...(props.country && { country: props.country }),
        ...(props.city && { city: props.city }),
        createdAt: now,
      })
    );
  }

  /**
   * Reconstitute from persistence
   */
  static fromPersistence(props: LinkClickProps): LinkClick {
    return new LinkClick(props);
  }

  // Getters

  get trackedLinkId(): TrackedLinkId {
    return this._trackedLinkId;
  }

  get timestamp(): Date {
    return new Date(this._timestamp.getTime());
  }

  get referrer(): string | undefined {
    return this._referrer;
  }

  get userAgent(): string | undefined {
    return this._userAgent;
  }

  get ipAddress(): string | undefined {
    return this._ipAddress;
  }

  get country(): string | undefined {
    return this._country;
  }

  get city(): string | undefined {
    return this._city;
  }

  get entityType(): string {
    return "LinkClick";
  }

  /**
   * Serialize to JSON
   */
  toJSON(): Record<string, unknown> {
    return {
      id: this._id.value,
      trackedLinkId: this._trackedLinkId.value,
      timestamp: this._timestamp.toISOString(),
      referrer: this._referrer,
      userAgent: this._userAgent,
      ipAddress: this._ipAddress,
      country: this._country,
      city: this._city,
      createdAt: this._createdAt.toISOString(),
    };
  }
}
