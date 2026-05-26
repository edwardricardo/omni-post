/**
 * @file mentionIngestWorker.test.ts
 * @description Unit tests for the mention-ingest worker's pure tracked-term
 *   attribution helper. Provider I/O (search/fetch normalization) is covered by
 *   the provider adapter tests; persistence idempotency by the Mention
 *   integration test.
 * @layer infrastructure
 */

import { describe, it } from "vitest";
import assert from "node:assert/strict";
import { matchTrackedTermId } from "../src/mentionIngestWorker.js";

const TERMS = [
  { id: "t-brand", term: "Acme", kind: "BRAND" },
  { id: "t-market", term: "Rival Co", kind: "MARKET" },
];

describe("matchTrackedTermId", () => {
  it("attributes a mention to the term whose text appears in the body", () => {
    assert.strictEqual(matchTrackedTermId("I love Acme products", TERMS), "t-brand");
  });

  it("matches case-insensitively", () => {
    assert.strictEqual(matchTrackedTermId("rival co is decent", TERMS), "t-market");
  });

  it("returns the first matching term when several appear", () => {
    assert.strictEqual(matchTrackedTermId("Acme beats Rival Co", TERMS), "t-brand");
  });

  it("returns undefined when no term matches", () => {
    assert.strictEqual(matchTrackedTermId("something unrelated", TERMS), undefined);
  });

  it("returns undefined for an empty term list", () => {
    assert.strictEqual(matchTrackedTermId("Acme", []), undefined);
  });
});
