/**
 * @file webhookInbound.test.ts
 * @description Integration tests for the inbound-webhook pipeline against the real
 *   database: edge signature verification resolves the seeded subscription
 *   (correct → ok, wrong → 401, none → 404), and the worker handler persists a
 *   WebhookEvent and dedups a redelivered event (idempotency). Redis is not
 *   exercised — the queue hop between edge and worker is covered by unit tests.
 * @layer infrastructure
 */

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { createTestPrismaClient } from "@infra/prisma";
import type { PrismaClient } from "@infra/prisma";
import { UniversalWebhookHandler } from "../../src/webhooks/webhookHandlerCore.js";

const sign = (body: string, secret: string): string =>
  `sha256=${createHmac("sha256", secret).update(body, "utf8").digest("hex")}`;

describe("Inbound webhook pipeline integration", () => {
  let prisma: PrismaClient;
  let handler: UniversalWebhookHandler;
  let accountId: string;
  let projectId: string;
  const tag = `wh-int-${Date.now()}`;
  const igAccountId = `${tag}-ig`;
  const secret = "integration-app-secret";

  const body = JSON.stringify({
    object: "instagram",
    entry: [
      {
        id: igAccountId,
        changes: [
          { field: "comments", value: { id: `${tag}-c1`, text: "hi", from: { id: "u1" } } },
        ],
      },
    ],
  });

  before(async () => {
    prisma = createTestPrismaClient();
    handler = new UniversalWebhookHandler(prisma);

    const account = await prisma.account.create({
      data: { email: `${tag}@test.com`, name: "WH Account" },
    });
    accountId = account.id;
    const project = await prisma.project.create({
      data: { accountId, name: `WH Project ${tag}` },
    });
    projectId = project.id;
    await prisma.channel.create({
      data: {
        projectId,
        provider: "INSTAGRAM",
        providerAccountId: igAccountId,
        handle: "ig-handle",
        credentialsCiphertext: "x",
        credentialsIv: "x",
        credentialsAuthTag: "x",
      },
    });
    await prisma.webhookSubscription.create({
      data: {
        accountId,
        provider: "INSTAGRAM",
        webhookUrl: "https://example.test/webhooks/instagram",
        secretKey: secret,
        eventTypes: ["COMMENT_RECEIVED"],
        isActive: true,
      },
    });
  });

  after(async () => {
    await prisma.webhookEvent.deleteMany({
      where: { provider: "INSTAGRAM", eventId: { contains: tag } },
    });
    await prisma.webhookSubscription.deleteMany({ where: { accountId } });
    await prisma.channel.deleteMany({ where: { projectId } });
    await prisma.project.deleteMany({ where: { accountId } });
    await prisma.account.deleteMany({ where: { id: accountId } });
  });

  it("verifies a correctly-signed webhook at the edge", async () => {
    const result = await handler.verifyInbound("INSTAGRAM", sign(body, secret), body, {});
    assert.ok(result.ok, "should verify");
    if (result.ok) {
      assert.strictEqual(result.eventType, "COMMENT_RECEIVED");
    }
  });

  it("rejects a wrong signature with 401", async () => {
    const result = await handler.verifyInbound("INSTAGRAM", sign(body, "wrong-secret"), body, {});
    assert.ok(!result.ok);
    if (!result.ok) {
      assert.strictEqual(result.status, 401);
    }
  });

  it("returns 404 when no active subscription exists for the provider", async () => {
    const result = await handler.verifyInbound("TIKTOK", "sig", "{}", {});
    assert.ok(!result.ok);
    if (!result.ok) {
      assert.strictEqual(result.status, 404);
    }
  });

  it("persists a WebhookEvent on process and dedups a redelivery (idempotent)", async () => {
    const signature = sign(body, secret);

    const first = await handler.handleWebhook("INSTAGRAM", signature, body, {});
    assert.ok(first.success, "first delivery should process");

    const stored = await prisma.webhookEvent.findMany({
      where: { provider: "INSTAGRAM", eventId: first.eventId },
    });
    assert.strictEqual(stored.length, 1, "exactly one WebhookEvent row");

    // Redelivery of the same event → deduped, still success, no duplicate row.
    const second = await handler.handleWebhook("INSTAGRAM", signature, body, {});
    assert.ok(second.success, "redelivery should short-circuit as success");
    const afterRedelivery = await prisma.webhookEvent.findMany({
      where: { provider: "INSTAGRAM", eventId: first.eventId },
    });
    assert.strictEqual(afterRedelivery.length, 1, "no duplicate row on redelivery");
  });
});
