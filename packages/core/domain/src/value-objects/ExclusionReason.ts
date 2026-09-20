/**
 * @file ExclusionReason.ts
 * @description The closed set of causes a channel can carry for a terminal
 *   not-published outcome, with an optional detail that is bounded and stripped of
 *   credential-shaped runs before it is stored. "Excluded with no reason" is the
 *   failure this record exists to delete, so the reason is never optional.
 * @layer domain
 */

import { type Result, ok, err } from "@shared/types";
import { InvalidValueError } from "../errors/index.js";

export const CHANNEL_FAILURE_CODES = {
  CHANNEL_AUTH_REQUIRED: "CHANNEL_AUTH_REQUIRED",
  CONTENT_REJECTED: "CONTENT_REJECTED",
  RENDER_FAILED: "RENDER_FAILED",
  THREAD_INTERRUPTED: "THREAD_INTERRUPTED",
  BUDGET_EXHAUSTED: "BUDGET_EXHAUSTED",
  UNCLASSIFIED_BUDGET_EXHAUSTED: "UNCLASSIFIED_BUDGET_EXHAUSTED",
  ACTION_WINDOW_EXPIRED: "ACTION_WINDOW_EXPIRED",
} as const;

export type ChannelFailureCode = (typeof CHANNEL_FAILURE_CODES)[keyof typeof CHANNEL_FAILURE_CODES];

/** A failure seen while the channel is still unresolved, kept as history. */
export interface ChannelFailureRecord {
  readonly code: ChannelFailureCode;
  readonly detail?: string;
  readonly at: Date;
}

export interface ExclusionReasonProps {
  code: ChannelFailureCode;
  detail?: string;
}

/**
 * Runs that look like a credential. A provider's message is written by the provider,
 * so it can carry whatever the request carried; the record is read by support and
 * rendered into an alert, which makes it a disclosure surface.
 */
const CREDENTIAL_PATTERNS: readonly RegExp[] = [
  /\b(bearer|token|secret|password|apikey|api_key|key)\b[\s:=]+\S+/gi,
  /\b[A-Za-z0-9_-]{32,}\b/g,
];

const REDACTED = "[redacted]";

/**
 * @class ExclusionReason
 * @description Immutable cause of a terminal not-published outcome.
 */
export class ExclusionReason {
  /** Detail is stored, logged and rendered — a provider stack trace is not. */
  static readonly MAX_DETAIL_LENGTH = 500;

  private readonly _code: ChannelFailureCode;
  private readonly _detail: string | undefined;

  private constructor(code: ChannelFailureCode, detail: string | undefined) {
    this._code = code;
    this._detail = detail;
  }

  /**
   * @method create
   * @description Builds a reason, refusing a code outside the closed set and
   *   normalising the detail.
   * @param props - The cause and its optional detail
   * @returns Result with the reason, or InvalidValueError naming the rejected code
   */
  static create(props: ExclusionReasonProps): Result<ExclusionReason, InvalidValueError> {
    const codes: readonly string[] = Object.values(CHANNEL_FAILURE_CODES);
    if (typeof props.code !== "string" || !codes.includes(props.code)) {
      return err(
        new InvalidValueError(
          "ExclusionReason.code",
          props.code,
          `Invalid channel failure code: "${String(props.code)}". Valid values: ${codes.join(", ")}`
        )
      );
    }

    return ok(new ExclusionReason(props.code, ExclusionReason.normalizeDetail(props.detail)));
  }

  /**
   * @method normalizeDetail
   * @description Redacts credential-shaped runs, then bounds the result. Redaction
   *   runs FIRST so a secret cannot survive by sitting past the cut.
   * @param detail - The raw detail, usually a provider message
   * @returns The stored detail, or undefined when nothing is left
   */
  private static normalizeDetail(detail: string | undefined): string | undefined {
    if (typeof detail !== "string") {
      return undefined;
    }

    let redacted = detail;
    for (const pattern of CREDENTIAL_PATTERNS) {
      redacted = redacted.replace(pattern, REDACTED);
    }

    const trimmed = redacted.trim();
    if (trimmed.length === 0) {
      return undefined;
    }

    return trimmed.length > ExclusionReason.MAX_DETAIL_LENGTH
      ? trimmed.slice(0, ExclusionReason.MAX_DETAIL_LENGTH)
      : trimmed;
  }

  get code(): ChannelFailureCode {
    return this._code;
  }

  get detail(): string | undefined {
    return this._detail;
  }

  /**
   * @method equals
   * @description Value equality over the code and the stored detail.
   * @param other - The reason to compare against
   * @returns true when both fields match
   */
  equals(other: ExclusionReason): boolean {
    return this._code === other._code && this._detail === other._detail;
  }

  toString(): string {
    return this._code;
  }

  toJSON(): { code: ChannelFailureCode; detail?: string } {
    return {
      code: this._code,
      ...(this._detail !== undefined && { detail: this._detail }),
    };
  }
}
