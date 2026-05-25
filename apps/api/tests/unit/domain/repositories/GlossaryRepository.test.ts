/**
 * @file GlossaryRepository.test.ts
 * @description Contract tests for the `GlossaryRepository` port. A
 *              fake in-memory implementation exercises the contract
 *              shape (`upsert`, `findById`, `delete`, `listByAccountLocale`,
 *              `updateEmbedding`) and asserts the canonical
 *              Result<error union> behaviour for each method.
 * @layer infrastructure
 */

import { describe, it, expect } from "vitest";
import { ok, err, type Result } from "@shared/types";
import type {
  GlossaryEntry,
  GlossaryEntryUpsertInput,
  GlossaryRepository,
  GlossaryRepositoryError,
} from "@core/domain/repositories/GlossaryRepository.js";

class InMemoryGlossaryRepository implements GlossaryRepository {
  private readonly store = new Map<string, GlossaryEntry>();
  private autoId = 0;

  async upsert(
    input: GlossaryEntryUpsertInput
  ): Promise<Result<GlossaryEntry, GlossaryRepositoryError>> {
    const key = `${input.accountId}::${input.locale}::${input.term}`;
    const existing = [...this.store.values()].find(
      (entry) => `${entry.accountId}::${entry.locale}::${entry.term}` === key
    );
    const now = new Date();
    if (existing) {
      const updated: GlossaryEntry = {
        ...existing,
        definition: input.definition,
        usage: input.usage ?? null,
        updatedAt: now,
      };
      this.store.set(existing.id, updated);
      return ok(updated);
    }
    const id = `g-${++this.autoId}`;
    const created: GlossaryEntry = {
      id,
      accountId: input.accountId,
      locale: input.locale,
      term: input.term,
      definition: input.definition,
      usage: input.usage ?? null,
      embedding: null,
      embeddingModel: "text-embedding-3-small",
      createdAt: now,
      updatedAt: now,
    };
    this.store.set(id, created);
    return ok(created);
  }

  async findById(id: string): Promise<Result<GlossaryEntry, GlossaryRepositoryError>> {
    const entry = this.store.get(id);
    return entry ? ok(entry) : err("NOT_FOUND");
  }

  async delete(id: string): Promise<Result<void, GlossaryRepositoryError>> {
    return this.store.delete(id) ? ok(undefined) : err("NOT_FOUND");
  }

  async listByAccountLocale(
    accountId: string,
    locale: string
  ): Promise<Result<GlossaryEntry[], GlossaryRepositoryError>> {
    const rows = [...this.store.values()].filter(
      (entry) => entry.accountId === accountId && entry.locale === locale
    );
    return ok(rows);
  }

  async updateEmbedding(
    id: string,
    embedding: number[],
    embeddingModel: string
  ): Promise<Result<void, GlossaryRepositoryError>> {
    const existing = this.store.get(id);
    if (!existing) return err("NOT_FOUND");
    this.store.set(id, { ...existing, embedding, embeddingModel, updatedAt: new Date() });
    return ok(undefined);
  }
}

describe("GlossaryRepository contract", () => {
  it("upsert creates a new entry when the (accountId, locale, term) is fresh", async () => {
    const repo = new InMemoryGlossaryRepository();
    const result = await repo.upsert({
      accountId: "acc-1",
      locale: "es",
      term: "Marca",
      definition: "Identidad",
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.id).toBeDefined();
      expect(result.value.embedding).toBeNull();
    }
  });

  it("upsert replaces the definition when the (accountId, locale, term) already exists", async () => {
    const repo = new InMemoryGlossaryRepository();
    await repo.upsert({ accountId: "acc-1", locale: "es", term: "Marca", definition: "v1" });
    const second = await repo.upsert({
      accountId: "acc-1",
      locale: "es",
      term: "Marca",
      definition: "v2",
    });
    expect(second.ok).toBe(true);
    if (second.ok) expect(second.value.definition).toBe("v2");

    const list = await repo.listByAccountLocale("acc-1", "es");
    expect(list.ok).toBe(true);
    if (list.ok) expect(list.value).toHaveLength(1);
  });

  it("findById returns NOT_FOUND for unknown ids", async () => {
    const repo = new InMemoryGlossaryRepository();
    const result = await repo.findById("missing");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("NOT_FOUND");
  });

  it("delete returns NOT_FOUND for unknown ids", async () => {
    const repo = new InMemoryGlossaryRepository();
    const result = await repo.delete("missing");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("NOT_FOUND");
  });

  it("updateEmbedding stores the vector + model on an existing row", async () => {
    const repo = new InMemoryGlossaryRepository();
    const created = await repo.upsert({
      accountId: "acc-1",
      locale: "es",
      term: "Voz",
      definition: "Tono",
    });
    if (!created.ok) throw new Error("setup failure");

    const updated = await repo.updateEmbedding(created.value.id, [0.1, 0.2], "model-x");
    expect(updated.ok).toBe(true);

    const found = await repo.findById(created.value.id);
    if (found.ok) {
      expect(found.value.embedding).toEqual([0.1, 0.2]);
      expect(found.value.embeddingModel).toBe("model-x");
    }
  });
});
