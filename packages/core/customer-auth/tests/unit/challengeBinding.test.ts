/**
 * @file challengeBinding.test.ts
 * @description Unit tests for the SHA-256 binding-hash helper.
 * @layer infrastructure
 */

import { describe, it } from "vitest";
import assert from "node:assert/strict";
import { createHash } from "crypto";
import { sha256Hex } from "../../src/challengeBinding.js";

describe("sha256Hex", () => {
  it("returns a 64-character lowercase hex digest", () => {
    const digest = sha256Hex("203.0.113.7");
    assert.strictEqual(digest.length, 64);
    assert.match(digest, /^[0-9a-f]{64}$/);
  });

  it("matches the Node crypto reference digest for the same input", () => {
    const input = "Mozilla/5.0 (X11; Linux x86_64) TestAgent/1.0";
    const expected = createHash("sha256").update(input, "utf8").digest("hex");
    assert.strictEqual(sha256Hex(input), expected);
  });

  it("is deterministic and distinguishes different inputs", () => {
    assert.strictEqual(sha256Hex("198.51.100.4"), sha256Hex("198.51.100.4"));
    assert.notStrictEqual(sha256Hex("198.51.100.4"), sha256Hex("198.51.100.5"));
  });
});
