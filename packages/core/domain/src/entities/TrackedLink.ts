/**
 * @file TrackedLink.ts
 * @description Domain entity representing a shortened/tracked URL with UTM parameters, click counting, and expiration support.
 * @layer domain
 */

import { type Result, ok, err } from "@shared/types";
import { Entity, type EntityProps } from "./Entity.js";
import { TrackedLinkId, ProjectId } from "../value-objects/EntityId.js";
import { ShortCode } from "../value-objects/ShortCode.js";
import { UTMParameters } from "../value-objects/UTMParameters.js";
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
  accountId: string;
  projectId: ProjectId;
  originalUrl: string;
  vanitySlug?: string;
}

/**
 * Props for reconstituting a TrackedLink from persistence
 */
export interface TrackedLinkProps extends EntityProps {
  id: TrackedLinkId;
  accountId: string;
  projectId: ProjectId;
  originalUrl: string;
  shortCode: ShortCode;
  vanitySlug?: string;
  clicks: number;
  isActive: boolean;
  utmSource?: string;
  utmMedium?: string;
  utmCampaign?: string;
  utmContent?: string;
  utmTerm?: string;
  campaignId?: string;
}

/**
 * TrackedLink Entity
 *
 * Represents a URL that is being tracked for analytics.
 * Supports both auto-generated short codes and custom vanity slugs.
 */
export class TrackedLink extends Entity<TrackedLinkId> {
  private readonly _accountId: string;
  private readonly _projectId: ProjectId;
  private readonly _originalUrl: string;
  private readonly _shortCode: ShortCode;
  private readonly _vanitySlug?: string;
  private _clicks: number;
  private _isActive: boolean;
  private _utmSource?: string;
  private _utmMedium?: string;
  private _utmCampaign?: string;
  private _utmContent?: string;
  private _utmTerm?: string;
  private _campaignId?: string;

  private constructor(props: TrackedLinkProps) {
    super(props.id, props.createdAt);
    this._accountId = props.accountId;
    this._projectId = props.projectId;
    this._originalUrl = props.originalUrl;
    this._shortCode = props.shortCode;
    if (props.vanitySlug !== undefined) {
      this._vanitySlug = props.vanitySlug;
    }
    this._clicks = props.clicks;
    this._isActive = props.isActive;
    if (props.utmSource !== undefined) {
      this._utmSource = props.utmSource;
    }
    if (props.utmMedium !== undefined) {
      this._utmMedium = props.utmMedium;
    }
    if (props.utmCampaign !== undefined) {
      this._utmCampaign = props.utmCampaign;
    }
    if (props.utmContent !== undefined) {
      this._utmContent = props.utmContent;
    }
    if (props.utmTerm !== undefined) {
      this._utmTerm = props.utmTerm;
    }
    if (props.campaignId !== undefined) {
      this._campaignId = props.campaignId;
    }
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
        accountId: props.accountId,
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

  /**
   * @description Owning account id, denormalized from the parent project.
   *   Server-derived and tenant-scoping only — never exposed via `toJSON`.
   */
  get accountId(): string {
    return this._accountId;
  }

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

  get utmSource(): string | undefined {
    return this._utmSource;
  }

  get utmMedium(): string | undefined {
    return this._utmMedium;
  }

  get utmCampaign(): string | undefined {
    return this._utmCampaign;
  }

  get utmContent(): string | undefined {
    return this._utmContent;
  }

  get utmTerm(): string | undefined {
    return this._utmTerm;
  }

  get campaignId(): string | undefined {
    return this._campaignId;
  }

  // Commands

  /**
   * @method setUTMParameters
   * @description Sets UTM tracking parameters on this link from a UTMParameters value object.
   * @param params - Validated UTMParameters value object
   */
  setUTMParameters(params: UTMParameters): void {
    this._utmSource = params.source;
    this._utmMedium = params.medium;
    this._utmCampaign = params.campaign;
    if (params.content !== undefined) {
      this._utmContent = params.content;
    }
    if (params.term !== undefined) {
      this._utmTerm = params.term;
    }
    this.markUpdated();
  }

  /**
   * @method setCampaignId
   * @description Associates this link with a campaign.
   * @param campaignId - The campaign ID string
   */
  setCampaignId(campaignId: string): void {
    this._campaignId = campaignId;
    this.markUpdated();
  }

  /**
   * @method getUTMUrl
   * @description Returns the original URL with UTM parameters appended,
   *   or just the original URL if no UTM parameters are set.
   * @returns The URL string with or without UTM parameters
   */
  getUTMUrl(): string {
    if (this._utmSource && this._utmMedium && this._utmCampaign) {
      const utmResult = UTMParameters.create({
        source: this._utmSource,
        medium: this._utmMedium,
        campaign: this._utmCampaign,
        ...(this._utmContent !== undefined && { content: this._utmContent }),
        ...(this._utmTerm !== undefined && { term: this._utmTerm }),
      });
      if (utmResult.ok) {
        return utmResult.value.buildUrl(this._originalUrl);
      }
    }
    return this._originalUrl;
  }

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
      ...(this._utmSource !== undefined && { utmSource: this._utmSource }),
      ...(this._utmMedium !== undefined && { utmMedium: this._utmMedium }),
      ...(this._utmCampaign !== undefined && { utmCampaign: this._utmCampaign }),
      ...(this._utmContent !== undefined && { utmContent: this._utmContent }),
      ...(this._utmTerm !== undefined && { utmTerm: this._utmTerm }),
      ...(this._campaignId !== undefined && { campaignId: this._campaignId }),
      createdAt: this._createdAt.toISOString(),
      updatedAt: this._updatedAt.toISOString(),
    };
  }
}
