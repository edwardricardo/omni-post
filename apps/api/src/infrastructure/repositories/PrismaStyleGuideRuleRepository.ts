/**
 * @file PrismaStyleGuideRuleRepository.ts
 * @description Prisma-backed adapter for the `StyleGuideRuleRepository`
 *              port. Read/write of the `vector(768)` `embedding` column
 *              uses `$queryRaw` / `$executeRaw` with the pgvector
 *              `::vector` cast.
 * @layer infrastructure
 */

import { ok, err, type Result } from "@shared/types";
import type { PrismaClient } from "@infra/prisma";
import { Prisma } from "@infra/prisma";
import pgvector from "pgvector/utils";
import { requireTenantContext } from "../../security/tenantContext.js";
import type {
  StyleGuideRule,
  StyleGuideRuleRepository,
  StyleGuideRuleRepositoryError,
  StyleGuideRuleUpsertInput,
} from "@core/domain/repositories/StyleGuideRuleRepository.js";

interface StyleGuideRuleRow {
  id: string;
  accountId: string;
  locale: string;
  rule: string;
  example: string | null;
  category: string | null;
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

function rowToRule(row: StyleGuideRuleRow): StyleGuideRule {
  return {
    id: row.id,
    accountId: row.accountId,
    locale: row.locale,
    rule: row.rule,
    example: row.example,
    category: row.category,
    embedding: parseVector(row.embedding),
    embeddingModel: row.embeddingModel,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export class PrismaStyleGuideRuleRepository implements StyleGuideRuleRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async upsert(
    input: StyleGuideRuleUpsertInput
  ): Promise<Result<StyleGuideRule, StyleGuideRuleRepositoryError>> {
    try {
      // StyleGuideRule does not have a natural composite unique key, so we
      // upsert by id when supplied and create otherwise. Callers that wish
      // to enforce idempotency must supply the id.
      const saved = input.id
        ? await this.prisma.styleGuideRule.upsert({
            where: { id: input.id },
            update: {
              rule: input.rule,
              example: input.example ?? null,
              category: input.category ?? null,
            },
            create: {
              id: input.id,
              accountId: input.accountId,
              locale: input.locale,
              rule: input.rule,
              example: input.example ?? null,
              category: input.category ?? null,
            },
            select: {
              id: true,
              accountId: true,
              locale: true,
              rule: true,
              example: true,
              category: true,
              embeddingModel: true,
              createdAt: true,
              updatedAt: true,
            },
          })
        : await this.prisma.styleGuideRule.create({
            data: {
              accountId: input.accountId,
              locale: input.locale,
              rule: input.rule,
              example: input.example ?? null,
              category: input.category ?? null,
            },
            select: {
              id: true,
              accountId: true,
              locale: true,
              rule: true,
              example: true,
              category: true,
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

  async findById(id: string): Promise<Result<StyleGuideRule, StyleGuideRuleRepositoryError>> {
    try {
      const rows = await this.prisma.$queryRaw<StyleGuideRuleRow[]>(Prisma.sql`
        SELECT id, "accountId", locale, rule, example, category,
               embedding::text AS embedding,
               "embeddingModel", "createdAt", "updatedAt"
        FROM "StyleGuideRule"
        WHERE id = ${id}
        LIMIT 1
      `);
      const row = rows[0];
      if (!row) return err("NOT_FOUND");
      return ok(rowToRule(row));
    } catch {
      return err("PERSISTENCE_ERROR");
    }
  }

  async delete(id: string): Promise<Result<void, StyleGuideRuleRepositoryError>> {
    try {
      await this.prisma.styleGuideRule.delete({ where: { id } });
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
  ): Promise<Result<StyleGuideRule[], StyleGuideRuleRepositoryError>> {
    try {
      const rows = await this.prisma.$queryRaw<StyleGuideRuleRow[]>(Prisma.sql`
        SELECT id, "accountId", locale, rule, example, category,
               embedding::text AS embedding,
               "embeddingModel", "createdAt", "updatedAt"
        FROM "StyleGuideRule"
        WHERE "accountId" = ${accountId} AND locale = ${locale}
        ORDER BY "createdAt" ASC
      `);
      return ok(rows.map(rowToRule));
    } catch {
      return err("PERSISTENCE_ERROR");
    }
  }

  async updateEmbedding(
    id: string,
    embedding: number[],
    embeddingModel: string
  ): Promise<Result<void, StyleGuideRuleRepositoryError>> {
    try {
      // S2.1d — raw UPDATEs bypass the Prisma $extends tenant guard (S2.1b),
      // so they MUST carry an explicit accountId predicate against the bound
      // TenantContext (CWE-639). Layer 2 (RLS) covers UoW-wrapped callers,
      // but background callers without a tx still rely on this filter.
      const { accountId } = requireTenantContext();
      const vectorLiteral = pgvector.toSql(embedding) as string;
      const affected = await this.prisma.$executeRaw(Prisma.sql`
        UPDATE "StyleGuideRule"
        SET embedding = ${vectorLiteral}::vector,
            "embeddingModel" = ${embeddingModel},
            "updatedAt" = NOW()
        WHERE id = ${id} AND "accountId" = ${accountId}
      `);
      if (affected === 0) return err("NOT_FOUND");
      return ok(undefined);
    } catch {
      return err("PERSISTENCE_ERROR");
    }
  }
}
