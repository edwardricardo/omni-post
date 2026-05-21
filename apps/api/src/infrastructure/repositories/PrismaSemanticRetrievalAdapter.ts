/**
 * @file PrismaSemanticRetrievalAdapter.ts
 * @description Prisma-backed adapter for the `SemanticRetrievalPort`.
 *              Ranks rows by cosine distance (`embedding <=> $1::vector`)
 *              and returns the top-K hits with their textual fields plus
 *              the distance. Rows whose embedding is NULL (not yet
 *              indexed) are excluded.
 * @layer infrastructure
 */

import type { PrismaClient } from "@infra/prisma";
import { Prisma } from "@infra/prisma";
import pgvector from "pgvector/utils";
import type {
  GlossaryHit,
  SemanticRetrievalPort,
  SemanticRetrievalQuery,
  StyleGuideHit,
} from "../../domain/repositories/SemanticRetrievalPort.js";

interface GlossaryHitRow {
  id: string;
  term: string;
  definition: string;
  usage: string | null;
  distance: number;
}

interface StyleGuideHitRow {
  id: string;
  rule: string;
  example: string | null;
  category: string | null;
  distance: number;
}

export class PrismaSemanticRetrievalAdapter implements SemanticRetrievalPort {
  constructor(private readonly prisma: PrismaClient) {}

  async searchGlossary(query: SemanticRetrievalQuery): Promise<GlossaryHit[]> {
    const vectorLiteral = pgvector.toSql(query.queryEmbedding) as string;
    const rows = await this.prisma.$queryRaw<GlossaryHitRow[]>(Prisma.sql`
      SELECT id, term, definition, usage,
             (embedding <=> ${vectorLiteral}::vector)::float8 AS distance
      FROM "Glossary"
      WHERE "accountId" = ${query.accountId}
        AND locale = ${query.locale}
        AND embedding IS NOT NULL
      ORDER BY embedding <=> ${vectorLiteral}::vector
      LIMIT ${query.topK}
    `);
    return rows.map((row) => ({
      id: row.id,
      term: row.term,
      definition: row.definition,
      usage: row.usage,
      distance: row.distance,
    }));
  }

  async searchStyleGuide(query: SemanticRetrievalQuery): Promise<StyleGuideHit[]> {
    const vectorLiteral = pgvector.toSql(query.queryEmbedding) as string;
    const rows = await this.prisma.$queryRaw<StyleGuideHitRow[]>(Prisma.sql`
      SELECT id, rule, example, category,
             (embedding <=> ${vectorLiteral}::vector)::float8 AS distance
      FROM "StyleGuideRule"
      WHERE "accountId" = ${query.accountId}
        AND locale = ${query.locale}
        AND embedding IS NOT NULL
      ORDER BY embedding <=> ${vectorLiteral}::vector
      LIMIT ${query.topK}
    `);
    return rows.map((row) => ({
      id: row.id,
      rule: row.rule,
      example: row.example,
      category: row.category,
      distance: row.distance,
    }));
  }
}
