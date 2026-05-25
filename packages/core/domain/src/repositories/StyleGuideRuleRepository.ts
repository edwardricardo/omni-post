/**
 * @file StyleGuideRuleRepository.ts
 * @description Read/write port for the per-locale style-guide aggregate.
 *              Each rule is account-scoped, locale-scoped, and optionally
 *              tagged by `category` (tone, formatting, grammar, etc.).
 *              The embedding vector + `embeddingModel` audit are persisted
 *              alongside the textual fields.
 * @layer domain
 */

import type { Result } from "@shared/types";

export interface StyleGuideRule {
  id: string;
  accountId: string;
  locale: string;
  rule: string;
  example: string | null;
  category: string | null;
  embedding: number[] | null;
  embeddingModel: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface StyleGuideRuleUpsertInput {
  id?: string;
  accountId: string;
  locale: string;
  rule: string;
  example?: string | null;
  category?: string | null;
}

export type StyleGuideRuleRepositoryError =
  | "NOT_FOUND"
  | "PERSISTENCE_ERROR"
  | "INVALID_LOCALE"
  | "INVALID_INPUT";

export interface StyleGuideRuleRepository {
  upsert(
    input: StyleGuideRuleUpsertInput
  ): Promise<Result<StyleGuideRule, StyleGuideRuleRepositoryError>>;

  findById(id: string): Promise<Result<StyleGuideRule, StyleGuideRuleRepositoryError>>;

  delete(id: string): Promise<Result<void, StyleGuideRuleRepositoryError>>;

  listByAccountLocale(
    accountId: string,
    locale: string
  ): Promise<Result<StyleGuideRule[], StyleGuideRuleRepositoryError>>;

  updateEmbedding(
    id: string,
    embedding: number[],
    embeddingModel: string
  ): Promise<Result<void, StyleGuideRuleRepositoryError>>;
}
