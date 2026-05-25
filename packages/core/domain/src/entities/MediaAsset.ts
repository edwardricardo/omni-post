/**
 * @file MediaAsset.ts
 * @description MediaAsset entity for the asset library. Supports tagging,
 *   folder organization, and usage tracking.
 * @layer domain
 */

import { type Result, ok, err } from "@shared/types";
import { Entity, type EntityProps } from "./Entity.js";
import { EntityId } from "../value-objects/EntityId.js";
import { InvalidValueError } from "../errors/index.js";

/**
 * Strongly-typed ID for MediaAsset, extending the base EntityId.
 */
export class MediaAssetId extends EntityId {
  protected readonly entityType = "MediaAssetId";

  private constructor(value: string) {
    super(value);
  }

  /**
   * @method generate
   * @description Creates a new MediaAssetId with a random UUID.
   */
  static generate(): MediaAssetId {
    return new MediaAssetId(EntityId.generateUUID());
  }

  /**
   * @method fromString
   * @description Creates a MediaAssetId from an existing string value.
   * @param id - The raw string identifier
   * @returns Result with the MediaAssetId, or InvalidValueError if empty
   */
  static fromString(id: string): Result<MediaAssetId, InvalidValueError> {
    if (!id || id.trim().length === 0) {
      return err(new InvalidValueError("MediaAssetId", id, "MediaAssetId cannot be empty"));
    }
    return ok(new MediaAssetId(id));
  }

  /**
   * @method fromStringUnsafe
   * @description Creates a MediaAssetId without validation (for DB reconstitution).
   * @param id - The raw string identifier from the database
   */
  static fromStringUnsafe(id: string): MediaAssetId {
    return new MediaAssetId(id);
  }
}

/**
 * Props for creating a new MediaAsset
 */
export interface MediaAssetCreateProps {
  accountId: string;
  projectId?: string;
  name: string;
  description?: string;
  url: string;
  storageKey: string;
  mimeType: string;
  sizeBytes: number;
  width?: number;
  height?: number;
  duration?: number;
  folderId?: string;
}

/**
 * Props for reconstituting a MediaAsset from persistence
 */
export interface MediaAssetProps extends EntityProps {
  id: MediaAssetId;
  accountId: string;
  projectId?: string;
  name: string;
  description?: string;
  url: string;
  storageKey: string;
  mimeType: string;
  sizeBytes: number;
  width?: number;
  height?: number;
  duration?: number;
  usageCount: number;
  folderId?: string;
  tagIds: string[];
  deletedAt?: Date;
}

/**
 * MediaAsset entity — manages media files in the asset library.
 */
export class MediaAsset extends Entity<MediaAssetId> {
  private _accountId: string;
  private _projectId: string | undefined;
  private _name: string;
  private _description: string | undefined;
  private _url: string;
  private _storageKey: string;
  private _mimeType: string;
  private _sizeBytes: number;
  private _width: number | undefined;
  private _height: number | undefined;
  private _duration: number | undefined;
  private _usageCount: number;
  private _folderId: string | undefined;
  private _tagIds: string[];
  private _deletedAt: Date | undefined;

  private constructor(id: MediaAssetId, props: MediaAssetProps) {
    super(id, props.createdAt);
    this._accountId = props.accountId;
    this._projectId = props.projectId;
    this._name = props.name;
    this._description = props.description;
    this._url = props.url;
    this._storageKey = props.storageKey;
    this._mimeType = props.mimeType;
    this._sizeBytes = props.sizeBytes;
    this._width = props.width;
    this._height = props.height;
    this._duration = props.duration;
    this._usageCount = props.usageCount;
    this._folderId = props.folderId;
    this._tagIds = [...props.tagIds];
    this._deletedAt = props.deletedAt;
  }

