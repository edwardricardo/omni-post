/**
 * @file canonicalizeName.ts
 * @description Turns a tombstone's plaintext `name` into the exact bytes the
 *              name digest is computed over. The pipeline is FROZEN: its
 *              identity is `canonicalisationVersion` 1, and a row that pinned
 *              that version must still verify years from now, so every step
 *              consults the tables vendored under `apps/api/ucd/17.0.0/` rather
 *              than the runtime's, which move with every ICU bump.
 *
 *              The order is part of the contract, not an implementation detail:
 *              decode, flag unassigned, NFD, full case fold, NFC, whitespace,
 *              UTF-8. Folding before the inner NFD would reorder combining
 *              marks differently and two spellings of one name would stop
 *              meeting; compatibility normalization (NFKC/NFKD) is never used
 *              at all, because it would conflate names that are genuinely
 *              different people.
 * @layer infrastructure
 */

import { FOLD_MAP, UNASSIGNED_RANGES, WHITE_SPACE } from "./unicodeData.generated.js";

/**
 * Why a name could not be canonicalised. One member today, declared as a const
 * map so a second reason arrives as data rather than as a widened string type.
 */
const CANONICALIZE_FAILURE_REASONS = {
  UNASSIGNED_CODEPOINT: "unassigned_codepoint",
} as const;

/** The reason a canonicalisation refused to produce bytes. */
export type CanonicalizeFailureReason =
  (typeof CANONICALIZE_FAILURE_REASONS)[keyof typeof CANONICALIZE_FAILURE_REASONS];

/** A name that canonicalised cleanly, carrying the bytes to digest. */
export interface CanonicalizeNameSuccess {
  readonly ok: true;
  readonly bytes: Buffer;
}

/** A name that was refused. It carries NO bytes, so it cannot be digested by accident. */
export interface CanonicalizeNameFailure {
  readonly ok: false;
  readonly reason: CanonicalizeFailureReason;
}

/** Discriminated result of {@link canonicalizeName}. */
export type CanonicalizeNameResult = CanonicalizeNameSuccess | CanonicalizeNameFailure;

/** The single space every White_Space codepoint collapses to. */
const SPACE = " ";

/**
 * @function isUnassigned
 * @description Membership test against the pinned General_Category=Cn ranges,
 *   by binary search over the sorted, merged range list.
 * @param codepoint - The code point to classify.
 * @returns True when this UCD version assigns the code point no character.
 */
function isUnassigned(codepoint: number): boolean {
  let low = 0;
  let high = UNASSIGNED_RANGES.length - 1;
  while (low <= high) {
    const middle = (low + high) >>> 1;
    const range = UNASSIGNED_RANGES[middle];
    if (range === undefined) break;
    const [start, end] = range;
    if (codepoint < start) {
      high = middle - 1;
    } else if (codepoint > end) {
      low = middle + 1;
    } else {
      return true;
    }
  }
  return false;
}

/**
 * @function foldFully
 * @description Apply the pinned full case fold (CaseFolding.txt statuses C and
 *   F) code point by code point. A code point with no entry folds to itself.
 * @param text - Text already in NFD.
 * @returns The folded text, not yet recomposed.
 */
function foldFully(text: string): string {
  let folded = "";
  for (const character of text) {
    // `for...of` over a string yields whole code points, so `codePointAt(0)`
    // is always defined here; the fallback keeps the type non-nullable without
    // a non-null assertion.
    const codepoint = character.codePointAt(0) ?? 0;
    const mapping = FOLD_MAP.get(codepoint);
    folded += mapping === undefined ? character : String.fromCodePoint(...mapping);
  }
  return folded;
}

/**
 * @function applyWhitespacePolicy
 * @description Map every pinned White_Space code point to U+0020, collapse runs
 *   to one space, and trim both ends. A name that is entirely whitespace
 *   reduces to the empty string rather than failing — it carries no identifying
 *   information, and refusing it would leave the row overdue forever.
 * @param text - Text already recomposed to NFC.
 * @returns The whitespace-normalised text.
 */
function applyWhitespacePolicy(text: string): string {
  let canonical = "";
  let separatorPending = false;
  for (const character of text) {
    const codepoint = character.codePointAt(0) ?? 0;
    if (WHITE_SPACE.has(codepoint)) {
      // Leading whitespace never opens a separator, and a trailing run is never
      // flushed — which is what makes this a trim as well as a collapse.
      separatorPending = canonical.length > 0;
      continue;
    }
    if (separatorPending) {
      canonical += SPACE;
      separatorPending = false;
    }
    canonical += character;
  }
  return canonical;
}

/**
 * @function canonicalizeName
 * @description Run the frozen canonicalisation pipeline over a plaintext name.
 *   A name holding any code point unassigned in the pinned UCD version is
 *   REFUSED rather than digested: a later Unicode version may assign it, and
 *   the fold it would then receive is not knowable now, so digesting it would
 *   record a value that can never be reproduced.
 * @param name - The plaintext name as stored on the tombstone.
 * @returns The canonical UTF-8 bytes, or the reason the name was refused.
 */
export function canonicalizeName(name: string): CanonicalizeNameResult {
  for (const character of name) {
    const codepoint = character.codePointAt(0) ?? 0;
    if (isUnassigned(codepoint)) {
      return { ok: false, reason: CANONICALIZE_FAILURE_REASONS.UNASSIGNED_CODEPOINT };
    }
  }

  const decomposed = name.normalize("NFD");
  const folded = foldFully(decomposed);
  const recomposed = folded.normalize("NFC");
  const canonical = applyWhitespacePolicy(recomposed);

  return { ok: true, bytes: Buffer.from(canonical, "utf8") };
}
