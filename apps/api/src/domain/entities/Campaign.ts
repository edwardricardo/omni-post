/**
 * @file Campaign.ts
 * @description Campaign entity for grouping posts by marketing campaign.
 *   Supports lifecycle management (DRAFT→ACTIVE→PAUSED→COMPLETED→ARCHIVED)
 *   and optional UTM parameters for link tracking.
 * @layer domain
 */

import { type Result, ok, err } from "@shared/types";
import { Entity, type EntityProps } from "./Entity.js";
import { CampaignId, ProjectId } from "../value-objects/EntityId.js";
import { CampaignStatus, type CampaignStatusValue } from "../value-objects/CampaignStatus.js";
import { DomainError, InvalidValueError } from "../errors/index.js";

/**
 * Props for creating a new Campaign
 */
export interface CampaignCreateProps {
  projectId: ProjectId;
  name: string;
  description?: string;
  startDate?: Date;
  endDate?: Date;
  utmSource?: string;
  utmMedium?: string;
}

/**
 * Props for reconstituting a Campaign from persistence
 */
export interface CampaignProps extends EntityProps {
  id: CampaignId;
  projectId: ProjectId;
  name: string;
  description?: string;
  status: CampaignStatus;
  startDate?: Date;
  endDate?: Date;
  utmSource?: string;
  utmMedium?: string;
}

/**
 * Domain event: Campaign was created
 */
export class CampaignCreated {
  readonly aggregateId: string;
  readonly occurredAt: Date;
  readonly name: string;
  readonly projectId: string;

  constructor(campaignId: string, projectId: string, name: string) {
    this.aggregateId = campaignId;
    this.occurredAt = new Date();
    this.name = name;
    this.projectId = projectId;
  }
}

/**
 * Domain event: Campaign was activated
 */
export class CampaignActivated {
  readonly aggregateId: string;
  readonly occurredAt: Date;

  constructor(campaignId: string) {
    this.aggregateId = campaignId;
    this.occurredAt = new Date();
  }
}

/**
 * Domain event: Campaign was completed
 */
export class CampaignCompleted {
  readonly aggregateId: string;
  readonly occurredAt: Date;

  constructor(campaignId: string) {
    this.aggregateId = campaignId;
    this.occurredAt = new Date();
  }
}

/**
 * Domain event: Campaign was archived
 */
export class CampaignArchived {
  readonly aggregateId: string;
  readonly occurredAt: Date;

  constructor(campaignId: string) {
    this.aggregateId = campaignId;
    this.occurredAt = new Date();
  }
}

/**
 * Domain event: Post was tagged with a campaign
 */
export class PostTaggedWithCampaign {
  readonly aggregateId: string;
  readonly occurredAt: Date;
  readonly postId: string;

  constructor(campaignId: string, postId: string) {
    this.aggregateId = campaignId;
    this.occurredAt = new Date();
    this.postId = postId;
  }
}

/**
 * Domain event: Post was untagged from a campaign
 */
export class PostUntaggedFromCampaign {
  readonly aggregateId: string;
  readonly occurredAt: Date;
  readonly postId: string;

  constructor(campaignId: string, postId: string) {
    this.aggregateId = campaignId;
    this.occurredAt = new Date();
    this.postId = postId;
  }
}

export type CampaignEvent =
  | CampaignCreated
  | CampaignActivated
  | CampaignCompleted
  | CampaignArchived
  | PostTaggedWithCampaign
  | PostUntaggedFromCampaign;

/**
 * @class Campaign
 * @description Entity representing a marketing campaign that groups posts.
 *   Manages lifecycle state transitions and optional UTM parameters.
 */
export class Campaign extends Entity<CampaignId> {
  private readonly _projectId: ProjectId;
  private _name: string;
  private _description?: string;
  private _status: CampaignStatus;
  private _startDate?: Date;
  private _endDate?: Date;
  private _utmSource?: string;
  private _utmMedium?: string;

  private constructor(props: CampaignProps) {
    super(props.id, props.createdAt);
    this._projectId = props.projectId;
    this._name = props.name;
    if (props.description !== undefined) {
      this._description = props.description;
    }
    this._status = props.status;
    if (props.startDate !== undefined) {
      this._startDate = props.startDate;
    }
    if (props.endDate !== undefined) {
      this._endDate = props.endDate;
    }
    if (props.utmSource !== undefined) {
      this._utmSource = props.utmSource;
    }
    if (props.utmMedium !== undefined) {
      this._utmMedium = props.utmMedium;
    }
  }

