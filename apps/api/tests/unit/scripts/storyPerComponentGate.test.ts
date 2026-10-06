/**
 * @file storyPerComponentGate.test.ts
 * @description Pins `scripts/testing/story-per-component-gate.mjs`, the gate behind
 *   `pnpm check:stories`: a component file under the three component roots needs a sibling
 *   `<basename>.stories.tsx`, and each root's count of components without one must equal the
 *   committed baseline in both directions. Every case builds its own tree in a scratch directory,
 *   one covered and one uncovered component per root, so the suite measures the rule and never the
 *   repository's components, and each red is proven on a tree built to be red.
 * @layer infrastructure
 */
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { findMonorepoRoot } from "@packages/vitest-shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

type Outcome = { exitCode: number; messages: string[] };
/** The module's surface; a literal import of an untyped `.mjs` would be an implicit any. */
type GateModule = {
  ROOTS: readonly string[];
  BASELINE: string;
  runGate: (input: { root: string }) => Outcome;
};

const REPO_ROOT = findMonorepoRoot(path.dirname(fileURLToPath(import.meta.url)));
const GATE_SCRIPT = path.join(REPO_ROOT, "scripts/testing/story-per-component-gate.mjs");
const { ROOTS, BASELINE, runGate } = (await import(GATE_SCRIPT)) as GateModule;
const [UI, CLIENT, ADMIN] = [
  "packages/ui/src/components",
  "apps/client/components",
  "apps/admin/components",
];
/** The one component per root that the fixture leaves without a story. */
const UNCOVERED = [`${UI}/badge.tsx`, `${CLIENT}/Nav.tsx`, `${ADMIN}/Chart.tsx`];

let root = "";

const write = (file: string, text = "export function Fixture() {\n  return null;\n}\n"): void => {
  const full = path.join(root, file);
  mkdirSync(path.dirname(full), { recursive: true });
  writeFileSync(full, text);
};
const writeBaseline = (counts: Record<string, unknown>): void =>
  write(BASELINE, JSON.stringify(counts));
const storyOf = (file: string): string => file.replace(/\.tsx$/, ".stories.tsx");
const check = (): Outcome => runGate({ root });
const report = (outcome: Outcome): string => outcome.messages.join("\n");

beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), "story-per-component-gate-test-"));
  for (const covered of [`${UI}/button.tsx`, `${CLIENT}/team/Row.tsx`, `${ADMIN}/Panel.tsx`]) {
    write(covered);
    write(storyOf(covered));
  }
  UNCOVERED.forEach((file) => write(file));
  writeBaseline({ [UI]: 1, [CLIENT]: 1, [ADMIN]: 1 });
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("scope", () => {
  it("measures fitness #12's three component roots against one committed baseline", () => {
    expect(ROOTS).toEqual([UI, CLIENT, ADMIN]);
    expect(BASELINE).toBe("scripts/testing/story-coverage-baseline.json");
  });
});

describe("what a component is", () => {
  it("exits 0 when each root counts exactly its baseline of components without a story", () => {
    const outcome = check();

    expect(outcome.exitCode).toBe(0);
    expect(outcome.messages).toEqual([
      `6 components; those without a sibling story equal ${BASELINE}: ${UI} 1, ${CLIENT} 1, ${ADMIN} 1`,
    ]);
  });

  it("counts no test, spec, story or .ts file as a component", () => {
    for (const file of ["button.test.tsx", "button.spec.tsx", "orphan.stories.tsx", "types.ts"]) {
      write(`${UI}/${file}`);
    }

    expect(check().exitCode).toBe(0);
  });

  it("enters subdirectories but neither node_modules nor a dot-directory", () => {
    write(`${ADMIN}/charts/Line.tsx`);
    write(`${ADMIN}/node_modules/widget/Widget.tsx`);
    write(`${ADMIN}/.cache/Hidden.tsx`);
    writeBaseline({ [UI]: 1, [CLIENT]: 1, [ADMIN]: 2 });

    const outcome = check();

    expect(outcome.exitCode).toBe(0);
    expect(report(outcome)).toContain(`${ADMIN} 2`);
  });

  it("covers a component only with a story of its exact basename in its own directory", () => {
    write(`${CLIENT}/Card.tsx`);
    write(`${CLIENT}/stories/Card.stories.tsx`);
    write(`${CLIENT}/Menu.tsx`);
    write(`${CLIENT}/menu.stories.tsx`);

    const outcome = check();

    expect(outcome.exitCode).toBe(1);
    expect(outcome.messages).toEqual(
      expect.arrayContaining([
        `no sibling story: ${CLIENT}/Card.tsx`,
        `no sibling story: ${CLIENT}/Menu.tsx`,
      ])
    );
  });
});

