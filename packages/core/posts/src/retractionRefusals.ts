/**
 * @file retractionRefusals.ts
 * @description The refusals a retraction act answers that a caller must be able to TELL
 *              APART from every other conflict, because they map to different answers at
 *              a route. They live in one module rather than in whichever use case
 *              happened to need the first of them: the set is the package's PUBLIC
 *              vocabulary — it is what a route switches on — and a second use case
 *              adding a second refusal must extend this set rather than grow a parallel
 *              one, which is how two discriminators for one concept get born.
 * @layer application
 */

import { UseCaseError, USE_CASE_ERRORS } from "@core/application/UseCase.js";

/** Every refusal a retraction act can answer with a discriminator. */
export const RETRACTION_REFUSALS = {
  /** Nothing is live on that channel, so there is no removal to confirm. */
  NOTHING_PENDING: "NOTHING_PENDING",
} as const;

export type RetractionRefusal = (typeof RETRACTION_REFUSALS)[keyof typeof RETRACTION_REFUSALS];

/**
 * The recognised values, DERIVED from the set above rather than listed again.
 *
 * A reader that compares against a hand-written subset answers `undefined` for the
 * member it does not know, and nothing catches it: the error class accepts the new
 * member, the return type still promises the whole union, and `tsc` stays at 0. That is
 * the same silent miss the discriminator exists to prevent, one level up — so the set is
 * the single source and coverage is a property of the code, not of anyone's diligence.
 */
const RECOGNISED: ReadonlySet<string> = new Set<string>(Object.values(RETRACTION_REFUSALS));

/**
 * @function isRetractionRefusal
 * @description Type guard over the derived value set.
 * @param value - Any value read off an error.
 * @returns true when the value is one of the declared refusals.
 */
function isRetractionRefusal(value: unknown): value is RetractionRefusal {
  return typeof value === "string" && RECOGNISED.has(value);
}

/**
 * @function refusalOf
 * @description Reads the retraction discriminator off an error, when it carries one.
 *              Value-based on purpose: a caller in another package compares a string
 *              rather than a constructor, so a duplicate module instance — this package
 *              ships a dual conditional export — cannot silently turn a known refusal
 *              into an unknown one.
 * @param error - The error a retraction use case returned.
 * @returns The discriminator, or undefined when the error carries none.
 */
export function refusalOf(error: Error): RetractionRefusal | undefined {
  if (!("refusal" in error)) {
    return undefined;
  }
  const { refusal } = error as { refusal: unknown };
  return isRetractionRefusal(refusal) ? refusal : undefined;
}

/**
 * A refusal that carries a stable discriminator beside its use-case code.
 *
 * The code alone says only `CONFLICT`, which every route already maps to 409; the
 * discriminator says WHICH conflict, so a caller never has to match on the message text
 * to find out.
 */
export class RetractionRefusalError extends UseCaseError {
  public readonly refusal: RetractionRefusal;

  constructor(message: string, refusal: RetractionRefusal) {
    super(message, USE_CASE_ERRORS.CONFLICT);
    this.refusal = refusal;
  }
}
