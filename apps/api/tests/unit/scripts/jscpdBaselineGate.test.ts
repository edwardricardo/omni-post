/**
 * @file jscpdBaselineGate.test.ts
 * @description Pins `scripts/testing/jscpd-baseline-gate.mjs`, the gate behind
 *   `pnpm check:duplicates`. jscpd fails a clone its fingerprint baseline does not hold, but never
 *   a stale entry, a fingerprint the tree no longer produces; the gate measures the tree into a
 *   scratch baseline and fails every count that drifted from the committed one. jscpd never runs
 *   here: an injected runner records each argv and, like jscpd, writes the measured baseline where
 *   `--baseline` points, so every red path is proven on a clean tree.
 * @layer infrastructure
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { findMonorepoRoot } from "@packages/vitest-shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

type Counts = Record<string, number>;
type Drift = { fingerprint: string; committed: number; current: number };
type Runner = (args: string[], options: { capture: boolean }) => { status: number; output: string };
type Outcome = { exitCode: number; messages: string[] };
/** The module's surface; a literal import of an untyped `.mjs` would be an implicit any. */
type GateModule = {
  SCAN_PATHS: string[];
  compareCounts: (was: Map<string, number>, now: Map<string, number>) => Record<string, Drift[]>;
  runGate: (input: { mode: "check" | "update"; root: string; runner: Runner }) => Outcome;
};
/** The stand-in jscpd's answers; `measured: null` writes no file where `--baseline` points. */
type Fake = { checkStatus?: number; measured?: string | null; measureStatus?: number };

const REPO_ROOT = findMonorepoRoot(path.dirname(fileURLToPath(import.meta.url)));
const GATE_SCRIPT = path.join(REPO_ROOT, "scripts/testing/jscpd-baseline-gate.mjs");
const { SCAN_PATHS, compareCounts, runGate } = (await import(GATE_SCRIPT)) as GateModule;
const [FIRST, SECOND] = ["0000aaaa0000aaaa", "1111bbbb1111bbbb"];
const COMMITTED: Counts = { [FIRST]: 1, [SECOND]: 2 };

const baseline = (counts: Counts, version: unknown = 1): string =>
  JSON.stringify({ version, fingerprints: counts });
const counts = (entries: Counts): Map<string, number> => new Map(Object.entries(entries));

let root = "";
let calls: { args: string[]; capture: boolean }[] = [];

beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), "jscpd-baseline-gate-test-"));
  calls = [];
  writeFileSync(path.join(root, ".jscpd.json"), JSON.stringify({ baseline: "base.json" }));
  writeFileSync(path.join(root, "base.json"), baseline(COMMITTED));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

const fakeJscpd =
  (fake: Fake = {}): Runner =>
  (args, { capture }) => {
    calls.push({ args: [...args], capture });
    const at = args.indexOf("--baseline");
    const updating = args.includes("--update-baseline");
    if (at === -1) return { status: updating ? 0 : (fake.checkStatus ?? 0), output: "" };
    const measured = fake.measured === undefined ? baseline(COMMITTED) : fake.measured;
    if (measured !== null) writeFileSync(args[at + 1] ?? "", measured);
    return { status: fake.measureStatus ?? 0, output: "measuring output" };
  };

const check = (fake?: Fake): Outcome => runGate({ mode: "check", root, runner: fakeJscpd(fake) });
const report = (outcome: Outcome): string => outcome.messages.join("\n");

describe("compareCounts", () => {
  it("returns no drift when the tree produces exactly the committed counts", () => {
    expect(compareCounts(counts(COMMITTED), counts(COMMITTED))).toEqual({ stale: [], grown: [] });
  });

  it("returns an entry the tree no longer produces as stale, counted as zero now", () => {
    const { stale } = compareCounts(counts(COMMITTED), counts({ [SECOND]: 2 }));

    expect(stale).toEqual([{ fingerprint: FIRST, committed: 1, current: 0 }]);
  });

  it("returns a count that fell as stale", () => {
    const { stale } = compareCounts(counts(COMMITTED), counts({ [FIRST]: 1, [SECOND]: 1 }));

    expect(stale).toEqual([{ fingerprint: SECOND, committed: 2, current: 1 }]);
  });

  it("returns a new or increased count as grown, never as stale", () => {
    const drift = compareCounts(counts({ [FIRST]: 1 }), counts({ [FIRST]: 2, [SECOND]: 1 }));

    expect(drift).toEqual({
      stale: [],
      grown: [
        { fingerprint: FIRST, committed: 1, current: 2 },
        { fingerprint: SECOND, committed: 0, current: 1 },
      ],
    });
  });
});