  /**
   * @method create
   * @description Create a new Campaign entity with validation.
   */
  static create(props: CampaignCreateProps): Result<Campaign, DomainError> {
    if (!props.name || props.name.trim().length === 0) {
      return err(new InvalidValueError("Campaign.name", props.name, "Name must not be empty"));
    }

    if (
      props.startDate !== undefined &&
      props.endDate !== undefined &&
      props.endDate <= props.startDate
    ) {
      return err(
        new InvalidValueError(
          "Campaign.endDate",
          props.endDate.toISOString(),
          "End date must be after start date"
        )
      );
    }

    const campaign = new Campaign({
      id: CampaignId.generate(),
      projectId: props.projectId,
      name: props.name.trim(),
      ...(props.description !== undefined && { description: props.description }),
      status: CampaignStatus.draft(),
      ...(props.startDate !== undefined && { startDate: props.startDate }),
      ...(props.endDate !== undefined && { endDate: props.endDate }),
      ...(props.utmSource !== undefined && { utmSource: props.utmSource }),
      ...(props.utmMedium !== undefined && { utmMedium: props.utmMedium }),
    });

    return ok(campaign);
  }

  /**
   * @method fromPersistence
   * @description Reconstitute a Campaign from persistence.
   */
  static fromPersistence(props: CampaignProps): Campaign {
    return new Campaign(props);
  }

  // Getters

  get projectId(): ProjectId {
    return this._projectId;
  }

  get name(): string {
    return this._name;
  }

  get description(): string | undefined {
    return this._description;
  }

  get status(): CampaignStatus {
    return this._status;
  }

  get startDate(): Date | undefined {
    return this._startDate;
  }

  get endDate(): Date | undefined {
    return this._endDate;
  }

  get utmSource(): string | undefined {
    return this._utmSource;
  }

  get utmMedium(): string | undefined {
    return this._utmMedium;
  }

  get entityType(): string {
    return "Campaign";
  }

  // Commands

  /**
   * @method activate
   * @description Transition campaign to ACTIVE status.
   */
  activate(): Result<void, DomainError> {
    const result = this._status.transitionTo("ACTIVE" as CampaignStatusValue);
    if (!result.ok) {
      return err(result.error);
    }
    this._status = result.value;
    this.markUpdated();
    return ok(undefined);
  }

  /**
   * @method pause
   * @description Transition campaign to PAUSED status.
   */
  pause(): Result<void, DomainError> {
    const result = this._status.transitionTo("PAUSED" as CampaignStatusValue);
    if (!result.ok) {
      return err(result.error);
    }
    this._status = result.value;
    this.markUpdated();
    return ok(undefined);
  }

  /**
   * @method complete
   * @description Transition campaign to COMPLETED status.
   */
  complete(): Result<void, DomainError> {
    const result = this._status.transitionTo("COMPLETED" as CampaignStatusValue);
    if (!result.ok) {
      return err(result.error);
    }
    this._status = result.value;
    this.markUpdated();
    return ok(undefined);
  }

  /**
   * @method archive
   * @description Transition campaign to ARCHIVED status.
   */
  archive(): Result<void, DomainError> {
    const result = this._status.transitionTo("ARCHIVED" as CampaignStatusValue);
    if (!result.ok) {
      return err(result.error);
    }
    this._status = result.value;
    this.markUpdated();
    return ok(undefined);
  }

  /**
   * @method updateDetails
   * @description Update campaign name, description, dates, and UTM params.
   */
  updateDetails(updates: {
    name?: string;
    description?: string;
    startDate?: Date;
    endDate?: Date;
    utmSource?: string;
    utmMedium?: string;
  }): Result<void, DomainError> {
    if (updates.name !== undefined) {
      if (updates.name.trim().length === 0) {
        return err(new InvalidValueError("Campaign.name", updates.name, "Name must not be empty"));
      }
      this._name = updates.name.trim();
    }

    const effectiveStart = updates.startDate !== undefined ? updates.startDate : this._startDate;
    const effectiveEnd = updates.endDate !== undefined ? updates.endDate : this._endDate;

    if (
      effectiveStart !== undefined &&
      effectiveEnd !== undefined &&
      effectiveEnd <= effectiveStart
    ) {
      return err(
        new InvalidValueError(
          "Campaign.endDate",
          String(effectiveEnd),
          "End date must be after start date"
        )
      );
    }

    if (updates.description !== undefined) {
      this._description = updates.description;
    }
    if (updates.startDate !== undefined) {
      this._startDate = updates.startDate;
    }
    if (updates.endDate !== undefined) {
      this._endDate = updates.endDate;
    }
    if (updates.utmSource !== undefined) {
      this._utmSource = updates.utmSource;
    }
    if (updates.utmMedium !== undefined) {
      this._utmMedium = updates.utmMedium;
    }

    this.markUpdated();
    return ok(undefined);
  }

  /**
   * @method toJSON
   * @description Serialize to plain object.
   */
  toJSON(): Record<string, unknown> {
    return {
      id: this._id.value,
      projectId: this._projectId.value,
      name: this._name,
      ...(this._description !== undefined && { description: this._description }),
      status: this._status.value,
      ...(this._startDate !== undefined && { startDate: this._startDate.toISOString() }),
      ...(this._endDate !== undefined && { endDate: this._endDate.toISOString() }),
      ...(this._utmSource !== undefined && { utmSource: this._utmSource }),
      ...(this._utmMedium !== undefined && { utmMedium: this._utmMedium }),
      createdAt: this._createdAt.toISOString(),
      updatedAt: this._updatedAt.toISOString(),
    };
  }
}
