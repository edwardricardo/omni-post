// @ts-check
/**
 * @file jscpd-baseline-gate.mjs
 * @description The duplicate-code gate behind `pnpm check:duplicates`. jscpd fails a clone its
 *   fingerprint baseline does not hold, but never a STALE entry, a fingerprint the tree no longer
 *   produces; while one stays, an identical clone added back passes unflagged.
 *
 *   Check mode runs jscpd twice over the same paths: first its own verdict against the committed
 *   baseline, output inherited, whose non-zero exit is the gate's; then `--baseline <scratch>
 *   --update-baseline`, which writes the tree's fingerprints to a scratch file and leaves the
 *   committed one untouched. A committed count above the current one is stale and fails. A current
 *   count above the committed one means the first run passed a new clone: the runs disagree, so the
 *   gate fails closed. `--update` rewrites the committed baseline. jscpd is the bin its manifest
 *   declares, run with this Node, because knip reads the `require.resolve` as a use of the package
 *   and does not read a spawn of `node_modules/.bin/jscpd` as one.
 *
 *   Usage: `node scripts/testing/jscpd-baseline-gate.mjs [--update]`. Exit 0 when the tree matches
 *   the baseline or it was rewritten; jscpd's own exit when its verdict fails; 1 otherwise.
 * @layer infrastructure
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const CONFIG_NAME = ".jscpd.json";
const REMEDY = "pnpm check:duplicates:update-baseline";

/** The directories every jscpd run scans, relative to the root. */
export const SCAN_PATHS = Object.freeze(["apps/", "packages/"]);

/** @typedef {{ status: number | null, output: string }} RunResult */
/** @typedef {{ cwd: string, capture: boolean }} RunOptions */
/** @typedef {(args: readonly string[], options: RunOptions) => RunResult} Runner */
/** @typedef {{ fingerprint: string, committed: number, current: number }} Drift */
/** @typedef {{ exitCode: number, messages: string[] }} Outcome */

/** @type {Runner} */
function spawnJscpd(args, { cwd, capture }) {
  const require = createRequire(path.join(cwd, "package.json"));
  const manifest = require.resolve("jscpd/package.json");
  const { bin } = JSON.parse(readFileSync(manifest, "utf8"));
  const entry = path.resolve(path.dirname(manifest), typeof bin === "string" ? bin : bin.jscpd);
  const stdio = capture ? "pipe" : "inherit";
  const result = spawnSync(process.execPath, [entry, ...args], { cwd, encoding: "utf8", stdio });
  const output = result.error?.message ?? `${result.stdout ?? ""}${result.stderr ?? ""}`;
  return { status: result.status, output: output.trim() };
}

/** @type {(file: string, label: string) => { value: unknown } | { error: string }} */
function readJson(file, label) {
  if (!existsSync(file)) return { error: `${label} does not exist` };
  try {
    return { value: JSON.parse(readFileSync(file, "utf8")) };
  } catch (error) {
    return { error: `${label} is not valid JSON: ${error instanceof Error ? error.message : ""}` };
  }
}

/**
 * Reads a baseline as jscpd writes it, `{"version": 1, "fingerprints": {"<hash>": count}}`; any
 * other shape is refused rather than compared.
 *
 * @type {(file: string, label: string) => { counts: Map<string, number> } | { error: string }}
 */
function readBaseline(file, label) {
  const read = readJson(file, label);
  if ("error" in read) return read;
  const { version, fingerprints: prints } =
    /** @type {{ version?: unknown, fingerprints?: unknown }} */ (read.value ?? {});
  if (version !== 1) return { error: `${label} declares version ${String(version)}, not 1` };
  if (typeof prints !== "object" || prints === null || Array.isArray(prints)) {
    return { error: `${label} has no \`fingerprints\` object` };
  }
  const bad = Object.entries(prints).find(([, count]) => !Number.isInteger(count) || count < 1);
  if (bad) return { error: `${label}: ${bad[0]} has no positive integer count` };
  return { counts: new Map(Object.entries(prints)) };
}

/**
 * Compares the committed counts with the tree's, in fingerprint order; an absent entry counts 0.
 *
 * @param {ReadonlyMap<string, number>} committed
 * @param {ReadonlyMap<string, number>} current
 * @returns {{ stale: Drift[], grown: Drift[] }}
 */
export function compareCounts(committed, current) {
  /** @type {{ stale: Drift[], grown: Drift[] }} */
  const drift = { stale: [], grown: [] };
  for (const fingerprint of [...new Set([...committed.keys(), ...current.keys()])].sort()) {
    const was = committed.get(fingerprint) ?? 0;
    const now = current.get(fingerprint) ?? 0;
    const entry = { fingerprint, committed: was, current: now };
    if (was !== now) (was > now ? drift.stale : drift.grown).push(entry);
  }
  return drift;
}

