/**
 * @file NodeCryptoSingleUsePasswordGenerator.test.ts
 * @description Unit tests for the adapter of the SingleUsePasswordGenerator port. Many values are
 *   drawn from Node's real secure random source and each one is held to the administrators'
 *   password policy, to the absence of whitespace and to the alphabet whose size and the value's
 *   length give at least 128 bits of entropy. A second suite replaces `randomInt` and pins that
 *   every character is drawn from it with the alphabet's size as its bound, the source Node
 *   documents as free of modulo bias, that a draw the policy refuses is drawn again, and that
 *   the generator raises after a hundred refused draws.
 * @layer infrastructure
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { validatePasswordStrength } from "../../../../src/admin/auth/adminAuthSchemas.js";
import { NodeCryptoSingleUsePasswordGenerator } from "../../../../src/infrastructure/adapters/NodeCryptoSingleUsePasswordGenerator.js";

/** Enough draws that a value missing a character class, about one draw in twenty, shows up. */
const DRAWS = 2_000;

/** The characters a single-use password may hold, by class. */
const LOWERCASE = "abcdefghijklmnopqrstuvwxyz";
const UPPERCASE = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
const DIGITS = "0123456789";
const SYMBOLS = "#%+-.:=@^_~";
const ALPHABET = `${LOWERCASE}${UPPERCASE}${DIGITS}${SYMBOLS}`;

/** The length of every value. */
const LENGTH = 24;

/** The draws the generator tries before it raises. */
const MAX_DRAWS = 100;

/** @returns The given number of values drawn by one generator. */
function drawMany(count: number): string[] {
  const generator = new NodeCryptoSingleUsePasswordGenerator();
  return Array.from({ length: count }, () => generator.generate());
}

describe("NodeCryptoSingleUsePasswordGenerator generate", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns values that each satisfy the administrators' password policy and hold no whitespace", () => {
    const values = drawMany(DRAWS);

    const refused = values.filter((value) => !validatePasswordStrength(value).valid);
    const withWhitespace = values.filter((value) => /\s/u.test(value));

    expect(refused).toEqual([]);
    expect(withWhitespace).toEqual([]);
  });

  it("returns values of 24 characters drawn from an alphabet of 73, at least 128 bits each", () => {
    const values = drawMany(DRAWS);
    const seen = new Set(values.join(""));

    expect(new Set(values.map((value) => value.length))).toEqual(new Set([LENGTH]));
    expect([...seen].sort()).toEqual([...ALPHABET].sort());
    expect(LENGTH * Math.log2(seen.size)).toBeGreaterThanOrEqual(128);
  });

  it("returns a different value on every call", () => {
    const values = drawMany(DRAWS);

    expect(new Set(values).size).toBe(DRAWS);
  });
});

describe("NodeCryptoSingleUsePasswordGenerator generate, with the random source replaced", () => {
  afterEach(() => {
    vi.doUnmock("node:crypto");
    vi.resetModules();
  });

  /**
   * Loads the adapter with `randomInt` replaced by one that answers the given indices in turn and
   * records the bound of every call.
   */
  async function loadWithIndices(indices: readonly number[]) {
    const bounds: number[] = [];
    let next = 0;
    vi.resetModules();
    vi.doMock("node:crypto", async (importOriginal) => ({
      ...(await importOriginal<typeof import("node:crypto")>()),
      randomInt: (bound: number) => {
        bounds.push(bound);
        const index = indices[next];
        next += 1;
        if (index === undefined) throw new Error("the test's indices ran out");
        return index;
      },
    }));
    const module =
      await import("../../../../src/infrastructure/adapters/NodeCryptoSingleUsePasswordGenerator.js");
    return { generator: new module.NodeCryptoSingleUsePasswordGenerator(), bounds };
  }

  /** The alphabet's indices of the characters of a value. */
  function indicesOf(value: string): number[] {
    return [...value].map((character) => ALPHABET.indexOf(character));
  }

  it("returns the characters randomInt picks, each drawn with the alphabet's size as its bound", async () => {
    const accepted = "aB3#cD4%eF5+gH6-iJ7.kL8:";
    const { generator, bounds } = await loadWithIndices(indicesOf(accepted));

    const value = generator.generate();

    expect(value).toBe(accepted);
    expect(bounds).toEqual(Array.from({ length: LENGTH }, () => ALPHABET.length));
  });

  it("returns the next draw when the policy refuses the first", async () => {
    const refusedForNoDigit = "abcdefghijkLMNOPQRSTUV#%";
    const accepted = "aB3#cD4%eF5+gH6-iJ7.kL8:";
    expect(validatePasswordStrength(refusedForNoDigit).valid).toBe(false);
    const { generator, bounds } = await loadWithIndices([
      ...indicesOf(refusedForNoDigit),
      ...indicesOf(accepted),
    ]);

    const value = generator.generate();

    expect(value).toBe(accepted);
    expect(bounds).toHaveLength(2 * LENGTH);
  });

  it("raises after a hundred draws when the policy refuses every one", async () => {
    const refusedForNoDigit = "abcdefghijkLMNOPQRSTUV#%";
    expect(validatePasswordStrength(refusedForNoDigit).valid).toBe(false);
    const { generator, bounds } = await loadWithIndices(
      Array.from({ length: MAX_DRAWS }, () => indicesOf(refusedForNoDigit)).flat()
    );

    expect(() => generator.generate()).toThrow(
      new Error("No value met the administrators' password policy in 100 draws")
    );
    expect(bounds).toHaveLength(MAX_DRAWS * LENGTH);
  });
});
