/**
 * @file EmbeddingService.test.ts
 * @description Unit tests for EmbeddingService — validates text embedding
 *   delegation to AIServicePort, empty-array shortcut, and error propagation.
 * @layer infrastructure
 */

import { describe, it, vi, beforeEach } from "vitest";
import assert from "node:assert/strict";
import { ok, err } from "@shared/types";
import { EmbeddingService } from "../../src/EmbeddingService.js";

const makeAiPort = () => ({
  generateEmbeddings: vi.fn().mockResolvedValue(ok([[0.1, 0.2, 0.3]])),
  generateText: vi.fn(),
  generateVariants: vi.fn(),
  optimizeContent: vi.fn(),
});

describe("EmbeddingService", () => {
  let aiPort: ReturnType<typeof makeAiPort>;
  let service: EmbeddingService;

  beforeEach(() => {
    vi.clearAllMocks();
    aiPort = makeAiPort();
    service = new EmbeddingService(aiPort);
  });

  describe("embed", () => {
    it("returns ok with embedding matrix for non-empty text array", async () => {
      const result = await service.embed(["hello world"]);
      assert.ok(result.ok, "Expected ok result");
      assert.strictEqual(result.value.length, 1);
      assert.deepEqual(result.value[0], [0.1, 0.2, 0.3]);
    });

    it("returns ok with empty matrix for empty input array (short-circuit)", async () => {
      const result = await service.embed([]);
      assert.ok(result.ok, "Expected ok result");
      assert.deepEqual(result.value, []);
      assert.strictEqual(aiPort.generateEmbeddings.mock.calls.length, 0);
    });

    it("returns INTERNAL_ERROR when AI provider fails", async () => {
      aiPort.generateEmbeddings.mockResolvedValue(err("AI_ERROR"));
      const result = await service.embed(["some text"]);
      assert.ok(!result.ok, "Expected err result");
      assert.strictEqual(result.error.code, "INTERNAL_ERROR");
    });
  });

  describe("embedSingle", () => {
    it("returns ok with single embedding vector", async () => {
      const result = await service.embedSingle("hello world");
      assert.ok(result.ok, "Expected ok result");
      assert.deepEqual(result.value, [0.1, 0.2, 0.3]);
    });

    it("returns INTERNAL_ERROR when provider returns empty matrix", async () => {
      aiPort.generateEmbeddings.mockResolvedValue(ok([]));
      const result = await service.embedSingle("hello world");
      assert.ok(!result.ok, "Expected err result");
      assert.strictEqual(result.error.code, "INTERNAL_ERROR");
    });
  });
});
