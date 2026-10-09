/**
 * @file rules.ts
 * @description The verdict of the reach engine, as a pure function of what was read: the disk
 *              inventory, every collection, the quarantine and its base. Two rules:
 *
 *              - R1: each file on disk or collected is collected exactly once, unless quarantined.
 *                Zero is a test nobody runs; two is a test that runs twice, or under the wrong
 *                environment, and whose green says nothing about the tier it was written for.
 *              - R3: the quarantine is honest. Every entry is a tracked file, none is collected,
 *                and when a base quarantine is given, every entry is already in it: the
 *                quarantine may only shrink.
 *
 *              Nothing here reads a file or starts a process, so every rule is tested over plain
 *              values; the command line in `reach.ts` does the reading.
 * @layer infrastructure
 */
import { err, ok, type Result } from "@shared/types";
import type { DiskInventory } from "./disk.js";
import { describeError, tallyReach, type Collection } from "./registry.js";

/** The rules a violation can break. */
const RULE = {
  R1: "R1",
  R3: "R3",
} as const;

/** A rule id, derived from {@link RULE}. */
type RuleId = (typeof RULE)[keyof typeof RULE];

/** One broken rule, about one file. */
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
 * R1: every file on disk or collected is collected exactly once, unless quarantined.
 *
 * @param testShaped - The test-shaped tracked files.
 * @param reach - Collected file → the sources that collect it.
 * @param quarantined - The quarantined paths.
 * @returns One violation per file collected zero or several times.
 */
function checkExactlyOnce(
  testShaped: readonly string[],
  reach: ReadonlyMap<string, readonly string[]>,
  quarantined: ReadonlySet<string>
): Violation[] {
  const files = [...new Set([...testShaped, ...reach.keys()])].sort();
  const violations: Violation[] = [];
  for (const file of files) {
    if (quarantined.has(file)) continue;
    const sources = reach.get(file) ?? [];
    if (sources.length === 0) {
      violations.push({ rule: RULE.R1, file, message: "unreached: no collector runs it" });
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
 * R3: every quarantine entry is tracked, none is collected, and the quarantine only shrinks.
 *
 * @param entries - The quarantine under check.
 * @param base - The base quarantine, or `null` when none was given.
 * @param tracked - Every tracked file.
 * @param reach - Collected file → the sources that collect it.
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
 * @param input - The disk inventory, the collections, the quarantine and its base.
 * @returns Every violation, R1 first, each in file order.
 */
export function evaluate(input: ReachInput): Violation[] {
  const reach = tallyReach(input.collections);
  return [
    ...checkExactlyOnce(
      input.disk.testShaped,
      reach,
      new Set(input.quarantine.map((entry) => entry.path))
    ),
    ...checkQuarantine(input.quarantine, input.base, new Set(input.disk.tracked), reach),
  ];
}
