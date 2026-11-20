/**
 * @file seedPasswordHashing.ts
 * @description The Argon2 parameters the development seed hashes every password it writes with,
 *   the administrator's and the test customers'. They are the API's own: the API verifies a seeded
 *   password, and asks for a rehash on the next sign-in when a stored hash's parameters differ from
 *   its own. The seed cannot import the API, so a test of the API holds this constant equal to the
 *   API's `ARGON2_PARAMS`.
 * @layer infrastructure
 */
import argon2 from "argon2";

/** Argon2id, 64 MiB, three passes, four lanes and a 32-byte hash. */
export const SEED_ARGON2_PARAMS = {
  type: argon2.argon2id,
  memoryCost: 65536,
  timeCost: 3,
  parallelism: 4,
  hashLength: 32,
} as const;
