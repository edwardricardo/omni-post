/**
 * Domain Layer - Content Value Object
 *
 * Part of Sprint 3: DDD Architecture Implementation
 * Represents immutable post content with validation.
 */

import { type Result, ok, err } from "@shared/types";
import { EmptyValueError, ValueTooLongError, InvalidValueError } from "../errors/index.js";
import { MediaId } from "./EntityId.js";

/**
 * Supported content locales
 */
export const CONTENT_LOCALES = ["es", "en", "pt", "fr", "de", "it", "ja", "ko", "zh"] as const;
export type ContentLocale = (typeof CONTENT_LOCALES)[number];

/**
 * Platform character limits for validation
 */
const PLATFORM_LIMITS = {
  X: { title: 280, body: 280 },
  INSTAGRAM: { title: 2200, body: 2200 },
  FACEBOOK: { title: 63206, body: 63206 },
  TIKTOK: { title: 2200, body: 2200 },
  YOUTUBE: { title: 100, body: 5000 },
} as const;

export type PlatformType = keyof typeof PLATFORM_LIMITS;

/**
 * Content construction properties
 */
export interface ContentProps {
  body: string;
  title?: string;
  summary?: string;
  tags?: string[];
  locale?: ContentLocale;
  mediaIds?: MediaId[];
}

/**
 * Content - Immutable value object representing post content
 *
 * @example
 * const content = Content.create({ body: 'Hello world', locale: 'en' });
 */
export class Content {
  private readonly _body: string;
  private readonly _title: string | undefined;
  private readonly _summary: string | undefined;
  private readonly _tags: readonly string[];
  private readonly _locale: ContentLocale;
  private readonly _mediaIds: readonly MediaId[];

  private constructor(props: {
    body: string;
    title?: string;
    summary?: string;
    tags: readonly string[];
    locale: ContentLocale;
    mediaIds: readonly MediaId[];
  }) {
    this._body = props.body;
    this._title = props.title;
    this._summary = props.summary;
    this._tags = props.tags;
    this._locale = props.locale;
    this._mediaIds = props.mediaIds;
  }

  /**
   * Reconstitute a Content value object from trusted persistent storage.
   * Bypasses empty-body validation since data from the DB is already validated at write time.
   * Use this in repository mappers (toDomain) instead of create().
   */
  static reconstitute(props: {
    body: string;
    title?: string;
    summary?: string;
    tags: readonly string[];
    locale: ContentLocale;
    mediaIds?: MediaId[];
  }): Content {
    const tags = [...new Set(props.tags.filter((t) => t.trim().length > 0))];
    return new Content({
      body: props.body,
      ...(props.title && { title: props.title }),
      ...(props.summary && { summary: props.summary }),
      tags: Object.freeze(tags),
      locale: props.locale,
      mediaIds: Object.freeze(props.mediaIds ?? []),
    });
  }

  /**
   * Create a new Content value object with validation
   */
  static create(props: ContentProps): Result<Content, EmptyValueError | InvalidValueError> {
    // Validate body is not empty
    if (!props.body || props.body.trim().length === 0) {
      return err(new EmptyValueError("body"));
    }

    // Validate locale if provided
    const locale = props.locale ?? "en";
    if (!CONTENT_LOCALES.includes(locale)) {
      return err(
        new InvalidValueError(
          "locale",
          locale,
          `Invalid locale: "${locale}". Valid locales: ${CONTENT_LOCALES.join(", ")}`
        )
      );
    }

    // Validate tags (remove duplicates and empty strings)
    const tags = props.tags ? [...new Set(props.tags.filter((t) => t.trim().length > 0))] : [];

    return ok(
      new Content({
        body: props.body.trim(),
        ...(props.title && { title: props.title.trim() }),
        ...(props.summary && { summary: props.summary.trim() }),
        tags: Object.freeze(tags),
        locale,
        mediaIds: Object.freeze(props.mediaIds ?? []),
      })
    );
  }

  /**
   * Getters - All return immutable values
   */
  get body(): string {
    return this._body;
  }

