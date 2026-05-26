/**
 * @file mention.aggregate.test.ts
 * @description Unit tests for the Mention aggregate factory: required-field
 *   validation and ingest defaults (sentiment null, optional channel/tracked-term).
 * @layer infrastructure
 */

import { describe, it, expect } from "vitest";
import assert from "node:assert/strict";
import { MentionAggregate } from "@core/domain/aggregates/MentionAggregate.js";
import { AccountId, ProjectId, ChannelId } from "@core/domain/value-objects/EntityId.js";
import type { ProviderType } from "@core/domain/value-objects/Provider.js";

const ACCOUNT_ID = "11111111-1111-4111-8111-111111111111";
const PROJECT_ID = "22222222-2222-4222-8222-222222222222";
const CHANNEL_ID = "33333333-3333-4333-8333-333333333333";

function makeProps(overrides?: Record<string, unknown>) {
  return {
    accountId: AccountId.fromStringUnsafe(ACCOUNT_ID),
    projectId: ProjectId.fromStringUnsafe(PROJECT_ID),
    provider: "X" as ProviderType,
    externalId: "ext-1",
    source: "SEARCH" as const,
    authorName: "Jane",
    authorProviderId: "provider-user-1",
    body: "A mention body",
    providerCreatedAt: new Date("2026-05-01T00:00:00Z"),
    ...overrides,
  };
}

describe("MentionAggregate.create", () => {
  it("creates a valid mention with ingest defaults", () => {
    const r = MentionAggregate.create(makeProps());
    assert.ok(r.ok, `Expected ok, got: ${!r.ok ? r.error.message : ""}`);
    const m = r.value;
    expect(m.id.value.length).toBeGreaterThan(0);
    expect(m.channelId).toBeNull();
    expect(m.trackedTermId).toBeNull();
    expect(m.sentimentScore).toBeNull();
    expect(m.sentimentLabel).toBeNull();
    expect(m.mediaUrls).toEqual([]);
    expect(m.entityType).toBe("Mention");
  });

  it("keeps a provided channelId", () => {
    const r = MentionAggregate.create(
      makeProps({ channelId: ChannelId.fromStringUnsafe(CHANNEL_ID) })
    );
    assert.ok(r.ok);
    expect(r.value.channelId?.value).toBe(CHANNEL_ID);
  });

  it("rejects an empty externalId", () => {
    assert.ok(!MentionAggregate.create(makeProps({ externalId: "  " })).ok);
  });

  it("rejects an empty authorName", () => {
    assert.ok(!MentionAggregate.create(makeProps({ authorName: "" })).ok);
  });

  it("rejects an empty authorProviderId", () => {
    assert.ok(!MentionAggregate.create(makeProps({ authorProviderId: "" })).ok);
  });

  it("rejects an empty body", () => {
    assert.ok(!MentionAggregate.create(makeProps({ body: "" })).ok);
  });

  it("serializes to a plain object via toJSON", () => {
    const r = MentionAggregate.create(makeProps());
    assert.ok(r.ok);
    const json = r.value.toJSON();
    expect(json.provider).toBe("X");
    expect(json.externalId).toBe("ext-1");
    expect(json.body).toBe("A mention body");
  });
});
