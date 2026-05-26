/**
 * @file UTMParameters.ts
 * @description Value Object representing UTM (Urchin Tracking Module) parameters
 *   for link tracking and campaign attribution. Validates that required fields
 *   are present and all values are URL-safe.
 * @layer domain
 */

import { type Result, ok, err } from "@shared/types";
import { InvalidValueError } from "../errors/index.js";

/**
 * Props for constructing UTMParameters
 */
export interface UTMParametersProps {
  source: string;
  medium: string;
  campaign: string;
  content?: string;
  term?: string;
}

/**
 * UTMParameters — Immutable value object encapsulating UTM tracking parameters.
 *
 * source, medium, and campaign are required. content and term are optional.
 * All values must be non-empty strings containing only URL-safe characters.
 *
 * @example
 * const result = UTMParameters.create({ source: "twitter", medium: "social", campaign: "launch" });
 * if (result.ok) {
 *   const url = result.value.buildUrl("https://example.com/page");
 *   // https://example.com/page?utm_source=twitter&utm_medium=social&utm_campaign=launch
 * }
 */
export class UTMParameters {
  readonly source: string;
  readonly medium: string;
  readonly campaign: string;
  readonly content?: string;
  readonly term?: string;

  private constructor(props: UTMParametersProps) {
    this.source = props.source;
    this.medium = props.medium;
    this.campaign = props.campaign;
    if (props.content !== undefined) {
      this.content = props.content;
    }
    if (props.term !== undefined) {
      this.term = props.term;
    }
  }

  /**
   * @method create
   * @description Factory method that validates props and returns a UTMParameters instance.
   * @param props - The UTM parameter values
   * @returns Result containing UTMParameters or InvalidValueError
   */
  static create(props: UTMParametersProps): Result<UTMParameters, InvalidValueError> {
    if (!props.source || props.source.trim().length === 0) {
      return err(new InvalidValueError("utm_source", props.source, "utm_source is required"));
    }
    if (!props.medium || props.medium.trim().length === 0) {
      return err(new InvalidValueError("utm_medium", props.medium, "utm_medium is required"));
    }
    if (!props.campaign || props.campaign.trim().length === 0) {
      return err(new InvalidValueError("utm_campaign", props.campaign, "utm_campaign is required"));
    }

    const allValues: Array<{ key: string; value: string }> = [
      { key: "utm_source", value: props.source },
      { key: "utm_medium", value: props.medium },
      { key: "utm_campaign", value: props.campaign },
      ...(props.content !== undefined ? [{ key: "utm_content", value: props.content }] : []),
      ...(props.term !== undefined ? [{ key: "utm_term", value: props.term }] : []),
    ];

    for (const entry of allValues) {
      if (!UTMParameters.isUrlSafe(entry.value)) {
        return err(
          new InvalidValueError(
            entry.key,
            entry.value,
            `${entry.key} contains invalid characters. Only alphanumeric, hyphens, underscores, dots, and tildes are allowed.`
          )
        );
      }
    }

    return ok(new UTMParameters(props));
  }

  /**
   * @method buildUrl
   * @description Appends UTM parameters to a base URL using URLSearchParams.
   * @param baseUrl - The URL to append parameters to
   * @returns The full URL with UTM query parameters
   */
  buildUrl(baseUrl: string): string {
    const url = new URL(baseUrl);
    url.searchParams.set("utm_source", this.source);
    url.searchParams.set("utm_medium", this.medium);
    url.searchParams.set("utm_campaign", this.campaign);
    if (this.content !== undefined) {
      url.searchParams.set("utm_content", this.content);
    }
    if (this.term !== undefined) {
      url.searchParams.set("utm_term", this.term);
    }
    return url.toString();
  }

  /**
   * @method equals
   * @description Value equality comparison.
   */
  equals(other: UTMParameters): boolean {
    return (
      this.source === other.source &&
      this.medium === other.medium &&
      this.campaign === other.campaign &&
      this.content === other.content &&
      this.term === other.term
    );
  }

  /**
   * @method toJSON
   * @description Serializes to a plain object, omitting undefined optional fields.
   */
  toJSON(): Record<string, string> {
    return {
      source: this.source,
      medium: this.medium,
      campaign: this.campaign,
      ...(this.content !== undefined && { content: this.content }),
      ...(this.term !== undefined && { term: this.term }),
    };
  }

  /**
   * Check if a value contains only URL-safe characters.
   * Allows alphanumeric, hyphens, underscores, dots, and tildes.
   */
  private static isUrlSafe(value: string): boolean {
    return /^[a-zA-Z0-9\-_.~]+$/.test(value);
  }
}
