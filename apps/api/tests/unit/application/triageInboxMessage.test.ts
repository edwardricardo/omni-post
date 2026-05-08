/**
 * @file triageInboxMessage.test.ts
 * @description Unit tests for TriageInboxMessageUseCase.
 * @layer infrastructure
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import assert from "node:assert/strict";
import { TriageInboxMessageUseCase } from "../../../src/application/inbox/TriageInboxMessageUseCase.js";

function makeMockPort() {
  return {
    loadMessage: vi.fn().mockResolvedValue({
      id: "msg-1",
      body: "This product is terrible, I want a refund!",
      provider: "INSTAGRAM",
      authorHandle: "@angry_customer",
      conversationId: null,
    }),
    getConversationContext: vi.fn().mockResolvedValue([]),
    updateMessageTriage: vi.fn().mockResolvedValue(undefined),
  };
}

function makeMockAI(
  response = '{"priority":"URGENT","sentimentScore":-0.8,"replies":["We apologize for the experience.","Let us help resolve this.","Please DM us your order details."]}'
) {
  return {
    generateContent: vi.fn().mockResolvedValue({ success: true, value: response }),
  };
}

function makeMockCrm(contact: { id: string; name: string; company: string | null } | null = null) {
  return {
    findContactByHandle: vi.fn().mockResolvedValue(contact),
  };
}

describe("TriageInboxMessageUseCase", () => {
  let port: ReturnType<typeof makeMockPort>;
  let ai: ReturnType<typeof makeMockAI>;
  let crm: ReturnType<typeof makeMockCrm>;
  let useCase: TriageInboxMessageUseCase;

  beforeEach(() => {
    vi.clearAllMocks();
    port = makeMockPort();
    ai = makeMockAI();
    crm = makeMockCrm();
    useCase = new TriageInboxMessageUseCase(port, ai, crm);
  });

  it("classifies complaint message as URGENT", async () => {
    const result = await useCase.execute({ messageId: "msg-1", accountId: "acc-1" });

    assert.ok(result.ok);
    assert.strictEqual(result.value.priority, "URGENT");
  });

  it("generates 3 suggested replies", async () => {
    const result = await useCase.execute({ messageId: "msg-1", accountId: "acc-1" });

    assert.ok(result.ok);
    assert.strictEqual(result.value.suggestedReplies.length, 3);
  });

  it("stores sentiment score between -1.0 and 1.0", async () => {
    const result = await useCase.execute({ messageId: "msg-1", accountId: "acc-1" });

    assert.ok(result.ok);
    assert.ok(result.value.sentimentScore >= -1);
    assert.ok(result.value.sentimentScore <= 1);
  });

  it("attaches CRM contact when sender matches", async () => {
    crm = makeMockCrm({ id: "crm-contact-1", name: "John Doe", company: "Acme Corp" });
    useCase = new TriageInboxMessageUseCase(port, ai, crm);

    const result = await useCase.execute({ messageId: "msg-1", accountId: "acc-1" });

    assert.ok(result.ok);
    assert.strictEqual(result.value.crmContactId, "crm-contact-1");
  });

  it("skips CRM lookup when no CRM port provided", async () => {
    useCase = new TriageInboxMessageUseCase(port, ai, undefined);

    const result = await useCase.execute({ messageId: "msg-1", accountId: "acc-1" });

    assert.ok(result.ok);
    assert.strictEqual(result.value.crmContactId, null);
  });

  it("handles LLM failure gracefully (returns defaults, no crash)", async () => {
    ai.generateContent.mockResolvedValue({ success: false });

    const result = await useCase.execute({ messageId: "msg-1", accountId: "acc-1" });

    assert.ok(result.ok);
    assert.strictEqual(result.value.priority, "NORMAL");
    assert.deepStrictEqual(result.value.suggestedReplies, []);
  });

  it("updates message with triage data", async () => {
    await useCase.execute({ messageId: "msg-1", accountId: "acc-1" });

    expect(port.updateMessageTriage).toHaveBeenCalledOnce();
    const call = port.updateMessageTriage.mock.calls[0] as [string, Record<string, unknown>];
    assert.strictEqual(call[0], "msg-1");
    assert.strictEqual(call[1].priority, "URGENT");
    assert.ok(call[1].aiProcessedAt instanceof Date);
  });

  it("returns NOT_FOUND when message does not exist", async () => {
    port.loadMessage.mockResolvedValue(null);

    const result = await useCase.execute({ messageId: "nope", accountId: "acc-1" });

    assert.ok(!result.ok);
  });
});
