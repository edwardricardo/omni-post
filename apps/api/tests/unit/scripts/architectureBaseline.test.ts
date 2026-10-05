/**
 * @file architectureBaseline.test.ts
 * @description Pins the ratchet behind `pnpm check:architecture`. The known-violations baseline of
 *   dependency-cruiser must pass the violations it lists, fail one it does not list, fail a listed
 *   entry that no longer occurs, and regenerate in shrink-only mode, dropping the stale entries and
 *   adding none. The installed `depcruise` runs over a fixture tree built per test, with the real
 *   config's `options.baseline`; the real config and the `check:architecture` scripts are read as
 *   well. A drift in the option keys or in the flags would otherwise turn the baseline into an
 *   ignore list while the canon still calls it a ratchet.
 * @layer infrastructure
 */
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { findMonorepoRoot } from "@packages/vitest-shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

type Config = { options: { baseline?: Record<string, string> } };

const REPO_ROOT = findMonorepoRoot(path.dirname(fileURLToPath(import.meta.url)));
const REAL_CONFIG = createRequire(import.meta.url)(
  path.join(REPO_ROOT, ".dependency-cruiser.cjs")
) as Config;
const MANIFEST = path.join(REPO_ROOT, "node_modules/dependency-cruiser/package.json");
const { bin } = JSON.parse(readFileSync(MANIFEST, "utf8")) as { bin: Record<string, string> };
const DEPCRUISE = path.join(path.dirname(MANIFEST), bin.depcruise ?? "bin.depcruise is missing");
const KNOWN = ".dependency-cruiser-known-violations.json";
const RULE = "ui-not-to-db";
const IMPORTS_DB = 'import { db } from "../db/db.mjs";\nexport const used = db;\n';

let root = "";

const write = (file: string, content: string): void => {
  mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
  writeFileSync(path.join(root, file), content);
};
const depcruise = (...args: string[]): { status: number | null; output: string } => {
  const cli = [DEPCRUISE, "src", "--config", ".dependency-cruiser.cjs", ...args];
  const env = { ...process.env, NO_COLOR: "1" };
  const run = spawnSync(process.execPath, cli, { cwd: root, encoding: "utf8", env });
  return { status: run.status, output: `${run.stdout}${run.stderr}` };
};
const check = (): { status: number | null; output: string } =>
  depcruise("--output-type", "err", "--ignore-known", KNOWN);
const listed = (): string[] =>
  (JSON.parse(readFileSync(path.join(root, KNOWN), "utf8")) as { from: string }[]).map(
    (v) => v.from
  );

describe("the known-violations baseline of the architecture gate", { timeout: 30_000 }, () => {
  beforeEach(() => {
    root = mkdtempSync(path.join(tmpdir(), "architecture-baseline-test-"));
    const forbidden = [
      { name: RULE, severity: "error", from: { path: "^src/ui/" }, to: { path: "^src/db/" } },
    ];
    const config = { forbidden, options: { baseline: REAL_CONFIG.options.baseline } };
    write(".dependency-cruiser.cjs", `module.exports = ${JSON.stringify(config)};\n`);
    write("src/db/db.mjs", "export const db = 1;\n");
    write("src/ui/kept.mjs", IMPORTS_DB);
    write("src/ui/fixed.mjs", IMPORTS_DB);
    // Written by the tool, as the committed one was: the stale-entry comparison also matches the
    // dependency types and the unresolved name, which a hand-written entry would lack.
    expect(depcruise("--baseline", KNOWN, "--baseline-mode", "full").status).toBe(0);
    expect(listed()).toEqual(["src/ui/fixed.mjs", "src/ui/kept.mjs"]);
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it("passes when every violation is listed", () => {
    const { status, output } = check();
    expect(output).toContain("2 known violations ignored");
    expect(status).toBe(0);
  });

  it("fails on a violation the baseline does not list, and names it", () => {
    write("src/ui/added.mjs", IMPORTS_DB);
    const { status, output } = check();
    expect(output).toContain(`${RULE}: src/ui/added.mjs`);
    expect(status).toBe(1);
  });

  it("fails on a listed violation that no longer occurs", () => {
    write("src/ui/fixed.mjs", "export const used = 0;\n");
    const { status, output } = check();
    expect(output).toContain("1 stale known violations in the baseline");
    expect(status).toBe(1);
  });

  it("regenerates shrink-only: drops the stale entry and adds no new one", () => {
    write("src/ui/fixed.mjs", "export const used = 0;\n");
    write("src/ui/added.mjs", IMPORTS_DB);
    expect(depcruise("--baseline", KNOWN).status).toBe(0);
    expect(listed()).toEqual(["src/ui/kept.mjs"]);
  });
});

describe("the real gate's wiring", () => {
  it("fails a stale entry and regenerates the baseline shrink-only", () => {
    expect(REAL_CONFIG.options.baseline).toEqual({
      mode: "shrink-only",
      staleEntriesSeverity: "error",
    });
  });

  it("checks against the committed baseline and regenerates that same file", () => {
    const manifest = readFileSync(path.join(REPO_ROOT, "package.json"), "utf8");
    const { scripts } = JSON.parse(manifest) as { scripts: Record<string, string> };
    expect(scripts["check:architecture"]).toContain(`--ignore-known ${KNOWN}`);
    expect(scripts["check:architecture:update-baseline"]).toContain(`--baseline ${KNOWN}`);
  });
});
