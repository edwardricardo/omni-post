/**
 * @file TrackedTermQuery.test.ts
 * @description Contract tests for the TrackedTermQuery domain port. Pins the
 *   read-model shape (`TrackedTermForSearch`) and the `TrackedTermKind` union the
 *   mention-search dispatch depends on, so a rename/shape drift breaks here.
 * @layer infrastructure
 */

import { describe, it, expect, vi } from "vitest";
import assert from "node:assert/strict";
import type {
  TrackedTermQuery,
  TrackedTermForSearch,
  TrackedTermKind,
} from "@core/domain/repositories/TrackedTermQuery.js";

describe("TrackedTermQuery contract", () => {
  it("exposes the fields the dispatch loop reads on a tracked term", () => {
    const term: TrackedTermForSearch = {
      id: "t-1",
      accountId: "acc-1",
      projectId: "proj-1",
      term: "acme",
      kind: "BRAND",
    };

    assert.deepStrictEqual(Object.keys(term).sort(), [
      "accountId",
      "id",
      "kind",
      "projectId",
      "term",
    ]);
  });

  it("allows both Share-of-Voice term kinds", () => {
    const brand: TrackedTermKind = "BRAND";
    const market: TrackedTermKind = "MARKET";
    assert.strictEqual(brand, "BRAND");
    assert.strictEqual(market, "MARKET");
  });

  it("is satisfiable by a conforming implementation, optionally scoped by account", async () => {
    const findActiveTerms = vi.fn(async (accountId?: string): Promise<TrackedTermForSearch[]> => {
      return accountId
        ? [{ id: "t-1", accountId, projectId: "proj-1", term: "acme", kind: "BRAND" }]
        : [];
    });
    const fake: TrackedTermQuery = { findActiveTerms };

    const scoped = await fake.findActiveTerms("acc-9");
    assert.strictEqual(scoped[0]?.accountId, "acc-9");
    expect(findActiveTerms).toHaveBeenCalledWith("acc-9");

    const unscoped = await fake.findActiveTerms();
    assert.deepStrictEqual(unscoped, []);
  });
});