  get title(): string | undefined {
    return this._title;
  }

  get summary(): string | undefined {
    return this._summary;
  }

  get tags(): readonly string[] {
    return this._tags;
  }

  get locale(): ContentLocale {
    return this._locale;
  }

  get mediaIds(): readonly MediaId[] {
    return this._mediaIds;
  }

  /**
   * Check if content fits within platform character limits
   */
  fitsInPlatform(platform: PlatformType): Result<boolean, ValueTooLongError> {
    const limits = PLATFORM_LIMITS[platform];

    if (this._title && this._title.length > limits.title) {
      return err(new ValueTooLongError("title", limits.title, this._title.length));
    }

    if (this._body.length > limits.body) {
      return err(new ValueTooLongError("body", limits.body, this._body.length));
    }

    return ok(true);
  }

  /**
   * Get character count
   */
  get characterCount(): number {
    return this._body.length + (this._title?.length ?? 0);
  }

  /**
   * Get word count
   */
  get wordCount(): number {
    const allText = `${this._title ?? ""} ${this._body}`.trim();
    return allText.split(/\s+/).filter((word) => word.length > 0).length;
  }

  /**
   * Check if content has media
   */
  get hasMedia(): boolean {
    return this._mediaIds.length > 0;
  }

  /**
   * Create a new Content with updated body (immutable update)
   */
  withBody(newBody: string): Result<Content, EmptyValueError> {
    if (!newBody || newBody.trim().length === 0) {
      return err(new EmptyValueError("body"));
    }

    return ok(
      new Content({
        body: newBody.trim(),
        ...(this._title && { title: this._title }),
        ...(this._summary && { summary: this._summary }),
        tags: this._tags,
        locale: this._locale,
        mediaIds: this._mediaIds,
      })
    );
  }

  /**
   * Create a new Content with updated title (immutable update)
   */
  withTitle(newTitle: string | undefined): Content {
    return new Content({
      body: this._body,
      ...(newTitle && { title: newTitle.trim() }),
      ...(this._summary && { summary: this._summary }),
      tags: this._tags,
      locale: this._locale,
      mediaIds: this._mediaIds,
    });
  }

  /**
   * Create a new Content with updated tags (immutable update)
   */
  withTags(newTags: string[]): Content {
    const uniqueTags = [...new Set(newTags.filter((t) => t.trim().length > 0))];

    return new Content({
      body: this._body,
      ...(this._title && { title: this._title }),
      ...(this._summary && { summary: this._summary }),
      tags: Object.freeze(uniqueTags),
      locale: this._locale,
      mediaIds: this._mediaIds,
    });
  }

  /**
   * Create a new Content with added media (immutable update)
   */
  withMedia(mediaIds: MediaId[]): Content {
    return new Content({
      body: this._body,
      ...(this._title && { title: this._title }),
      ...(this._summary && { summary: this._summary }),
      tags: this._tags,
      locale: this._locale,
      mediaIds: Object.freeze([...this._mediaIds, ...mediaIds]),
    });
  }

  /**
   * Equality check
   */
  equals(other: Content): boolean {
    if (this._body !== other._body) return false;
    if (this._title !== other._title) return false;
    if (this._summary !== other._summary) return false;
    if (this._locale !== other._locale) return false;
    if (this._tags.length !== other._tags.length) return false;
    if (!this._tags.every((tag, i) => tag === other._tags[i])) return false;
    if (this._mediaIds.length !== other._mediaIds.length) return false;
    if (
      !this._mediaIds.every((id, i) => {
        const otherId = other._mediaIds[i];
        return otherId !== undefined && id.equals(otherId);
      })
    )
      return false;
    return true;
  }

  toJSON(): Record<string, unknown> {
    return {
      body: this._body,
      ...(this._title && { title: this._title }),
      ...(this._summary && { summary: this._summary }),
      tags: [...this._tags],
      locale: this._locale,
      mediaIds: this._mediaIds.map((id) => id.toString()),
    };
  }
}
