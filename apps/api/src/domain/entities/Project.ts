/**
 * Domain Layer - Project Entity
 *
 * Part of Sprint 4: DDD Architecture Implementation
 * Updated Sprint 19: Added Crisis Mode support
 * Represents a project that contains posts and channels.
 */

import { type Result, ok, err } from "@shared/types";
import { AggregateRoot } from "../aggregates/AggregateRoot.js";
import { type EntityProps } from "./Entity.js";
import { ProjectId, AccountId, ChannelId, PostId } from "../value-objects/EntityId.js";
import { type ContentLocale, CONTENT_LOCALES } from "../value-objects/Content.js";
import { InvalidValueError, InvariantViolationError } from "../errors/index.js";
import { CrisisModeEntered, CrisisModeExited } from "../events/ProjectEvents.js";

/**
 * Crisis mode history entry
 */
export interface CrisisModeEntry {
  reason: string;
  startedAt: Date;
  endedAt?: Date;
}

/**
 * Project construction properties
 */
export interface ProjectProps extends EntityProps {
  accountId: AccountId;
  name: string;
  locale?: ContentLocale;
  description?: string;
  channelIds?: ChannelId[];
  postIds?: PostId[];
  isInCrisisMode?: boolean;
  crisisStartedAt?: Date;
  crisisReason?: string;
  crisisModeHistory?: CrisisModeEntry[];
}

/**
 * Project creation input
 */
export interface CreateProjectInput {
  accountId: AccountId;
  name: string;
  locale?: ContentLocale;
  description?: string;
}

/**
 * Project statistics
 */
export interface ProjectStats {
  channelCount: number;
  postCount: number;
  draftCount: number;
  scheduledCount: number;
  publishedCount: number;
}

/**
 * Project - Domain entity representing a content project
 *
 * Invariants:
 * - Name cannot be empty
 * - Name must be unique within an account (enforced at repository level)
 * - Locale must be a valid supported locale
 *
 * @example
 * const result = Project.create({
 *   accountId: accountId,
 *   name: 'Marketing Campaign Q1',
 *   locale: 'en'
 * });
 */
export class Project extends AggregateRoot<ProjectId> {
  private readonly _accountId: AccountId;
  private _name: string;
  private _locale: ContentLocale;
  private _description: string | undefined;
  private readonly _channelIds: ChannelId[];
  private readonly _postIds: PostId[];

  // Stats (these are maintained by the aggregate/repository)
  private _draftCount: number;
  private _scheduledCount: number;
  private _publishedCount: number;

  // Crisis Mode (Sprint 19)
  private _isInCrisisMode: boolean;
  private _crisisStartedAt: Date | undefined;
  private _crisisReason: string | undefined;
  private _crisisModeHistory: CrisisModeEntry[];

  private constructor(id: ProjectId, props: ProjectProps) {
    super(id, props.createdAt);
    this._accountId = props.accountId;
    this._name = props.name;
    this._locale = props.locale ?? "en";
    this._description = props.description;
    this._channelIds = props.channelIds ?? [];
    this._postIds = props.postIds ?? [];
    this._draftCount = 0;
    this._scheduledCount = 0;
    this._publishedCount = 0;

    // Crisis mode initialization
    this._isInCrisisMode = props.isInCrisisMode ?? false;
    this._crisisStartedAt = props.crisisStartedAt;
    this._crisisReason = props.crisisReason;
    this._crisisModeHistory = props.crisisModeHistory ?? [];

    if (props.updatedAt) {
      this._updatedAt = props.updatedAt;
    }
  }

  /**
   * Factory method to create a new Project
   */
  static create(input: CreateProjectInput): Result<Project, InvalidValueError> {
    // Validate name
    if (!input.name || input.name.trim().length === 0) {
      return err(new InvalidValueError("name", input.name, "Project name cannot be empty"));
    }

    if (input.name.trim().length > 100) {
      return err(
        new InvalidValueError("name", input.name, "Project name cannot exceed 100 characters")
      );
    }

    // Validate locale
    const locale = input.locale ?? "en";
    if (!CONTENT_LOCALES.includes(locale)) {
      return err(
        new InvalidValueError(
          "locale",
          locale,
          `Invalid locale. Valid locales: ${CONTENT_LOCALES.join(", ")}`
        )
      );
    }

    const trimmedDescription = input.description?.trim();
    return ok(
      new Project(ProjectId.generate(), {
        accountId: input.accountId,
        name: input.name.trim(),
        locale,
        ...(trimmedDescription !== undefined &&
          trimmedDescription.length > 0 && { description: trimmedDescription }),
      })
    );
  }

