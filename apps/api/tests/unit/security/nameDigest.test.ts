/**
 * @file nameDigest.test.ts
 * @description Known-answer vectors for the frozen MAC construction and for the
 *              verifier that reads a degraded row back. The expected values are
 *              derived from NIST SP 800-185's `encode_string` definition and
 *              from HMAC-SHA-256 under a fixed test key — not from this
 *              module — so the suite pins the CONSTRUCTION rather than merely
 *              agreeing with whatever the implementation currently emits.
 *
 *              The framing assertions are the load-bearing ones. Length-prefix
 *              encoding is what makes the domain tag unambiguous: without it,
 *              two different (tag, name) splits concatenate to the same bytes
 *              and a name could be crafted to impersonate another domain's
 *              input.
 * @layer infrastructure
 */

import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { describe, it, expect } from "vitest";
import { canonicalizeName } from "../../../src/security/nameDigest/canonicalizeName.js";
import {
  computeNameDigest,
  encodeString,
  verifyNameDigest,
  type NameDigestKeyRing,
} from "../../../src/security/nameDigest/nameDigest.js";
import {
  RING_PARAMETERS,
  ringParametersFor,
} from "../../../src/security/nameDigest/ringParameters.js";

/** A fixed, non-secret 32-byte test key. Never used outside this suite. */
const TEST_KEY_HEX = "00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff";

/** A second fixed test key, so a rotation can be exercised without a real ring. */
const SECOND_KEY_HEX = "ffeeddccbbaa99887766554433221100ffeeddccbbaa99887766554433221100";

const RING: NameDigestKeyRing = new Map([
  [1, Buffer.from(TEST_KEY_HEX, "hex")],
  [2, Buffer.from(SECOND_KEY_HEX, "hex")],
]);

/** Digest of `name` under `version`, or a thrown error naming the refusal. */
const digestOf = (name: string, version = 1): string => {
  const result = computeNameDigest(RING, version, name);
  if (!result.ok) throw new Error(`expected a digest, got flag "${result.reason}"`);
  return result.digest;
};

describe("frozen ring parameters", () => {
  it("resolves the complete parameter set from a pinned version alone", () => {
    const parameters = RING_PARAMETERS[1];
    expect(parameters).toBeDefined();
    expect(parameters).toEqual({
      algorithm: "HMAC-SHA-256",
      canonicalisationVersion: 1,
      domainTag: "omnipost/deletion-record/name-digest/v1",
    });
  });
});

describe("encode_string framing (SP 800-185)", () => {
  it("encodes the empty string as left_encode(0) followed by nothing", () => {
    // left_encode(0) = 0x01 0x00 — one length byte, then the value zero.
    expect(encodeString(Buffer.alloc(0)).toString("hex")).toBe("0100");
  });

  it("encodes a one-byte string as its BIT length then the byte", () => {
    // left_encode(8) = 0x01 0x08, then 0x41 for "A".
    expect(encodeString(Buffer.from("A", "utf8")).toString("hex")).toBe("010841");
  });

  it("encodes the 39-byte domain tag with a two-byte length prefix", () => {
    // 39 bytes = 312 bits = 0x0138, which needs two bytes, so n = 2.
    const tag = Buffer.from(RING_PARAMETERS[1]?.domainTag ?? "", "utf8");
    expect(tag.length).toBe(39);
    const encoded = encodeString(tag);
    expect(encoded.subarray(0, 3).toString("hex")).toBe("020138");
    expect(encoded.subarray(3).equals(tag)).toBe(true);
  });

  it("removes the split ambiguity that bare concatenation leaves open", () => {
    const ab = Buffer.from("ab", "utf8");
    const c = Buffer.from("c", "utf8");
    const a = Buffer.from("a", "utf8");
    const bc = Buffer.from("bc", "utf8");

    // A naive scheme concatenates and cannot tell the two splits apart.
    expect(Buffer.concat([ab, c]).equals(Buffer.concat([a, bc]))).toBe(true);

    // The framed encoding can, which is the whole reason it is used.
    const framedLeft = Buffer.concat([encodeString(ab), encodeString(c)]);
    const framedRight = Buffer.concat([encodeString(a), encodeString(bc)]);
    expect(framedLeft.equals(framedRight)).toBe(false);
  });
});

