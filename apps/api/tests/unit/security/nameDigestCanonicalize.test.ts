/**
 * @file nameDigestCanonicalize.test.ts
 * @description Known-answer vectors for the frozen name-canonicalisation
 *              pipeline, run against the REAL generated UCD 17.0.0 tables
 *              rather than a fixture copy of them. Three families, each proving
 *              a different half of the contract: spellings of ONE name that must
 *              collapse to one byte string, distinct names that only a
 *              compatibility fold would conflate and must stay apart, and the
 *              unassigned-codepoint path that refuses to produce bytes at all.
 *              Every expected value is derived from the UCD tables themselves
 *              (CaseFolding.txt statuses C and F), never from the implementation.
 *
 *              Every vector argument is written with `\u` escapes. A test whose
 *              whole point is byte-level identity cannot be reviewed when the
 *              difference between two inputs — a reordered combining mark, a
 *              no-break space, a final sigma — is invisible in the source.
 * @layer infrastructure
 */

import { describe, it, expect } from "vitest";
import {
  canonicalizeName,
  type CanonicalizeNameResult,
} from "../../../src/security/nameDigest/canonicalizeName.js";

/**
 * Lowest Unicode version the runtime may report and still be trusted to
 * normalize the way the pinned tables assume. Expressed as `[major, minor]`
 * NUMBERS and compared numerically: a string compare would rank "9.0" above
 * "17.0" and silently pass a runtime eight versions below the pin.
 */
const UNICODE_FLOOR: readonly [number, number] = [17, 0];

/** Canonical bytes of `name`, as lowercase hex. Throws if the name was flagged. */
const bytesOf = (name: string): string => {
  const result: CanonicalizeNameResult = canonicalizeName(name);
  if (!result.ok) {
    throw new Error(`expected canonical bytes, got flag "${result.reason}"`);
  }
  return result.bytes.toString("hex");
};

/** UTF-8 bytes of an expected literal, as lowercase hex. */
const utf8 = (text: string): string => Buffer.from(text, "utf8").toString("hex");

describe("canonicalizeName — spellings of one name collapse to one byte string", () => {
  it("folds ASCII case", () => {
    expect(bytesOf("Anna")).toBe(utf8("anna"));
    expect(bytesOf("ANNA")).toBe(utf8("anna"));
    expect(bytesOf("anna")).toBe(utf8("anna"));
  });

  it("expands sharp s through the FULL fold (status F), not the simple one", () => {
    // CaseFolding.txt: 00DF; F; 0073 0073. The simple fold (status S) leaves
    // U+00DF intact, and "Weiss" spelled with it would never meet "Weiss".
    expect(bytesOf("Wei\u00DF")).toBe(utf8("weiss"));
    expect(bytesOf("WEISS")).toBe(utf8("weiss"));
    expect(bytesOf("Wei\u00DF")).toBe(bytesOf("Weiss"));
  });

  it("folds the dotted capital I to i plus a combining dot above", () => {
    // CaseFolding.txt: 0130; F; 0069 0307. The Turkic tailoring (0130; T; 0069)
    // is excluded on purpose — a legal name must fold the same way everywhere,
    // not differently depending on the locale that happens to process it.
    expect(bytesOf("\u0130")).toBe(utf8("i\u0307"));
    expect(bytesOf("\u0130")).toBe(bytesOf("i\u0307"));
  });

  it("collapses the fi ligature, because full case folding decomposes it", () => {
    // CaseFolding.txt: FB01; F; 0066 0069. This is why the ligature belongs to
    // the SAME-digest family even though it is a compatibility mapping: the
    // mandated fold collapses it long before compatibility normalization would
    // be reached, and NFKC/NFKD are never used here at all.
    expect(bytesOf("\uFB01")).toBe(utf8("fi"));
    expect(bytesOf("\uFB01nal")).toBe(bytesOf("Final"));
  });

  it("folds every sigma to U+03C3, where toLowerCase would emit final sigma", () => {
    // The discriminator against a `toLowerCase` implementation: JavaScript
    // lowercases a word-final capital sigma to U+03C2, while CaseFolding.txt
    // maps BOTH U+03A3 and U+03C2 to U+03C3. A pipeline built on toLowerCase
    // passes every other vector in this file and fails exactly this one.
    expect("\u039F\u0394\u039F\u03A3".toLowerCase()).toBe("\u03BF\u03B4\u03BF\u03C2");
    expect(bytesOf("\u039F\u0394\u039F\u03A3")).toBe(utf8("\u03BF\u03B4\u03BF\u03C3"));
    expect(bytesOf("\u03A3")).toBe(bytesOf("\u03C3"));
    expect(bytesOf("\u03C2")).toBe(bytesOf("\u03C3"));
  });

  it("reorders combining marks before folding them", () => {
    // U+0345 has ccc=240 and U+0301 has ccc=230, so canonical order is 0301
    // then 0345 however the input was typed. The INNER NFD is what makes the
    // two orderings meet: fold first and U+0345 becomes U+03B9 (ccc=0, a base
    // letter), after which the two inputs reorder differently and never
    // converge — U+03B1 U+03AF against U+03AC U+03B9.
    expect(bytesOf("\u03B1\u0345\u0301")).toBe(bytesOf("\u03B1\u0301\u0345"));
  });

  it("collapses NFC and NFD spellings of the same name", () => {
    expect(bytesOf("D\u00EDaz")).toBe(bytesOf("Di\u0301az"));
  });

  it("maps every White_Space codepoint to U+0020, collapses runs, and trims", () => {
    const expected = utf8("ana d\u00EDaz");
    expect(bytesOf("  Ana  D\u00EDaz  ")).toBe(expected);
    expect(bytesOf("Ana\u00A0\u00A0D\u00EDaz")).toBe(expected);
    expect(bytesOf("Ana\u0085D\u00EDaz")).toBe(expected);
    expect(bytesOf("Ana\t\n D\u00EDaz")).toBe(expected);
    expect(bytesOf("\u3000Ana D\u00EDaz\u3000")).toBe(expected);
  });

  it("reduces an all-whitespace name to empty bytes rather than failing", () => {
    expect(bytesOf("   \t \u3000 ")).toBe("");
    expect(bytesOf("")).toBe("");
  });
});