  /**
   * Reconstruct a Project from persistence
   */
  static reconstitute(
    id: ProjectId,
    props: ProjectProps & {
      draftCount?: number;
      scheduledCount?: number;
      publishedCount?: number;
    }
  ): Project {
    const project = new Project(id, props);
    project._draftCount = props.draftCount ?? 0;
    project._scheduledCount = props.scheduledCount ?? 0;
    project._publishedCount = props.publishedCount ?? 0;
    return project;
  }

  // Getters

  get entityType(): string {
    return "Project";
  }

  get accountId(): AccountId {
    return this._accountId;
  }

  get name(): string {
    return this._name;
  }

  get locale(): ContentLocale {
    return this._locale;
  }

  get description(): string | undefined {
    return this._description;
  }

  get channelIds(): readonly ChannelId[] {
    return [...this._channelIds];
  }

  get postIds(): readonly PostId[] {
    return [...this._postIds];
  }

  get channelCount(): number {
    return this._channelIds.length;
  }

  get postCount(): number {
    return this._postIds.length;
  }

  /**
   * Get project statistics
   */
  get stats(): ProjectStats {
    return {
      channelCount: this._channelIds.length,
      postCount: this._postIds.length,
      draftCount: this._draftCount,
      scheduledCount: this._scheduledCount,
      publishedCount: this._publishedCount,
    };
  }

  /**
   * Check if project has any channels
   */
  get hasChannels(): boolean {
    return this._channelIds.length > 0;
  }

  /**
   * Check if project has any posts
   */
  get hasPosts(): boolean {
    return this._postIds.length > 0;
  }

  // Crisis Mode Getters (Sprint 19)

  /**
   * Check if project is currently in crisis mode
   */
  get isInCrisisMode(): boolean {
    return this._isInCrisisMode;
  }

  /**
   * Get the time when crisis mode started
   */
  get crisisStartedAt(): Date | undefined {
    return this._crisisStartedAt ? new Date(this._crisisStartedAt.getTime()) : undefined;
  }

  /**
   * Get the reason for crisis mode
   */
  get crisisReason(): string | undefined {
    return this._crisisReason;
  }

  /**
   * Get crisis mode history
   */
  get crisisModeHistory(): readonly CrisisModeEntry[] {
    return [...this._crisisModeHistory];
  }

  /**
   * Get crisis duration in milliseconds (if in crisis mode)
   */
  get crisisDurationMs(): number | undefined {
    if (!this._isInCrisisMode || !this._crisisStartedAt) {
      return undefined;
    }
    return Date.now() - this._crisisStartedAt.getTime();
  }

  // Domain behavior

  /**
   * Update project name
   */
  updateName(newName: string): Result<void, InvalidValueError> {
    if (!newName || newName.trim().length === 0) {
      return err(new InvalidValueError("name", newName, "Project name cannot be empty"));
    }

    if (newName.trim().length > 100) {
      return err(
        new InvalidValueError("name", newName, "Project name cannot exceed 100 characters")
      );
    }

    this._name = newName.trim();
    this.markUpdated();

    return ok(undefined);
  }

  /**
   * Update project description
   */
  updateDescription(description: string | undefined): void {
    this._description = description?.trim();
    this.markUpdated();
  }

  /**
   * Update project locale
   */
  updateLocale(locale: ContentLocale): Result<void, InvalidValueError> {
    if (!CONTENT_LOCALES.includes(locale)) {
      return err(
        new InvalidValueError(
          "locale",
          locale,
          `Invalid locale. Valid locales: ${CONTENT_LOCALES.join(", ")}`
        )
      );
    }

    this._locale = locale;
    this.markUpdated();

    return ok(undefined);
  }

  /**
   * Add a channel to the project
   */
  addChannel(channelId: ChannelId): Result<void, InvariantViolationError> {
    // Check if channel already exists
    if (this._channelIds.some((id) => id.equals(channelId))) {
      return err(new InvariantViolationError("Channel already exists in project"));
    }

    this._channelIds.push(channelId);
    this.markUpdated();

    return ok(undefined);
  }

  /**
   * Remove a channel from the project
   */
  removeChannel(channelId: ChannelId): boolean {
    const index = this._channelIds.findIndex((id) => id.equals(channelId));
    if (index !== -1) {
      this._channelIds.splice(index, 1);
      this.markUpdated();
      return true;
    }
    return false;
  }

  /**
   * Check if project has a specific channel
   */
  hasChannel(channelId: ChannelId): boolean {
    return this._channelIds.some((id) => id.equals(channelId));
  }

