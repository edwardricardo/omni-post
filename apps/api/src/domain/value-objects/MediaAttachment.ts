/**
 * Domain Layer - MediaAttachment Value Object
 *
 * Part of Sprint 3: DDD Architecture Implementation
 * Represents an immutable media attachment with validation.
 */

import { type Result, ok, err } from "@shared/types";
import { InvalidValueError, EmptyValueError } from "../errors/index.js";
import { MediaId } from "./EntityId.js";

/**
 * Supported media types
 */
export const MEDIA_TYPES = ["image", "video", "gif"] as const;
export type MediaType = (typeof MEDIA_TYPES)[number];

/**
 * Platform-specific media constraints
 */
const PLATFORM_MEDIA_CONSTRAINTS = {
  X: {
    maxImages: 4,
    maxVideoDurationMs: 140000, // 140 seconds
    maxFileSizeBytes: 512 * 1024 * 1024, // 512MB for video
    supportedTypes: ["image", "video", "gif"] as MediaType[],
    maxImageSizeBytes: 5 * 1024 * 1024, // 5MB
    minWidth: 600,
    maxWidth: 4096,
    minHeight: 335,
    maxHeight: 4096,
  },
  INSTAGRAM: {
    maxImages: 10,
    maxVideoDurationMs: 60000, // 60 seconds for feed
    maxFileSizeBytes: 100 * 1024 * 1024, // 100MB
    supportedTypes: ["image", "video"] as MediaType[],
    maxImageSizeBytes: 8 * 1024 * 1024, // 8MB
    minWidth: 320,
    maxWidth: 1440,
    minHeight: 320,
    maxHeight: 1440,
    aspectRatios: { min: 0.8, max: 1.91 },
  },
  FACEBOOK: {
    maxImages: 10,
    maxVideoDurationMs: 240 * 60 * 1000, // 240 minutes
    maxFileSizeBytes: 4 * 1024 * 1024 * 1024, // 4GB
    supportedTypes: ["image", "video", "gif"] as MediaType[],
    maxImageSizeBytes: 4 * 1024 * 1024, // 4MB
  },
  YOUTUBE: {
    maxImages: 0,
    maxVideoDurationMs: 12 * 60 * 60 * 1000, // 12 hours
    maxFileSizeBytes: 128 * 1024 * 1024 * 1024, // 128GB
    supportedTypes: ["video"] as MediaType[],
  },
  TIKTOK: {
    maxImages: 35,
    maxVideoDurationMs: 10 * 60 * 1000, // 10 minutes
    maxFileSizeBytes: 4 * 1024 * 1024 * 1024, // 4GB
    supportedTypes: ["image", "video"] as MediaType[],
    maxImageSizeBytes: 50 * 1024 * 1024, // 50MB
    aspectRatios: { min: 0.5625, max: 1.0 }, // 9:16 to 1:1
  },
} as const;

export type MediaPlatform = keyof typeof PLATFORM_MEDIA_CONSTRAINTS;

/**
 * MediaAttachment construction properties
 */
export interface MediaAttachmentProps {
  id?: MediaId;
  type: MediaType;
  url: string;
  width?: number;
  height?: number;
  durationMs?: number;
  fileSizeBytes?: number;
  altText?: string;
  hash?: string;
}

/**
 * MediaAttachment - Immutable value object representing a media file
 *
 * @example
 * const media = MediaAttachment.create({
 *   type: 'image',
 *   url: 'https://example.com/image.jpg',
 *   width: 1200,
 *   height: 800,
 *   altText: 'A beautiful sunset'
 * });
 */
export class MediaAttachment {
  private readonly _id: MediaId;
  private readonly _type: MediaType;
  private readonly _url: string;
  private readonly _width: number | undefined;
  private readonly _height: number | undefined;
  private readonly _durationMs: number | undefined;
  private readonly _fileSizeBytes: number | undefined;
  private readonly _altText: string | undefined;
  private readonly _hash: string | undefined;

  private constructor(props: {
    id: MediaId;
    type: MediaType;
    url: string;
    width?: number;
    height?: number;
    durationMs?: number;
    fileSizeBytes?: number;
    altText?: string;
    hash?: string;
  }) {
    this._id = props.id;
    this._type = props.type;
    this._url = props.url;
    this._width = props.width;
    this._height = props.height;
    this._durationMs = props.durationMs;
    this._fileSizeBytes = props.fileSizeBytes;
    this._altText = props.altText;
    this._hash = props.hash;
  }

