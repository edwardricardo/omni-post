/**
 * @file seedPasswordHashing.test.ts
 * @description Pins `SEED_ARGON2_PARAMS` (`infra/prisma/src/seedPasswordHashing.ts`), the Argon2
 *   parameters the development seed hashes every password with, to `ARGON2_PARAMS`, the parameters
 *   the API hashes and verifies with. The seed cannot import the API, so this case is what ties
 *   the two: a password the seed writes is one the API accepts without asking for a rehash.
 * @layer infrastructure
 */

import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { ARGON2_PARAMS } from "../../src/auth/passwordHashing.js";
import { SEED_ARGON2_PARAMS } from "../../../../infra/prisma/src/seedPasswordHashing.js";

describe("SEED_ARGON2_PARAMS", () => {
  it("equals the parameters the API hashes passwords with when both are read", () => {
    assert.deepStrictEqual(SEED_ARGON2_PARAMS, ARGON2_PARAMS);
  });
});
