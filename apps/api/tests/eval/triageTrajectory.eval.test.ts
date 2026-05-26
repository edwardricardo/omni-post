/**
 * @file triageTrajectory.eval.test.ts
 * @description Trajectory eval for the inbox triage slice. The triage
 *              pipeline is linear (load → AI structured call → update
 *              persistence), so the trajectory is measured as the
 *              ordered sequence of port calls plus the number of
 *              `AIServicePort.generateStructured` invocations as a
 *              cost proxy. Strict output-shape assertions guard the
 *              policy contract (priority enum, sentiment range,
 *              suggested-reply cardinality).
 *
 *              Failure of any assertion below blocks merge: a drift in
 *              call ordering, an extra LLM call, or a shape regression
 *              are all release-blocking.
 * @layer infrastructure
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { ok } from "@shared/types";
import { TriageInboxMessageUseCase } from "@core/application/inbox/TriageInboxMessageUseCase.js";
import type { AIServicePort } from "@core/domain/repositories/AIServicePort.js";
import type { TriageClassification } from "@core/domain/ai/AiStructuredOutputs.js";
import { triageSpec } from "../../src/ai/structuredSchemas.js";

/**
 * Per-message ceiling on AI invocations. The current pipeline calls
 * `generateStructured` exactly once per message. A regression that
 * introduces additional LLM calls (e.g. unguarded self-correction)
 * must surface here.
 */
const MAX_TRIAGE_AI_CALLS = 1;

const CANONICAL_CLASSIFICATION: TriageClassification = {
  priority: "URGENT",
  sentimentScore: -0.85,
  suggestedReplies: [
    "We are sorry to hear about your experience. Please DM us your order number and we will resolve this right away.",
    "That sounds really frustrating — we want to make it right. Could you share your order details?",
    "Apologies for the trouble. Reply with your order ID and we will process the refund today.",
  ],
};

function makePort() {
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

function makeAI(): AIServicePort {
  return {
    generateStructured: vi.fn().mockResolvedValue(ok(CANONICAL_CLASSIFICATION)),
    generateText: vi.fn(),
    generateContent: vi.fn(),
    analyzeContent: vi.fn(),
    optimizeContent: vi.fn(),
    predictPerformance: vi.fn(),
    generateVariations: vi.fn(),
  } as unknown as AIServicePort;
}

describe("trajectory eval — triage slice", () => {
  let port: ReturnType<typeof makePort>;
  let ai: AIServicePort;
  let useCase: TriageInboxMessageUseCase;

  beforeEach(() => {
    vi.clearAllMocks();
    port = makePort();
    ai = makeAI();
    useCase = new TriageInboxMessageUseCase(port, ai, triageSpec);
  });

  it("walks the canonical load → structured-call → update sequence in order", async () => {
    const callOrder: string[] = [];
    port.loadMessage.mockImplementationOnce(async () => {
      callOrder.push("loadMessage");
      return {
        id: "msg-1",
        body: "Customer complaint body",
        provider: "INSTAGRAM",
        authorHandle: "@customer",
        conversationId: null,
      };
    });
    (ai.generateStructured as ReturnType<typeof vi.fn>).mockImplementationOnce(async () => {
      callOrder.push("generateStructured");
      return ok(CANONICAL_CLASSIFICATION);
    });
    port.updateMessageTriage.mockImplementationOnce(async () => {
      callOrder.push("updateMessageTriage");
      return undefined;
    });

    const result = await useCase.execute({ messageId: "msg-1", accountId: "acc-1" });

    expect(result.ok).toBe(true);
    expect(callOrder).toEqual(["loadMessage", "generateStructured", "updateMessageTriage"]);
  });

  it("keeps the number of AI invocations under the canonical budget", async () => {
    const result = await useCase.execute({ messageId: "msg-1", accountId: "acc-1" });

    expect(result.ok).toBe(true);
    const invocations = (ai.generateStructured as ReturnType<typeof vi.fn>).mock.calls.length;
    expect(
      invocations,
      `triage AI-call cost regression: ${invocations} > ${MAX_TRIAGE_AI_CALLS}`
    ).toBeLessThanOrEqual(MAX_TRIAGE_AI_CALLS);
    expect(invocations).toBe(1);
  });

  it("returns exactly three suggested replies (cardinality policy)", async () => {
    const result = await useCase.execute({ messageId: "msg-1", accountId: "acc-1" });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.suggestedReplies).toHaveLength(3);
    }
  });

  it("returns sentimentScore within the [-1, 1] policy range", async () => {
    const result = await useCase.execute({ messageId: "msg-1", accountId: "acc-1" });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.sentimentScore).toBeGreaterThanOrEqual(-1);
      expect(result.value.sentimentScore).toBeLessThanOrEqual(1);
    }
  });

  it("emits a recognised priority value (policy enum)", async () => {
    const result = await useCase.execute({ messageId: "msg-1", accountId: "acc-1" });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(["URGENT", "NORMAL", "LOW"]).toContain(result.value.priority);
    }
  });
});
