import { describe, it, beforeEach, after, mock } from "node:test";
import assert from "node:assert/strict";
import Fastify from "fastify";
import type { FastifyInstance } from "fastify";
import { signPayload } from "./webhookSignatureVerification.test-helpers.js";

describe("Webhook HTTP route — signature enforcement at Fastify layer", { concurrency: 1 }, () => {
  let app: FastifyInstance;

  const MOCK_SECRET = "route-test-secret";

  beforeEach(async () => {
    app = Fastify({ logger: false });

    app.post("/webhooks/:provider", async (request, reply) => {
      const rawSig =
        request.headers["x-hub-signature-256"] ||
        request.headers["x-tiktok-signature"] ||
        request.headers["x-signature"] ||
        request.headers["signature"];

      const signature = Array.isArray(rawSig) ? rawSig[0] : rawSig;

      if (!signature) {
        return reply.status(400).send({ ok: false, error: "Missing webhook signature" });
      }

      const rawBody =
        typeof request.body === "string" ? request.body : JSON.stringify(request.body ?? "");

      const expected = signPayload(rawBody, MOCK_SECRET);
      const isValid = signature === expected;

      if (!isValid) {
        return reply.status(401).send({ ok: false, error: "Signature verification failed" });
      }

      return reply.status(200).send({ ok: true, eventId: "test-event" });
    });

    await app.ready();
  });

  after(async () => {
    await app.close();
    mock.restoreAll();
  });

  it("returns 200 when signature is valid", async () => {
    const payload = JSON.stringify({ object: "instagram", entry: [{ id: "ig-1" }] });
    const sig = signPayload(payload, MOCK_SECRET);

    const response = await app.inject({
      method: "POST",
      url: "/webhooks/instagram",
      headers: {
        "content-type": "application/json",
        "x-hub-signature-256": sig,
      },
      payload,
    });

    assert.strictEqual(response.statusCode, 200, "Valid signature should return 200");
    const body = JSON.parse(response.body) as { ok: boolean };
    assert.strictEqual(body.ok, true);
  });

  it("returns 401 when body has been tampered (signature mismatch)", async () => {
    const originalPayload = JSON.stringify({ object: "instagram", entry: [{ id: "ig-2" }] });
    const sig = signPayload(originalPayload, MOCK_SECRET);

    const tamperedPayload = JSON.stringify({
      object: "instagram",
      entry: [{ id: "ig-2" }],
      injected: true,
    });

    const response = await app.inject({
      method: "POST",
      url: "/webhooks/instagram",
      headers: {
        "content-type": "application/json",
        "x-hub-signature-256": sig,
      },
      payload: tamperedPayload,
    });

    assert.strictEqual(response.statusCode, 401, "Tampered body must return 401");
    const body = JSON.parse(response.body) as { ok: boolean; error: string };
    assert.strictEqual(body.ok, false);
    assert.ok(body.error.includes("Signature"), "Error message should mention signature");
  });

  it("returns 400 when X-Hub-Signature-256 header is absent", async () => {
    const payload = JSON.stringify({ object: "instagram", entry: [{ id: "ig-3" }] });

    const response = await app.inject({
      method: "POST",
      url: "/webhooks/instagram",
      headers: { "content-type": "application/json" },
      payload,
    });

    assert.strictEqual(response.statusCode, 400, "Missing signature must return 400");
    const body = JSON.parse(response.body) as { ok: boolean; error: string };
    assert.strictEqual(body.ok, false);
    assert.ok(body.error.toLowerCase().includes("missing"), "Error must mention 'missing'");
  });

  it("returns 400 when Facebook X-Hub-Signature-256 header is absent", async () => {
    const payload = JSON.stringify({ object: "page", entry: [{ id: "fb-page-1" }] });

    const response = await app.inject({
      method: "POST",
      url: "/webhooks/facebook",
      headers: { "content-type": "application/json" },
      payload,
    });

    assert.strictEqual(response.statusCode, 400, "Missing Facebook signature must return 400");
    const body = JSON.parse(response.body) as { ok: boolean };
    assert.strictEqual(body.ok, false);
  });

  it("returns 401 when Facebook body is tampered", async () => {
    const originalPayload = JSON.stringify({
      object: "page",
      entry: [{ id: "fb-page-2", changes: [{ field: "feed" }] }],
    });
    const sig = signPayload(originalPayload, MOCK_SECRET);

    const tamperedPayload = JSON.stringify({
      object: "page",
      entry: [{ id: "fb-page-2", changes: [{ field: "admin" }] }],
    });

    const response = await app.inject({
      method: "POST",
      url: "/webhooks/facebook",
      headers: {
        "content-type": "application/json",
        "x-hub-signature-256": sig,
      },
      payload: tamperedPayload,
    });

    assert.strictEqual(response.statusCode, 401, "Tampered Facebook payload must return 401");
  });

  it("returns 200 when X provider x-signature header contains valid sig", async () => {
    const payload = JSON.stringify({ tweet_create_events: [{ id_str: "tw-001" }] });
    const sig = signPayload(payload, MOCK_SECRET);

    const response = await app.inject({
      method: "POST",
      url: "/webhooks/x",
      headers: {
        "content-type": "application/json",
        "x-signature": sig,
      },
      payload,
    });

    assert.strictEqual(response.statusCode, 200, "Valid X signature must return 200");
  });
});
