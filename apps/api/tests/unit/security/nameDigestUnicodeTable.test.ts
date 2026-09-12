/**
 * @file nameDigestUnicodeTable.test.ts
 * @description Offline gate for the Unicode tables the name-digest
 *              canonicalisation pipeline is frozen against. Two independent
 *              assertions, because either one alone would let a wrong table
 *              through: (a) every vendored UCD input still hashes to the
 *              sha256 the generator pins, so nobody can edit the source data
 *              under the table; (b) re-running the generator in-process
 *              reproduces the committed module byte for byte, so nobody can
 *              edit the table under the source data. Together they say the
 *              committed tables ARE what UCD 17.0.0 says, and the digests
 *              computed from them are reproducible forever.
 * @layer infrastructure
 */

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";
import {
  GENERATED_MODULE_RELATIVE_PATH,
  UCD_INPUTS,
  UCD_VERSION,
  renderUnicodeDataModule,
} from "../../../scripts/generate-unicode-fold-table.js";
import { UNICODE_DATA_VERSION } from "../../../src/security/nameDigest/unicodeData.generated.js";

/** apps/api — the root both the generator and the committed module are relative to. */
const API_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

const sha256 = (value: Buffer | string): string => createHash("sha256").update(value).digest("hex");

describe("pinned UCD inputs", () => {
  it("pins exactly the three inputs the canonicalisation pipeline consumes", () => {
    expect(UCD_VERSION).toBe("17.0.0");
    expect(UNICODE_DATA_VERSION).toBe(UCD_VERSION);
    expect(UCD_INPUTS.map((input) => input.relativePath)).toEqual([
      "ucd/17.0.0/CaseFolding.txt",
      "ucd/17.0.0/PropList.txt",
      "ucd/17.0.0/extracted/DerivedGeneralCategory.txt",
    ]);
  });

  for (const input of UCD_INPUTS) {
    it(`${input.relativePath} still hashes to its committed sha256 pin`, () => {
      const bytes = readFileSync(path.join(API_ROOT, input.relativePath));
      expect(sha256(bytes)).toBe(input.sha256);
    });
  }
});

describe("regenerate-and-diff", () => {
  it("reproduces the committed generated module byte for byte", () => {
    const regenerated = renderUnicodeDataModule(API_ROOT);
    const committed = readFileSync(path.join(API_ROOT, GENERATED_MODULE_RELATIVE_PATH), "utf8");

    // Compare hashes first so a mismatch reports two 64-char strings instead of
    // dumping ~2,300 lines of table into the failure output.
    expect(sha256(regenerated)).toBe(sha256(committed));
    expect(regenerated).toBe(committed);
  });
});
