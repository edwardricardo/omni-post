/**
 * @file PrismaTriageMessageAdapter.test.ts
 * @description Unit tests for the Prisma adapter that persists AI triage
 *              results on social messages. Validates the
 *              `aiProcessedAt IS NULL` guard that prevents concurrent
 *              triage jobs from overwriting each other.
 * @layer infrastructure
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { PrismaTriageMessageAdapter } from "../../../../src/infrastructure/repositories/PrismaTriageMessageAdapter";

function makePrismaMock(updateManyCount: number) {
  return {
    socialMessage: {
      updateMany: vi.fn().mockResolvedValue({ count: updateManyCount }),
    },
  } as unknown as Parameters<typeof PrismaTriageMessageAdapter.prototype.constructor>[0];
}

const FIXED_NOW = new Date("2026-05-30T19:30:00Z");

const TRIAGE_DATA = {
  priority: "HIGH",
  suggestedReplies: ["reply-1", "reply-2", "reply-3"],
  sentimentScore: 0.5,
  aiProcessedAt: FIXED_NOW,
};

describe("PrismaTriageMessageAdapter.updateMessageTriage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("writes triage when message has aiProcessedAt = null (first attempt)", async () => {
    const prisma = makePrismaMock(1);
    const adapter = new PrismaTriageMessageAdapter(prisma);

    await adapter.updateMessageTriage("msg-1", TRIAGE_DATA);

    const updateManyMock = (
      prisma as unknown as { socialMessage: { updateMany: ReturnType<typeof vi.fn> } }
    ).socialMessage.updateMany;
    expect(updateManyMock).toHaveBeenCalledOnce();
    const call = updateManyMock.mock.calls[0]?.[0] as {
      where: { id: string; aiProcessedAt: null };
      data: Record<string, unknown>;
    };
    expect(call.where).toEqual({ id: "msg-1", aiProcessedAt: null });
    expect(call.data).toMatchObject({
      priority: "HIGH",
      suggestedReplies: ["reply-1", "reply-2", "reply-3"],
      sentimentScore: 0.5,
      aiProcessedAt: FIXED_NOW,
    });
  });

  it("no-ops silently when message was already triaged (updateMany count = 0)", async () => {
    const prisma = makePrismaMock(0);
    const adapter = new PrismaTriageMessageAdapter(prisma);

    // Should NOT throw — second concurrent triage finds aiProcessedAt set
    // and the partial update affects zero rows. Behavior: idempotent success.
    await expect(adapter.updateMessageTriage("msg-1", TRIAGE_DATA)).resolves.toBeUndefined();
  });

  it("includes crmContactId in the data when provided", async () => {
    const prisma = makePrismaMock(1);
    const adapter = new PrismaTriageMessageAdapter(prisma);

    await adapter.updateMessageTriage("msg-1", { ...TRIAGE_DATA, crmContactId: "crm-42" });

    const updateManyMock = (
      prisma as unknown as { socialMessage: { updateMany: ReturnType<typeof vi.fn> } }
    ).socialMessage.updateMany;
    const call = updateManyMock.mock.calls[0]?.[0] as { data: Record<string, unknown> };
    expect(call.data.crmContactId).toBe("crm-42");
  });

  it("omits crmContactId from the data when not provided", async () => {
    const prisma = makePrismaMock(1);
    const adapter = new PrismaTriageMessageAdapter(prisma);

    await adapter.updateMessageTriage("msg-1", TRIAGE_DATA);

    const updateManyMock = (
      prisma as unknown as { socialMessage: { updateMany: ReturnType<typeof vi.fn> } }
    ).socialMessage.updateMany;
    const call = updateManyMock.mock.calls[0]?.[0] as { data: Record<string, unknown> };
    expect(call.data.crmContactId).toBeUndefined();
  });
});