  /**
   * Add a post to the project
   */
  addPost(postId: PostId): Result<void, InvariantViolationError> {
    if (this._postIds.some((id) => id.equals(postId))) {
      return err(new InvariantViolationError("Post already exists in project"));
    }

    this._postIds.push(postId);
    this._draftCount += 1; // New posts start as drafts
    this.markUpdated();

    return ok(undefined);
  }

  /**
   * Remove a post from the project
   */
  removePost(postId: PostId): boolean {
    const index = this._postIds.findIndex((id) => id.equals(postId));
    if (index !== -1) {
      this._postIds.splice(index, 1);
      this.markUpdated();
      return true;
    }
    return false;
  }

  /**
   * Check if project has a specific post
   */
  hasPost(postId: PostId): boolean {
    return this._postIds.some((id) => id.equals(postId));
  }

  /**
   * Update post counts (called when post status changes)
   */
  updatePostCounts(counts: { drafts: number; scheduled: number; published: number }): void {
    this._draftCount = counts.drafts;
    this._scheduledCount = counts.scheduled;
    this._publishedCount = counts.published;
  }

  /**
   * Record a post status change
   */
  recordPostStatusChange(fromStatus: string, toStatus: string): void {
    // Decrement old status count
    if (fromStatus === "DRAFT") this._draftCount = Math.max(0, this._draftCount - 1);
    else if (fromStatus === "SCHEDULED")
      this._scheduledCount = Math.max(0, this._scheduledCount - 1);
    else if (fromStatus === "PUBLISHED")
      this._publishedCount = Math.max(0, this._publishedCount - 1);

    // Increment new status count
    if (toStatus === "DRAFT") this._draftCount += 1;
    else if (toStatus === "SCHEDULED") this._scheduledCount += 1;
    else if (toStatus === "PUBLISHED") this._publishedCount += 1;
  }

  // Crisis Mode Methods (Sprint 19)

  /**
   * Enter crisis mode - pauses all scheduled posts
   * @param reason The reason for entering crisis mode
   * @returns true if entered, false if already in crisis mode
   */
  enterCrisisMode(reason: string): boolean {
    if (this._isInCrisisMode) {
      return false; // Already in crisis mode
    }

    const now = new Date();
    this._isInCrisisMode = true;
    this._crisisStartedAt = now;
    this._crisisReason = reason;

    // Add to history
    this._crisisModeHistory.push({
      reason,
      startedAt: now,
    });

    // Emit domain event
    this.addDomainEvent(new CrisisModeEntered(this._id.value, reason, now));

    this.markUpdated();
    return true;
  }

  /**
   * Exit crisis mode - allows scheduled posts to resume
   * @returns true if exited, false if not in crisis mode
   */
  exitCrisisMode(): boolean {
    if (!this._isInCrisisMode || !this._crisisStartedAt) {
      return false; // Not in crisis mode
    }

    const now = new Date();
    const startedAt = this._crisisStartedAt;
    const reason = this._crisisReason ?? "Unknown";
    const durationMs = now.getTime() - startedAt.getTime();

    // Update the last history entry with end time
    const lastEntry = this._crisisModeHistory[this._crisisModeHistory.length - 1];
    if (lastEntry) {
      lastEntry.endedAt = now;
    }

    // Clear crisis state
    this._isInCrisisMode = false;
    this._crisisStartedAt = undefined;
    this._crisisReason = undefined;

    // Emit domain event
    this.addDomainEvent(new CrisisModeExited(this._id.value, reason, startedAt, now, durationMs));

    this.markUpdated();
    return true;
  }

  toJSON(): Record<string, unknown> {
    return {
      id: this._id.toString(),
      accountId: this._accountId.toString(),
      name: this._name,
      locale: this._locale,
      ...(this._description && { description: this._description }),
      channelIds: this._channelIds.map((id) => id.toString()),
      postIds: this._postIds.map((id) => id.toString()),
      stats: this.stats,
      isInCrisisMode: this._isInCrisisMode,
      ...(this._crisisStartedAt && { crisisStartedAt: this._crisisStartedAt.toISOString() }),
      ...(this._crisisReason && { crisisReason: this._crisisReason }),
      crisisModeHistory: this._crisisModeHistory.map((entry) => ({
        reason: entry.reason,
        startedAt: entry.startedAt.toISOString(),
        ...(entry.endedAt && { endedAt: entry.endedAt.toISOString() }),
      })),
      createdAt: this._createdAt.toISOString(),
      updatedAt: this._updatedAt.toISOString(),
    };
  }
}
