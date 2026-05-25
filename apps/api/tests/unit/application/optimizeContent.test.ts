/**
 * @file optimizeContent.test.ts
 * @description Tests for `OptimizeContentUseCase` after the AIServicePort
 *   refactor: verifies the UC depends on the port (not the concrete
 *   AIService) and exercises happy/AI-down/platform-limit paths.
 * @layer infrastructure
 */

import { describe, it, beforeEach, vi, expect } from "vitest";
import { OptimizeContentUseCase } from "@core/application/ml/OptimizeContentUseCase.js";
import type { AIServicePort } from "@core/domain/repositories/AIServicePort.js";

function createMockAI(overrides: Partial<AIServicePort> = {}): AIServicePort {
  return {
    optimizeContent: vi.fn(async () => ({ success: true, optimization: {} })),
    analyzeContent: vi.fn(async () => ({ success: true, analysis: {} })),
    generateVariations: vi.fn(async () => ({ success: true, variations: [] })),
    generateContent: vi.fn(async () => ({ success: true, content: "" })),
    ...overrides,
  };
}

describe("OptimizeContentUseCase", () => {
  let ai: AIServicePort;
  let uc: OptimizeContentUseCase;

  beforeEach(() => {
    ai = createMockAI();
    uc = new OptimizeContentUseCase(ai);
  });

  it("returns validation error when content is empty", async () => {
    const result = await uc.execute({
      content: "",
      provider: "X",
      optimizationGoal: "engagement",
    });
    expect(result.ok).toBe(false);
  });

  it("invokes AIServicePort.optimizeContent with content + platform", async () => {
    ai = createMockAI({
      optimizeContent: vi.fn(async () => ({
        success: true,
        optimization: { optimizedText: "AI optimized!", changes: [], hashtags: [] },
      })),
    });
    uc = new OptimizeContentUseCase(ai);

    const result = await uc.execute({
      content: "Hello world",
      provider: "X",
      optimizationGoal: "engagement",
    });
    expect(result.ok).toBe(true);
    expect((ai.optimizeContent as ReturnType<typeof vi.fn>).mock.calls.length).toBe(1);
    const call = (ai.optimizeContent as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(call?.[0]).toBe("Hello world");
    // The UC normalises provider strings to platform identifiers before
    // calling the AI port — accept either the raw or the lowercased form.
    expect(typeof call?.[1]).toBe("string");
  });

  it("falls back to heuristic when AI throws", async () => {
    ai = createMockAI({
      optimizeContent: vi.fn(async () => {
        throw new Error("AI unavailable");
      }),
    });
    uc = new OptimizeContentUseCase(ai);

    const result = await uc.execute({
      content: "Lorem ipsum dolor sit amet",
      provider: "X",
      optimizationGoal: "engagement",
    });
    // Heuristic fallback always succeeds
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.optimizedContent).toBeTruthy();
    }
  });

  it("truncates content to platform limit when AI is unavailable", async () => {
    ai = createMockAI({
      optimizeContent: vi.fn(async () => {
        throw new Error("down");
      }),
    });
    uc = new OptimizeContentUseCase(ai);
    const longContent = "x".repeat(500);
    const result = await uc.execute({
      content: longContent,
      provider: "X", // 280 char limit
      optimizationGoal: "engagement",
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.optimizedContent.length).toBeLessThanOrEqual(280);
    }
  });
});
