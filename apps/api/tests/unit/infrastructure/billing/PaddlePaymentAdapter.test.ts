/**
 * @file PaddlePaymentAdapter.test.ts
 * @description Unit tests for PaddlePaymentAdapter.parseWebhookEvent. The Paddle SDK
 *              verifies a webhook signature asynchronously, so the adapter must await
 *              that verdict: a verified notification yields its real id, type and data,
 *              and a forged one rejects instead of leaving a rejected promise that no
 *              caller handles.
 * @layer infrastructure
 */

import { describe, it, vi, beforeEach, afterEach, expect } from "vitest";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { Webhooks } from "@paddle/paddle-node-sdk";
import {
  PaddlePaymentAdapter,
  type PaddleConfig,
} from "../../../../src/infrastructure/billing/PaddlePaymentAdapter.js";

const WEBHOOK_SECRET = "pdl_ntfset_unit_test_webhook_secret";
const SIGNATURE_FAILURE = "[Paddle] Webhook signature verification failed";
const EVENT_ID = "evt_01j9unittestactivated000001";
const SUBSCRIPTION_ID = "sub_01j9unittestsubscription001";
const CUSTOMER_ID = "ctm_01j9unittestcustomer000001";

const makeConfig = (overrides?: Partial<PaddleConfig>): PaddleConfig => ({
  apiKey: "pdl_sdbx_apikey_unit_test",
  webhookSecret: WEBHOOK_SECRET,
  sandbox: true,
  prices: {
    BASIC: { monthly: "pri_basic_monthly", yearly: "pri_basic_yearly" },
    PRO: { monthly: "pri_pro_monthly", yearly: "pri_pro_yearly" },
    ENTERPRISE: { monthly: "pri_enterprise_monthly", yearly: "pri_enterprise_yearly" },
  },
  ...overrides,
});

/** A `subscription.activated` notification body exactly as Paddle sends it on the wire. */
const makeSubscriptionActivatedBody = (): string =>
  JSON.stringify({
    event_id: EVENT_ID,
    event_type: "subscription.activated",
    occurred_at: "2026-10-04T05:44:00.000000Z",
    notification_id: "ntf_01j9unittestnotification01",
    data: {
      id: SUBSCRIPTION_ID,
      status: "active",
      customer_id: CUSTOMER_ID,
      address_id: "add_01j9unittestaddress0000001",
      currency_code: "USD",
      created_at: "2026-10-04T05:43:00.000000Z",
      updated_at: "2026-10-04T05:44:00.000000Z",
      collection_mode: "automatic",
      billing_cycle: { interval: "month", frequency: 1 },
      items: [],
    },
  });

/** Signs a body the way Paddle does: HMAC-SHA256 over `<ts>:<body>`, sent as `ts=<ts>;h1=<hex>`. */
const sign = (body: string, secret: string = WEBHOOK_SECRET): string => {
  const ts = Math.floor(Date.now() / 1000);
  const h1 = createHmac("sha256", secret).update(`${ts}:${body}`).digest("hex");
  return `ts=${ts};h1=${h1}`;
};

describe("PaddlePaymentAdapter.parseWebhookEvent with an asynchronous verifier", () => {
  let adapter: PaddlePaymentAdapter;

  beforeEach(() => {
    vi.restoreAllMocks();
    adapter = new PaddlePaymentAdapter(makeConfig());
  });

  it("resolves to the verified event's id, type and data when the signature is valid", async () => {
    const body = makeSubscriptionActivatedBody();
    const verified = Webhooks.fromJson(JSON.parse(body));
    vi.spyOn(Webhooks.prototype, "unmarshal").mockImplementation(async () => verified);

    const event = await adapter.parseWebhookEvent({ payload: body, signature: "ts=1;h1=valid" });

    assert.strictEqual(event.id, EVENT_ID);
    assert.strictEqual(event.type, "subscription.activated");
    assert.strictEqual(event.data.id, SUBSCRIPTION_ID);
    assert.strictEqual(event.data.customerId, CUSTOMER_ID);
    assert.strictEqual(adapter.mapEventType(event.type), "subscription.activated");
  });

  it("rejects with the verifier's error when the signature is invalid", async () => {
    vi.spyOn(Webhooks.prototype, "unmarshal").mockImplementation(async () => {
      throw new Error(SIGNATURE_FAILURE);
    });

    await expect(
      adapter.parseWebhookEvent({
        payload: makeSubscriptionActivatedBody(),
        signature: "ts=1;h1=forged",
      })
    ).rejects.toThrow(SIGNATURE_FAILURE);
  });

  it("hands the verifier the raw body, the webhook secret and the signature header", async () => {
    const body = makeSubscriptionActivatedBody();
    const signature = "ts=1;h1=header-value";
    const unmarshal = vi
      .spyOn(Webhooks.prototype, "unmarshal")
      .mockImplementation(async () => Webhooks.fromJson(JSON.parse(body)));

    await adapter.parseWebhookEvent({ payload: Buffer.from(body, "utf-8"), signature });

    expect(unmarshal).toHaveBeenCalledTimes(1);
    expect(unmarshal).toHaveBeenCalledWith(body, WEBHOOK_SECRET, signature);
  });
});

describe("PaddlePaymentAdapter.parseWebhookEvent with the SDK's real signature check", () => {
  let adapter: PaddlePaymentAdapter;

  beforeEach(() => {
    vi.restoreAllMocks();
    // The SDK refuses a signature timestamp older than five seconds, so the clock is pinned.
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-04T05:44:00.000Z"));
    adapter = new PaddlePaymentAdapter(makeConfig());
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("accepts a notification signed with the webhook secret", async () => {
    const body = makeSubscriptionActivatedBody();

    const event = await adapter.parseWebhookEvent({ payload: body, signature: sign(body) });

    assert.strictEqual(event.id, EVENT_ID);
    assert.strictEqual(event.type, "subscription.activated");
    assert.strictEqual(event.data.customerId, CUSTOMER_ID);
  });

  it("rejects a notification signed with another secret", async () => {
    const body = makeSubscriptionActivatedBody();

    await expect(
      adapter.parseWebhookEvent({ payload: body, signature: sign(body, "an_attacker_secret") })
    ).rejects.toThrow(SIGNATURE_FAILURE);
  });
});
