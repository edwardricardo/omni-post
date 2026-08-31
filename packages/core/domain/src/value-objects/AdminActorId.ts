/**
 * @file AdminActorId.ts
 * @description Branded, non-empty identifier of the admin principal that performs an
 *              irreversible destruction (hard delete). Constructing one requires a real,
 *              non-empty id, so a placeholder such as "unknown" cannot stand in for a missing
 *              principal — the tombstone can never be attributed to nobody.
 * @layer domain
 */

import { type Result, ok, err } from "@shared/types";
import { EmptyValueError } from "../errors/index.js";

declare const adminActorIdBrand: unique symbol;

/**
 * The id of the admin who executed a hard delete, recorded on the tombstone.
 *
 * Branded so a plain string — most dangerously the literal `"unknown"` the delete
 * routes used to fall back to — does not type-check where this is required. The
 * only way to obtain one is {@link toAdminActorId}, which rejects the empty or
 * whitespace-only input a missing principal would produce. This is the type-level
 * half of the fail-closed rule: the routes refuse the delete when no principal is
 * present, and the compiler refuses a call site that tries to hard-code one.
 */
export type AdminActorId = string & { readonly [adminActorIdBrand]: true };

/**
 * @function toAdminActorId
 * @description Validates a raw principal id and brands it. Fail-closed: a missing, empty, or
 *              whitespace-only id yields an error rather than a usable value.
 * @param raw - Candidate principal id (e.g. `request.auth.user.id` after admin authentication).
 * @returns Ok(AdminActorId) for a non-empty id; EmptyValueError otherwise.
 */
export function toAdminActorId(
  raw: string | undefined | null
): Result<AdminActorId, EmptyValueError> {
  const trimmed = (raw ?? "").trim();
  if (trimmed.length === 0) {
    return err(new EmptyValueError("adminActorId"));
  }
  return ok(trimmed as AdminActorId);
}
