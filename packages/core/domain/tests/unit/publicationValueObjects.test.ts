/**
 * @file publicationValueObjects.test.ts
 * @description Unit tests for the channel-publication value objects — the fragment
 *   reference, the provider reference, the exclusion reason, the content fingerprint
 *   and the composed publication outcome. Each one is the smallest unit the record
 *   entity is built from, so each is pinned on its own.
 * @layer infrastructure
 */

import { describe, it } from "vitest";
import assert from "node:assert/strict";
import {
  FragmentReference,
  type FragmentReferenceJson,
} from "@core/domain/value-objects/FragmentReference.js";
import {
  providedReference,
  noneReturnedReference,
  isProvidedReference,
  PROVIDER_REFERENCE_KINDS,
} from "@core/domain/value-objects/ProviderReference.js";
import {
  ExclusionReason,
  CHANNEL_FAILURE_CODES,
} from "@core/domain/value-objects/ExclusionReason.js";
import { ContentFingerprint } from "@core/domain/value-objects/ContentFingerprint.js";
import {
  publishedOutcome,
  excludedOutcome,
  unresolvedOutcome,
  outcomeHasLiveContent,
  liveFragmentsOf,
  PUBLICATION_OUTCOME_KINDS,
  CHANNEL_RETRACTION_BLOCKS,
} from "@core/domain/value-objects/PublicationOutcome.js";

// ---------------------------------------------------------------------------
// Mock factories — no magic values inline
// ---------------------------------------------------------------------------

function makeFragment(overrides?: Partial<FragmentReferenceJson>): FragmentReference {
  const result = FragmentReference.create({
    index: overrides?.index ?? 1,
    externalId: overrides?.externalId ?? "tweet-1",
    ...(overrides?.url !== undefined && { url: overrides.url }),
  });
  assert.ok(result.ok, "the fragment fixture is valid");
  return result.value;
}

const PUBLISHED_AT = new Date("2026-02-01T10:00:00.000Z");

describe("FragmentReference", () => {
  it("returns the ordered reference when index, externalId and url are valid", () => {
    const result = FragmentReference.create({
      index: 2,
      externalId: "tweet-2",
      url: "https://x.com/u/status/2",
    });

    assert.ok(result.ok);
    assert.strictEqual(result.value.index, 2);
    assert.strictEqual(result.value.externalId, "tweet-2");
    assert.strictEqual(result.value.url, "https://x.com/u/status/2");
  });

  it("returns a reference without a url when none is supplied", () => {
    const fragment = makeFragment();

    assert.strictEqual(fragment.url, undefined);
    assert.deepStrictEqual(fragment.toJSON(), { index: 1, externalId: "tweet-1" });
  });

  it("returns an error when the index is below one", () => {
    const result = FragmentReference.create({ index: 0, externalId: "tweet-0" });

    assert.ok(!result.ok);
    assert.match(result.error.message, /index/i);
  });

  it("returns an error when the index is not an integer", () => {
    const result = FragmentReference.create({ index: 1.5, externalId: "tweet-1" });

    assert.ok(!result.ok);
    assert.match(result.error.message, /index/i);
  });

  it("returns an error when the external id is empty", () => {
    const result = FragmentReference.create({ index: 1, externalId: "   " });

    assert.ok(!result.ok);
    assert.match(result.error.message, /external/i);
  });

  it("returns equality by value, not by reference", () => {
    const one = makeFragment({ index: 3, externalId: "tweet-3" });
    const other = makeFragment({ index: 3, externalId: "tweet-3" });
    const different = makeFragment({ index: 3, externalId: "tweet-4" });

    assert.ok(one.equals(other));
    assert.ok(!one.equals(different));
  });

  it("returns the reference again when its own JSON is parsed back", () => {
    const fragment = makeFragment({ index: 4, externalId: "tweet-4", url: "https://x.com/4" });

    const parsed = FragmentReference.fromJSON(fragment.toJSON());

    assert.ok(parsed.ok);
    assert.ok(parsed.value.equals(fragment));
    assert.strictEqual(parsed.value.url, "https://x.com/4");
  });

  it("returns an error when the parsed value is not a fragment shape", () => {
    const parsed = FragmentReference.fromJSON({ index: "first", externalId: "tweet-1" });

    assert.ok(!parsed.ok);
  });
});

