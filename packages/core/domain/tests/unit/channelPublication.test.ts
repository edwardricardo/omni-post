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
  type ChannelPublicationState,
} from "@core/domain/entities/ChannelPublication.js";
import { ChannelId } from "@core/domain/value-objects/EntityId.js";
import { FragmentReference } from "@core/domain/value-objects/FragmentReference.js";
import { ContentFingerprint } from "@core/domain/value-objects/ContentFingerprint.js";
import { providedReference } from "@core/domain/value-objects/ProviderReference.js";
import {
  CHANNEL_FAILURE_CODES,
  ExclusionReason,
} from "@core/domain/value-objects/ExclusionReason.js";
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

/** A complete persisted published state — every field the outcome needs. */
function publishedState(): ChannelPublicationState {
  const head = providedReference("frag-1");
  assert.ok(head.ok);
  return {
    id: "11111111-0000-4000-8000-000000000001",
    channelId: ChannelId.fromStringUnsafe(CHANNEL_A),
    outcomeKind: PUBLICATION_OUTCOME_KINDS.PUBLISHED,
    head: head.value,
    liveFragments: [makeFragment(1)],
    publishedAt: NOW,
    contentHash: makeFingerprint(),
    attempts: 1,
    episode: 1,
    episodeAttempts: 1,
  };
}

/** A persisted unresolved state: no settlement of either kind, which is the whole point. */
function unresolvedState(): ChannelPublicationState {
  return {
    id: "11111111-0000-4000-8000-000000000003",
    channelId: ChannelId.fromStringUnsafe(CHANNEL_A),
    outcomeKind: PUBLICATION_OUTCOME_KINDS.UNRESOLVED,
    attempts: 1,
    episode: 1,
    episodeAttempts: 1,
  };
}

