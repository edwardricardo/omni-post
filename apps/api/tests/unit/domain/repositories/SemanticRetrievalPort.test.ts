/**
 * @file SemanticRetrievalPort.test.ts
 * @description Contract test for the `SemanticRetrievalPort`. A
 *              deterministic in-memory fake ranks candidates by an
 *              externally supplied distance map and verifies:
 *                - results are returned in ascending distance order;
 *                - `topK` truncates the result set;
 *                - the `accountId` + `locale` filter is honoured;
 *                - the textual fields of each hit are preserved.
 * @layer infrastructure
 */

import { describe, it, expect } from "vitest";
import type {
  GlossaryHit,
  SemanticRetrievalPort,
  SemanticRetrievalQuery,
  StyleGuideHit,
} from "../../../../src/domain/repositories/SemanticRetrievalPort.js";

interface GlossaryRow {
  id: string;
  accountId: string;
  locale: string;
  term: string;
  definition: string;
  usage: string | null;
  distance: number;
}

interface StyleGuideRow {
  id: string;
  accountId: string;
  locale: string;
  rule: string;
  example: string | null;
  category: string | null;
  distance: number;
}

class InMemorySemanticRetrievalAdapter implements SemanticRetrievalPort {
  constructor(
    private readonly glossaryRows: GlossaryRow[],
    private readonly styleRows: StyleGuideRow[]
  ) {}

  async searchGlossary(query: SemanticRetrievalQuery): Promise<GlossaryHit[]> {
    return this.glossaryRows
      .filter((row) => row.accountId === query.accountId && row.locale === query.locale)
      .sort((a, b) => a.distance - b.distance)
      .slice(0, query.topK)
      .map((row) => ({
        id: row.id,
        term: row.term,
        definition: row.definition,
        usage: row.usage,
        distance: row.distance,
      }));
  }

  async searchStyleGuide(query: SemanticRetrievalQuery): Promise<StyleGuideHit[]> {
    return this.styleRows
      .filter((row) => row.accountId === query.accountId && row.locale === query.locale)
      .sort((a, b) => a.distance - b.distance)
      .slice(0, query.topK)
      .map((row) => ({
        id: row.id,
        rule: row.rule,
        example: row.example,
        category: row.category,
        distance: row.distance,
      }));
  }
}

describe("SemanticRetrievalPort contract", () => {
  it("searchGlossary returns hits sorted by ascending distance", async () => {
    const port = new InMemorySemanticRetrievalAdapter(
      [
        {
          id: "g-1",
          accountId: "acc-1",
          locale: "es",
          term: "Voz",
          definition: "Tono",
          usage: null,
          distance: 0.8,
        },
        {
          id: "g-2",
          accountId: "acc-1",
          locale: "es",
          term: "Marca",
          definition: "Identidad",
          usage: null,
          distance: 0.1,
        },
        {
          id: "g-3",
          accountId: "acc-1",
          locale: "es",
          term: "Slogan",
          definition: "Lema",
          usage: null,
          distance: 0.4,
        },
      ],
      []
    );

    const hits = await port.searchGlossary({
      accountId: "acc-1",
      locale: "es",
      queryEmbedding: [0.1, 0.2],
      topK: 5,
    });
    expect(hits.map((hit) => hit.id)).toEqual(["g-2", "g-3", "g-1"]);
  });

  it("searchGlossary honours topK truncation", async () => {
    const port = new InMemorySemanticRetrievalAdapter(
      Array.from({ length: 10 }).map((_, i) => ({
        id: `g-${i}`,
        accountId: "acc-1",
        locale: "es",
        term: `Term-${i}`,
        definition: `Def-${i}`,
        usage: null,
        distance: i / 10,
      })),
      []
    );

    const hits = await port.searchGlossary({
      accountId: "acc-1",
      locale: "es",
      queryEmbedding: [0.1],
      topK: 3,
    });
    expect(hits).toHaveLength(3);
    expect(hits.map((hit) => hit.id)).toEqual(["g-0", "g-1", "g-2"]);
  });

  it("searchGlossary filters by (accountId, locale) — no cross-tenant or cross-locale leak", async () => {
    const port = new InMemorySemanticRetrievalAdapter(
      [
        {
          id: "g-acc1-es",
          accountId: "acc-1",
          locale: "es",
          term: "Marca",
          definition: "ES",
          usage: null,
          distance: 0.1,
        },
        {
          id: "g-acc1-en",
          accountId: "acc-1",
          locale: "en",
          term: "Brand",
          definition: "EN",
          usage: null,
          distance: 0.1,
        },
        {
          id: "g-acc2-es",
          accountId: "acc-2",
          locale: "es",
          term: "Otra",
          definition: "Otra",
          usage: null,
          distance: 0.0,
        },
      ],
      []
    );

    const hits = await port.searchGlossary({
      accountId: "acc-1",
      locale: "es",
      queryEmbedding: [0.1],
      topK: 10,
    });
    expect(hits).toHaveLength(1);
    expect(hits[0]?.id).toBe("g-acc1-es");
  });

  it("searchStyleGuide preserves rule/example/category fields", async () => {
    const port = new InMemorySemanticRetrievalAdapter(
      [],
      [
        {
          id: "s-1",
          accountId: "acc-1",
          locale: "es",
          rule: "Usa primera persona del plural",
          example: "Nosotros lanzamos…",
          category: "tone",
          distance: 0.05,
        },
      ]
    );

    const hits = await port.searchStyleGuide({
      accountId: "acc-1",
      locale: "es",
      queryEmbedding: [0.0],
      topK: 5,
    });
    expect(hits).toEqual([
      {
        id: "s-1",
        rule: "Usa primera persona del plural",
        example: "Nosotros lanzamos…",
        category: "tone",
        distance: 0.05,
      },
    ]);
  });
});
