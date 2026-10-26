/**
 * @file Content.ts
 * @description Value object representing post content — immutable, locale-aware, with platform-specific character limit validation.
 * @layer domain
 */

import {
  type Result,
  ok,
  err,
  CONTENT_LOCALES,
  type ContentLocale,
  isContentLocale,
} from "@shared/types";
import { EmptyValueError, ValueTooLongError, InvalidValueError } from "../errors/index.js";
import { MediaId } from "./EntityId.js";

/**
 * The content languages, defined once in the shared kernel so that the portals, which import the
 * shared kernel and never the core, read the same list as the domain.
 */
export { CONTENT_LOCALES, type ContentLocale, isContentLocale };

/**
 * @function contentLocaleFromStorage
 * @description Reads a content language back from a stored row. A row can hold a language the
 *   product no longer supports, written before the list narrowed; it is refused with an error that
 *   names the row and the value, so the read fails where the data is wrong instead of carrying a
 *   value its type does not admit. An adapter reads a stored content language through it.
 * @param value - The locale the row holds.
 * @param row - The row it was read from, as `<Model> <id>`.
 * @returns The locale, or an InvalidValueError naming the row and the value.
 */
export function contentLocaleFromStorage(
  value: string,
  row: string
): Result<ContentLocale, InvalidValueError> {
  if (isContentLocale(value)) return ok(value);
  return err(
    new InvalidValueError(
      "locale",
      value,
      `${row} holds locale "${value}", which is not a content locale (${CONTENT_LOCALES.join(", ")})`
    )
  );
}

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
   * @method reconstitute
   * @description Rebuilds a Content value object from trusted persistent storage. It skips the
   *   empty-body check, which the data passed when it was written; repository mappers use it
   *   instead of create(), and read the stored locale through contentLocaleFromStorage first.
   * @param props - The stored body, title, summary, tags, locale and media ids.
   * @returns The Content, with blank and duplicate tags dropped.
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
   * @method create
   * @description Creates a Content value object, validating the body and the locale.
   * @param props - The body, title, summary, tags, locale (default "en") and media ids.
   * @returns The Content, or EmptyValueError for a blank body and InvalidValueError for a locale
   *   outside CONTENT_LOCALES.
   */
  static create(props: ContentProps): Result<Content, EmptyValueError | InvalidValueError> {
    // Validate body is not empty
    if (!props.body || props.body.trim().length === 0) {
      return err(new EmptyValueError("body"));
    }

    // Validate locale if provided
    const locale = props.locale ?? "en";
    if (!isContentLocale(locale)) {
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
   * @method fitsInPlatform
   * @description Checks the title and body against a platform's character limits.
   * @param platform - The platform whose limits apply.
   * @returns ok(true) when both fit, or ValueTooLongError naming the field that does not.
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
   * @method withBody
   * @description Returns a copy of this Content with another body.
   * @param newBody - The new body, trimmed.
   * @returns The new Content, or EmptyValueError for a blank body.
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
   * @method withTitle
   * @description Returns a copy of this Content with another title, or none.
   * @param newTitle - The new title, trimmed; undefined or empty removes it.
   * @returns The new Content.
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
   * @method withTags
   * @description Returns a copy of this Content with another tag list.
   * @param newTags - The new tags; blank and duplicate tags are dropped.
   * @returns The new Content.
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
   * @method withMedia
   * @description Returns a copy of this Content with media ids appended.
   * @param mediaIds - The media ids to append after the existing ones.
   * @returns The new Content.
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
   * @method equals
   * @description Compares two Content values field by field, tags and media ids in order.
   * @param other - The Content to compare with.
   * @returns True when every field is equal.
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

  /**
   * @method toJSON
   * @description Serializes the Content for JSON, media ids as strings.
   * @returns The body, title and summary when present, tags, locale and media ids.
   */
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
