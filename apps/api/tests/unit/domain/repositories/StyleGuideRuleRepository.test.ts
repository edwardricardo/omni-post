/**
 * @file StyleGuideRuleRepository.test.ts
 * @description Contract tests for the `StyleGuideRuleRepository` port.
 *              An in-memory fake exercises `upsert` (with and without
 *              caller-supplied id), `findById`, `delete`,
 *              `listByAccountLocale`, and `updateEmbedding`, and asserts
 *              the Result<error union> shape.
 * @layer infrastructure
 */

import { describe, it, expect } from "vitest";
import { ok, err, type Result } from "@shared/types";
import type {
  StyleGuideRule,
  StyleGuideRuleRepository,
  StyleGuideRuleRepositoryError,
  StyleGuideRuleUpsertInput,
} from "../../../../src/domain/repositories/StyleGuideRuleRepository.js";

class InMemoryStyleGuideRuleRepository implements StyleGuideRuleRepository {
  private readonly store = new Map<string, StyleGuideRule>();
  private autoId = 0;

  async upsert(
    input: StyleGuideRuleUpsertInput
  ): Promise<Result<StyleGuideRule, StyleGuideRuleRepositoryError>> {
    const now = new Date();
    if (input.id && this.store.has(input.id)) {
      const existing = this.store.get(input.id)!;
      const updated: StyleGuideRule = {
        ...existing,
        rule: input.rule,
        example: input.example ?? null,
        category: input.category ?? null,
        updatedAt: now,
      };
      this.store.set(input.id, updated);
      return ok(updated);
    }
    const id = input.id ?? `s-${++this.autoId}`;
    const created: StyleGuideRule = {
      id,
      accountId: input.accountId,
      locale: input.locale,
      rule: input.rule,
      example: input.example ?? null,
      category: input.category ?? null,
      embedding: null,
      embeddingModel: "text-embedding-3-small",
      createdAt: now,
      updatedAt: now,
    };
    this.store.set(id, created);
    return ok(created);
  }

  async findById(id: string): Promise<Result<StyleGuideRule, StyleGuideRuleRepositoryError>> {
    const rule = this.store.get(id);
    return rule ? ok(rule) : err("NOT_FOUND");
  }

  async delete(id: string): Promise<Result<void, StyleGuideRuleRepositoryError>> {
    return this.store.delete(id) ? ok(undefined) : err("NOT_FOUND");
  }

  async listByAccountLocale(
    accountId: string,
    locale: string
  ): Promise<Result<StyleGuideRule[], StyleGuideRuleRepositoryError>> {
    const rows = [...this.store.values()].filter(
      (rule) => rule.accountId === accountId && rule.locale === locale
    );
    return ok(rows);
  }

  async updateEmbedding(
    id: string,
    embedding: number[],
    embeddingModel: string
  ): Promise<Result<void, StyleGuideRuleRepositoryError>> {
    const existing = this.store.get(id);
    if (!existing) return err("NOT_FOUND");
    this.store.set(id, {
      ...existing,
      embedding,
      embeddingModel,
      updatedAt: new Date(),
    });
    return ok(undefined);
  }
}

describe("StyleGuideRuleRepository contract", () => {
  it("upsert creates a new rule when no id is supplied", async () => {
    const repo = new InMemoryStyleGuideRuleRepository();
    const result = await repo.upsert({
      accountId: "acc-1",
      locale: "es",
      rule: "Usa primera persona del plural",
      category: "tone",
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.id).toBeDefined();
      expect(result.value.embedding).toBeNull();
      expect(result.value.category).toBe("tone");
    }
  });

  it("upsert updates the existing rule when the caller-supplied id is known", async () => {
    const repo = new InMemoryStyleGuideRuleRepository();
    const first = await repo.upsert({
      id: "s-fixed",
      accountId: "acc-1",
      locale: "es",
      rule: "v1",
    });
    expect(first.ok).toBe(true);

    const second = await repo.upsert({
      id: "s-fixed",
      accountId: "acc-1",
      locale: "es",
      rule: "v2",
    });
    expect(second.ok).toBe(true);
    if (second.ok) expect(second.value.rule).toBe("v2");

    const list = await repo.listByAccountLocale("acc-1", "es");
    expect(list.ok).toBe(true);
    if (list.ok) expect(list.value).toHaveLength(1);
  });

  it("findById returns NOT_FOUND for unknown ids", async () => {
    const repo = new InMemoryStyleGuideRuleRepository();
    const result = await repo.findById("missing");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("NOT_FOUND");
  });

  it("delete returns NOT_FOUND for unknown ids", async () => {
    const repo = new InMemoryStyleGuideRuleRepository();
    const result = await repo.delete("missing");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("NOT_FOUND");
  });

  it("updateEmbedding stores the vector + model on an existing row", async () => {
    const repo = new InMemoryStyleGuideRuleRepository();
    const created = await repo.upsert({
      accountId: "acc-1",
      locale: "en",
      rule: "Prefer active voice",
    });
    if (!created.ok) throw new Error("setup failure");

    const updated = await repo.updateEmbedding(created.value.id, [0.5, 0.6], "model-y");
    expect(updated.ok).toBe(true);

    const found = await repo.findById(created.value.id);
    if (found.ok) {
      expect(found.value.embedding).toEqual([0.5, 0.6]);
      expect(found.value.embeddingModel).toBe("model-y");
    }
  });
});
