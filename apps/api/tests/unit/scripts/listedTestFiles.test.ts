/**
 * @file listedTestFiles.test.ts
 * @description Pins the scope counter the tests-typecheck ratchet measures its
 *   floor with. What is worth pinning is not that it counts — it is the DIRECTION
 *   it is allowed to be wrong in. The counter feeds a floor (`the program opened N
 *   files, below the floor of 700`), so an over-count makes that floor easier to
 *   clear and quietly weakens the one assertion standing between a collapsed
 *   include glob and a green ratchet over a program the compiler never opened. An
 *   under-count, by contrast, fails the gate loudly and gets fixed.
 *
 *   The counter used to ask whether a line merely CONTAINED the directory. Measured
 *   on the real compiler output that form and this one agreed exactly (749 vs 749),
 *   so the weakness was latent rather than live — which is precisely why it needs a
 *   test instead of a measurement: every shape below is one tsc already knows how
 *   to print with `--pretty` on, and none of them happened to occur that day.
 * @layer infrastructure
 */

import { describe, it, expect } from "vitest";
import assert from "node:assert/strict";
import { listedFilesUnder } from "../../../scripts/lib/listedTestFiles.mjs";

const TESTS = "/apps/api/tests/";
const ROOT = "/root/omni-post/apps/api/tests";

/** Three genuine `--listFiles` entries: a whole line that IS an absolute path. */
const REAL_ENTRIES = [`${ROOT}/unit/a.test.ts`, `${ROOT}/unit/b.test.ts`, `${ROOT}/unit/c.test.ts`];

describe("listedFilesUnder", () => {
  it("counts each genuine --listFiles entry under the directory once", () => {
    const found = listedFilesUnder(REAL_ENTRIES.join("\n"), TESTS);

    assert.strictEqual(found.size, 3);
    assert.deepStrictEqual([...found].sort(), [...REAL_ENTRIES].sort());
  });

  it("ignores a diagnostic header whose path sits under the directory", () => {
    // The header carries the path of a file the program opened, but the opened
    // file is already listed elsewhere. Counting the header too would double it.
    const output = [
      ...REAL_ENTRIES,
      `${ROOT}/unit/a.test.ts:12:5 - error TS2339: Property 'x' does not exist on type 'Y'.`,
    ].join("\n");

    assert.strictEqual(listedFilesUnder(output, TESTS).size, 3);
  });

  it("ignores a --pretty source excerpt whose string literal embeds such a path", () => {
    // This is the shape the substring form could not tell from a listed file.
    const output = [
      ...REAL_ENTRIES,
      `  12   const fixture = "${ROOT}/fixtures/seed.ts";`,
      "                       ~~~~~~~~~~~~~~~~~~~~~~~~~~",
    ].join("\n");

    assert.strictEqual(listedFilesUnder(output, TESTS).size, 3);
  });

  it("ignores a --pretty related-information header, which is indented", () => {
    const output = [
      ...REAL_ENTRIES,
      `  ${ROOT}/unit/helpers/testContainer.ts:44:3`,
      "    The expected type comes from this declaration.",
    ].join("\n");

    assert.strictEqual(listedFilesUnder(output, TESTS).size, 3);
  });

  it("ignores error prose that names such a path", () => {
    const output = [
      ...REAL_ENTRIES,
      `  Cannot find module '${ROOT}/unit/missing.ts' or its type declarations.`,
    ].join("\n");

    assert.strictEqual(listedFilesUnder(output, TESTS).size, 3);
  });

  it("counts a path emitted twice only once", () => {
    const output = [...REAL_ENTRIES, `${ROOT}/unit/a.test.ts`].join("\n");

    assert.strictEqual(listedFilesUnder(output, TESTS).size, 3);
  });

  it("does not count files outside the directory", () => {
    const output = [
      ...REAL_ENTRIES,
      "/root/omni-post/apps/api/src/index.ts",
      "/root/omni-post/node_modules/typescript/lib/lib.es2022.d.ts",
    ].join("\n");

    assert.strictEqual(listedFilesUnder(output, TESTS).size, 3);
  });

  it("recognises a Windows path once slash-normalised", () => {
    // The ratchet normalises separators before comparing, so a Windows runner
    // must reach the same count rather than silently reaching zero.
    const output = String.raw`C:\work\omni-post\apps\api\tests\unit\a.test.ts`;

    assert.deepStrictEqual(
      [...listedFilesUnder(output, TESTS)],
      ["C:/work/omni-post/apps/api/tests/unit/a.test.ts"]
    );
  });

  it("is wrong only in the safe direction when a shape is unrecognised", () => {
    // A listed entry with an extension the pattern does not know is MISSED, not
    // over-counted. That lowers the count, which trips the caller's floor and
    // fails the gate loudly — the direction this whole design chooses.
    const output = [...REAL_ENTRIES, `${ROOT}/unit/d.test.tsz`].join("\n");
    const found = listedFilesUnder(output, TESTS);

    expect(found.size).toBeLessThanOrEqual(REAL_ENTRIES.length + 1);
    assert.strictEqual(found.size, 3);
  });
});