/** A complete persisted excluded state — the reason and the moment it was written. */
function excludedState(): ChannelPublicationState {
  const reason = ExclusionReason.create({ code: CHANNEL_FAILURE_CODES.CONTENT_REJECTED });
  assert.ok(reason.ok);
  return {
    id: "11111111-0000-4000-8000-000000000002",
    channelId: ChannelId.fromStringUnsafe(CHANNEL_A),
    outcomeKind: PUBLICATION_OUTCOME_KINDS.EXCLUDED,
    reason: reason.value,
    excludedAt: NOW,
    attempts: 1,
    episode: 1,
    episodeAttempts: 1,
  };
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

    it("returns an unresolved record carrying the attempt but no cause when the failure names none", () => {
      const record = makeOpenRecord();

      const result = record.recordAttempt({
        episode: 1,
        attemptNo: 1,
        planSize: 1,
        result: {
          kind: "failed",
          classification: ATTEMPT_CLASSIFICATIONS.TRANSIENT,
          publishedFragments: [],
        },
        now: NOW,
      });

      assert.ok(result.ok);
      assert.strictEqual(record.outcome.kind, PUBLICATION_OUTCOME_KINDS.UNRESOLVED);
      assert.strictEqual(record.attempts, 1);
      // The KEY is absent, not present holding undefined: the record either names a
      // cause or says nothing, and a key carrying undefined is the third reading.
      assert.strictEqual(Object.hasOwn(record.lastFailure ?? {}, "code"), false);
      assert.deepStrictEqual(record.lastFailure?.at, NOW, "the attempt is still stamped");
    });

    it("returns an error when a nontransient failure names no cause", () => {
      const record = makeOpenRecord();

      const result = record.recordAttempt({
        episode: 1,
        attemptNo: 1,
        planSize: 1,
        result: {
          kind: "failed",
          classification: ATTEMPT_CLASSIFICATIONS.NONTRANSIENT,
          publishedFragments: [],
        },
        now: NOW,
      });

      assert.ok(!result.ok);
      assert.match(result.error.message, /cause/i);
      assert.strictEqual(record.attempts, 0, "a refused attempt spends nothing");
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

    it("returns the clearance FORGOTTEN once a new episode opens over it", () => {
      // The clearance is a fact about the episode it settled. Carrying it into the next
      // one lets a reader that asks "did the customer already confirm this channel?"
      // read YES about an episode that never stranded anything — which turns the next
      // confirmation of a genuinely stranded channel into a success it never performed.
      const record = makeStrandedRecord();
      const cleared = record.clearPendingRetraction({ cause: "manually-removed", now: NOW });
      assert.ok(cleared.ok && cleared.value.applied, "the fixture confirms the removal first");

      const opened = record.openEpisode(record.episode + 1);

      assert.ok(opened.ok, "a channel with nothing live is re-drivable");
      assert.strictEqual(
        record.retractionClearedCause,
        undefined,
        "the previous episode's clearance does not describe this one"
      );
      assert.strictEqual(record.retractionClearedAt, undefined);
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

    it("refuses a window that is not a finite number instead of expiring on it", () => {
      // `now < startedAt + NaN` is FALSE, so a guard written only as a comparison is
      // NOT taken and the record expires — the one malformed argument here that fails
      // OPEN. The invariant belongs to the entity, not to whichever caller remembered
      // to validate first.
      const record = makeStrandedRecord();

      const expired = record.expireRetractionActionWindow({
        now: new Date(NOW.getTime() + 100 * HOUR_MS),
        window: Number.NaN,
      });

      assert.strictEqual(
        record.actionWindowExpiredAt,
        undefined,
        "the window the malformed argument would have closed is still open"
      );
      assert.ok(!expired.ok, "an unusable duration is refused, never applied");
    });

    it("refuses a negative window instead of expiring on it", () => {
      const record = makeStrandedRecord();

      const expired = record.expireRetractionActionWindow({
        now: NOW,
        window: -1,
      });

      assert.strictEqual(record.actionWindowExpiredAt, undefined);
      assert.ok(!expired.ok);
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

  describe("reconstitution refuses a state the record could never have produced", () => {
    it("returns an error when a published state carries no content fingerprint", () => {
      const rebuilt = ChannelPublication.reconstitute({
        ...publishedState(),
        contentHash: undefined,
      });

      assert.ok(!rebuilt.ok, "a published row without a fingerprint is a corrupted row");
      assert.match(rebuilt.error.message, /fingerprint/i);
    });

    it("returns an error when a published state carries no publication moment", () => {
      const rebuilt = ChannelPublication.reconstitute({
        ...publishedState(),
        publishedAt: undefined,
      });

      assert.ok(!rebuilt.ok, "a published row without a moment is a corrupted row");
      assert.match(rebuilt.error.message, /moment/i);
    });

    it("returns an error when a published state carries no head reference", () => {
      const rebuilt = ChannelPublication.reconstitute({ ...publishedState(), head: undefined });

      assert.ok(!rebuilt.ok, "a published row without a head is a corrupted row");
      assert.match(rebuilt.error.message, /head/i);
    });

    it("returns an error when an excluded state carries no reason", () => {
      const rebuilt = ChannelPublication.reconstitute({ ...excludedState(), reason: undefined });

      assert.ok(!rebuilt.ok, "an exclusion without a reason is the state this record forbids");
      assert.match(rebuilt.error.message, /reason/i);
    });

    it("returns an error when an excluded state carries no exclusion moment", () => {
      const rebuilt = ChannelPublication.reconstitute({
        ...excludedState(),
        excludedAt: undefined,
      });

      assert.ok(!rebuilt.ok, "an exclusion without a moment is a corrupted row");
      assert.match(rebuilt.error.message, /moment/i);
    });

    it("returns the stored fingerprint and moment when the published state is complete", () => {
      const rebuilt = ChannelPublication.reconstitute(publishedState());

      assert.ok(rebuilt.ok);
      const outcome = rebuilt.value.outcome;
      assert.ok(isPublishedOutcome(outcome));
      assert.strictEqual(outcome.contentHash.value, makeFingerprint().value);
      assert.strictEqual(outcome.publishedAt.getTime(), NOW.getTime());
    });

    it("returns the stored reason and moment when the excluded state is complete", () => {
      const rebuilt = ChannelPublication.reconstitute(excludedState());

      assert.ok(rebuilt.ok);
      const outcome = rebuilt.value.outcome;
      assert.ok(isExcludedOutcome(outcome));
      assert.strictEqual(outcome.reason.code, CHANNEL_FAILURE_CODES.CONTENT_REJECTED);
      assert.strictEqual(outcome.excludedAt.getTime(), NOW.getTime());
    });

    it("returns an error when an unresolved state carries a settlement fact", () => {
      const head = providedReference("frag-1");
      assert.ok(head.ok);
      const reason = ExclusionReason.create({ code: CHANNEL_FAILURE_CODES.CONTENT_REJECTED });
      assert.ok(reason.ok);

      const carried: readonly { fact: string; state: Partial<ChannelPublicationState> }[] = [
        { fact: "head", state: { head: head.value } },
        { fact: "publishedAt", state: { publishedAt: NOW } },
        { fact: "contentHash", state: { contentHash: makeFingerprint() } },
        { fact: "reason", state: { reason: reason.value } },
        { fact: "excludedAt", state: { excludedAt: NOW } },
      ];

      for (const { fact, state } of carried) {
        const rebuilt = ChannelPublication.reconstitute({ ...unresolvedState(), ...state });

        assert.ok(
          !rebuilt.ok,
          `an unresolved row carrying ${fact} is a corrupted row, not a row to strip`
        );
        assert.match(rebuilt.error.message, /unresolved/i);
      }
    });

    it("returns the record when the unresolved state carries no settlement fact", () => {
      const rebuilt = ChannelPublication.reconstitute(unresolvedState());

      assert.ok(rebuilt.ok);
      assert.strictEqual(rebuilt.value.outcome.kind, PUBLICATION_OUTCOME_KINDS.UNRESOLVED);
    });
  });

  describe("an attempt is refused while content is live on the provider", () => {
    it("returns an error when an attempt is recorded against a published channel", () => {
      const record = makeOpenRecord();
      const first = record.recordAttempt({
        episode: 1,
        attemptNo: 1,
        planSize: 1,
        result: publishedResult(1),
        now: NOW,
      });
      assert.ok(first.ok);

      const second = record.recordAttempt({
        episode: 1,
        attemptNo: 2,
        planSize: 1,
        result: failedResult({ classification: ATTEMPT_CLASSIFICATIONS.TRANSIENT }),
        now: NOW,
      });

      assert.ok(!second.ok, "a published channel would double-post or orphan what is live");
      assert.match(second.error.message, /live/i);
      assert.ok(record.isPublished(), "the settled outcome survives the refusal");
      assert.strictEqual(record.liveFragments.length, 1);
      assert.ok(record.hasLiveContent());
    });

    it("returns an error when an attempt is recorded against a channel pending retraction", () => {
      const record = makeStrandedRecord();

      const next = record.recordAttempt({
        episode: 1,
        attemptNo: 2,
        planSize: 4,
        result: failedResult({ classification: ATTEMPT_CLASSIFICATIONS.TRANSIENT }),
        now: NOW,
      });

      assert.ok(!next.ok, "fragments are still on the provider");
      assert.match(next.error.message, /live/i);
      assert.ok(record.pendingRetraction, "the pending retraction survives the refusal");
      assert.strictEqual(record.liveFragments.length, 2);
    });

    it("returns applied false when a published channel replays the attempt it already recorded", () => {
      const record = makeOpenRecord();
      const first = record.recordAttempt({
        episode: 1,
        attemptNo: 1,
        planSize: 1,
        result: publishedResult(1),
        now: NOW,
      });
      assert.ok(first.ok);

      const replay = record.recordAttempt({
        episode: 1,
        attemptNo: 1,
        planSize: 1,
        result: publishedResult(1),
        now: NOW,
      });

      assert.ok(replay.ok, "idempotence comes before the live-content refusal");
      assert.strictEqual(replay.value.applied, false);
    });
  });
});
