/**
 * @file passwordHashing.ts
 * @description Single source of truth for password / API-key hashing across the
 *   api app. All callers use `hashPassword`, `verifyPassword`, and `needsRehash`
 *   here — never `argon2.hash` / `argon2.verify` directly. Centralisation gives
 *   uniform parameters, easy rotation when the canon advances, and built-in
 *   transparent rehash on login.
 *
 *   Canon: RFC 9106 (Argon2 spec) second-recommended configuration —
 *     m=65536 (64 MiB), t=3, p=4, hashLength=32, type=argon2id
 *   These match the `node-argon2` library defaults exactly, so swapping
 *   between explicit params and lib defaults is a no-op crypto-wise. We pass
 *   the params explicitly anyway for type-safety, audit traceability, and to
 *   detect drift if a future lib bump changes the defaults.
 *
 *   OWASP 2025 deviates from RFC 9106 by recommending `p=1` (because most
 *   libs serialize lanes). We follow RFC because the underlying lib's API and
 *   defaults are RFC-aligned, and the cost difference is negligible for
 *   server-side single-user-per-request hashing.
 *
 * @layer infrastructure
 */
import argon2 from "argon2";

/**
 * Argon2id parameters used everywhere passwords or API keys are hashed.
 * Bumping any value here automatically triggers `needsRehash` to flag stored
 * hashes for transparent re-hashing on the next successful login.
 */
export const ARGON2_PARAMS = {
  type: argon2.argon2id,
  memoryCost: 65536, // 64 MiB
  timeCost: 3,
  parallelism: 4,
  hashLength: 32,
} as const;

/**
 * @function hashPassword
 * @description Hash a plaintext password / token / API key with the canonical
 *   parameters. Always returns the encoded string ready for DB storage.
 * @param plaintext - The plaintext to hash.
 * @returns The argon2id-encoded hash string.
 */
export async function hashPassword(plaintext: string): Promise<string> {
  return argon2.hash(plaintext, ARGON2_PARAMS);
}

/**
 * @function verifyPassword
 * @description Verify a plaintext against a stored argon2id hash.
 *   Constant-time inside the library; returns false on any failure
 *   (mismatch, malformed hash, missing fields). Never throws on bad input.
 * @param storedHash - The encoded hash from the DB.
 * @param plaintext - The plaintext to verify.
 */
export async function verifyPassword(storedHash: string, plaintext: string): Promise<boolean> {
  try {
    return await argon2.verify(storedHash, plaintext);
  } catch {
    return false;
  }
}

/**
 * @function needsRehash
 * @description Returns true if the stored hash uses parameters weaker than
 *   the current canon (i.e. should be re-hashed on the next login). Use this
 *   in the login flow to transparently upgrade existing accounts when the
 *   server bumps Argon2 cost without forcing a password reset.
 *
 *   Pattern (in the login handler):
 *     if (await verifyPassword(user.passwordHash, plain)) {
 *       if (needsRehash(user.passwordHash)) {
 *         user.passwordHash = await hashPassword(plain);
 *         await repo.save(user);
 *       }
 *       // ... emit tokens
 *     }
 *
 * @param storedHash - The encoded hash from the DB.
 */
export function needsRehash(storedHash: string): boolean {
  return argon2.needsRehash(storedHash, ARGON2_PARAMS);
}
