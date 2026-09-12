/**
 * @file keyRing.ts
 * @description Parses the append-only name-digest key ring out of its single
 *              environment variable and into `ReadonlyMap<number, Buffer>`.
 *              Kept beside the digest rather than inside `config/env.ts` for
 *              the same reason `trustedProxy.ts` is: the env schema states the
 *              boundary rule, the security module owns the meaning, and the
 *              rule stays testable without booting an env.
 *
 *              Every refusal NAMES the offending version. A ring outlives the
 *              plaintext its generations described — a row pinned to a
 *              generation can never be re-digested — so "the ring is invalid"
 *              is not an actionable message; "version 2 is not 64 lowercase hex
 *              characters" is.
 * @layer infrastructure
 */

import type { NameDigestKeyRing } from "./nameDigest.js";

/** The variable this module parses. Embedded so refusals read as boot errors. */
const RING_ENV_KEY = "DELETION_NAME_DIGEST_KEY_RING";

/** A generation label: a positive integer with no leading zero. */
const VERSION_KEY = /^[1-9][0-9]*$/;

/** Key material: exactly 32 bytes as 64 LOWERCASE hex characters. */
const KEY_MATERIAL = /^[0-9a-f]{64}$/;

/** A parsed ring, ready to hand to the digest. */
export interface KeyRingParseSuccess {
  readonly ok: true;
  readonly ring: NameDigestKeyRing;
}

/** A refusal, carrying the message the boot failure should show. */
export interface KeyRingParseFailure {
  readonly ok: false;
  readonly reason: string;
}

/** Discriminated result of {@link parseNameDigestKeyRing}. */
export type KeyRingParseResult = KeyRingParseSuccess | KeyRingParseFailure;

/**
 * @function parseNameDigestKeyRing
 * @description Validate the ring's SHAPE and decode its key material. Version
 *   contiguity is deliberately NOT checked here: it is the cross-field rule the
 *   env schema applies alongside the active-version pointer, so both
 *   ring-consistency refusals are raised in one place.
 * @param raw - The raw environment value.
 * @returns The decoded ring, or the reason it was refused.
 */
export function parseNameDigestKeyRing(raw: string): KeyRingParseResult {
  let decoded: unknown;
  try {
    decoded = JSON.parse(raw);
  } catch {
    return {
      ok: false,
      reason: `${RING_ENV_KEY} is not valid JSON (expected {"1":"<64 lowercase hex characters>"})`,
    };
  }

  if (typeof decoded !== "object" || decoded === null || Array.isArray(decoded)) {
    return {
      ok: false,
      reason: `${RING_ENV_KEY} must be a JSON object mapping version numbers to key material`,
    };
  }

  const entries = Object.entries(decoded as Record<string, unknown>);
  if (entries.length === 0) {
    return {
      ok: false,
      reason: `${RING_ENV_KEY} declares no generations — version 1 must exist`,
    };
  }

  const ring = new Map<number, Buffer>();
  for (const [versionKey, value] of entries) {
    if (!VERSION_KEY.test(versionKey)) {
      return {
        ok: false,
        reason:
          `${RING_ENV_KEY} has a non-version key "${versionKey}" ` +
          `(versions are positive integers starting at 1)`,
      };
    }
    if (typeof value !== "string" || !KEY_MATERIAL.test(value)) {
      return {
        ok: false,
        reason:
          `${RING_ENV_KEY} version ${versionKey} is not 64 lowercase hex characters ` +
          `(32 random bytes, generated with \`openssl rand -hex 32\`)`,
      };
    }
    ring.set(Number(versionKey), Buffer.from(value, "hex"));
  }

  return { ok: true, ring: new Map([...ring].sort((a, b) => a[0] - b[0])) };
}

/**
 * @function firstMissingRingVersion
 * @description Find the lowest generation between 1 and the highest declared
 *   one that the ring does not hold. A gap means some row's pinned generation
 *   was deleted, and that row's digest can never be verified again — so a
 *   gapped ring must refuse to boot rather than run in a state where
 *   verification silently stops working.
 * @param ring - A shape-valid ring.
 * @returns The missing generation, or undefined when the ring is contiguous.
 */
export function firstMissingRingVersion(ring: NameDigestKeyRing): number | undefined {
  const highest = Math.max(...ring.keys());
  for (let version = 1; version <= highest; version += 1) {
    if (!ring.has(version)) return version;
  }
  return undefined;
}
