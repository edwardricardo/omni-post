/**
 * @file nameDigest.ts
 * @description The keyed digest that replaces a tombstone's plaintext name once
 *              its retention window closes, and the verifier that reads one
 *              back. The MAC input is NIST SP 800-185 length-prefix framing —
 *              `encode_string(domainTag) || encode_string(canonicalBytes)` —
 *              rather than a delimiter, because a delimiter scheme lets two
 *              different (tag, name) splits produce identical bytes and a name
 *              could then be crafted to impersonate another domain's input.
 *
 *              The output is the FULL 32 bytes of HMAC-SHA-256, never
 *              truncated, stored as 64 lowercase hex characters. The digest is
 *              one-way by construction: this module offers no path back to a
 *              name, only a constant-time check of a candidate against a row.
 * @layer infrastructure
 */

import { createHmac, timingSafeEqual } from "node:crypto";
import { canonicalizeName, type CanonicalizeFailureReason } from "./canonicalizeName.js";
import { ringParametersFor } from "./ringParameters.js";

/** Generation to key material. Built once at boot from the validated env. */
export type NameDigestKeyRing = ReadonlyMap<number, Buffer>;

/** The two columns a degraded row carries, and all a verifier is given. */
export interface DegradedNameRow {
  readonly nameDigest: string;
  readonly nameDigestKeyVersion: number;
}

/** Refusals that belong to this module rather than to canonicalisation. */
const NAME_DIGEST_FAILURE_REASONS = {
  UNKNOWN_KEY_VERSION: "unknown_key_version",
} as const;

/** Why a digest could not be produced. */
export type NameDigestFailureReason =
  | CanonicalizeFailureReason
  | (typeof NAME_DIGEST_FAILURE_REASONS)[keyof typeof NAME_DIGEST_FAILURE_REASONS];

/** A computed digest and the generation it must be pinned to. */
export interface NameDigestSuccess {
  readonly ok: true;
  readonly digest: string;
  readonly keyVersion: number;
}

/** A refusal. It carries NO digest, so nothing can be written by accident. */
export interface NameDigestFailure {
  readonly ok: false;
  readonly reason: NameDigestFailureReason;
}

/** Discriminated result of {@link computeNameDigest}. */
export type NameDigestResult = NameDigestSuccess | NameDigestFailure;

/** Byte length of HMAC-SHA-256 output. The digest is stored whole. */
const DIGEST_BYTES = 32;

/**
 * @function leftEncode
 * @description SP 800-185 `left_encode`: the byte count, then the value's
 *   big-endian bytes. Used on BIT lengths, which is what the standard prefixes.
 * @param value - A non-negative integer, here always a bit length.
 * @returns The encoded bytes.
 */
function leftEncode(value: number): Buffer {
  const bytes: number[] = [];
  let remaining = value;
  do {
    bytes.unshift(remaining % 256);
    remaining = Math.floor(remaining / 256);
  } while (remaining > 0);
  return Buffer.from([bytes.length, ...bytes]);
}

/**
 * @function encodeString
 * @description SP 800-185 `encode_string`: `left_encode(len(S) in bits) || S`.
 *   Exported so the framing itself can be pinned by known-answer vectors rather
 *   than only observed through a digest.
 * @param payload - The bytes to frame.
 * @returns The length-prefixed encoding.
 */
export function encodeString(payload: Buffer): Buffer {
  return Buffer.concat([leftEncode(payload.length * 8), payload]);
}

/**
 * @function macInputFor
 * @description Build the exact bytes the MAC is taken over, for one generation.
 * @param keyVersion - The generation whose frozen parameters apply.
 * @param canonicalBytes - Output of the frozen canonicalisation pipeline.
 * @returns The framed MAC input.
 */
function macInputFor(keyVersion: number, canonicalBytes: Buffer): Buffer {
  const { domainTag } = ringParametersFor(keyVersion);
  return Buffer.concat([
    encodeString(Buffer.from(domainTag, "utf8")),
    encodeString(canonicalBytes),
  ]);
}

/**
 * @function computeNameDigest
 * @description Canonicalise a plaintext name and MAC it under one ring
 *   generation. Every refusal is returned rather than thrown, and carries no
 *   digest, so a caller cannot write a partially-computed result: an unassigned
 *   codepoint leaves the row intact, and an unknown generation refuses instead
 *   of quietly falling back to the active key.
 * @param ring - Generation to key material, as validated at boot.
 * @param keyVersion - The generation to compute under.
 * @param name - The plaintext name.
 * @returns The digest with the version to pin, or the reason for refusal.
 */
export function computeNameDigest(
  ring: NameDigestKeyRing,
  keyVersion: number,
  name: string
): NameDigestResult {
  const key = ring.get(keyVersion);
  if (key === undefined) {
    return { ok: false, reason: NAME_DIGEST_FAILURE_REASONS.UNKNOWN_KEY_VERSION };
  }

  const canonical = canonicalizeName(name);
  if (!canonical.ok) {
    return { ok: false, reason: canonical.reason };
  }

  const digest = createHmac("sha256", key)
    .update(macInputFor(keyVersion, canonical.bytes))
    .digest("hex");

  return { ok: true, digest, keyVersion };
}

/**
 * @function verifyNameDigest
 * @description Check a candidate name against a degraded row in constant time.
 *   The generation is taken from the ROW'S pin and never from the active
 *   pointer — that is what keeps rotation append-only: the row carries
 *   everything needed to check it, forever, including after the pointer has
 *   moved on. A pin the ring no longer holds returns false; it cannot return
 *   true, and boot already refuses a ring with a generation removed, so that
 *   state is unreachable in a running process.
 * @param ring - Generation to key material.
 * @param name - The candidate plaintext name.
 * @param row - The degraded row's digest and pinned generation.
 * @returns True when the candidate canonicalises to the recorded digest.
 */
export function verifyNameDigest(
  ring: NameDigestKeyRing,
  name: string,
  row: DegradedNameRow
): boolean {
  const computed = computeNameDigest(ring, row.nameDigestKeyVersion, name);
  if (!computed.ok) return false;

  // Reject anything that is not a whole digest BEFORE comparing: a stored value
  // of the wrong length cannot match, and `timingSafeEqual` throws on unequal
  // lengths rather than returning false.
  if (!/^[0-9a-f]{64}$/.test(row.nameDigest)) return false;

  const stored = Buffer.from(row.nameDigest, "hex");
  if (stored.length !== DIGEST_BYTES) return false;

  return timingSafeEqual(
    new Uint8Array(stored),
    new Uint8Array(Buffer.from(computed.digest, "hex"))
  );
}