describe("computeNameDigest known answers", () => {
  it("reproduces the committed digest for a canonical ASCII name", () => {
    expect(digestOf("Anna")).toBe(
      "872f88739b825d1abf44b74e2a8338a65d46ac9ac74380f13e1bbb339069a4be"
    );
  });

  it("reproduces the committed digest for a canonical accented name", () => {
    expect(digestOf("  ANA   D\u00CDAZ  ")).toBe(
      "826a514493e98ae669191231a85d5255a46a2f0661632f802c2062fce76a67c3"
    );
  });

  it("reproduces the committed digest for the empty canonical form", () => {
    expect(digestOf("   \u3000 ")).toBe(
      "1f38f7661983287dee8f077af4172aef43f8b98b55cbd884f0b445cda562b3ce"
    );
  });

  it("emits the FULL 32 bytes as 64 lowercase hex characters, never truncated", () => {
    const digest = digestOf("Anna");
    expect(digest).toMatch(/^[0-9a-f]{64}$/);
    expect(Buffer.from(digest, "hex")).toHaveLength(32);
  });

  it("agrees with HMAC-SHA-256 over the framed input computed independently", () => {
    const canonical = canonicalizeName("Anna");
    expect(canonical.ok).toBe(true);
    if (!canonical.ok) throw new Error("unreachable — asserted ok above");

    const tag = Buffer.from(RING_PARAMETERS[1]?.domainTag ?? "", "utf8");
    const macInput = Buffer.concat([encodeString(tag), encodeString(canonical.bytes)]);
    const expected = createHmac("sha256", Buffer.from(TEST_KEY_HEX, "hex"))
      .update(macInput)
      .digest("hex");

    expect(digestOf("Anna")).toBe(expected);
  });

  it("keeps NUL-bearing names apart from the names a delimiter would conflate", () => {
    // U+0000 is assigned (Cc) and is not White_Space, so it survives
    // canonicalisation. A "tag + NUL + name" scheme would let these meet.
    const withLeadingNul = digestOf("\u0000anna");
    const withTrailingNul = digestOf("anna\u0000");
    const withInnerNul = digestOf("an\u0000na");
    const plain = digestOf("anna");

    expect(new Set([withLeadingNul, withTrailingNul, withInnerNul, plain]).size).toBe(4);
  });

  it("keeps a name that repeats the domain tag apart from the tag's own framing", () => {
    const tag = RING_PARAMETERS[1]?.domainTag ?? "";
    expect(digestOf(tag)).not.toBe(digestOf(`${tag}x`));
    expect(digestOf(tag)).not.toBe(digestOf(""));
  });

  it("produces a different digest under a different ring generation", () => {
    expect(digestOf("Anna", 1)).not.toBe(digestOf("Anna", 2));
  });

  it("refuses a key version the ring does not hold, instead of guessing one", () => {
    const result = computeNameDigest(RING, 9, "Anna");
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable — asserted not ok above");
    expect(result.reason).toBe("unknown_key_version");
  });

  it("refuses a name holding an unassigned codepoint, producing no digest", () => {
    const result = computeNameDigest(RING, 1, "Ana\u05FFDiaz");
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable — asserted not ok above");
    expect(result.reason).toBe("unassigned_codepoint");
    expect(result).not.toHaveProperty("digest");
  });
});

