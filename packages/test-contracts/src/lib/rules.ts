/**
 * @file rules.ts
 * @description The verdict of the reach engine, as a pure function of what was read: the disk
 *              inventory, every collection, the sources a required check runs, the quarantine
 *              and its base. Two rules live here:
 *
 *              - R1: each file on disk or collected is collected exactly once, by a source a
 *                required check runs, unless quarantined. Zero is a test nobody runs; two is a
 *                test that runs twice, or under the wrong environment, and whose green says
 *                nothing about the tier it was written for.
 *              - R3: the quarantine is honest. Every entry is a tracked file, no source a required
 *                check runs collects it, and when a base quarantine is given, every entry is
 *                already in it: the quarantine may only shrink.
 *
 *              R2, which decides which sources a required check runs, lives in `executed-by.ts`
 *              and shares the rule ids and the violation shape defined here. Nothing here reads a
 *              file or starts a process, so every rule is tested over plain values; the command
 *              line in `reach.ts` does the reading.
 * @layer infrastructure
 */
import { err, ok, type Result } from "@shared/types";
import type { DiskInventory } from "./disk.js";
import { describeError, tallyReach, type Collection } from "./registry.js";

/** The rules a violation can break. */
export const RULE = {
  R1: "R1",
  R2: "R2",
  R3: "R3",
} as const;

/** A rule id, derived from {@link RULE}. */
type RuleId = (typeof RULE)[keyof typeof RULE];

/** One broken rule, about one file, or about one registry entry for R2. */
export interface Violation {
  readonly rule: RuleId;
  readonly file: string;
  readonly message: string;
}

/** One quarantined file, with why it runs nowhere and who owns ending that. */
export interface QuarantineEntry {
  readonly path: string;
  readonly reason: string;
  readonly owner: string;
}

/** Everything the verdict reads. */
export interface ReachInput {
  readonly disk: DiskInventory;
  readonly collections: readonly Collection[];
  readonly quarantine: readonly QuarantineEntry[];
  /** The base quarantine, or `null` when none was given and the shrink check does not run. */
  readonly base: readonly QuarantineEntry[] | null;
  /**
   * The labels of the sources a required check runs. Omitted, every source counts as run: the
   * verdict over the collections alone.
   */
  readonly runSources?: ReadonlySet<string>;
}

/**
 * @param value - One parsed quarantine entry.
 * @returns Whether it carries a non-empty path, reason and owner.
 */
function isQuarantineEntry(value: unknown): value is QuarantineEntry {
  if (typeof value !== "object" || value === null) return false;
  const fields = new Map<string, unknown>(Object.entries(value));
  return ["path", "reason", "owner"].every((key) => {
    const field = fields.get(key);
    return typeof field === "string" && field.trim().length > 0;
  });
}

/**
 * Parses a quarantine: `{ "entries": [{ "path", "reason", "owner" }] }`.
 *
 * @param text - The quarantine's JSON text.
 * @param label - What to call it in a failure, usually its path.
 * @returns The entries, or why the text cannot be trusted.
 */
export function parseQuarantine(text: string, label: string): Result<QuarantineEntry[], string> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error: unknown) {
    return err(`quarantine ${label} is not JSON: ${describeError(error)}`);
  }
  const entries: unknown =
    typeof parsed === "object" && parsed !== null && "entries" in parsed ? parsed.entries : null;
  if (!Array.isArray(entries)) return err(`quarantine ${label} has no "entries" array`);
  const valid: QuarantineEntry[] = [];
  for (const [index, entry] of entries.entries()) {
    if (!isQuarantineEntry(entry)) {
      return err(
        `quarantine ${label} entry ${String(index)} needs a non-empty path, reason and owner`
      );
    }
    valid.push(entry);
  }
  return ok(valid);
}

/**
 * @param sources - The labels of the sources that collect a file.
 * @param runSources - The labels of the sources a required check runs, or `undefined` for all.
 * @returns The sources among them a required check runs.
 */
function runBy(sources: readonly string[], runSources?: ReadonlySet<string>): string[] {
  return runSources === undefined ? [...sources] : sources.filter((s) => runSources.has(s));
}

