/**
 * @file ringParameters.ts
 * @description The FROZEN parameter set each key-ring generation resolves to.
 *              A degraded tombstone carries one number — its
 *              `nameDigestKeyVersion` — and that number alone must still answer
 *              "how was this digest computed?" years after the plaintext it
 *              described stopped existing. So the algorithm, the
 *              canonicalisation identity and the domain tag are pinned per
 *              generation here, never read from live configuration.
 *
 *              Rotation appends a generation; it never edits one. Changing any
 *              value below for an existing version would silently invalidate
 *              every row pinned to it, and those rows can never be re-digested,
 *              because the name they were computed from is gone.
 * @layer infrastructure
 */

/** The MAC algorithms this capability admits. One today, named rather than inlined. */
const MAC_ALGORITHMS = {
  HMAC_SHA_256: "HMAC-SHA-256",
} as const;

/** A MAC algorithm a ring generation may declare. */
type MacAlgorithm = (typeof MAC_ALGORITHMS)[keyof typeof MAC_ALGORITHMS];

/** Everything a verifier needs, resolvable from a row's pinned version alone. */
export interface RingParameters {
  /** Full 32-byte output; never truncated. */
  readonly algorithm: MacAlgorithm;
  /**
   * Identity of the canonicalisation pipeline, which includes the pinned UCD
   * version. Version 1 is UCD 17.0.0 plus the order frozen in
   * `canonicalizeName.ts`. A different UCD version is a different
   * canonicalisation and therefore a different number here.
   */
  readonly canonicalisationVersion: number;
  /** SP 800-185 domain separation string for this capability's MACs. */
  readonly domainTag: string;
}

/** Generation 1: UCD 17.0.0, HMAC-SHA-256, the v1 domain tag. Frozen. */
const GENERATION_1: RingParameters = {
  algorithm: MAC_ALGORITHMS.HMAC_SHA_256,
  canonicalisationVersion: 1,
  domainTag: "omnipost/deletion-record/name-digest/v1",
};

/**
 * Generation to parameters, for every generation whose parameters are stated
 * explicitly. Append-only, exactly like the key ring it mirrors.
 */
export const RING_PARAMETERS: Readonly<Record<number, RingParameters>> = {
  1: GENERATION_1,
};

/**
 * @function ringParametersFor
 * @description Resolve the parameters a pinned generation was computed under.
 *   A key-only rotation — append key material, bump the pointer, restart — is
 *   an ENV operation by design, so a generation with no explicit entry inherits
 *   generation 1's parameters rather than leaving the digest uncomputable. The
 *   day the pipeline itself changes, that change adds an explicit entry for the
 *   generation it starts at, and older rows keep resolving to what they used.
 * @param version - The generation pinned on the row, or the active one.
 * @returns The frozen parameters for that generation.
 */
export function ringParametersFor(version: number): RingParameters {
  return RING_PARAMETERS[version] ?? GENERATION_1;
}
