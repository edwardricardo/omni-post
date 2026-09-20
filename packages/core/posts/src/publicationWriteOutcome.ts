/**
 * @file publicationWriteOutcome.ts
 * @description The two translations every publication writer performs: a refusal the
 *              aggregate returned into the use-case vocabulary, and a failure the narrow
 *              save returned into it. They live in one module because the writers perform
 *              them identically, and a writer that classified a lost compare-and-swap
 *              differently from its siblings would make one route answer a conflict where
 *              another answers an infrastructure failure for the very same event.
 * @layer application
 */

import { UseCaseError, USE_CASE_ERRORS } from "@core/application/UseCase.js";
import { INVALID_STATE_TRANSITION_CODE, VERSION_CONFLICT_CODE } from "@core/domain/index.js";

/**
 * @function domainCode
 * @description Reads the STABLE `code` a domain error carries, never its class identity.
 *              `instanceof` compares constructors, and `@core/domain` ships a dual
 *              conditional export (`development` -> src, `default` -> dist), so the
 *              adapter's copy of a class and this module's copy can be two distinct
 *              objects in one process. A string compares by value and survives the
 *              duplicate.
 * @param error - The error a domain method or a repository handed back.
 * @returns The discriminator, or undefined when the error carries none.
 */
function domainCode(error: Error): string | undefined {
  if ("code" in error) {
    const { code } = error as { code: unknown };
    return typeof code === "string" ? code : undefined;
  }
  return undefined;
}

/**
 * @function publicationRefusal
 * @description Translates a refusal the aggregate returned. A lifecycle refusal is the
 *              caller asking for a transition the post's word does not admit, which is a
 *              permission answer; every other refusal is the RECORD disagreeing with the
 *              request, which is a conflict.
 * @param error - The domain error the aggregate returned.
 * @returns The use-case error the caller receives.
 */
export function publicationRefusal(error: Error): UseCaseError {
  return new UseCaseError(
    error.message,
    domainCode(error) === INVALID_STATE_TRANSITION_CODE
      ? USE_CASE_ERRORS.FORBIDDEN
      : USE_CASE_ERRORS.CONFLICT,
    error
  );
}

/**
 * @function publicationSaveFailure
 * @description Translates a failure the narrow save returned. A lost compare-and-swap is
 *              a conflict the caller can act on by reloading; anything else — including
 *              the save's own edit tripwire, which means the caller mixed an edit into a
 *              publication — is reported as an internal failure rather than handed to the
 *              customer as something they did wrong.
 * @param error - The error `savePublication` returned.
 * @returns The use-case error the caller receives.
 */
export function publicationSaveFailure(error: Error): UseCaseError {
  return domainCode(error) === VERSION_CONFLICT_CODE
    ? new UseCaseError(error.message, USE_CASE_ERRORS.CONFLICT, error)
    : new UseCaseError(
        `Failed to save the publication outcome: ${error.message}`,
        USE_CASE_ERRORS.INTERNAL_ERROR,
        error
      );
}