/** @type {(message: string) => Outcome} */
const refuse = (message) => ({ exitCode: 1, messages: [message] });

/** @type {(d: Drift) => string} */
const counted = (d) => `${d.fingerprint}: committed ${d.committed}, current ${d.current}`;

/** @type {(root: string, runner: Runner) => Outcome} */
function check(root, runner) {
  const config = readJson(path.join(root, CONFIG_NAME), CONFIG_NAME);
  if ("error" in config) return refuse(config.error);
  const named = /** @type {{ baseline?: unknown }} */ (config.value ?? {}).baseline;
  if (typeof named !== "string" || !named) return refuse(`${CONFIG_NAME} names no \`baseline\``);
  const committed = readBaseline(path.resolve(root, named), `the committed baseline ${named}`);
  if ("error" in committed) return refuse(`${committed.error}. Restore it, or run \`${REMEDY}\`.`);

  const first = runner(SCAN_PATHS, { cwd: root, capture: false });
  if (first.status !== 0) {
    const cause = `jscpd exited ${first.status ?? "on a signal"} ${first.output}`.trim();
    return { exitCode: first.status ?? 1, messages: [`${cause}; the stale check did not run`] };
  }
  const scratchDir = mkdtempSync(path.join(tmpdir(), "jscpd-baseline-gate-"));
  try {
    const scratch = path.join(scratchDir, "current.json");
    const args = [...SCAN_PATHS, "--baseline", scratch, "--update-baseline", "--silent"];
    const second = runner(args, { cwd: root, capture: true });
    if (second.status !== 0) {
      return refuse(`the measuring run exited ${String(second.status)}: ${second.output}`);
    }
    const current = readBaseline(scratch, "the measuring run's baseline");
    if ("error" in current) return refuse(`${current.error}: it wrote nothing usable`);

    const { stale, grown } = compareCounts(committed.counts, current.counts);
    const messages = [
      ...stale.map((d) => `stale entry ${counted(d)}`),
      ...grown.map((d) => `fingerprint ${counted(d)}`),
    ];
    if (stale.length > 0) {
      const entries = stale.length === 1 ? "entry" : "entries";
      messages.push(
        `${stale.length} stale ${entries} in ${named}: each lets a removed clone back in ` +
          `unflagged. Run \`${REMEDY}\`, then commit ${named}.`
      );
    }
    if (grown.length > 0) {
      messages.push(
        `the tree has more clones than ${named} holds, yet the jscpd run above passed: the runs ` +
          `disagree, so the gate fails closed. Check \`failOnNewClones: 0\` in ${CONFIG_NAME}.`
      );
    }
    if (messages.length > 0) return { exitCode: 1, messages };
    return { exitCode: 0, messages: [`${named} matches the tree: no stale entry, no new clone`] };
  } finally {
    rmSync(scratchDir, { recursive: true, force: true });
  }
}

/**
 * Runs the gate in one mode. Every jscpd run goes through `runner`, so the suite drives the rules
 * without jscpd.
 *
 * @param {{ mode: "check" | "update", root?: string, runner?: Runner }} input
 * @returns {Outcome}
 */
export function runGate({ mode, root = ROOT, runner = spawnJscpd }) {
  if (mode === "check") return check(root, runner);
  const result = runner([...SCAN_PATHS, "--update-baseline"], { cwd: root, capture: false });
  if (result.status === 0) return { exitCode: 0, messages: ["baseline rewritten: commit it"] };
  return refuse(`the jscpd update run exited ${result.status ?? "on a signal"}`);
}

/** @type {(argv: string[]) => number} */
function main(argv) {
  const mode = argv.length === 0 ? "check" : argv.join(" ") === "--update" ? "update" : null;
  if (mode === null) {
    process.stderr.write("usage: node scripts/testing/jscpd-baseline-gate.mjs [--update]\n");
    return 1;
  }
  /** @type {Outcome} */
  let outcome;
  try {
    outcome = runGate({ mode });
  } catch (error) {
    outcome = refuse(`jscpd could not run: ${error instanceof Error ? error.message : "unknown"}`);
  }
  const stream = outcome.exitCode === 0 ? process.stdout : process.stderr;
  for (const message of outcome.messages) stream.write(`jscpd-baseline-gate: ${message}\n`);
  return outcome.exitCode;
}

/** True only when this file is the process entry point, so importing its exports runs nothing. */
const entryPoint = process.argv[1];
if (entryPoint !== undefined && existsSync(entryPoint)) {
  if (realpathSync(entryPoint) === fileURLToPath(import.meta.url)) {
    process.exitCode = main(process.argv.slice(2));
  }
}