describe("verifyNameDigest", () => {
  const row = { nameDigest: digestOf("Ana D\u00EDaz", 1), nameDigestKeyVersion: 1 };

  it("verifies the original name", () => {
    expect(verifyNameDigest(RING, "Ana D\u00EDaz", row)).toBe(true);
  });

  it("verifies any canonically equivalent spelling of it", () => {
    expect(verifyNameDigest(RING, "  ana   d\u00EDaz  ", row)).toBe(true);
    expect(verifyNameDigest(RING, "ANA\u00A0Di\u0301AZ", row)).toBe(true);
  });

  it("does not verify a different name", () => {
    expect(verifyNameDigest(RING, "Ana Diaz", row)).toBe(false);
    expect(verifyNameDigest(RING, "Anna", row)).toBe(false);
  });

  it("resolves the key from the ROW's pin, never from the active version", () => {
    // The same name under generation 2 must not verify against a row pinned to
    // generation 1, and vice versa. This is what keeps rotation append-only:
    // the row carries everything needed to check it, forever.
    const rowV2 = { nameDigest: digestOf("Ana D\u00EDaz", 2), nameDigestKeyVersion: 2 };
    expect(verifyNameDigest(RING, "Ana D\u00EDaz", rowV2)).toBe(true);
    expect(verifyNameDigest(RING, "Ana D\u00EDaz", { ...row, nameDigestKeyVersion: 2 })).toBe(
      false
    );
    expect(verifyNameDigest(RING, "Ana D\u00EDaz", { ...rowV2, nameDigestKeyVersion: 1 })).toBe(
      false
    );
  });

  it("does not verify against a pin the ring no longer holds", () => {
    expect(verifyNameDigest(RING, "Ana D\u00EDaz", { ...row, nameDigestKeyVersion: 9 })).toBe(
      false
    );
  });

  it("does not verify a name that canonicalisation refuses", () => {
    expect(verifyNameDigest(RING, "Ana\u05FFDiaz", row)).toBe(false);
  });

  it("does not verify against a malformed or short stored digest", () => {
    expect(verifyNameDigest(RING, "Ana D\u00EDaz", { ...row, nameDigest: "" })).toBe(false);
    expect(verifyNameDigest(RING, "Ana D\u00EDaz", { ...row, nameDigest: "zz" })).toBe(false);
    expect(
      verifyNameDigest(RING, "Ana D\u00EDaz", { ...row, nameDigest: row.nameDigest.slice(0, 32) })
    ).toBe(false);
  });
});

describe("ring parameter inheritance", () => {
  /** Generations the suite probes; a listed one is skipped, so adding an entry never hides the rest. */
  const unlistedGenerations = [2, 3, 17, 1000].filter(
    (generation) => !(generation in RING_PARAMETERS)
  );

  it("resolves a generation with no explicit entry to generation 1's parameters", () => {
    expect(unlistedGenerations.length).toBeGreaterThan(0);
    for (const generation of unlistedGenerations) {
      expect(ringParametersFor(generation)).toEqual({
        algorithm: "HMAC-SHA-256",
        canonicalisationVersion: 1,
        domainTag: "omnipost/deletion-record/name-digest/v1",
      });
    }
  });

  it("returns the explicit entry for a generation that has one", () => {
    expect(ringParametersFor(1)).toBe(RING_PARAMETERS[1]);
  });

  it("MACs a key-only rotation under generation 1's domain tag, with the rotated key", () => {
    const tag = Buffer.from("omnipost/deletion-record/name-digest/v1", "utf8");
    const canonical = Buffer.from("anna", "utf8");
    const expected = createHmac("sha256", Buffer.from(SECOND_KEY_HEX, "hex"))
      .update(Buffer.concat([encodeString(tag), encodeString(canonical)]))
      .digest("hex");

    expect(digestOf("Anna", 2)).toBe(expected);
  });

  it("holds generation 1 as the only explicit entry until vectors exist for a new one", () => {
    // An entry added here starts a generation whose pipeline may differ from
    // version 1, so it needs its own golden vectors below. Add them, then widen
    // this list; the inheritance cases above keep covering the unlisted ones.
    assert.deepStrictEqual(
      Object.keys(RING_PARAMETERS),
      ["1"],
      "RING_PARAMETERS gained a generation: add golden canonicalisation vectors for it"
    );
  });
});