describe("ProviderReference", () => {
  it("returns a provided reference carrying the identifier the provider returned", () => {
    const result = providedReference("tweet-99");

    assert.ok(result.ok);
    assert.strictEqual(result.value.kind, PROVIDER_REFERENCE_KINDS.PROVIDED);
    assert.ok(isProvidedReference(result.value));
    assert.strictEqual(isProvidedReference(result.value) ? result.value.id : undefined, "tweet-99");
  });

  it("returns an error when the provided identifier is empty", () => {
    const result = providedReference("  ");

    assert.ok(!result.ok);
  });

  it("returns a none-returned reference that is distinguishable from a provided one", () => {
    const none = noneReturnedReference();

    assert.strictEqual(none.kind, PROVIDER_REFERENCE_KINDS.NONE_RETURNED);
    assert.ok(!isProvidedReference(none));
  });
});

describe("ExclusionReason", () => {
  it("returns the reason when the code belongs to the closed set", () => {
    const result = ExclusionReason.create({
      code: CHANNEL_FAILURE_CODES.THREAD_INTERRUPTED,
      detail: "fragment 3 of 4 was rejected",
    });

    assert.ok(result.ok);
    assert.strictEqual(result.value.code, "THREAD_INTERRUPTED");
    assert.strictEqual(result.value.detail, "fragment 3 of 4 was rejected");
  });

  it("returns an error when the code is outside the closed set", () => {
    const result = ExclusionReason.create({ code: "MYSTERY" as never });

    assert.ok(!result.ok);
    assert.match(result.error.message, /MYSTERY/);
  });

  it("returns a detail bounded to its maximum length", () => {
    // Short words on purpose: a single long run would be read as a credential and
    // redacted before the bound is ever reached, which would prove the wrong rule.
    const longMessage = "the provider rejected this slide. ".repeat(30);
    assert.ok(longMessage.length > ExclusionReason.MAX_DETAIL_LENGTH);

    const result = ExclusionReason.create({
      code: CHANNEL_FAILURE_CODES.CONTENT_REJECTED,
      detail: longMessage,
    });

    assert.ok(result.ok);
    assert.strictEqual(result.value.detail?.length, ExclusionReason.MAX_DETAIL_LENGTH);
  });

  it("returns a redacted detail even when the credential run sits past the bound", () => {
    const filler = "the provider rejected this slide. ".repeat(30);
    const result = ExclusionReason.create({
      code: CHANNEL_FAILURE_CODES.CHANNEL_AUTH_REQUIRED,
      detail: `${filler} token=abcdefghijklmnopqrstuvwxyz012345`,
    });

    assert.ok(result.ok);
    assert.ok(!result.value.detail?.includes("abcdefghijklmnopqrstuvwxyz012345"));
  });

  it("returns a detail with credential-shaped runs replaced", () => {
    const result = ExclusionReason.create({
      code: CHANNEL_FAILURE_CODES.CHANNEL_AUTH_REQUIRED,
      detail: "refused for Bearer abc123def456ghi789 on retry",
    });

    assert.ok(result.ok);
    assert.ok(!result.value.detail?.includes("abc123def456ghi789"));
    assert.match(result.value.detail ?? "", /\[redacted\]/);
  });

  it("returns no detail when only whitespace was supplied", () => {
    const result = ExclusionReason.create({
      code: CHANNEL_FAILURE_CODES.RENDER_FAILED,
      detail: "   ",
    });

    assert.ok(result.ok);
    assert.strictEqual(result.value.detail, undefined);
  });
});