  /**
   * Create a new MediaAttachment with validation
   */
  static create(
    props: MediaAttachmentProps
  ): Result<MediaAttachment, InvalidValueError | EmptyValueError> {
    // Validate type
    if (!MEDIA_TYPES.includes(props.type)) {
      return err(
        new InvalidValueError(
          "type",
          props.type,
          `Invalid media type: "${props.type}". Valid types: ${MEDIA_TYPES.join(", ")}`
        )
      );
    }

    // Validate URL
    if (!props.url || props.url.trim().length === 0) {
      return err(new EmptyValueError("url"));
    }

    // Validate URL format
    try {
      new URL(props.url);
    } catch {
      return err(new InvalidValueError("url", props.url, "Invalid URL format"));
    }

    // Validate dimensions if provided
    if (props.width !== undefined && props.width <= 0) {
      return err(new InvalidValueError("width", props.width, "Width must be a positive number"));
    }

    if (props.height !== undefined && props.height <= 0) {
      return err(new InvalidValueError("height", props.height, "Height must be a positive number"));
    }

    // Validate duration for video/gif
    if (props.durationMs !== undefined && props.durationMs <= 0) {
      return err(
        new InvalidValueError("durationMs", props.durationMs, "Duration must be a positive number")
      );
    }

    // Validate file size
    if (props.fileSizeBytes !== undefined && props.fileSizeBytes <= 0) {
      return err(
        new InvalidValueError(
          "fileSizeBytes",
          props.fileSizeBytes,
          "File size must be a positive number"
        )
      );
    }

    return ok(
      new MediaAttachment({
        id: props.id ?? MediaId.generate(),
        type: props.type,
        url: props.url.trim(),
        ...(props.width !== undefined && { width: props.width }),
        ...(props.height !== undefined && { height: props.height }),
        ...(props.durationMs !== undefined && { durationMs: props.durationMs }),
        ...(props.fileSizeBytes !== undefined && { fileSizeBytes: props.fileSizeBytes }),
        ...(props.altText && { altText: props.altText.trim() }),
        ...(props.hash && { hash: props.hash }),
      })
    );
  }

  /**
   * Getters
   */
  get id(): MediaId {
    return this._id;
  }

  get type(): MediaType {
    return this._type;
  }

  get url(): string {
    return this._url;
  }

  get width(): number | undefined {
    return this._width;
  }

  get height(): number | undefined {
    return this._height;
  }

  get durationMs(): number | undefined {
    return this._durationMs;
  }

  get fileSizeBytes(): number | undefined {
    return this._fileSizeBytes;
  }

  get altText(): string | undefined {
    return this._altText;
  }

  get hash(): string | undefined {
    return this._hash;
  }

  /**
   * Check if this is a video
   */
  isVideo(): boolean {
    return this._type === "video";
  }

  /**
   * Check if this is an image
   */
  isImage(): boolean {
    return this._type === "image";
  }

  /**
   * Check if this is a GIF
   */
  isGif(): boolean {
    return this._type === "gif";
  }

  /**
   * Calculate aspect ratio if dimensions are available
   */
  get aspectRatio(): number | undefined {
    if (this._width && this._height) {
      return this._width / this._height;
    }
    return undefined;
  }

  /**
   * Check if media is compatible with a platform
   */
  isCompatibleWithPlatform(platform: MediaPlatform): Result<boolean, InvalidValueError> {
    const constraints = PLATFORM_MEDIA_CONSTRAINTS[platform];

    // Check if type is supported
    if (!constraints.supportedTypes.includes(this._type)) {
      return err(
        new InvalidValueError(
          "type",
          this._type,
          `${platform} does not support ${this._type}. Supported types: ${constraints.supportedTypes.join(", ")}`
        )
      );
    }

    // Check file size
    if (this._fileSizeBytes !== undefined) {
      const maxSize =
        this._type === "image" && "maxImageSizeBytes" in constraints
          ? constraints.maxImageSizeBytes
          : constraints.maxFileSizeBytes;

      if (this._fileSizeBytes > maxSize) {
        return err(
          new InvalidValueError(
            "fileSizeBytes",
            this._fileSizeBytes,
            `File size exceeds ${platform} limit of ${maxSize} bytes`
          )
        );
      }
    }

    // Check video duration
    if (this._type === "video" && this._durationMs !== undefined) {
      if (this._durationMs > constraints.maxVideoDurationMs) {
        return err(
          new InvalidValueError(
            "durationMs",
            this._durationMs,
            `Video duration exceeds ${platform} limit of ${constraints.maxVideoDurationMs}ms`
          )
        );
      }
    }

    return ok(true);
  }

  /**
   * Create a new MediaAttachment with updated alt text (immutable update)
   */
  withAltText(altText: string): MediaAttachment {
    return new MediaAttachment({
      id: this._id,
      type: this._type,
      url: this._url,
      ...(this._width !== undefined && { width: this._width }),
      ...(this._height !== undefined && { height: this._height }),
      ...(this._durationMs !== undefined && { durationMs: this._durationMs }),
      ...(this._fileSizeBytes !== undefined && { fileSizeBytes: this._fileSizeBytes }),
      altText: altText.trim(),
      ...(this._hash && { hash: this._hash }),
    });
  }

  /**
   * Equality check
   */
  equals(other: MediaAttachment): boolean {
    return this._id.equals(other._id);
  }

  toJSON(): Record<string, unknown> {
    return {
      id: this._id.toString(),
      type: this._type,
      url: this._url,
      ...(this._width !== undefined && { width: this._width }),
      ...(this._height !== undefined && { height: this._height }),
      ...(this._durationMs !== undefined && { durationMs: this._durationMs }),
      ...(this._fileSizeBytes !== undefined && { fileSizeBytes: this._fileSizeBytes }),
      ...(this._altText && { altText: this._altText }),
      ...(this._hash && { hash: this._hash }),
    };
  }
}
