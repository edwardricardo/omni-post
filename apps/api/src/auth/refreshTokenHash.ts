/**
 * @file refreshTokenHash.ts
 * @description SHA-256 hashing helper for AdminSession.refreshTokenHash.
 *   Plaintext refresh tokens never persist — the user receives the JWT in
 *   their cookie / Authorization header, and the DB stores only the hex
 *   digest. Lookups hash the incoming token and compare against the column.
 *   Same canonical pattern as ApiKey.keyHash (one-way, deterministic).
 * @layer infrastructure
 */
import { createHash } from "node:crypto";

/**
 * @function hashRefreshToken
 * @description Returns the SHA-256 hex digest of a refresh JWT. Pure
 *   function — same input always returns same output, enabling DB lookup
 *   by hash.
 * @param token - The plaintext refresh JWT
 * @returns 64-char hex string (SHA-256 digest)
 */
export function hashRefreshToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}
