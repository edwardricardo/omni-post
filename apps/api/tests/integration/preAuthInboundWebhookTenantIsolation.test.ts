/**
 * @file preAuthInboundWebhookTenantIsolation.test.ts
 * @description MERGE-BLOCKING integration proof for the inbound webhook worker
 *   boundary (A7). The BullMQ pipeline is currently wired into no composition
 *   root (verified: `WebhookManager` is constructed nowhere), so the seam is
 *   defensive — this test asserts its CONTRACT directly against a real processor:
 *   the `processWebhookJob` body runs under the declared `system:inbound-webhook`
 *   context, so an enrolled-model read reached through the webhook handler
 *   succeeds WITHOUT `TenantContextMissingError`.
 *
 *   The universal handler is replaced with a probe that (a) captures the system
 *   reason active during processing and (b) performs a REAL guarded
 *   `webhookEvent` read — which only resolves because the seam bound a system
 *   context. Without the seam that read throws and the probe reports failure.
 *
 * @layer infrastructure
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { Redis } from "ioredis";
import { createTestPrismaClient, type PrismaClient } from "@infra/prisma";
import { tenantGuardExtension } from "@infra/prisma/extensions/tenantGuard.js";
import { getTenantContext, getSystemContext } from "../../src/security/tenantContext.js";
import {
  WebhookJobProcessor,
  INBOUND_WEBHOOK_SYSTEM_REASON,
  type WebhookJobData,
  type WebhookJobResult,
} from "../../src/webhooks/webhookJobProcessor.js";

const REDIS_URL = process.env.REDIS_URL ?? "redis://localhost:6379";

interface Captured {
  reasonDuringProcessing?: string;
  guardedReadThrew: boolean;
}

/** Test view onto the processor internals the probe needs to reach. */
interface ProcessorInternals {
  webhookHandler: { handleWebhook: (...args: unknown[]) => Promise<{ success: boolean }> };
  processWebhookJob: (job: unknown) => Promise<WebhookJobResult>;
}

describe("Inbound webhook worker — system-context seam (MERGE-BLOCKING)", () => {
  let base: PrismaClient;
  let guarded: PrismaClient;
  let redis: Redis;
  let processor: WebhookJobProcessor;
  const captured: Captured = { guardedReadThrew: false };

  before(async () => {
    base = createTestPrismaClient();
    guarded = base.$extends(
      tenantGuardExtension({ getTenantContext, getSystemContext })
    ) as unknown as PrismaClient;
    redis = new Redis(REDIS_URL, { maxRetriesPerRequest: null });

    processor = new WebhookJobProcessor(guarded, redis);

    // Replace the universal handler with a probe: capture the ambient system
    // reason and exercise a real guarded enrolled read from inside the job body.
    const internals = processor as unknown as ProcessorInternals;
    internals.webhookHandler = {
      handleWebhook: async () => {
        captured.reasonDuringProcessing = getSystemContext()?.reason;
        try {
          await guarded.webhookEvent.findMany({ take: 1 });
        } catch {
          captured.guardedReadThrew = true;
        }
        return { success: true };
      },
    };
  });

  after(async () => {
    await processor?.shutdown().catch(() => undefined);
    await redis?.quit().catch(() => undefined);
    await base?.$disconnect().catch(() => undefined);
  });

  it("processes a probe job under the inbound-webhook system context, enrolled read clean", async () => {
    const jobData: WebhookJobData = {
      eventId: `preauth-inbound-${Date.now()}`,
      provider: "INSTAGRAM",
      eventType: "COMMENT_RECEIVED",
      payload: { probe: true },
      headers: {},
      signature: "test-signature",
      retryCount: 0,
      originalReceivedAt: new Date().toISOString(),
    };
    const fakeJob = { data: jobData, updateProgress: async () => undefined };

    const internals = processor as unknown as ProcessorInternals;
    const result = await internals.processWebhookJob(fakeJob);

    assert.strictEqual(result.success, true, "the probe job must process clean under the seam");
    assert.strictEqual(
      captured.reasonDuringProcessing,
      INBOUND_WEBHOOK_SYSTEM_REASON,
      "the job body must run under the declared inbound-webhook system context"
    );
    assert.strictEqual(
      captured.guardedReadThrew,
      false,
      "the enrolled webhookEvent read must not throw TenantContextMissingError under the seam"
    );
  });
});