describe("canonicalizeName — compatibility-only relations stay distinct", () => {
  it("keeps a fullwidth letter apart from its ASCII compatibility decomposition", () => {
    // CaseFolding.txt: FF21; C; FF41 — the fold stays inside the fullwidth
    // block, and `<wide>` is a COMPATIBILITY mapping that NFD and NFC preserve.
    // Only NFKC/NFKD would conflate these, which is why neither is used.
    expect(bytesOf("\uFF21")).toBe(utf8("\uFF41"));
    expect(bytesOf("\uFF21")).not.toBe(bytesOf("a"));
  });

  it("keeps a superscript digit apart from the digit", () => {
    // U+00B2 has no fold entry and no canonical decomposition.
    expect(bytesOf("\u00B2")).toBe(utf8("\u00B2"));
    expect(bytesOf("\u00B2")).not.toBe(bytesOf("2"));
  });
});

describe("canonicalizeName — unassigned codepoints are flagged, never digested", () => {
  it("refuses to produce bytes for a codepoint unassigned in UCD 17.0.0", () => {
    // U+05FF falls inside the Cn range 05F5..05FF of the pinned tables.
    const result = canonicalizeName("Ana\u05FFDiaz");
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable — asserted not ok above");
    expect(result.reason).toBe("unassigned_codepoint");
    expect(result).not.toHaveProperty("bytes");
  });

  it("flags on the raw input, before normalization could bury the codepoint", () => {
    expect(canonicalizeName("\u05FF").ok).toBe(false);
    expect(canonicalizeName("\uFFFE").ok).toBe(false);
    expect(canonicalizeName("\u0378").ok).toBe(false);
  });

  it("does not flag an assigned codepoint merely because it is outside the BMP", () => {
    expect(canonicalizeName("\u{1F600}").ok).toBe(true);
    expect(canonicalizeName("\u0E01").ok).toBe(true);
  });
});

describe("runtime normalization canary", () => {
  it("still produces the normalization OUTPUTS the pinned tables assume", () => {
    // Assigned-codepoint normalization is stable forever under the Unicode
    // Normalization Stability Policy, so these assert BEHAVIOUR this pipeline
    // depends on — never a version string, which would redden on every ICU
    // point release while telling us nothing about normalization at all.
    expect("\u00C5".normalize("NFD")).toBe("A\u030A");
    expect("A\u030A".normalize("NFC")).toBe("\u00C5");
    expect("\u1E9B\u0323".normalize("NFD")).toBe("\u017F\u0323\u0307");
    expect("q\u0307\u0323".normalize("NFC")).toBe("q\u0323\u0307");
    expect("\uFF21".normalize("NFD")).toBe("\uFF21");
  });

  it("runs on a Unicode version at or above the pin", () => {
    const reported = process.versions.unicode;

    // EXISTENCE first. A runtime reporting no `unicode` field would make every
    // comparison below vacuous, so its absence must redden rather than pass.
    expect(reported).toBeDefined();
    expect(typeof reported).toBe("string");

    const [majorText, minorText] = (reported ?? "").split(".");
    const major = Number.parseInt(majorText ?? "", 10);
    const minor = Number.parseInt(minorText ?? "0", 10);
    expect(Number.isInteger(major)).toBe(true);
    expect(Number.isInteger(minor)).toBe(true);

    // A FLOOR, not an equality: a runtime ABOVE the pin can only assign more
    // codepoints, so the pinned Cn set can only over-flag — a name is then left
    // intact and named by the gauge, never wrongly digested. A runtime BELOW
    // the pin is the direction that corrupts silently, and this refuses it
    // while leaving every point release green.
    const [floorMajor, floorMinor] = UNICODE_FLOOR;
    expect(major > floorMajor || (major === floorMajor && minor >= floorMinor)).toBe(true);
  });
});
