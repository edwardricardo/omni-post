/**
 * @file channelPublication.test.ts
 * @description Unit tests for the ChannelPublication record entity — the attempt
 *   budget and its transient / nontransient / unclassifiable split, all-or-nothing
 *   across fragments, the pending-retraction state and its explicit exits, the
 *   bounded action window, and the single place that decides whether an alert is
 *   raised or resolved.
 * @layer infrastructure
 */

import { describe, it } from "vitest";
import assert from "node:assert/strict";
import {
  ChannelPublication,
  CHANNEL_ATTEMPT_BUDGET,
} from "@core/domain/entities/ChannelPublication.js";
import { ChannelId } from "@core/domain/value-objects/EntityId.js";
import { FragmentReference } from "@core/domain/value-objects/FragmentReference.js";
import { ContentFingerprint } from "@core/domain/value-objects/ContentFingerprint.js";
import { providedReference } from "@core/domain/value-objects/ProviderReference.js";
import { CHANNEL_FAILURE_CODES } from "@core/domain/value-objects/ExclusionReason.js";
import {
  type AttemptResult,
  type FailedAttemptResult,
  ATTEMPT_CLASSIFICATIONS,
  CHANNEL_RETRACTION_BLOCKS,
  CHANNEL_RETRACTION_CLEARANCES,
  PUBLICATION_OUTCOME_KINDS,
  isExcludedOutcome,
  isPublishedOutcome,
} from "@core/domain/value-objects/PublicationOutcome.js";

// ---------------------------------------------------------------------------
// Mock factories
// ---------------------------------------------------------------------------

const CHANNEL_A = "aa000000-0000-4000-8000-000000000001";
const NOW = new Date("2026-03-01T09:00:00.000Z");
const HOUR_MS = 60 * 60 * 1000;

function makeFragment(index: number, externalId?: string): FragmentReference {
  const result = FragmentReference.create({
    index,
    externalId: externalId ?? `frag-${index}`,
  });
  assert.ok(result.ok, "the fragment fixture is valid");
  return result.value;
}

function makeFingerprint(body = "hello"): ContentFingerprint {
  return ContentFingerprint.ofContent({ body, mediaIds: [] });
}

/** A record already opened on an episode, which is the state every attempt needs. */
function makeOpenRecord(episode = 1): ChannelPublication {
  const record = ChannelPublication.declare(ChannelId.fromStringUnsafe(CHANNEL_A));
  const opened = record.openEpisode(episode);
  assert.ok(opened.ok, "the fixture opens its episode");
  return record;
}

function publishedResult(fragmentCount: number): AttemptResult {
  const head = providedReference("frag-1");
  assert.ok(head.ok);
  return {
    kind: PUBLICATION_OUTCOME_KINDS.PUBLISHED,
    head: head.value,
    fragments: Array.from({ length: fragmentCount }, (_, i) => makeFragment(i + 1)),
    publishedAt: NOW,
    contentHash: makeFingerprint(),
  };
}

function failedResult(overrides?: Partial<FailedAttemptResult>): FailedAttemptResult {
  return {
    kind: "failed",
    classification: overrides?.classification ?? ATTEMPT_CLASSIFICATIONS.TRANSIENT,
    code: overrides?.code ?? CHANNEL_FAILURE_CODES.CONTENT_REJECTED,
    ...(overrides?.detail !== undefined && { detail: overrides.detail }),
    publishedFragments: overrides?.publishedFragments ?? [],
  };
}

/** Runs `count` transient attempts starting at `from`, asserting each one applied. */
function spendTransientAttempts(record: ChannelPublication, count: number, from = 1): void {
  for (let n = 0; n < count; n += 1) {
    const applied = record.recordAttempt({
      episode: record.episode,
      attemptNo: from + n,
      planSize: 1,
      result: failedResult({ classification: ATTEMPT_CLASSIFICATIONS.TRANSIENT }),
      now: NOW,
    });
    assert.ok(applied.ok, "a transient attempt is recorded");
  }
}

