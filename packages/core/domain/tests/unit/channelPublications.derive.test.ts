/**
 * @file channelPublications.derive.test.ts
 * @description Unit tests for the ChannelPublications collection — the derivation of
 *   the post's publication word from the record set (total and order-independent),
 *   and the three predicates every lock, admission and guard reads.
 * @layer infrastructure
 */

import { describe, it } from "vitest";
import assert from "node:assert/strict";
import { ChannelPublications } from "@core/domain/aggregates/ChannelPublications.js";
import { ChannelPublication } from "@core/domain/entities/ChannelPublication.js";
import { ChannelId } from "@core/domain/value-objects/EntityId.js";
import { FragmentReference } from "@core/domain/value-objects/FragmentReference.js";
import { ContentFingerprint } from "@core/domain/value-objects/ContentFingerprint.js";
import { CHANNEL_FAILURE_CODES } from "@core/domain/value-objects/ExclusionReason.js";
import {
  ATTEMPT_CLASSIFICATIONS,
  PUBLICATION_OUTCOME_KINDS,
} from "@core/domain/value-objects/PublicationOutcome.js";
import { PUBLISH_STATUS } from "@core/domain/value-objects/PublishStatus.js";

// ---------------------------------------------------------------------------
// Mock factories — one record per channel, driven into the state under test
// ---------------------------------------------------------------------------

const NOW = new Date("2026-03-01T09:00:00.000Z");
const HOUR_MS = 60 * 60 * 1000;

let channelSeq = 0;

function nextChannelId(): ChannelId {
  channelSeq += 1;
  return ChannelId.fromStringUnsafe(
    `aa000000-0000-4000-8000-${String(channelSeq).padStart(12, "0")}`
  );
}

function makeFragment(index: number): FragmentReference {
  const result = FragmentReference.create({ index, externalId: `frag-${index}` });
  assert.ok(result.ok);
  return result.value;
}

function openRecord(): ChannelPublication {
  const record = ChannelPublication.declare(nextChannelId());
  const opened = record.openEpisode(1);
  assert.ok(opened.ok);
  return record;
}

function unresolvedRecord(): ChannelPublication {
  return openRecord();
}

function publishedRecord(): ChannelPublication {
  const record = openRecord();
  const result = record.recordAttempt({
    episode: 1,
    attemptNo: 1,
    planSize: 1,
    result: {
      kind: PUBLICATION_OUTCOME_KINDS.PUBLISHED,
      fragments: [makeFragment(1)],
      publishedAt: NOW,
      contentHash: ContentFingerprint.ofContent({ body: "hello", mediaIds: [] }),
    },
    now: NOW,
  });
  assert.ok(result.ok);
  return record;
}

function excludedRecord(): ChannelPublication {
  const record = openRecord();
  const result = record.recordAttempt({
    episode: 1,
    attemptNo: 1,
    planSize: 1,
    result: {
      kind: "failed",
      classification: ATTEMPT_CLASSIFICATIONS.NONTRANSIENT,
      code: CHANNEL_FAILURE_CODES.CHANNEL_AUTH_REQUIRED,
      publishedFragments: [],
    },
    now: NOW,
  });
  assert.ok(result.ok);
  return record;
}

function strandedRecord(): ChannelPublication {
  const record = openRecord();
  const result = record.recordAttempt({
    episode: 1,
    attemptNo: 1,
    planSize: 3,
    result: {
      kind: "failed",
      classification: ATTEMPT_CLASSIFICATIONS.TRANSIENT,
      code: CHANNEL_FAILURE_CODES.CONTENT_REJECTED,
      publishedFragments: [makeFragment(1)],
    },
    now: NOW,
  });
  assert.ok(result.ok);
  return record;
}

const BUILDERS = {
  unresolved: unresolvedRecord,
  published: publishedRecord,
  excluded: excludedRecord,
} as const;

type BuilderKey = keyof typeof BUILDERS;

/** Every ordered combination of `size` record kinds. */
function combinations(size: number): BuilderKey[][] {
  const keys = Object.keys(BUILDERS) as BuilderKey[];
  if (size === 0) {
    return [[]];
  }
  return combinations(size - 1).flatMap((prefix) => keys.map((key) => [...prefix, key]));
}

function permutations<T>(items: readonly T[]): T[][] {
  if (items.length <= 1) {
    return [[...items]];
  }
  return items.flatMap((item, index) =>
    permutations([...items.slice(0, index), ...items.slice(index + 1)]).map((rest) => [
      item,
      ...rest,
    ])
  );
}

function deriveOf(kinds: readonly BuilderKey[]): string | undefined {
  return ChannelPublications.of(kinds.map((kind) => BUILDERS[kind]())).derive();
}

