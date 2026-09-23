/**
 * @file classifyPublishFailure.ts
 * @description Decides whether a publish failure is worth another attempt, over the closed
 *   `PublishError` and `RenderError` unions the providers and the renderer actually return.
 *
 *   Three answers, never two. "Unclassifiable" is its own verdict because provider error
 *   reporting is uneven across the eleven providers: a failure nobody recognises is not a
 *   failure we know is permanent, and excluding on that guess would strand a channel that
 *   would have succeeded. The aggregate still bounds it — it retries an unclassifiable
 *   failure within the same budget and then excludes it under a reason that NAMES the
 *   uncertainty, so "I do not know" is allowed but never silent.
 *
 *   The classifier never decides what is LIVE on the provider. That is the
 *   `publishedFragments` array the failure contract carries on every error path.
 * @layer infrastructure
 */

import type { PublishError, RenderError } from "@shared/types";
import {
  ATTEMPT_CLASSIFICATIONS,
  CHANNEL_FAILURE_CODES,
  type AttemptClassification,
  type ChannelFailureCode,
} from "@core/domain/index.js";

/** What the classifier concluded about one failed attempt. */
export interface PublishFailureClassification {
  readonly classification: AttemptClassification;
  /**
   * The exclusion cause to record — present only when the failure NAMES one. A transient
   * or unclassifiable failure names none: the two closed-set codes that would fit are the
   * aggregate's own exhaustion codes, and those are false while the channel still has
   * budget. The aggregate derives them from the classification when the budget runs out.
   */
  readonly code?: ChannelFailureCode;
}

const TRANSIENT: PublishFailureClassification = {
  classification: ATTEMPT_CLASSIFICATIONS.TRANSIENT,
};

const UNCLASSIFIABLE: PublishFailureClassification = {
  classification: ATTEMPT_CLASSIFICATIONS.UNCLASSIFIABLE,
};

const nontransient = (code: ChannelFailureCode): PublishFailureClassification => ({
  classification: ATTEMPT_CLASSIFICATIONS.NONTRANSIENT,
  code,
});

/**
 * Total over `PublishError`: a member added to the union without a verdict here is a
 * compile error rather than a silent fall-through into "unknown shape".
 */
const PUBLISH_ERROR_VERDICTS: Record<PublishError, PublishFailureClassification> = {
  RATE_LIMIT: TRANSIENT,
  NETWORK: TRANSIENT,
  AUTH: nontransient(CHANNEL_FAILURE_CODES.CHANNEL_AUTH_REQUIRED),
  VALIDATION: nontransient(CHANNEL_FAILURE_CODES.CONTENT_REJECTED),
  // Live fragments are on the platform; retrying would publish them a second time.
  THREAD_INTERRUPTED: nontransient(CHANNEL_FAILURE_CODES.THREAD_INTERRUPTED),
  // Declared by the union, produced by nothing in the tree (measured). It is classified
  // here rather than assumed unreachable, and it is classified as the union's own
  // unknown: no producer means no evidence about whether a retry would help.
  PARENT_TWEET_FAILED: UNCLASSIFIABLE,
};

/** Total over `RenderError`, for the same reason. Every member is the channel's own problem. */
const RENDER_ERRORS: Record<RenderError, true> = {
  UNSUPPORTED_MEDIA: true,
  TEXT_TOO_LONG: true,
  VALIDATION_ERROR: true,
  CONTENT_TOO_LONG: true,
  INVALID_STRATEGY: true,
  MEDIA_DISTRIBUTION_FAILED: true,
  THREAD_PLANNING_FAILED: true,
};

/**
 * @function classifyPublishFailure
 * @description Classifies one failed publish attempt.
 * @param failure - A `PublishError` or `RenderError` member, or anything else that was
 *   thrown or returned on the failure path.
 * @returns The classification, carrying the exclusion cause when the failure names one.
 */
export function classifyPublishFailure(failure: unknown): PublishFailureClassification {
  if (typeof failure !== "string") {
    return UNCLASSIFIABLE;
  }
  // Both lookups ask for an OWN key. `in` and a bare index walk `Object.prototype`, so the
  // twelve names inherited from it — `toString`, `constructor`, `__proto__` and the rest —
  // would answer as union members: the first arm excludes them permanently under a cause
  // they do not have, and the second returns a function, which is truthy enough to defeat
  // the `??` fallback the third answer depends on.
  if (Object.hasOwn(RENDER_ERRORS, failure)) {
    return nontransient(CHANNEL_FAILURE_CODES.RENDER_FAILED);
  }
  return Object.hasOwn(PUBLISH_ERROR_VERDICTS, failure)
    ? PUBLISH_ERROR_VERDICTS[failure as PublishError]
    : UNCLASSIFIABLE;
}
