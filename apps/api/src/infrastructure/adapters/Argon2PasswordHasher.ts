/**
 * @file Argon2PasswordHasher.ts
 * @description Infrastructure adapter implementing `PasswordHasher` by
 *              delegating to the canonical Argon2id helper in
 *              `auth/passwordHashing`. Keeps the helper the single caller of
 *              the argon2 library (uniform RFC 9106 parameters + transparent
 *              rehash) while exposing a technology-free port to the application.
 * @layer infrastructure
 */

import type { PasswordHasher } from "@core/domain/repositories/PasswordHasher.js";
import { hashPassword, verifyPassword, needsRehash } from "../../auth/passwordHashing.js";

/**
 * @class Argon2PasswordHasher
 * @description Thin pass-through from the `PasswordHasher` contract to the
 *   module-level Argon2id helper functions.
 */
export class Argon2PasswordHasher implements PasswordHasher {
  hash(plaintext: string): Promise<string> {
    return hashPassword(plaintext);
  }

  verify(storedHash: string, plaintext: string): Promise<boolean> {
    return verifyPassword(storedHash, plaintext);
  }

  needsRehash(storedHash: string): boolean {
    return needsRehash(storedHash);
  }
}
