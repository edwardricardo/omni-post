/**
 * @file readAlertFragments.test.ts
 * @description Unit tests for the ONE reader of the live-fragment list an alert carries.
 *   It existed twice — once on the outbox payload in the event handler, once on the
 *   notification metadata in the email adapter — and two readers of one shape drift: the
 *   day one of them starts accepting a numeric `externalId`, the dashboard and the email
 *   name different fragments for the same stranded post.
 *
 *   The rule it encodes is deliberate and is pinned here rather than in either caller: a
 *   malformed entry is DROPPED, never fatal. An email naming three of four live
 *   fragments is worth sending; one that fails to render names none.
 * @layer infrastructure
 */

import { describe, it } from "vitest";
import assert from "node:assert/strict";
import { readAlertFragments } from "../../src/readAlertFragments.js";

describe("readAlertFragments", () => {
  it("reads the entries that carry an index and an external id", () => {
    const fragments = readAlertFragments([
      { index: 1, externalId: "18110001", url: "https://x.test/a/1" },
      { index: 2, externalId: "18110002" },
    ]);

    assert.deepStrictEqual(fragments, [
      { index: 1, externalId: "18110001", url: "https://x.test/a/1" },
      { index: 2, externalId: "18110002" },
    ]);
  });

  it("drops a malformed entry instead of failing the whole alert", () => {
    const fragments = readAlertFragments([
      { index: 1, externalId: "18110001" },
      { bogus: true },
      null,
      "not an object",
      { index: "two", externalId: "18110003" },
      { index: 3 },
    ]);

    assert.deepStrictEqual(fragments, [{ index: 1, externalId: "18110001" }]);
  });

  it("omits a url that is not a usable string rather than carrying an empty one", () => {
    const fragments = readAlertFragments([
      { index: 1, externalId: "18110001", url: "" },
      { index: 2, externalId: "18110002", url: 42 },
    ]);

    assert.deepStrictEqual(fragments, [
      { index: 1, externalId: "18110001" },
      { index: 2, externalId: "18110002" },
    ]);
  });

  it("answers with nothing when the payload carries no list at all", () => {
    assert.deepStrictEqual(readAlertFragments(undefined), []);
    assert.deepStrictEqual(readAlertFragments({ index: 1 }), []);
    assert.deepStrictEqual(readAlertFragments([]), []);
  });
});