/** One fixed input and the committed result of each frozen stage that decides it. */
interface GoldenVector {
  readonly label: string;
  readonly input: string;
  /** Hex of the canonical UTF-8 bytes the pipeline must produce. */
  readonly canonicalHex: string;
  /** HMAC-SHA-256 under generation 1 of the test ring, over the framed bytes. */
  readonly digest: string;
}

const CHANGE_INSTRUCTION =
  "canonicalisation changed for generation 1: add a RING_PARAMETERS entry for the generation " +
  "the change starts at, keep these vectors for generation 1, and add new vectors for that entry";

/**
 * Literals committed from a run of the pipeline, never recomputed here. Each
 * vector is decided by a different stage, so altering any stage of the frozen
 * pipeline turns at least one of them red.
 */
const GOLDEN_VECTORS_V1: readonly GoldenVector[] = [
  {
    label: "a full case fold that is longer than one code point (ss)",
    input: "Stra\u00DFE",
    canonicalHex: "73747261737365",
    digest: "59c12520b4a791b80f98cccf0d8c8949991daf193bd565d4d5240a324ffdfd99",
  },
  {
    label: "a fold that differs from lower-casing (final sigma)",
    input: "\u03A3\u03A3\u03C2",
    canonicalHex: "cf83cf83cf83",
    digest: "9360163c2ba3a7127f0f8d0a0185e7e619c65f91e56e3b05521bf0f29e6fc809",
  },
  {
    label: "a fold that yields a base letter plus a combining mark",
    input: "\u0130",
    canonicalHex: "69cc87",
    digest: "a30531709c21956043878d9560b59610f2d0d55ba423e4c8775d0bddce309988",
  },
  {
    label: "a name that is recomposed to NFC after folding",
    input: "\u00C9COLE",
    canonicalHex: "c3a9636f6c65",
    digest: "956833648d2e557b1e3260f7951414e8201b1fc0f726a0258bd1d428ec28906b",
  },
  {
    label: "combining marks that only meet their fold once decomposed and reordered",
    input: "a\u0345\u0323",
    canonicalHex: "e1baa1ceb9",
    digest: "ea43bf843a692a00c92866a8a09c123176217298585dc7e9f1040c5c515781aa",
  },
  {
    label: "mixed White_Space runs collapsed to one space and trimmed",
    input: "\u00A0\u2003Ana\u3000\u3000 D\u00EDaz\t\n ",
    canonicalHex: "616e612064c3ad617a",
    digest: "826a514493e98ae669191231a85d5255a46a2f0661632f802c2062fce76a67c3",
  },
  {
    label: "a supplementary-plane letter folded and written as four UTF-8 bytes",
    input: "\u{10400}",
    canonicalHex: "f09090a8",
    digest: "711b978bc50ac86baa1e07955429716f76bb91693d173f6d395096d8a9e52d22",
  },
];

describe("canonicalisation version 1 golden vectors", () => {
  it.each(GOLDEN_VECTORS_V1)("canonicalises $label to its committed bytes", (vector) => {
    const canonical = canonicalizeName(vector.input);
    expect(canonical.ok).toBe(true);
    if (!canonical.ok) throw new Error(`expected bytes, got refusal "${canonical.reason}"`);

    assert.strictEqual(canonical.bytes.toString("hex"), vector.canonicalHex, CHANGE_INSTRUCTION);
  });

  it.each(GOLDEN_VECTORS_V1)("digests $label to its committed value", (vector) => {
    assert.strictEqual(digestOf(vector.input), vector.digest, CHANGE_INSTRUCTION);
  });

  it("refuses a basic-plane and a supplementary-plane unassigned codepoint", () => {
    for (const input of ["Ana\u05FFDiaz", "Ana\u{2FFFE}"]) {
      const canonical = canonicalizeName(input);
      assert.strictEqual(canonical.ok, false, CHANGE_INSTRUCTION);
      if (canonical.ok) throw new Error("unreachable — asserted not ok above");
      expect(canonical.reason).toBe("unassigned_codepoint");
      expect(canonical).not.toHaveProperty("bytes");
    }
  });
});