// ---------------------------------------------------------------------------

describe("ChannelPublications", () => {
  describe("derive", () => {
    it("returns no derivation for the empty set", () => {
      assert.strictEqual(ChannelPublications.empty().derive(), undefined);
    });

    it("returns PUBLISHED when every channel published every fragment", () => {
      assert.strictEqual(
        deriveOf(["published", "published", "published"]),
        PUBLISH_STATUS.PUBLISHED
      );
    });

    it("returns PARTIALLY_PUBLISHED when two published and one is excluded", () => {
      assert.strictEqual(
        deriveOf(["published", "published", "excluded"]),
        PUBLISH_STATUS.PARTIALLY_PUBLISHED
      );
    });

    it("returns PUBLISHING while any intended channel is unresolved", () => {
      assert.strictEqual(deriveOf(["published", "unresolved"]), PUBLISH_STATUS.PUBLISHING);
      assert.strictEqual(deriveOf(["excluded", "unresolved"]), PUBLISH_STATUS.PUBLISHING);
    });

    it("returns FAILED when no channel published, never PARTIALLY_PUBLISHED", () => {
      assert.strictEqual(deriveOf(["excluded", "excluded"]), PUBLISH_STATUS.FAILED);
    });

    it("returns FAILED for a stranded channel, so live fragments never make a post partial", () => {
      const records = ChannelPublications.of([strandedRecord()]);

      assert.strictEqual(records.derive(), PUBLISH_STATUS.FAILED);
      assert.ok(records.hasLiveContent(), "the lock is engaged even though the word is FAILED");
    });

    it("returns the same word after the action window expired", () => {
      const stranded = strandedRecord();
      const before = ChannelPublications.of([stranded]).derive();
      const expired = stranded.expireRetractionActionWindow({
        now: new Date(NOW.getTime() + 100 * HOUR_MS),
        window: 72 * HOUR_MS,
      });
      assert.ok(expired.ok);

      assert.strictEqual(ChannelPublications.of([stranded]).derive(), before);
      assert.strictEqual(before, PUBLISH_STATUS.FAILED);
    });

    it("returns exactly one defined word for every combination of up to three channels", () => {
      const allowed: readonly string[] = [
        PUBLISH_STATUS.PUBLISHED,
        PUBLISH_STATUS.PARTIALLY_PUBLISHED,
        PUBLISH_STATUS.PUBLISHING,
        PUBLISH_STATUS.FAILED,
      ];

      const cases = [1, 2, 3].flatMap((size) => combinations(size));
      assert.strictEqual(cases.length, 3 + 9 + 27, "every combination is exercised");

      for (const kinds of cases) {
        const derived = deriveOf(kinds);
        assert.ok(
          derived !== undefined && allowed.includes(derived),
          `${kinds.join("+")} derived ${String(derived)}`
        );
      }
    });

    it("returns the same word whatever order the outcomes arrived in", () => {
      const multiset: BuilderKey[] = ["published", "excluded", "unresolved"];
      const derived = permutations(multiset).map((order) => deriveOf(order));

      assert.strictEqual(derived.length, 6);
      assert.strictEqual(new Set(derived).size, 1, "permuting the arrival order changes nothing");
      assert.strictEqual(derived[0], PUBLISH_STATUS.PUBLISHING);
    });
  });

  describe("predicates", () => {
    it("returns no live content for a set of unresolved and excluded records", () => {
      const records = ChannelPublications.of([unresolvedRecord(), excludedRecord()]);

      assert.ok(!records.hasLiveContent());
      assert.ok(records.noLiveContent());
    });

    it("returns live content when any channel published", () => {
      const records = ChannelPublications.of([excludedRecord(), publishedRecord()]);

      assert.ok(records.hasLiveContent());
      assert.ok(!records.noLiveContent());
    });

    it("returns only the channels that may be attempted again", () => {
      const published = publishedRecord();
      const excluded = excludedRecord();
      const stranded = strandedRecord();
      const records = ChannelPublications.of([published, excluded, stranded]);

      const redrivable = records.redrivable();

      assert.deepStrictEqual(
        redrivable.map((record) => record.channelId.value),
        [excluded.channelId.value]
      );
    });

    it("returns the record for a channel it holds, and nothing for one it does not", () => {
      const published = publishedRecord();
      const records = ChannelPublications.of([published]);

      assert.strictEqual(
        records.find(published.channelId)?.channelId.value,
        published.channelId.value
      );
      assert.strictEqual(records.find(nextChannelId()), undefined);
      assert.strictEqual(records.size, 1);
      assert.ok(!records.isEmpty());
      assert.ok(ChannelPublications.empty().isEmpty());
    });
  });
});
