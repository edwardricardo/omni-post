/**
 * @file EmbeddingService.test.ts
 * @description Unit tests for the embeddings application service: empty
 *              input short-circuits, the port is invoked with the
 *              supplied texts + options, the matrix is returned as-is on
 *              success, and a `Result.err(UseCaseError)` is returned when
 *              every provider fails.
 * @layer infrastructure
 */

import { describe, it, expect, vi } from "vitest";
import { ok, err } from "@shared/types";
import { EmbeddingService } from "@core/application/embeddings/EmbeddingService.js";
import type { AIServicePort } from "../../../../src/domain/repositories/AIServicePort.js";

function makeAI(result: { ok: true; value: number[][] } | { ok: false; error: "AI_ERROR" }) {
  const generateEmbeddings = vi
    .fn()
    .mockResolvedValue(result.ok ? ok(result.value) : err(result.error));
  return {
    aiPort: {
      generateEmbeddings,
    } as unknown as AIServicePort,
    generateEmbeddings,
  };
}

describe("EmbeddingService", () => {
  it("returns an empty matrix without invoking the port when texts is empty", async () => {
    const { aiPort, generateEmbeddings } = makeAI({ ok: true, value: [] });
    const service = new EmbeddingService(aiPort);

    const result = await service.embed([]);

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toEqual([]);
    expect(generateEmbeddings).not.toHaveBeenCalled();
  });

  it("forwards texts and options to the port on the happy path", async () => {
    const { aiPort, generateEmbeddings } = makeAI({
      ok: true,
      value: [
        [0.1, 0.2, 0.3],
        [0.4, 0.5, 0.6],
      ],
    });
    const service = new EmbeddingService(aiPort);

    const result = await service.embed(["hello", "world"], { dimensions: 3 }, "acc-1");

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toHaveLength(2);
    expect(generateEmbeddings).toHaveBeenCalledWith(["hello", "world"], { dimensions: 3 }, "acc-1");
  });

  it("returns a UseCaseError when the port reports AI_ERROR", async () => {
    const { aiPort } = makeAI({ ok: false, error: "AI_ERROR" });
    const service = new EmbeddingService(aiPort);

    const result = await service.embed(["hi"]);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.message).toMatch(/Embeddings provider failed/);
  });

  it("embedSingle returns the first vector on success", async () => {
    const { aiPort } = makeAI({ ok: true, value: [[0.7, 0.8]] });
    const service = new EmbeddingService(aiPort);

    const result = await service.embedSingle("hi");

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toEqual([0.7, 0.8]);
  });

  it("embedSingle returns a UseCaseError when the matrix is empty", async () => {
    const { aiPort } = makeAI({ ok: true, value: [] });
    const service = new EmbeddingService(aiPort);

    const result = await service.embedSingle("hi");

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.message).toMatch(/empty/);
  });
});
