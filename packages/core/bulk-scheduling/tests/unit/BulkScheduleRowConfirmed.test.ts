/**
 * @file BulkScheduleRowConfirmed.test.ts
 * @description Unit tests for the BulkScheduleRowConfirmed domain event.
 *   Spec scenario: "Confirm persists atomically" — the event payload carries
 *   all fields required by the dispatch handler and the outbox relay.
 * @layer infrastructure
 */

import { describe, it } from "vitest";
import assert from "node:assert/strict";
import { BulkScheduleRowConfirmed } from "../../src/events/BulkScheduleRowConfirmed.js";

const ITEM_ID = "item-uuid-001";
const BATCH_ID = "batch-uuid-001";
const ACCOUNT_ID = "account-uuid-001";
const PROJECT_ID = "project-uuid-001";
const BODY = "Hello from bulk schedule!";
const SCHEDULED_FOR = "2026-07-01T10:00:00.000Z";
const TIMEZONE = "America/New_York";
const CHANNEL_IDS = ["ch-001", "ch-002"] as const;
const MEDIA = [{ url: "https://cdn.example.com/photo.jpg", type: "image" as const }];
const TAGS = ["promo", "summer"];
const TITLE = "My Bulk Post";

describe("BulkScheduleRowConfirmed", () => {
  describe("toPayload()", () => {
    it("returns all required fields in the payload", () => {
      const event = new BulkScheduleRowConfirmed(
        ITEM_ID,
        BATCH_ID,
        ACCOUNT_ID,
        PROJECT_ID,
        BODY,
        SCHEDULED_FOR,
        TIMEZONE,
        CHANNEL_IDS,
        MEDIA,
        TAGS,
        TITLE
      );

      const payload = event.toPayload();

      assert.strictEqual(payload.itemId, ITEM_ID);
      assert.strictEqual(payload.batchId, BATCH_ID);
      assert.strictEqual(payload.accountId, ACCOUNT_ID);
      assert.strictEqual(payload.projectId, PROJECT_ID);
      assert.strictEqual(payload.body, BODY);
      assert.strictEqual(payload.scheduledFor, SCHEDULED_FOR);
      assert.strictEqual(payload.timezone, TIMEZONE);
      assert.deepStrictEqual(payload.channelIds, [...CHANNEL_IDS]);
      assert.deepStrictEqual(
        payload.media,
        MEDIA.map((m) => ({ url: m.url, type: m.type }))
      );
      assert.deepStrictEqual(payload.tags, [...TAGS]);
      assert.strictEqual(payload.title, TITLE);
    });

    it("omits title from payload when not provided", () => {
      const event = new BulkScheduleRowConfirmed(
        ITEM_ID,
        BATCH_ID,
        ACCOUNT_ID,
        PROJECT_ID,
        BODY,
        SCHEDULED_FOR,
        TIMEZONE,
        CHANNEL_IDS,
        MEDIA,
        TAGS
        // title omitted
      );

      const payload = event.toPayload();

      assert.strictEqual("title" in payload, false);
    });

    it("returns empty arrays for channelIds, media, and tags when empty", () => {
      const event = new BulkScheduleRowConfirmed(
        ITEM_ID,
        BATCH_ID,
        ACCOUNT_ID,
        PROJECT_ID,
        BODY,
        SCHEDULED_FOR,
        TIMEZONE,
        [],
        [],
        []
      );

      const payload = event.toPayload();

      assert.deepStrictEqual(payload.channelIds, []);
      assert.deepStrictEqual(payload.media, []);
      assert.deepStrictEqual(payload.tags, []);
    });
  });

  describe("event identity", () => {
    it("aggregateType equals BulkScheduleItem", () => {
      const event = new BulkScheduleRowConfirmed(
        ITEM_ID,
        BATCH_ID,
        ACCOUNT_ID,
        PROJECT_ID,
        BODY,
        SCHEDULED_FOR,
        TIMEZONE,
        CHANNEL_IDS,
        MEDIA,
        TAGS
      );

      assert.strictEqual(event.aggregateType, "BulkScheduleItem");
    });

    it("aggregateId equals itemId", () => {
      const event = new BulkScheduleRowConfirmed(
        ITEM_ID,
        BATCH_ID,
        ACCOUNT_ID,
        PROJECT_ID,
        BODY,
        SCHEDULED_FOR,
        TIMEZONE,
        CHANNEL_IDS,
        MEDIA,
        TAGS
      );

      assert.strictEqual(event.aggregateId, ITEM_ID);
    });

    it("eventType equals BulkScheduleRowConfirmed", () => {
      const event = new BulkScheduleRowConfirmed(
        ITEM_ID,
        BATCH_ID,
        ACCOUNT_ID,
        PROJECT_ID,
        BODY,
        SCHEDULED_FOR,
        TIMEZONE,
        CHANNEL_IDS,
        MEDIA,
        TAGS
      );

      assert.strictEqual(event.eventType, "BulkScheduleRowConfirmed");
    });

    it("generates a unique eventId on construction", () => {
      const event1 = new BulkScheduleRowConfirmed(
        ITEM_ID,
        BATCH_ID,
        ACCOUNT_ID,
        PROJECT_ID,
        BODY,
        SCHEDULED_FOR,
        TIMEZONE,
        CHANNEL_IDS,
        MEDIA,
        TAGS
      );
      const event2 = new BulkScheduleRowConfirmed(
        ITEM_ID,
        BATCH_ID,
        ACCOUNT_ID,
        PROJECT_ID,
        BODY,
        SCHEDULED_FOR,
        TIMEZONE,
        CHANNEL_IDS,
        MEDIA,
        TAGS
      );

      assert.notStrictEqual(event1.eventId, event2.eventId);
    });
  });

  describe("toPayload() degradation guard", () => {
    it("toPayload returns a plain object (not undefined or null) so PrismaOutboxWriter does not degrade", () => {
      const event = new BulkScheduleRowConfirmed(
        ITEM_ID,
        BATCH_ID,
        ACCOUNT_ID,
        PROJECT_ID,
        BODY,
        SCHEDULED_FOR,
        TIMEZONE,
        CHANNEL_IDS,
        MEDIA,
        TAGS
      );

      const payload = event.toPayload();

      assert.ok(typeof payload === "object" && payload !== null);
    });
  });
});