describe("ContentFingerprint", () => {
  it("returns the same fingerprint for the same body and media order", () => {
    const one = ContentFingerprint.ofContent({ body: "hello", mediaIds: ["m1", "m2"] });
    const other = ContentFingerprint.ofContent({ body: "hello", mediaIds: ["m1", "m2"] });

    assert.strictEqual(one.value, other.value);
    assert.ok(one.equals(other));
  });

  it("returns a different fingerprint when the media ORDER changes", () => {
    const one = ContentFingerprint.ofContent({ body: "hello", mediaIds: ["m1", "m2"] });
    const reordered = ContentFingerprint.ofContent({ body: "hello", mediaIds: ["m2", "m1"] });

    assert.notStrictEqual(one.value, reordered.value);
  });

  it("returns a different fingerprint when the body changes", () => {
    const one = ContentFingerprint.ofContent({ body: "hello", mediaIds: [] });
    const other = ContentFingerprint.ofContent({ body: "hello ", mediaIds: [] });

    assert.notStrictEqual(one.value, other.value);
  });

  it("returns the stored fingerprint when a persisted value is parsed back", () => {
    const original = ContentFingerprint.ofContent({ body: "hello", mediaIds: ["m1"] });

    const parsed = ContentFingerprint.fromString(original.value);

    assert.ok(parsed.ok);
    assert.ok(parsed.value.equals(original));
  });

  it("returns an error when the persisted value is not a fingerprint", () => {
    const parsed = ContentFingerprint.fromString("not-a-hash");

    assert.ok(!parsed.ok);
  });
});

describe("PublicationOutcome", () => {
  it("returns a published outcome whose live set is every fragment that went out", () => {
    const fragments = [makeFragment({ index: 1 }), makeFragment({ index: 2, externalId: "t-2" })];
    const head = providedReference("t-1");
    assert.ok(head.ok);

    const outcome = publishedOutcome({
      head: head.value,
      fragments,
      publishedAt: PUBLISHED_AT,
      contentHash: ContentFingerprint.ofContent({ body: "hello", mediaIds: [] }),
    });

    assert.strictEqual(outcome.kind, PUBLICATION_OUTCOME_KINDS.PUBLISHED);
    assert.ok(outcomeHasLiveContent(outcome));
    assert.deepStrictEqual(
      liveFragmentsOf(outcome).map((f) => f.externalId),
      ["tweet-1", "t-2"]
    );
  });

  it("returns an unresolved outcome that holds no live content", () => {
    const outcome = unresolvedOutcome();

    assert.strictEqual(outcome.kind, PUBLICATION_OUTCOME_KINDS.UNRESOLVED);
    assert.ok(!outcomeHasLiveContent(outcome));
    assert.deepStrictEqual(liveFragmentsOf(outcome), []);
  });

  it("returns an excluded outcome with nothing pending that holds no live content", () => {
    const reason = ExclusionReason.create({ code: CHANNEL_FAILURE_CODES.BUDGET_EXHAUSTED });
    assert.ok(reason.ok);

    const outcome = excludedOutcome({
      reason: reason.value,
      excludedAt: PUBLISHED_AT,
      retraction: { pending: false },
    });

    assert.strictEqual(outcome.kind, PUBLICATION_OUTCOME_KINDS.EXCLUDED);
    assert.ok(!outcomeHasLiveContent(outcome));
  });

  it("returns an excluded outcome pending retraction that DOES hold live content", () => {
    const reason = ExclusionReason.create({ code: CHANNEL_FAILURE_CODES.THREAD_INTERRUPTED });
    assert.ok(reason.ok);
    const live = [makeFragment({ index: 1 })];

    const outcome = excludedOutcome({
      reason: reason.value,
      excludedAt: PUBLISHED_AT,
      retraction: {
        pending: true,
        live,
        blockedBy: CHANNEL_RETRACTION_BLOCKS.NO_CAPABILITY,
        window: { startedAt: PUBLISHED_AT },
      },
    });

    assert.ok(outcomeHasLiveContent(outcome));
    assert.deepStrictEqual(
      liveFragmentsOf(outcome).map((f) => f.externalId),
      ["tweet-1"]
    );
  });
});
