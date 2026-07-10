/**
 * @file challengeBinding.ts
 * @description SHA-256 hex helper used to bind a customer login MFA challenge to
 *              the trusted client IP and the raw user-agent. The challenge JWT
 *              carries only the HASHES (`iph`/`uah`) because the token reaches the
 *              browser — a raw IP/UA in a client-visible artifact is avoided.
 *              Step 2 recomputes the hashes and hard-rejects on any mismatch, so
 *              a stolen challenge replayed from another host dies at the binding
 *              check. Uses the Node stdlib crypto, matching the existing customer
 *              auth use cases (no third-party dependency).
 * @layer application
 */

import { createHash } from "crypto";

/**
 * @function sha256Hex
 * @description Compute the lowercase hex SHA-256 digest of a UTF-8 string.
 * @param value - The value to hash (trusted client IP or raw user-agent).
 * @returns 64-character lowercase hex digest.
 */
export function sha256Hex(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}
