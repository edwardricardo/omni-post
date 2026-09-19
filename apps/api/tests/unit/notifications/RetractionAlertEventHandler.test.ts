/**
 * @file RetractionAlertEventHandler.test.ts
 * @description Unit tests for the bridge between the outbox and the alert use cases.
 *
 *   The load-bearing assertion is the TENANT one, and it fails closed by design: the
 *   handler binds the account from the event's own payload, and an event that carries
 *   no account is REFUSED rather than processed unbound. Processing it unbound would
 *   run every repository read with no tenant context, which row security answers with
 *   an empty result — so the alert would be built from nothing and delivered to nobody,
 *   silently, which is the failure this whole capability exists to prevent.
 * @layer infrastructure
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import assert from "node:assert/strict";
import { RetractionAlertEventHandler } from "../../../src/notifications/RetractionAlertEventHandler.js";
import { RETRACTION_ALERT_HANDLED_EVENT_TYPES } from "../../../src/notifications/RetractionAlertEventHandler.js";
import { ok } from "@shared/types";
import { getTenantContext } from "../../../src/security/tenantContext.js";
import type { DomainEvent } from "@core/domain/events/DomainEvent.js";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const ACCOUNT_ID = "a1000000-0000-4000-8000-000000000001";
const POST_ID = "b1000000-0000-4000-8000-000000000001";
const CHANNEL_ID = "c1000000-0000-4000-8000-000000000001";
const PROJECT_ID = "p1000000-0000-4000-8000-000000000001";
const ALERT_KEY = "alert-key-1";

const makeEvent = (eventType: string, payload: Record<string, unknown>): DomainEvent =>
  ({
    eventId: "e-1",
    eventType,
    aggregateId: POST_ID,
    aggregateType: "Post",
    occurredAt: new Date("2026-09-19T10:00:00Z"),
    version: 1,
    metadata: { payload },
  }) as unknown as DomainEvent;

const raisedPayload = (overrides?: Record<string, unknown>) => ({
  postId: POST_ID,
  projectId: PROJECT_ID,
  accountId: ACCOUNT_ID,
  channelId: CHANNEL_ID,
  liveFragments: [{ index: 1, externalId: "18110001", url: "https://x.test/a/1" }],
  cause: "NO_CAPABILITY",
  alertKey: ALERT_KEY,
  ...overrides,
});

function makeHarness(options?: { boundAccountId?: { value?: string } }) {
  const raise = {
    execute: vi.fn(async () => {
      if (options?.boundAccountId) {
        options.boundAccountId.value = getTenantContext()?.accountId;
      }
      return ok({ report: [], recipientCount: 1 });
    }),
  };
  const resolve = { execute: vi.fn(async () => ok({ deletedNotifications: 0 })) };
  const context = {
    read: vi.fn(async () => ({
      postExcerpt: "Launch week",
      channelName: "@acme",
      provider: "X",
      accountName: "Acme Corp",
    })),
  };
  const handler = new RetractionAlertEventHandler(
    raise as never,
    resolve as never,
    context as never
  );
  return { handler, raise, resolve, context };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("RetractionAlertEventHandler", () => {
  beforeEach(() => vi.clearAllMocks());

  it("subscribes to both alert events and nothing else", () => {
    assert.deepStrictEqual(
      [...RETRACTION_ALERT_HANDLED_EVENT_TYPES],
      ["PostChannelRetractionAlertRaised", "PostChannelRetractionAlertResolved"]
    );
  });

  describe("tenancy", () => {
    it("binds the account from the payload before touching any repository", async () => {
      const bound: { value?: string } = {};
      const h = makeHarness({ boundAccountId: bound });

      await h.handler.handle(makeEvent("PostChannelRetractionAlertRaised", raisedPayload()));

      assert.strictEqual(bound.value, ACCOUNT_ID);
    });

    it("REFUSES an event whose payload carries no account rather than running unbound", async () => {
      const h = makeHarness();
      const payload = raisedPayload();
      delete (payload as Record<string, unknown>).accountId;

      await h.handler.handle(makeEvent("PostChannelRetractionAlertRaised", payload));

      expect(h.raise.execute).not.toHaveBeenCalled();
      expect(h.context.read).not.toHaveBeenCalled();
    });

    it("refuses a resolved event with no account for the same reason", async () => {
      const h = makeHarness();

      await h.handler.handle(
        makeEvent("PostChannelRetractionAlertResolved", { alertKey: ALERT_KEY })
      );

      expect(h.resolve.execute).not.toHaveBeenCalled();
    });
  });

  describe("raised", () => {
    it("hands the use case the payload's facts plus the resolved names", async () => {
      const h = makeHarness();

      await h.handler.handle(makeEvent("PostChannelRetractionAlertRaised", raisedPayload()));

      const input = h.raise.execute.mock.calls[0]?.[0] as Record<string, unknown>;
      assert.strictEqual(input.alertKey, ALERT_KEY);
      assert.strictEqual(input.postId, POST_ID);
      assert.strictEqual(input.channelId, CHANNEL_ID);
      assert.strictEqual(input.accountId, ACCOUNT_ID);
      assert.strictEqual(input.channelName, "@acme");
      assert.strictEqual(input.provider, "X");
      assert.strictEqual(input.postExcerpt, "Launch week");
      assert.deepStrictEqual(input.liveFragments, [
        { index: 1, externalId: "18110001", url: "https://x.test/a/1" },
      ]);
    });

    it("carries a superseded key through when the record named one", async () => {
      const h = makeHarness();

      await h.handler.handle(
        makeEvent(
          "PostChannelRetractionAlertRaised",
          raisedPayload({ supersededAlertKey: "older-key" })
        )
      );

      const input = h.raise.execute.mock.calls[0]?.[0] as Record<string, unknown>;
      assert.strictEqual(input.supersededAlertKey, "older-key");
    });

    it("refuses an event with no alert key — there would be nothing to deduplicate on", async () => {
      const h = makeHarness();
      const payload = raisedPayload();
      delete (payload as Record<string, unknown>).alertKey;

      await h.handler.handle(makeEvent("PostChannelRetractionAlertRaised", payload));

      expect(h.raise.execute).not.toHaveBeenCalled();
    });

    it("drops a malformed fragment entry instead of failing the whole alert", async () => {
      const h = makeHarness();

      await h.handler.handle(
        makeEvent(
          "PostChannelRetractionAlertRaised",
          raisedPayload({ liveFragments: [{ index: 1, externalId: "ok" }, { bogus: true }] })
        )
      );

      const input = h.raise.execute.mock.calls[0]?.[0] as { liveFragments: unknown[] };
      assert.strictEqual(input.liveFragments.length, 1);
    });

    it("does not throw when the use case fails — the outbox must not retry a delivered alert forever", async () => {
      const h = makeHarness();
      h.raise.execute.mockResolvedValueOnce({
        ok: false as const,
        error: new Error("delivery blew up"),
      } as never);

      await h.handler.handle(makeEvent("PostChannelRetractionAlertRaised", raisedPayload()));
    });
  });

  describe("resolved", () => {
    it("resolves by alert key under the payload's tenant", async () => {
      const h = makeHarness();

      await h.handler.handle(
        makeEvent("PostChannelRetractionAlertResolved", {
          accountId: ACCOUNT_ID,
          alertKey: ALERT_KEY,
          cause: "ACTION_WINDOW_EXPIRED",
        })
      );

      const input = h.resolve.execute.mock.calls[0]?.[0] as Record<string, unknown>;
      assert.strictEqual(input.alertKey, ALERT_KEY);
      assert.strictEqual(input.cause, "ACTION_WINDOW_EXPIRED");
    });
  });

  describe("events it does not own", () => {
    it("ignores an unrelated event type", async () => {
      const h = makeHarness();

      await h.handler.handle(makeEvent("PostPublished", raisedPayload()));

      expect(h.raise.execute).not.toHaveBeenCalled();
      expect(h.resolve.execute).not.toHaveBeenCalled();
    });
  });
});