/** Drives a record into the stranded state: excluded, live fragments, window open. */
function makeStrandedRecord(liveCount = 2): ChannelPublication {
  const record = makeOpenRecord();
  const result = record.recordAttempt({
    episode: 1,
    attemptNo: 1,
    planSize: 4,
    result: failedResult({
      classification: ATTEMPT_CLASSIFICATIONS.NONTRANSIENT,
      code: CHANNEL_FAILURE_CODES.CONTENT_REJECTED,
      publishedFragments: Array.from({ length: liveCount }, (_, i) => makeFragment(i + 1)),
    }),
    now: NOW,
  });
  assert.ok(result.ok, "the stranded fixture records its attempt");
  return record;
}

// ---------------------------------------------------------------------------

describe("ChannelPublication", () => {
  describe("declaration and episodes", () => {
    it("returns a declared record that is unresolved, on episode zero, and never attempted", () => {
      const record = ChannelPublication.declare(ChannelId.fromStringUnsafe(CHANNEL_A));

      assert.strictEqual(record.outcome.kind, PUBLICATION_OUTCOME_KINDS.UNRESOLVED);
      assert.strictEqual(record.episode, 0);
      assert.strictEqual(record.attempts, 0);
      assert.ok(!record.hasLiveContent());
      assert.ok(record.redrivable());
    });

    it("returns an error when an attempt is recorded against episode zero", () => {
      const record = ChannelPublication.declare(ChannelId.fromStringUnsafe(CHANNEL_A));

      const result = record.recordAttempt({
        episode: 0,
        attemptNo: 1,
        planSize: 1,
        result: publishedResult(1),
        now: NOW,
      });

      assert.ok(!result.ok);
      assert.match(result.error.message, /episode/i);
    });

    it("returns an error when the attempt names a stale episode", () => {
      const record = makeOpenRecord(2);

      const result = record.recordAttempt({
        episode: 1,
        attemptNo: 1,
        planSize: 1,
        result: publishedResult(1),
        now: NOW,
      });

      assert.ok(!result.ok);
      assert.match(result.error.message, /episode/i);
    });

    it("returns an error when an episode opens over live content", () => {
      const record = makeStrandedRecord();

      const result = record.openEpisode(2);

      assert.ok(!result.ok);
      assert.match(result.error.message, /live/i);
    });

    it("returns the record re-opened with its per-episode budget reset and its history kept", () => {
      const record = makeOpenRecord();
      spendTransientAttempts(record, CHANNEL_ATTEMPT_BUDGET);
      assert.ok(isExcludedOutcome(record.outcome));

      const opened = record.openEpisode(2);

      assert.ok(opened.ok);
      assert.strictEqual(record.episode, 2);
      assert.strictEqual(record.episodeAttempts, 0);
      assert.strictEqual(record.attempts, CHANNEL_ATTEMPT_BUDGET);
      assert.strictEqual(record.outcome.kind, PUBLICATION_OUTCOME_KINDS.UNRESOLVED);
      assert.strictEqual(record.lastFailure?.code, CHANNEL_FAILURE_CODES.BUDGET_EXHAUSTED);
    });

    it("returns an attempt count that accumulates across re-drives", () => {
      const record = makeOpenRecord();
      spendTransientAttempts(record, 2);
      const reopened = record.openEpisode(2);
      assert.ok(reopened.ok);
      spendTransientAttempts(record, 1);

      assert.strictEqual(record.attempts, 3);
      assert.strictEqual(record.episodeAttempts, 1);
    });
  });

  describe("the attempt budget", () => {
    it("returns an unresolved record when a transient failure lands within budget", () => {
      const record = makeOpenRecord();

      spendTransientAttempts(record, CHANNEL_ATTEMPT_BUDGET - 1);

      assert.strictEqual(record.outcome.kind, PUBLICATION_OUTCOME_KINDS.UNRESOLVED);
      assert.strictEqual(record.attempts, CHANNEL_ATTEMPT_BUDGET - 1);
      assert.strictEqual(record.lastFailure?.code, CHANNEL_FAILURE_CODES.CONTENT_REJECTED);
      assert.ok(record.redrivable());
    });

    it("returns an excluded record naming exhaustion when the budget runs out", () => {
      const record = makeOpenRecord();

      spendTransientAttempts(record, CHANNEL_ATTEMPT_BUDGET);

      const outcome = record.outcome;
      assert.ok(isExcludedOutcome(outcome));
      assert.strictEqual(outcome.reason.code, CHANNEL_FAILURE_CODES.BUDGET_EXHAUSTED);
      assert.ok(!record.hasLiveContent());
    });

    it("returns an excluded record on the FIRST attempt when the failure is nontransient", () => {
      const record = makeOpenRecord();

      const result = record.recordAttempt({
        episode: 1,
        attemptNo: 1,
        planSize: 1,
        result: failedResult({
          classification: ATTEMPT_CLASSIFICATIONS.NONTRANSIENT,
          code: CHANNEL_FAILURE_CODES.CHANNEL_AUTH_REQUIRED,
          detail: "the channel needs to be reconnected",
        }),
        now: NOW,
      });

      assert.ok(result.ok);
      const outcome = record.outcome;
      assert.ok(isExcludedOutcome(outcome));
      assert.strictEqual(outcome.reason.code, CHANNEL_FAILURE_CODES.CHANNEL_AUTH_REQUIRED);
      assert.strictEqual(outcome.reason.detail, "the channel needs to be reconnected");
      assert.strictEqual(record.episodeAttempts, 1);
    });

    it("returns an unclassifiable failure bounded by the same budget, then named", () => {
      const record = makeOpenRecord();
      const unclassifiable = failedResult({
        classification: ATTEMPT_CLASSIFICATIONS.UNCLASSIFIABLE,
        code: CHANNEL_FAILURE_CODES.CONTENT_REJECTED,
      });

      for (let n = 1; n < CHANNEL_ATTEMPT_BUDGET; n += 1) {
        const mid = record.recordAttempt({
          episode: 1,
          attemptNo: n,
          planSize: 1,
          result: unclassifiable,
          now: NOW,
        });
        assert.ok(mid.ok);
        assert.strictEqual(
          record.outcome.kind,
          PUBLICATION_OUTCOME_KINDS.UNRESOLVED,
          "an unclassifiable failure is not an exclusion on a guess"
        );
      }

      const last = record.recordAttempt({
        episode: 1,
        attemptNo: CHANNEL_ATTEMPT_BUDGET,
        planSize: 1,
        result: unclassifiable,
        now: NOW,
      });

      assert.ok(last.ok);
      const outcome = record.outcome;
      assert.ok(isExcludedOutcome(outcome));
      assert.strictEqual(
        outcome.reason.code,
        CHANNEL_FAILURE_CODES.UNCLASSIFIED_BUDGET_EXHAUSTED,
        "the exclusion names the uncertainty instead of asserting a cause"
      );
    });

    it("returns applied false when an attempt ordinal is replayed", () => {
      const record = makeOpenRecord();
      spendTransientAttempts(record, 2);

      const replay = record.recordAttempt({
        episode: 1,
        attemptNo: 2,
        planSize: 1,
        result: publishedResult(1),
        now: NOW,
      });

      assert.ok(replay.ok);
      assert.strictEqual(replay.value.applied, false);
      assert.strictEqual(record.attempts, 2, "a replay spends nothing");
      assert.strictEqual(record.outcome.kind, PUBLICATION_OUTCOME_KINDS.UNRESOLVED);
    });
  });

  describe("all-or-nothing across fragments", () => {
    it("returns the published outcome with every fragment and the fingerprint", () => {
      const record = makeOpenRecord();

      const result = record.recordAttempt({
        episode: 1,
        attemptNo: 1,
        planSize: 3,
        result: publishedResult(3),
        now: NOW,
      });

      assert.ok(result.ok);
      const outcome = record.outcome;
      assert.ok(isPublishedOutcome(outcome));
      assert.strictEqual(outcome.fragments.length, 3);
      assert.strictEqual(outcome.publishedAt.toISOString(), NOW.toISOString());
      assert.ok(outcome.contentHash.equals(makeFingerprint()));
      assert.ok(record.hasLiveContent());
      assert.ok(!record.redrivable());
    });

    it("returns an error when a published result carries fewer fragments than the plan", () => {
      const record = makeOpenRecord();

      const result = record.recordAttempt({
        episode: 1,
        attemptNo: 1,
        planSize: 3,
        result: publishedResult(2),
        now: NOW,
      });

      assert.ok(!result.ok);
      assert.match(result.error.message, /fragment/i);
      assert.strictEqual(
        record.outcome.kind,
        PUBLICATION_OUTCOME_KINDS.UNRESOLVED,
        "no committed state carries a published outcome with fragments missing"
      );
    });

    it("returns the published outcome with an explicit absence when the provider returned no id", () => {
      const record = makeOpenRecord();

      const result = record.recordAttempt({
        episode: 1,
        attemptNo: 1,
        planSize: 1,
        result: {
          kind: PUBLICATION_OUTCOME_KINDS.PUBLISHED,
          fragments: [makeFragment(1)],
          publishedAt: NOW,
          contentHash: makeFingerprint(),
        },
        now: NOW,
      });

      assert.ok(result.ok);
      const outcome = record.outcome;
      assert.ok(isPublishedOutcome(outcome));
      assert.strictEqual(outcome.head.kind, "none-returned");
      assert.strictEqual(record.externalIdMissing, true);
    });

    it("returns an interrupted thread as excluded, pending retraction, with the window open", () => {
      const record = makeOpenRecord();

      const result = record.recordAttempt({
        episode: 1,
        attemptNo: 1,
        planSize: 4,
        result: failedResult({
          classification: ATTEMPT_CLASSIFICATIONS.TRANSIENT,
          code: CHANNEL_FAILURE_CODES.CONTENT_REJECTED,
          publishedFragments: [makeFragment(1), makeFragment(2)],
        }),
        now: NOW,
      });

      assert.ok(result.ok);
      const outcome = record.outcome;
      assert.ok(isExcludedOutcome(outcome));
      assert.strictEqual(
        outcome.reason.code,
        CHANNEL_FAILURE_CODES.THREAD_INTERRUPTED,
        "live fragments override the classification and the budget"
      );
      assert.ok(outcome.retraction.pending);
      assert.deepStrictEqual(
        outcome.retraction.pending ? outcome.retraction.live.map((f) => f.index) : [],
        [1, 2]
      );
      assert.strictEqual(
        outcome.retraction.pending ? outcome.retraction.blockedBy : undefined,
        CHANNEL_RETRACTION_BLOCKS.NO_CAPABILITY
      );
      assert.strictEqual(record.actionWindowStartedAt?.toISOString(), NOW.toISOString());
      assert.ok(record.hasLiveContent());
      assert.ok(!record.redrivable());
      assert.strictEqual(record.episodeAttempts, 1, "the exclusion did not consume the budget");
    });

    it("returns a transient interruption as excluded even with the budget untouched", () => {
      const record = makeOpenRecord();

      record.recordAttempt({
        episode: 1,
        attemptNo: 1,
        planSize: 2,
        result: failedResult({ publishedFragments: [makeFragment(1)] }),
        now: NOW,
      });

      const outcome = record.outcome;
      assert.ok(isExcludedOutcome(outcome));
      assert.notStrictEqual(outcome.reason.code, CHANNEL_FAILURE_CODES.BUDGET_EXHAUSTED);
      assert.ok(record.episodeAttempts < CHANNEL_ATTEMPT_BUDGET);
    });
  });

  describe("clearing live fragments", () => {
    it("returns the record redrivable once the customer confirms the removal", () => {
      const record = makeStrandedRecord();

      const cleared = record.clearPendingRetraction({ cause: "manually-removed", now: NOW });

      assert.ok(cleared.ok);
      assert.strictEqual(cleared.value.applied, true);
      assert.ok(!record.hasLiveContent());
      assert.ok(record.redrivable());
      assert.strictEqual(
        record.retractionClearedCause,
        CHANNEL_RETRACTION_CLEARANCES.MANUALLY_REMOVED
      );
      assert.strictEqual(record.retractionClearedAt?.toISOString(), NOW.toISOString());
    });

    it("returns applied false when nothing is pending", () => {
      const record = makeOpenRecord();

      const cleared = record.clearPendingRetraction({ cause: "manually-removed", now: NOW });

      assert.ok(cleared.ok);
      assert.strictEqual(cleared.value.applied, false);
    });

    it("returns the live fragments unchanged when nothing explicit clears them", () => {
      const record = makeStrandedRecord(2);

      const expired = record.expireRetractionActionWindow({
        now: new Date(NOW.getTime() + 100 * HOUR_MS),
        window: 72 * HOUR_MS,
      });

      assert.ok(expired.ok);
      assert.strictEqual(record.liveFragments.length, 2);
      assert.ok(record.hasLiveContent());
    });

    it("returns a smaller live set when a retraction partially succeeds", () => {
      const record = makeStrandedRecord(2);

      const marked = record.markRetractionOutcome({
        outcome: "retracted",
        remaining: [makeFragment(2)],
        now: NOW,
      });

      assert.ok(marked.ok);
      assert.strictEqual(record.liveFragments.length, 1);
      assert.ok(record.hasLiveContent(), "one fragment left is still live content");
    });

    it("returns a cleared record when a retraction removes everything", () => {
      const record = makeStrandedRecord(2);

      const marked = record.markRetractionOutcome({
        outcome: "retracted",
        remaining: [],
        now: NOW,
      });

      assert.ok(marked.ok);
      assert.ok(!record.hasLiveContent());
      assert.strictEqual(record.retractionClearedCause, CHANNEL_RETRACTION_CLEARANCES.RETRACTED);
    });

    it("returns the window opened when retraction reports itself exhausted", () => {
      const record = makeOpenRecord();
      const attempt = record.recordAttempt({
        episode: 1,
        attemptNo: 1,
        planSize: 2,
        result: failedResult({ publishedFragments: [makeFragment(1)] }),
        now: NOW,
      });
      assert.ok(attempt.ok);

      const marked = record.markRetractionOutcome({
        outcome: "exhausted",
        remaining: [makeFragment(1)],
        now: new Date(NOW.getTime() + HOUR_MS),
      });

      assert.ok(marked.ok);
      assert.strictEqual(record.retractionBlockedCause, CHANNEL_RETRACTION_BLOCKS.EXHAUSTED);
      assert.ok(record.actionWindowStartedAt !== undefined);
    });
  });

  describe("the action window", () => {
    it("returns applied false before the window has elapsed", () => {
      const record = makeStrandedRecord();

      const expired = record.expireRetractionActionWindow({
        now: new Date(NOW.getTime() + 71 * HOUR_MS),
        window: 72 * HOUR_MS,
      });

      assert.ok(expired.ok);
      assert.strictEqual(expired.value.applied, false);
      assert.strictEqual(record.actionWindowExpiredAt, undefined);
    });

    it("returns the outcome finalized once the window has elapsed", () => {
      const record = makeStrandedRecord();
      const lastFailureBefore = record.lastFailure?.code;

      const expired = record.expireRetractionActionWindow({
        now: new Date(NOW.getTime() + 72 * HOUR_MS),
        window: 72 * HOUR_MS,
      });

      assert.ok(expired.ok);
      assert.strictEqual(expired.value.applied, true);
      const outcome = record.outcome;
      assert.ok(isExcludedOutcome(outcome));
      assert.strictEqual(outcome.reason.code, CHANNEL_FAILURE_CODES.ACTION_WINDOW_EXPIRED);
      assert.strictEqual(record.lastFailure?.code, lastFailureBefore, "the history is kept");
      assert.ok(record.hasLiveContent(), "expiry fixes the outcome, it never clears the content");
      assert.ok(!record.redrivable());
    });

    it("returns applied false when the window is expired twice", () => {
      const record = makeStrandedRecord();
      const later = new Date(NOW.getTime() + 100 * HOUR_MS);
      const first = record.expireRetractionActionWindow({ now: later, window: 72 * HOUR_MS });
      assert.ok(first.ok);

      const second = record.expireRetractionActionWindow({ now: later, window: 72 * HOUR_MS });

      assert.ok(second.ok);
      assert.strictEqual(second.value.applied, false);
    });

    it("returns applied false when nothing is pending retraction", () => {
      const record = makeOpenRecord();

      const expired = record.expireRetractionActionWindow({
        now: new Date(NOW.getTime() + 100 * HOUR_MS),
        window: 72 * HOUR_MS,
      });

      assert.ok(expired.ok);
      assert.strictEqual(expired.value.applied, false);
    });

    it("returns the record still clearable after the window expired", () => {
      const record = makeStrandedRecord();
      const expired = record.expireRetractionActionWindow({
        now: new Date(NOW.getTime() + 100 * HOUR_MS),
        window: 72 * HOUR_MS,
      });
      assert.ok(expired.ok);

      const cleared = record.clearPendingRetraction({ cause: "manually-removed", now: NOW });

      assert.ok(cleared.ok);
      assert.strictEqual(cleared.value.applied, true);
      assert.ok(!record.hasLiveContent());
    });
  });

  describe("alertTransition", () => {
    it("returns none while nothing is pending retraction", () => {
      const record = makeOpenRecord();

      assert.strictEqual(record.alertTransition().kind, "none");
    });

    it("returns a raise the first time a live set becomes the customer's problem", () => {
      const record = makeStrandedRecord(2);

      const transition = record.alertTransition();

      assert.strictEqual(transition.kind, "raise");
      assert.strictEqual(
        transition.kind === "raise" ? transition.supersededAlertKey : "x",
        undefined
      );
      assert.ok(record.retractionAlertHash !== undefined);
    });

    it("returns none when the live set has not changed since the last alert", () => {
      const record = makeStrandedRecord(2);
      assert.strictEqual(record.alertTransition().kind, "raise");

      assert.strictEqual(record.alertTransition().kind, "none");
    });

    it("returns a raise naming the superseded alert when the live set shrinks", () => {
      const record = makeStrandedRecord(2);
      const first = record.alertTransition();
      assert.strictEqual(first.kind, "raise");
      const firstHash = record.retractionAlertHash;

      const marked = record.markRetractionOutcome({
        outcome: "retracted",
        remaining: [makeFragment(2)],
        now: NOW,
      });
      assert.ok(marked.ok);
      const second = record.alertTransition();

      assert.strictEqual(second.kind, "raise");
      assert.strictEqual(
        second.kind === "raise" ? second.supersededAlertKey : undefined,
        firstHash
      );
      assert.notStrictEqual(record.retractionAlertHash, firstHash);
    });

    it("returns a resolve when the customer confirms the removal", () => {
      const record = makeStrandedRecord();
      assert.strictEqual(record.alertTransition().kind, "raise");
      const cleared = record.clearPendingRetraction({ cause: "manually-removed", now: NOW });
      assert.ok(cleared.ok);

      const transition = record.alertTransition();

      assert.strictEqual(transition.kind, "resolve");
      assert.strictEqual(
        transition.kind === "resolve" ? transition.cause : undefined,
        CHANNEL_RETRACTION_CLEARANCES.MANUALLY_REMOVED
      );
      assert.strictEqual(record.retractionAlertHash, undefined);
    });

    it("returns a resolve naming the expiry, and NOTHING afterwards", () => {
      const record = makeStrandedRecord(2);
      assert.strictEqual(record.alertTransition().kind, "raise");
      const expired = record.expireRetractionActionWindow({
        now: new Date(NOW.getTime() + 100 * HOUR_MS),
        window: 72 * HOUR_MS,
      });
      assert.ok(expired.ok);

      const resolve = record.alertTransition();
      assert.strictEqual(resolve.kind, "resolve");
      assert.strictEqual(
        resolve.kind === "resolve" ? resolve.cause : undefined,
        CHANNEL_FAILURE_CODES.ACTION_WINDOW_EXPIRED
      );

      // Clause 1 takes precedence over every other clause: a later change of the
      // live set raises nothing, and a later clearance resolves nothing.
      const shrunk = record.markRetractionOutcome({
        outcome: "retracted",
        remaining: [makeFragment(2)],
        now: NOW,
      });
      assert.ok(shrunk.ok);
      assert.strictEqual(record.alertTransition().kind, "none");

      const cleared = record.clearPendingRetraction({ cause: "manually-removed", now: NOW });
      assert.ok(cleared.ok);
      assert.strictEqual(record.alertTransition().kind, "none");
    });

    it("returns none for a record that was never alerted and is cleared", () => {
      const record = makeStrandedRecord();
      const cleared = record.clearPendingRetraction({ cause: "manually-removed", now: NOW });
      assert.ok(cleared.ok);

      assert.strictEqual(record.alertTransition().kind, "none");
    });
  });
});
