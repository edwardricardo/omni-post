/**
 * @file PasswordHasher.ts
 * @description Port for one-way hashing + verification of secrets (passwords,
 *              API keys, backup codes) with Argon2id. Application use cases
 *              depend on this interface; the infrastructure adapter wraps the
 *              canonical hashing helper so all secrets share identical
 *              parameters. Not password-specific despite the name — any secret
 *              hashed the same way uses this port.
 * @layer domain
 */

export interface PasswordHasher {
  /** Hash a plaintext secret. Returns the encoded Argon2id hash. */
  hash(plaintext: string): Promise<string>;
  /** Constant-time verify a plaintext against a stored hash. */
  verify(storedHash: string, plaintext: string): Promise<boolean>;
  /** True when the stored hash was produced with weaker-than-current params. */
  needsRehash(storedHash: string): boolean;
}