describe("check mode", () => {
  it("exits 0 when the measured fingerprints equal the committed ones", () => {
    expect(check().exitCode).toBe(0);
  });

  it("exits 1 naming each stale entry with both counts and the remedy", () => {
    const outcome = check({ measured: baseline({ [SECOND]: 2 }) });

    expect(outcome.exitCode).toBe(1);
    expect(outcome.messages).toContain(`stale entry ${FIRST}: committed 1, current 0`);
    expect(report(outcome)).toContain("pnpm check:duplicates:update-baseline");
  });

  it("exits 1, failing closed, when the tree counts more clones than the baseline", () => {
    const outcome = check({ measured: baseline({ ...COMMITTED, [FIRST]: 2 }) });

    expect(outcome.exitCode).toBe(1);
    expect(outcome.messages).toContain(`fingerprint ${FIRST}: committed 1, current 2`);
    expect(report(outcome)).toContain("the gate fails closed");
  });

  it("returns jscpd's own exit and skips the measuring run when its verdict fails", () => {
    const outcome = check({ checkStatus: 3 });

    expect(outcome.exitCode).toBe(3);
    expect(calls).toHaveLength(1);
  });

  it.each([
    ["the committed baseline is missing", "base.json", null, "does not exist"],
    ["the committed baseline is not JSON", "base.json", "{", "is not valid JSON"],
    ["the committed baseline is not version 1", "base.json", baseline(COMMITTED, 2), "version 2"],
    ["a count is not a positive integer", "base.json", baseline({ [FIRST]: 0 }), "positive"],
    ["the config names no baseline", ".jscpd.json", "{}", "names no `baseline`"],
  ])("exits 1 before running jscpd when %s", (_case, file, text, cause) => {
    if (text === null) rmSync(path.join(root, file));
    else writeFileSync(path.join(root, file), text);

    const outcome = check();

    expect(outcome.exitCode).toBe(1);
    expect(report(outcome)).toContain(cause);
    expect(calls).toEqual([]);
  });

  it.each([
    ["exits non-zero", { measureStatus: 2 }, "exited 2: measuring output"],
    ["writes nothing", { measured: null }, "wrote nothing"],
    ["writes a baseline that is not version 1", { measured: baseline(COMMITTED, 0) }, "version 0"],
  ])("exits 1 when the measuring run %s", (_case, fake: Fake, cause) => {
    const outcome = check(fake);

    expect(outcome.exitCode).toBe(1);
    expect(report(outcome)).toContain(cause);
  });

  it.each([
    ["passes", {}],
    ["fails", { measureStatus: 2 }],
  ])("removes the scratch directory when the comparison %s", (_case, fake: Fake) => {
    check(fake);

    const scratch = calls[1]?.args[SCAN_PATHS.length + 1] ?? "";
    expect(existsSync(path.dirname(scratch))).toBe(false);
  });
});

describe("argv", () => {
  it("scans the same paths in the checking, measuring and update runs", () => {
    check();
    const scratch = calls[1]?.args[SCAN_PATHS.length + 1];

    const update = runGate({ mode: "update", root, runner: fakeJscpd() });

    expect(SCAN_PATHS).toEqual(["apps/", "packages/"]);
    expect(update.exitCode).toBe(0);
    expect(calls).toEqual([
      { args: SCAN_PATHS, capture: false },
      {
        args: [...SCAN_PATHS, "--baseline", scratch, "--update-baseline", "--silent"],
        capture: true,
      },
      { args: [...SCAN_PATHS, "--update-baseline"], capture: false },
    ]);
  });
});

describe("command line", () => {
  it("exits 1 with the usage line on an unknown argument", () => {
    const result = spawnSync(process.execPath, [GATE_SCRIPT, "--bogus"], { encoding: "utf8" });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain(
      "usage: node scripts/testing/jscpd-baseline-gate.mjs [--update]"
    );
  });
});
