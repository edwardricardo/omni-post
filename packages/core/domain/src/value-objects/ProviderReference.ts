/**
 * @file ProviderReference.ts
 * @description The head reference a provider gives back when it accepts content, and
 *   the explicit alternative for a provider that accepts content without returning an
 *   identifier. "The provider gave no id" and "we never asked" must not share a
 *   representation, so the absence is a stated kind rather than a null.
 * @layer domain
 */

import { type Result, ok, err } from "@shared/types";
import { InvalidValueError } from "../errors/index.js";

export const PROVIDER_REFERENCE_KINDS = {
  PROVIDED: "provided",
  NONE_RETURNED: "none-returned",
} as const;

export type ProviderReferenceKind =
  (typeof PROVIDER_REFERENCE_KINDS)[keyof typeof PROVIDER_REFERENCE_KINDS];

/** A provider that returned an identifier for the published item. */
export interface ProvidedReference {
  readonly kind: typeof PROVIDER_REFERENCE_KINDS.PROVIDED;
  readonly id: string;
}

/** A provider that accepted the content and returned no identifier. */
export interface NoneReturnedReference {
  readonly kind: typeof PROVIDER_REFERENCE_KINDS.NONE_RETURNED;
}

export type ProviderReference = ProvidedReference | NoneReturnedReference;

/**
 * @function providedReference
 * @description Builds the reference for a provider that returned an identifier.
 * @param id - The provider's identifier for the published item
 * @returns Result with the reference, or InvalidValueError when the id is empty
 */
export function providedReference(id: string): Result<ProviderReference, InvalidValueError> {
  const trimmed = typeof id === "string" ? id.trim() : "";
  if (trimmed.length === 0) {
    return err(
      new InvalidValueError(
        "ProviderReference.id",
        id,
        "A provided reference cannot carry an empty id — use the none-returned reference instead"
      )
    );
  }
  return ok({ kind: PROVIDER_REFERENCE_KINDS.PROVIDED, id: trimmed });
}

/**
 * @function noneReturnedReference
 * @description The reference for a provider that accepted the content without giving
 *   an identifier back.
 * @returns The none-returned reference
 */
export function noneReturnedReference(): ProviderReference {
  return { kind: PROVIDER_REFERENCE_KINDS.NONE_RETURNED };
}

/**
 * @function isProvidedReference
 * @description Type guard separating a real identifier from a stated absence.
 * @param reference - The reference to narrow
 * @returns true when the provider returned an identifier
 */
export function isProvidedReference(reference: ProviderReference): reference is ProvidedReference {
  return reference.kind === PROVIDER_REFERENCE_KINDS.PROVIDED;
}