describe("against the baseline", () => {
  it("exits 1 above the baseline, listing every component of that root without a story", () => {
    write(`${CLIENT}/Planted.tsx`);

    const outcome = check();

    expect(outcome.exitCode).toBe(1);
    expect(outcome.messages[0]).toContain(
      `${CLIENT}: 2 components without a sibling story, baseline 1`
    );
    expect(outcome.messages.slice(1)).toEqual([
      `no sibling story: ${CLIENT}/Nav.tsx`,
      `no sibling story: ${CLIENT}/Planted.tsx`,
    ]);
  });

  it("exits 1 below the baseline, naming the stale count to lower in the same change", () => {
    write(storyOf(`${UI}/badge.tsx`));

    const outcome = check();

    expect(outcome.exitCode).toBe(1);
    expect(outcome.messages).toEqual([
      `${UI}: stale baseline: 0 components without a sibling story, baseline 1. ` +
        `Lower it to 0 in ${BASELINE}`,
    ]);
  });

  it("exits 1 asking for the baseline's deletion once every root counts zero", () => {
    UNCOVERED.forEach((file) => write(storyOf(file)));

    const outcome = check();

    expect(outcome.exitCode).toBe(1);
    expect(report(outcome)).toContain(`delete ${BASELINE} in this change`);
  });

  it("exits 0 with no baseline file when every component has a sibling story", () => {
    UNCOVERED.forEach((file) => write(storyOf(file)));
    rmSync(path.join(root, BASELINE));

    expect(check()).toEqual({ exitCode: 0, messages: ["6 components; each with a sibling story"] });
  });

  it("exits 1 with no baseline file, naming each component without a sibling story", () => {
    rmSync(path.join(root, BASELINE));

    const outcome = check();

    expect(outcome.exitCode).toBe(1);
    expect(outcome.messages.filter((line) => line.startsWith("no sibling story: "))).toEqual(
      UNCOVERED.map((file) => `no sibling story: ${file}`)
    );
  });
});

describe("fails closed", () => {
  const counts = { [UI]: 1, [CLIENT]: 1, [ADMIN]: 1 };

  it.each([
    ["is not JSON", "{", "could not be read as JSON"],
    ["is not an object", "[1, 1, 1]", "is not an object of counts per root"],
    ["misses a root", JSON.stringify({ [UI]: 1, [CLIENT]: 1 }), `has no count for ${ADMIN}`],
    ["names another root", JSON.stringify({ ...counts, "apps/x": 0 }), "apps/x: not a root"],
    ["holds a negative count", JSON.stringify({ ...counts, [UI]: -1 }), `${UI} is not a`],
    ["holds a fraction", JSON.stringify({ ...counts, [CLIENT]: 1.5 }), `${CLIENT} is not a`],
    ["holds a string", JSON.stringify({ ...counts, [ADMIN]: "1" }), `${ADMIN} is not a`],
  ])("exits 1 when the baseline %s", (_case, text, cause) => {
    write(BASELINE, text);

    const outcome = check();

    expect(outcome.exitCode).toBe(1);
    expect(report(outcome)).toContain(cause);
  });

  it.each([
    ["is not a directory", [], "is not a directory"],
    ["holds no component file", [`${ADMIN}/types.ts`], "holds no component file"],
  ])("exits 1 naming a root that %s", (_case, files: string[], cause) => {
    rmSync(path.join(root, ADMIN), { recursive: true });
    files.forEach((file) => write(file));

    const outcome = check();

    expect(outcome.exitCode).toBe(1);
    expect(report(outcome)).toContain(`${ADMIN} ${cause}`);
  });
});

describe("command line", () => {
  it("exits 1 with the usage line on any argument, so there is no update mode to raise counts", () => {
    const result = spawnSync(process.execPath, [GATE_SCRIPT, "--update"], { encoding: "utf8" });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("usage: node scripts/testing/story-per-component-gate.mjs");
  });
});
