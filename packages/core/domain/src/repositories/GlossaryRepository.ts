/**
 * @file GlossaryRepository.ts
 * @description Read/write port for the per-locale glossary aggregate.
 *              Each `Glossary` entry is account-scoped, locale-scoped,
 *              and unique by `(accountId, locale, term)`. The embedding
 *              vector + `embeddingModel` audit are persisted alongside
 *              the textual fields.
 * @layer domain
 */

import type { Result } from "@shared/types";

export interface GlossaryEntry {
  id: string;
  accountId: string;
  locale: string;
  term: string;
  definition: string;
  usage: string | null;
  embedding: number[] | null;
  embeddingModel: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface GlossaryEntryUpsertInput {
  accountId: string;
  locale: string;
  term: string;
  definition: string;
  usage?: string | null;
}

export type GlossaryRepositoryError =
  | "NOT_FOUND"
  | "PERSISTENCE_ERROR"
  | "INVALID_LOCALE"
  | "INVALID_INPUT";

export interface GlossaryRepository {
  upsert(input: GlossaryEntryUpsertInput): Promise<Result<GlossaryEntry, GlossaryRepositoryError>>;

  findById(id: string): Promise<Result<GlossaryEntry, GlossaryRepositoryError>>;

  delete(id: string): Promise<Result<void, GlossaryRepositoryError>>;

  listByAccountLocale(
    accountId: string,
    locale: string
  ): Promise<Result<GlossaryEntry[], GlossaryRepositoryError>>;

  /**
   * Stores the embedding vector + audit fields after the embedding service
   * has produced them. Kept as a separate method so embedding generation
   * can happen out-of-band without re-writing the textual columns.
   */
  updateEmbedding(
    id: string,
    embedding: number[],
    embeddingModel: string
  ): Promise<Result<void, GlossaryRepositoryError>>;
}
