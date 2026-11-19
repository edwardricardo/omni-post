/**
 * @file SingleUsePasswordGenerator.ts
 * @description Port for a single-use password: the one an administrator receives once and signs
 *              in with a single time, before setting a password of their own. The port says only
 *              that each call returns a new random value; how the value is drawn, and what makes
 *              it hard to guess, belong to its adapter.
 * @layer domain
 */

/** Draws single-use passwords. */
export interface SingleUsePasswordGenerator {
  /**
   * Draw a new random password, independent of every value drawn before. It raises when no
   * random value can be drawn.
   *
   * @returns The password in plain text, which its caller hashes before storing it
   */
  generate(): string;
}
