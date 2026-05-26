/**
 * @file PrismaSemanticRetrievalAdapter.test.ts
 * @description Unit tests for the Prisma adapter of the
 *              `SemanticRetrievalPort`. Stubs `$queryRaw` so we verify:
 *                - rows are returned with their textual fields plus
 *                  cosine-distance score preserved verbatim;
 *                - both `searchGlossary` and `searchStyleGuide`
 *                  serialize the query embedding through the pgvector
 *                  helper before binding it (no thrown error means the
 *                  literal compiled).
 * @layer infrastructure
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { PrismaSemanticRetrievalAdapter } from "../../../../src/infrastructure/repositories/PrismaSemanticRetrievalAdapter.js";

interface MockPrisma {
  $queryRaw: ReturnType<typeof vi.fn>;
}

function makePrisma(): MockPrisma {
  return { $queryRaw: vi.fn() };
}

describe("PrismaSemanticRetrievalAdapter", () => {
  let prisma: MockPrisma;
  let adapter: PrismaSemanticRetrievalAdapter;

  beforeEach(() => {
    prisma = makePrisma();
    adapter = new PrismaSemanticRetrievalAdapter(prisma as never);
  });

  it("searchGlossary returns the rows mapped to hits", async () => {
    prisma.$queryRaw.mockResolvedValue([
      { id: "g-1", term: "Marca", definition: "Identidad", usage: null, distance: 0.1 },
      { id: "g-2", term: "Voz", definition: "Tono", usage: "Casual", distance: 0.42 },
    ]);

    const hits = await adapter.searchGlossary({
      accountId: "acc-1",
      locale: "es",
      queryEmbedding: [0.1, 0.2, 0.3],
      topK: 5,
    });

    expect(hits).toEqual([
      { id: "g-1", term: "Marca", definition: "Identidad", usage: null, distance: 0.1 },
      { id: "g-2", term: "Voz", definition: "Tono", usage: "Casual", distance: 0.42 },
    ]);
    expect(prisma.$queryRaw).toHaveBeenCalledTimes(1);
  });

  it("searchStyleGuide returns the rows mapped to hits", async () => {
    prisma.$queryRaw.mockResolvedValue([
      {
        id: "s-1",
        rule: "Prefer active voice",
        example: null,
        category: "grammar",
        distance: 0.05,
      },
    ]);

    const hits = await adapter.searchStyleGuide({
      accountId: "acc-1",
      locale: "en",
      queryEmbedding: [0.4, 0.5],
      topK: 3,
    });

    expect(hits).toEqual([
      {
        id: "s-1",
        rule: "Prefer active voice",
        example: null,
        category: "grammar",
        distance: 0.05,
      },
    ]);
    expect(prisma.$queryRaw).toHaveBeenCalledTimes(1);
  });

  it("searchGlossary returns an empty array when the query yields no rows", async () => {
    prisma.$queryRaw.mockResolvedValue([]);
    const hits = await adapter.searchGlossary({
      accountId: "acc-1",
      locale: "es",
      queryEmbedding: [0.0],
      topK: 5,
    });
    expect(hits).toEqual([]);
  });

  it("propagates the underlying Prisma error (caller decides how to react)", async () => {
    prisma.$queryRaw.mockRejectedValue(new Error("vector dim mismatch"));
    await expect(
      adapter.searchGlossary({
        accountId: "acc-1",
        locale: "es",
        queryEmbedding: [0.1],
        topK: 5,
      })
    ).rejects.toThrow(/vector dim mismatch/);
  });
});