  static create(input: MediaAssetCreateProps): Result<MediaAsset, InvalidValueError> {
    if (!input.name || input.name.trim().length === 0) {
      return err(new InvalidValueError("name", input.name, "Asset name cannot be empty"));
    }
    if (!input.url || input.url.trim().length === 0) {
      return err(new InvalidValueError("url", input.url, "Asset URL cannot be empty"));
    }
    if (!input.mimeType || input.mimeType.trim().length === 0) {
      return err(
        new InvalidValueError("mimeType", input.mimeType, "Asset mimeType cannot be empty")
      );
    }
    if (input.sizeBytes < 0) {
      return err(
        new InvalidValueError("sizeBytes", input.sizeBytes, "Asset size cannot be negative")
      );
    }

    const id = MediaAssetId.generate();
    const now = new Date();

    return ok(
      new MediaAsset(id, {
        id,
        accountId: input.accountId,
        ...(input.projectId !== undefined && { projectId: input.projectId }),
        name: input.name.trim(),
        ...(input.description !== undefined && { description: input.description }),
        url: input.url,
        storageKey: input.storageKey,
        mimeType: input.mimeType,
        sizeBytes: input.sizeBytes,
        ...(input.width !== undefined && { width: input.width }),
        ...(input.height !== undefined && { height: input.height }),
        ...(input.duration !== undefined && { duration: input.duration }),
        usageCount: 0,
        ...(input.folderId !== undefined && { folderId: input.folderId }),
        tagIds: [],
        createdAt: now,
      })
    );
  }

  static reconstitute(props: MediaAssetProps): MediaAsset {
    return new MediaAsset(props.id, props);
  }

  get entityType(): string {
    return "MediaAsset";
  }

  get accountId(): string {
    return this._accountId;
  }

  get projectId(): string | undefined {
    return this._projectId;
  }

  get name(): string {
    return this._name;
  }

  get description(): string | undefined {
    return this._description;
  }

  get url(): string {
    return this._url;
  }

  get storageKey(): string {
    return this._storageKey;
  }

  get mimeType(): string {
    return this._mimeType;
  }

  get sizeBytes(): number {
    return this._sizeBytes;
  }

  get width(): number | undefined {
    return this._width;
  }

  get height(): number | undefined {
    return this._height;
  }

  get duration(): number | undefined {
    return this._duration;
  }

  get usageCount(): number {
    return this._usageCount;
  }

  get folderId(): string | undefined {
    return this._folderId;
  }

  get tagIds(): readonly string[] {
    return [...this._tagIds];
  }

  get deletedAt(): Date | undefined {
    return this._deletedAt;
  }

  get isImage(): boolean {
    return this._mimeType.startsWith("image/");
  }

  get isVideo(): boolean {
    return this._mimeType.startsWith("video/");
  }

  updateName(name: string): Result<void, InvalidValueError> {
    if (!name || name.trim().length === 0) {
      return err(new InvalidValueError("name", name, "Asset name cannot be empty"));
    }
    this._name = name.trim();
    this.markUpdated();
    return ok(undefined);
  }

  updateDescription(description: string | undefined): void {
    this._description = description;
    this.markUpdated();
  }

  moveTo(folderId: string | undefined): void {
    this._folderId = folderId;
    this.markUpdated();
  }

  incrementUsage(): void {
    this._usageCount += 1;
    this.markUpdated();
  }

  setTags(tagIds: string[]): void {
    this._tagIds = [...new Set(tagIds)];
    this.markUpdated();
  }

  addTag(tagId: string): void {
    if (!this._tagIds.includes(tagId)) {
      this._tagIds.push(tagId);
      this.markUpdated();
    }
  }

  removeTag(tagId: string): void {
    const idx = this._tagIds.indexOf(tagId);
    if (idx !== -1) {
      this._tagIds.splice(idx, 1);
      this.markUpdated();
    }
  }

  softDelete(): void {
    this._deletedAt = new Date();
    this.markUpdated();
  }

  toJSON(): Record<string, unknown> {
    return {
      id: this._id.value,
      accountId: this._accountId,
      ...(this._projectId !== undefined && { projectId: this._projectId }),
      name: this._name,
      ...(this._description !== undefined && { description: this._description }),
      url: this._url,
      storageKey: this._storageKey,
      mimeType: this._mimeType,
      sizeBytes: this._sizeBytes,
      ...(this._width !== undefined && { width: this._width }),
      ...(this._height !== undefined && { height: this._height }),
      ...(this._duration !== undefined && { duration: this._duration }),
      usageCount: this._usageCount,
      ...(this._folderId !== undefined && { folderId: this._folderId }),
      tagIds: [...this._tagIds],
      createdAt: this._createdAt.toISOString(),
      updatedAt: this._updatedAt.toISOString(),
      ...(this._deletedAt !== undefined && { deletedAt: this._deletedAt.toISOString() }),
    };
  }
}
