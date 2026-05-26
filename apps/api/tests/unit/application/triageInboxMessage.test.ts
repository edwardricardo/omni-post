/**
 * @file triageInboxMessage.test.ts
 * @description Unit tests + eval set for TriageInboxMessageUseCase against the
 *              schema-validated `AIServicePort.generateStructured` path. The
 *              eval cases assert consistency of the structured output across
 *              representative inputs (complaint / question / compliment / spam)
 *              so any regression in shape (missing field, wrong type, wrong
 *              cardinality) fails CI deterministically.
 * @layer infrastructure
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import assert from "node:assert/strict";
import { ok, err } from "@shared/types";
import { TriageInboxMessageUseCase } from "@core/application/inbox/TriageInboxMessageUseCase.js";
import type { AIServicePort } from "@core/domain/repositories/AIServicePort.js";
import type { TriageClassification } from "@core/domain/ai/AiStructuredOutputs.js";
import { triageSpec } from "../../../src/ai/structuredSchemas.js";

const URGENT_CLASSIFICATION: TriageClassification = {
  priority: "URGENT",
  sentimentScore: -0.85,
  suggestedReplies: [
    "We are sorry to hear about your experience. Please DM us your order number and we will resolve this right away.",
    "That sounds really frustrating — we want to make it right. Could you share your order details?",
    "Apologies for the trouble. Reply with your order ID and we will process the refund today.",
  ],
};

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
  result: { ok: true; value: TriageClassification } | { ok: false; error: "AI_ERROR" } = {
    ok: true,
    value: URGENT_CLASSIFICATION,
  }
): AIServicePort {
  return {
    generateStructured: vi.fn().mockResolvedValue(result.ok ? ok(result.value) : err(result.error)),
    generateText: vi.fn(),
    generateContent: vi.fn(),
    analyzeContent: vi.fn(),
    optimizeContent: vi.fn(),
    predictPerformance: vi.fn(),
    generateVariations: vi.fn(),
  } as unknown as AIServicePort;
}

function makeMockCrm(contact: { id: string; name: string; company: string | null } | null = null) {
  return {
    findContactByHandle: vi.fn().mockResolvedValue(contact),
  };
}

describe("TriageInboxMessageUseCase", () => {
  let port: ReturnType<typeof makeMockPort>;
  let ai: AIServicePort;
  let crm: ReturnType<typeof makeMockCrm>;
  let useCase: TriageInboxMessageUseCase;

  beforeEach(() => {
    vi.clearAllMocks();
    port = makeMockPort();
    ai = makeMockAI();
    crm = makeMockCrm();
    useCase = new TriageInboxMessageUseCase(port, ai, triageSpec, crm);
  });

  it("classifies complaint message as URGENT", async () => {
    const result = await useCase.execute({ messageId: "msg-1", accountId: "acc-1" });
    assert.ok(result.ok);
    assert.strictEqual(result.value.priority, "URGENT");
  });

  it("generates exactly 3 suggested replies", async () => {
    const result = await useCase.execute({ messageId: "msg-1", accountId: "acc-1" });
    assert.ok(result.ok);
    assert.strictEqual(result.value.suggestedReplies.length, 3);
  });

  it("returns sentiment score in [-1, 1]", async () => {
    const result = await useCase.execute({ messageId: "msg-1", accountId: "acc-1" });
    assert.ok(result.ok);
    assert.ok(result.value.sentimentScore >= -1);
    assert.ok(result.value.sentimentScore <= 1);
  });

  it("attaches CRM contact when sender matches", async () => {
    crm = makeMockCrm({ id: "crm-contact-1", name: "John Doe", company: "Acme Corp" });
    useCase = new TriageInboxMessageUseCase(port, ai, triageSpec, crm);

    const result = await useCase.execute({ messageId: "msg-1", accountId: "acc-1" });

    assert.ok(result.ok);
    assert.strictEqual(result.value.crmContactId, "crm-contact-1");
  });

  it("skips CRM lookup when no CRM port provided", async () => {
    useCase = new TriageInboxMessageUseCase(port, ai, triageSpec, undefined);

    const result = await useCase.execute({ messageId: "msg-1", accountId: "acc-1" });

    assert.ok(result.ok);
    assert.strictEqual(result.value.crmContactId, null);
  });

  it("handles AI failure gracefully (returns NORMAL defaults, no crash)", async () => {
    ai = makeMockAI({ ok: false, error: "AI_ERROR" });
    useCase = new TriageInboxMessageUseCase(port, ai, triageSpec, crm);

    const result = await useCase.execute({ messageId: "msg-1", accountId: "acc-1" });

    assert.ok(result.ok);
    assert.strictEqual(result.value.priority, "NORMAL");
    assert.deepStrictEqual(result.value.suggestedReplies, []);
  });

  it("updates message with triage data + aiProcessedAt timestamp", async () => {
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

  it("invokes generateStructured with system + few-shot + user messages", async () => {
    await useCase.execute({ messageId: "msg-1", accountId: "acc-1" });

    const aiCall = vi.mocked(ai.generateStructured).mock.calls[0];
    assert.ok(aiCall, "generateStructured should be called");
    const [messages, spec] = aiCall as [Array<{ role: string; content: string }>, { name: string }];
    assert.strictEqual(spec.name, "inbox_triage");
    assert.strictEqual(messages[0]?.role, "system");
    // At least one few-shot pair + the final user message
    assert.ok(messages.length >= 4, "expected system + few-shot + user");
    assert.strictEqual(messages[messages.length - 1]?.role, "user");
  });
});

// ---------------------------------------------------------------------------
// Eval set — consistency of structured output across representative inputs.
// Asserts schema invariants so any regression in shape fails CI loud.
// ---------------------------------------------------------------------------

const EVAL_CASES: Array<{
  name: string;
  body: string;
  classification: TriageClassification;
}> = [
  {
    name: "complaint",
    body: "This product is terrible, I want a refund!",
    classification: URGENT_CLASSIFICATION,
  },
  {
    name: "question",
    body: "Do you ship to Mexico?",
    classification: {
      priority: "HIGH",
      sentimentScore: 0.1,
      suggestedReplies: [
        "Yes, we ship to Mexico. You will see the rates at checkout.",
        "We do! Add your address at checkout for shipping options.",
        "Yes — shipping to Mexico is available.",
      ],
    },
  },
  {
    name: "compliment",
    body: "Love the new launch, great work!",
    classification: {
      priority: "NORMAL",
      sentimentScore: 0.9,
      suggestedReplies: [
        "Thank you so much — we are thrilled you love it!",
        "Appreciate you! Glad it landed well.",
        "Thanks for the kind words!",
      ],
    },
  },
  {
    name: "spam",
    body: "🎰 Buy followers cheap! 🎰",
    classification: {
      priority: "LOW",
      sentimentScore: 0,
      suggestedReplies: ["—", "—", "—"],
    },
  },
];

describe("TriageInboxMessageUseCase / eval set (consistency)", () => {
  it.each(EVAL_CASES)(
    "$name → priority is one of URGENT/HIGH/NORMAL/LOW",
    async ({ classification }) => {
      const port = makeMockPort();
      port.loadMessage.mockResolvedValue({
        id: "msg-eval",
        body: "ignored",
        provider: "INSTAGRAM",
        authorHandle: null,
        conversationId: null,
      });
      const ai = makeMockAI({ ok: true, value: classification });
      const useCase = new TriageInboxMessageUseCase(port, ai, triageSpec);

      const result = await useCase.execute({ messageId: "msg-eval", accountId: "acc-eval" });

      assert.ok(result.ok);
      assert.match(result.value.priority, /^(URGENT|HIGH|NORMAL|LOW)$/);
    }
  );

  it.each(EVAL_CASES)(
    "$name → sentiment in [-1, 1] and exactly 3 replies",
    async ({ classification }) => {
      const port = makeMockPort();
      port.loadMessage.mockResolvedValue({
        id: "msg-eval",
        body: "ignored",
        provider: "INSTAGRAM",
        authorHandle: null,
        conversationId: null,
      });
      const ai = makeMockAI({ ok: true, value: classification });
      const useCase = new TriageInboxMessageUseCase(port, ai, triageSpec);

      const result = await useCase.execute({ messageId: "msg-eval", accountId: "acc-eval" });

      assert.ok(result.ok);
      assert.ok(result.value.sentimentScore >= -1);
      assert.ok(result.value.sentimentScore <= 1);
      assert.strictEqual(result.value.suggestedReplies.length, 3);
    }
  );

  it("same input twice produces the same output (deterministic mock = deterministic use case)", async () => {
    const port1 = makeMockPort();
    const port2 = makeMockPort();
    const ai1 = makeMockAI({ ok: true, value: URGENT_CLASSIFICATION });
    const ai2 = makeMockAI({ ok: true, value: URGENT_CLASSIFICATION });

    const useCase1 = new TriageInboxMessageUseCase(port1, ai1, triageSpec);
    const useCase2 = new TriageInboxMessageUseCase(port2, ai2, triageSpec);

    const r1 = await useCase1.execute({ messageId: "msg-1", accountId: "acc-1" });
    const r2 = await useCase2.execute({ messageId: "msg-1", accountId: "acc-1" });

    assert.ok(r1.ok && r2.ok);
    assert.deepStrictEqual(
      { priority: r1.value.priority, sentiment: r1.value.sentimentScore },
      { priority: r2.value.priority, sentiment: r2.value.sentimentScore }
    );
  });
});
