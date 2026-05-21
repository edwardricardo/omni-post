/**
 * @file PrismaGlossaryRepository.ts
 * @description Prisma-backed adapter for the `GlossaryRepository` port.
 *              The `embedding` column is `vector(768)` and Prisma marks
 *              it `Unsupported`, so it is read and written via
 *              `$queryRaw` / `$executeRaw` with the canonical pgvector
 *              cast `::vector`.
 * @layer infrastructure
 */

import { ok, err, type Result } from "@shared/types";
import type { PrismaClient } from "@infra/prisma";
import { Prisma } from "@infra/prisma";
import pgvector from "pgvector/utils";
import type {
  GlossaryEntry,
  GlossaryEntryUpsertInput,
  GlossaryRepository,
  GlossaryRepositoryError,
} from "../../domain/repositories/GlossaryRepository.js";

interface GlossaryRow {
  id: string;
  accountId: string;
  locale: string;
  term: string;
  definition: string;
  usage: string | null;
  embedding: string | null;
  embeddingModel: string;
  createdAt: Date;
  updatedAt: Date;
}

function parseVector(raw: string | null): number[] | null {
  if (raw === null) return null;
  const parsed = pgvector.fromSql(raw);
  return Array.isArray(parsed) ? (parsed as number[]) : null;
}

function rowToEntry(row: GlossaryRow): GlossaryEntry {
  return {
    id: row.id,
    accountId: row.accountId,
    locale: row.locale,
    term: row.term,
    definition: row.definition,
    usage: row.usage,
    embedding: parseVector(row.embedding),
    embeddingModel: row.embeddingModel,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export class PrismaGlossaryRepository implements GlossaryRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async upsert(
    input: GlossaryEntryUpsertInput
  ): Promise<Result<GlossaryEntry, GlossaryRepositoryError>> {
    try {
      const saved = await this.prisma.glossary.upsert({
        where: {
          accountId_locale_term: {
            accountId: input.accountId,
            locale: input.locale,
            term: input.term,
          },
        },
        update: {
          definition: input.definition,
          usage: input.usage ?? null,
        },
        create: {
          accountId: input.accountId,
          locale: input.locale,
          term: input.term,
          definition: input.definition,
          usage: input.usage ?? null,
        },
        select: {
          id: true,
          accountId: true,
          locale: true,
          term: true,
          definition: true,
          usage: true,
          embeddingModel: true,
          createdAt: true,
          updatedAt: true,
        },
      });

      return ok({
        ...saved,
        embedding: null,
      });
    } catch {
      return err("PERSISTENCE_ERROR");
    }
  }

  async findById(id: string): Promise<Result<GlossaryEntry, GlossaryRepositoryError>> {
    try {
      const rows = await this.prisma.$queryRaw<GlossaryRow[]>(Prisma.sql`
        SELECT id, "accountId", locale, term, definition, usage,
               embedding::text AS embedding,
               "embeddingModel", "createdAt", "updatedAt"
        FROM "Glossary"
        WHERE id = ${id}
        LIMIT 1
      `);
      const row = rows[0];
      if (!row) return err("NOT_FOUND");
      return ok(rowToEntry(row));
    } catch {
      return err("PERSISTENCE_ERROR");
    }
  }

  async delete(id: string): Promise<Result<void, GlossaryRepositoryError>> {
    try {
      await this.prisma.glossary.delete({ where: { id } });
      return ok(undefined);
    } catch (error: unknown) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2025") {
        return err("NOT_FOUND");
      }
      return err("PERSISTENCE_ERROR");
    }
  }

  async listByAccountLocale(
    accountId: string,
    locale: string
  ): Promise<Result<GlossaryEntry[], GlossaryRepositoryError>> {
    try {
      const rows = await this.prisma.$queryRaw<GlossaryRow[]>(Prisma.sql`
        SELECT id, "accountId", locale, term, definition, usage,
               embedding::text AS embedding,
               "embeddingModel", "createdAt", "updatedAt"
        FROM "Glossary"
        WHERE "accountId" = ${accountId} AND locale = ${locale}
        ORDER BY term ASC
      `);
      return ok(rows.map(rowToEntry));
    } catch {
      return err("PERSISTENCE_ERROR");
    }
  }

  async updateEmbedding(
    id: string,
    embedding: number[],
    embeddingModel: string
  ): Promise<Result<void, GlossaryRepositoryError>> {
    try {
      const vectorLiteral = pgvector.toSql(embedding) as string;
      const affected = await this.prisma.$executeRaw(Prisma.sql`
        UPDATE "Glossary"
        SET embedding = ${vectorLiteral}::vector,
            "embeddingModel" = ${embeddingModel},
            "updatedAt" = NOW()
        WHERE id = ${id}
      `);
      if (affected === 0) return err("NOT_FOUND");
      return ok(undefined);
    } catch {
      return err("PERSISTENCE_ERROR");
    }
  }
}
