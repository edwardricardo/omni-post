/**
 * @file hardDeleteErrorMapping.ts
 * @description Maps a hard-delete use-case error code to an HTTP status and message, shared by
 *              the account and project hard-delete routes so the two stay in lockstep. It gives
 *              the distinct failure classes distinct, actionable responses instead of collapsing
 *              them all to 500: a foreign-key interlock (409, never retryable) is different from a
 *              transient timeout / write conflict (503, retryable) is different from a tenant too
 *              large to remove atomically (413, reduce it first).
 * @layer infrastructure
 */

import { USE_CASE_ERRORS } from "@core/application/UseCase.js";

/**
 * @function mapHardDeleteError
 * @description Resolve the HTTP status and client message for a failed hard delete.
 * @param code - The use-case error code returned by the hard-delete use case.
 * @param useCaseMessage - The use-case error message (already actionable for the size/interlock/
 *                         timeout classes — the count and ceiling live here).
 * @param entityNoun - Lowercase entity noun for the generic fallbacks, e.g. "account".
 * @returns The status and the message to send.
 */
export function mapHardDeleteError(
  code: string,
  useCaseMessage: string,
  entityNoun: string
): { status: number; message: string } {
  const Entity = entityNoun.charAt(0).toUpperCase() + entityNoun.slice(1);
  switch (code) {
    case USE_CASE_ERRORS.NOT_FOUND:
      return { status: 404, message: `${Entity} not found` };
    case USE_CASE_ERRORS.VALIDATION_FAILED:
      return { status: 400, message: `Invalid ${entityNoun} ID` };
    case USE_CASE_ERRORS.OPERATION_TOO_LARGE:
      // 413 Payload Too Large: the request is fine, the blast radius is not.
      return { status: 413, message: useCaseMessage };
    case USE_CASE_ERRORS.CONFLICT:
      // 409: a durable foreign-key interlock blocks it; never retryable as-is.
      return { status: 409, message: useCaseMessage };
    case USE_CASE_ERRORS.TRANSIENT_FAILURE:
      // 503: a timeout or serialization conflict; the same call may succeed on retry.
      return { status: 503, message: useCaseMessage };
    default:
      return { status: 500, message: `Failed to hard delete ${entityNoun}` };
  }
}
