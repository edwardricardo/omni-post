/**
 * @file NodeCryptoSingleUsePasswordGenerator.ts
 * @description Infrastructure adapter implementing `SingleUsePasswordGenerator` with Node's
 *              secure random source. Each of the 24 characters is drawn by `randomInt` from an
 *              alphabet of 73 (letters of both cases, digits and eleven symbols, no whitespace),
 *              so a value carries about 148 bits of entropy; `randomInt` draws without modulo
 *              bias. A draw the administrators' password policy refuses, one missing a
 *              character class, is drawn again, so every value returned meets that policy. After
 *              a hundred refused draws the adapter raises: it never draws without end.
 * @layer infrastructure
 */

import { randomInt } from "node:crypto";
import type { SingleUsePasswordGenerator } from "@ports/core";
import { validatePasswordStrength } from "../../admin/auth/adminAuthSchemas.js";

/**
 * The characters a value is drawn from. The symbols are ones a browser field, a terminal and a
 * clipboard carry unchanged; whitespace is left out so a copied value cannot lose or gain any.
 */
const ALPHABET = [
  "abcdefghijklmnopqrstuvwxyz",
  "ABCDEFGHIJKLMNOPQRSTUVWXYZ",
  "0123456789",
  "#%+-.:=@^_~",
].join("");

/** 24 characters of 73: 24 × log2(73) ≈ 148.5 bits, above the 128 the command requires. */
const LENGTH = 24;

/**
 * Draws tried before the adapter raises. The policy in force refuses about one draw in twenty, so
 * a hundred refusals in a row mean it asks for what this length or this alphabet cannot give.
 */
const MAX_DRAWS = 100;

/**
 * @class NodeCryptoSingleUsePasswordGenerator
 * @description Draws single-use passwords from `node:crypto`.
 */
export class NodeCryptoSingleUsePasswordGenerator implements SingleUsePasswordGenerator {
  /**
   * @method generate
   * @description Draws values until one meets the administrators' password policy and returns
   *   it. About one draw in twenty lacks a digit or a symbol and is drawn again; refusing those
   *   draws costs well under one bit of the value's entropy.
   * @returns A new random password in plain text
   * @throws Error when none of a hundred draws meets the policy; its message holds no draw
   */
  generate(): string {
    for (let draw = 0; draw < MAX_DRAWS; draw += 1) {
      let candidate = "";
      for (let position = 0; position < LENGTH; position += 1) {
        candidate += ALPHABET.charAt(randomInt(ALPHABET.length));
      }
      if (validatePasswordStrength(candidate).valid) {
        return candidate;
      }
    }
    throw new Error(`No value met the administrators' password policy in ${MAX_DRAWS} draws`);
  }
}
