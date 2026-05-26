/**
 * @file AiServiceImageGenerationAdapter.test.ts
 * @description Tests the mapping from AIService's AIResponse wrapper to the
 *              ImageGenerationPort Result: success → ok, provider error →
 *              err(message), and the empty-payload edge (ok but no value) →
 *              err(fallback).
 * @layer infrastructure
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import assert from "node:assert/strict";
import { AiServiceImageGenerationAdapter } from "../../../../src/infrastructure/adapters/AiServiceImageGenerationAdapter.js";
import type { AIService } from "../../../../src/ai/aiService.js";

function makeAIService(generateImage: ReturnType<typeof vi.fn>) {
  return { generateImage } as unknown as AIService;
}

const OPTIONS = { prompt: "A sunset over the ocean" } as const;

describe("AiServiceImageGenerationAdapter", () => {
  let adapter: AiServiceImageGenerationAdapter;
  let generateImage: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    generateImage = vi.fn();
    adapter = new AiServiceImageGenerationAdapter(makeAIService(generateImage));
  });

  it("maps a successful response with a payload to ok(value)", async () => {
    generateImage.mockResolvedValue({
      ok: true,
      value: { imageUrl: "https://cdn.example.com/img.png", revisedPrompt: "Revised" },
    });

    const result = await adapter.generateImage(OPTIONS);

    assert.ok(result.ok);
    assert.equal(result.value.imageUrl, "https://cdn.example.com/img.png");
    assert.equal(result.value.revisedPrompt, "Revised");
    expect(generateImage).toHaveBeenCalledWith(OPTIONS);
  });

  it("maps a provider error to err(message)", async () => {
    generateImage.mockResolvedValue({
      ok: false,
      error: { message: "Rate limit exceeded" },
    });

    const result = await adapter.generateImage(OPTIONS);

    assert.ok(!result.ok);
    assert.equal(result.error, "Rate limit exceeded");
  });

  it("maps a successful response with no payload to err(fallback)", async () => {
    generateImage.mockResolvedValue({ ok: true, value: undefined });

    const result = await adapter.generateImage(OPTIONS);

    assert.ok(!result.ok);
    assert.equal(result.error, "Image generation failed");
  });

  it("maps an error response with no message to err(fallback)", async () => {
    generateImage.mockResolvedValue({ ok: false });

    const result = await adapter.generateImage(OPTIONS);

    assert.ok(!result.ok);
    assert.equal(result.error, "Image generation failed");
  });
});