/**
 * R1: every file on disk or collected is collected exactly once, by a source a required check
 * runs, unless quarantined. Two sources is a violation whether or not a check runs them: the
 * file sits under two collectors' conventions at once.
 *
 * @param testShaped - The test-shaped tracked files.
 * @param reach - Collected file → the sources that collect it.
 * @param quarantined - The quarantined paths.
 * @param runSources - The labels of the sources a required check runs, or `undefined` for all.
 * @returns One violation per file collected zero or several times, or by no run source.
 */
function checkExactlyOnce(
  testShaped: readonly string[],
  reach: ReadonlyMap<string, readonly string[]>,
  quarantined: ReadonlySet<string>,
  runSources?: ReadonlySet<string>
): Violation[] {
  const files = [...new Set([...testShaped, ...reach.keys()])].sort();
  const violations: Violation[] = [];
  for (const file of files) {
    if (quarantined.has(file)) continue;
    const sources = reach.get(file) ?? [];
    if (sources.length === 0) {
      violations.push({ rule: RULE.R1, file, message: "unreached: no collector runs it" });
    } else if (sources.length === 1 && runBy(sources, runSources).length === 0) {
      violations.push({
        rule: RULE.R1,
        file,
        message: `unreached: collected by ${sources.join(", ")}, which no required check runs`,
      });
    } else if (sources.length > 1) {
      violations.push({
        rule: RULE.R1,
        file,
        message: `collected ${String(sources.length)} times: ${sources.join(", ")}`,
      });
    }
  }
  return violations;
}

/**
 * R3: every quarantine entry is tracked, no source a required check runs collects it, and the
 * quarantine only shrinks. A file collected only by a source no required check runs belongs in
 * the quarantine: that collection runs nowhere.
 *
 * @param entries - The quarantine under check.
 * @param base - The base quarantine, or `null` when none was given.
 * @param tracked - Every tracked file.
 * @param reach - Collected file → the sources a required check runs that collect it.
 * @returns One violation per broken entry.
 */
function checkQuarantine(
  entries: readonly QuarantineEntry[],
  base: readonly QuarantineEntry[] | null,
  tracked: ReadonlySet<string>,
  reach: ReadonlyMap<string, readonly string[]>
): Violation[] {
  const basePaths = base === null ? null : new Set(base.map((entry) => entry.path));
  const seen = new Set<string>();
  const violations: Violation[] = [];
  for (const { path: file } of entries) {
    if (seen.has(file)) {
      violations.push({ rule: RULE.R3, file, message: "quarantined more than once" });
      // A repeat is reported once per extra listing and nothing more: the entry's other checks
      // already ran on its first listing, and running them again would only repeat those.
      continue;
    }
    seen.add(file);
    if (!tracked.has(file)) {
      violations.push({ rule: RULE.R3, file, message: "quarantined, but not a tracked file" });
    }
    const sources = reach.get(file) ?? [];
    if (sources.length > 0) {
      violations.push({
        rule: RULE.R3,
        file,
        message: `quarantined, but collected by ${sources.join(", ")}`,
      });
    }
    if (basePaths !== null && !basePaths.has(file)) {
      violations.push({
        rule: RULE.R3,
        file,
        message: "quarantined, but not in the base quarantine; the quarantine may only shrink",
      });
    }
  }
  return violations;
}

/**
 * Holds what was read against R1 and R3.
 *
 * @param input - The disk inventory, the collections, the run sources, the quarantine and its
 *   base.
 * @returns Every violation, R1 first, each in file order.
 */
export function evaluate(input: ReachInput): Violation[] {
  const reach = tallyReach(input.collections);
  const runReach = new Map<string, string[]>();
  for (const [file, sources] of reach) {
    const run = runBy(sources, input.runSources);
    if (run.length > 0) runReach.set(file, run);
  }
  return [
    ...checkExactlyOnce(
      input.disk.testShaped,
      reach,
      new Set(input.quarantine.map((entry) => entry.path)),
      input.runSources
    ),
    ...checkQuarantine(input.quarantine, input.base, new Set(input.disk.tracked), runReach),
  ];
}
