/**
 * @file executed-by.ts
 * @description The registry and the ruleset rule R2 of the reach engine reads.
 *              `collectors.json` maps every collector the engine runs to the CI jobs that execute
 *              it: `{ "collectors": { "<id>": { "executedBy": [entry], "note"? } } }`, each entry
 *              `{ workflow, jobId, entrypoint, packages | exclude }`, where `packages` names the
 *              directory prefixes of the sources a job runs and `exclude` the ones it does not.
 *              The ruleset is `.github/rulesets/main.json`, in the shape GitHub's rulesets API
 *              returns, and what is read from it is its required status checks. Both are refused,
 *              never read in part, when anything in them is malformed or unknown.
 * @layer infrastructure
 */
import { err, ok, type Result } from "@shared/types";
import { asRecord, describeError } from "./registry.js";

/** One job that executes a collector, and the sources of the collector it runs. */
export interface ExecutedByEntry {
  /** Repository-relative workflow path, under `.github/workflows/`. */
  readonly workflow: string;
  readonly jobId: string;
  /** Text one `run` of the job must contain. */
  readonly entrypoint: string;
  /** Directory prefixes of the sources the job runs; omitted with `exclude` for every source. */
  readonly packages?: readonly string[];
  /** Directory prefixes of the sources the job does not run. */
  readonly exclude?: readonly string[];
}

/** Collector id → the jobs that execute it. */
export type CollectorRegistry = ReadonlyMap<string, readonly ExecutedByEntry[]>;

const ENTRY_KEYS = new Set(["workflow", "jobId", "entrypoint", "packages", "exclude"]);
const COLLECTOR_KEYS = new Set(["executedBy", "note"]);
const WORKFLOW_PATH = /^\.github\/workflows\/[^/]+\.ya?ml$/;

/**
 * @param value - Any parsed value.
 * @returns It as a non-empty list of non-empty strings, or `null`.
 */
function asPrefixList(value: unknown): string[] | null {
  if (!Array.isArray(value) || value.length === 0) return null;
  const prefixes: string[] = [];
  for (const item of value) {
    if (typeof item !== "string" || item.trim() === "") return null;
    prefixes.push(item);
  }
  return prefixes;
}

/**
 * @param value - One parsed `executedBy` element.
 * @param where - How to name it in a failure.
 * @returns The entry, or why it cannot be trusted.
 */
function parseEntry(value: unknown, where: string): Result<ExecutedByEntry, string> {
  const record = asRecord(value);
  if (record === null) return err(`${where} is not an object`);
  const unknown = Object.keys(record).filter((key) => !ENTRY_KEYS.has(key));
  if (unknown.length > 0) return err(`${where} has unknown keys: ${unknown.join(", ")}`);
  const { workflow, jobId, entrypoint } = record;
  if (typeof workflow !== "string" || !WORKFLOW_PATH.test(workflow)) {
    return err(`${where} needs a workflow path under .github/workflows/`);
  }
  if (typeof jobId !== "string" || jobId === "" || typeof entrypoint !== "string") {
    return err(`${where} needs a jobId and an entrypoint`);
  }
  if (entrypoint.trim() === "") return err(`${where} needs a non-empty entrypoint`);
  if ("packages" in record && "exclude" in record) {
    return err(`${where} carries both packages and exclude`);
  }
  const scopeKey = "packages" in record ? "packages" : "exclude" in record ? "exclude" : null;
  if (scopeKey === null) return ok({ workflow, jobId, entrypoint });
  const prefixes = asPrefixList(record[scopeKey]);
  if (prefixes === null) return err(`${where} needs ${scopeKey} as a non-empty list of paths`);
  return ok({ workflow, jobId, entrypoint, [scopeKey]: prefixes });
}

/**
 * Parses `collectors.json`.
 *
 * @param text - The registry's JSON text.
 * @param label - What to call it in a failure, usually its path.
 * @returns Collector id → its entries, or why the registry cannot be trusted.
 */
export function parseCollectorRegistry(
  text: string,
  label: string
): Result<CollectorRegistry, string> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error: unknown) {
    return err(`registry ${label} is not JSON: ${describeError(error)}`);
  }
  const collectors = asRecord(asRecord(parsed)?.collectors);
  if (collectors === null) return err(`registry ${label} has no "collectors" object`);
  const registry = new Map<string, ExecutedByEntry[]>();
  for (const [id, value] of Object.entries(collectors)) {
    const record = asRecord(value);
    const unknown =
      record === null ? [] : Object.keys(record).filter((k) => !COLLECTOR_KEYS.has(k));
    if (record === null || !Array.isArray(record.executedBy) || unknown.length > 0) {
      return err(`registry ${label} collector "${id}" needs an executedBy list and no other key`);
    }
    const entries: ExecutedByEntry[] = [];
    for (const [index, entry] of record.executedBy.entries()) {
      const where = `registry ${label} collector "${id}" entry ${String(index)}`;
      const parsedEntry = parseEntry(entry, where);
      if (!parsedEntry.ok) return parsedEntry;
      entries.push(parsedEntry.value);
    }
    registry.set(id, entries);
  }
  return ok(registry);
}

/**
 * Reads the required status-check contexts of a ruleset, in the shape GitHub's rulesets API
 * returns: `rules[]` with `type: "required_status_checks"` and
 * `parameters.required_status_checks[].context`.
 *
 * @param text - The ruleset's JSON text.
 * @param label - What to call it in a failure, usually its path.
 * @returns The contexts, or why the ruleset cannot be trusted.
 */
export function parseRequiredContexts(text: string, label: string): Result<Set<string>, string> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error: unknown) {
    return err(`ruleset ${label} is not JSON: ${describeError(error)}`);
  }
  const rules = asRecord(parsed)?.rules;
  if (!Array.isArray(rules)) return err(`ruleset ${label} has no "rules" list`);
  const contexts = new Set<string>();
  for (const rule of rules) {
    const record = asRecord(rule);
    if (record?.type !== "required_status_checks") continue;
    const checks = asRecord(record.parameters)?.required_status_checks;
    if (!Array.isArray(checks)) return err(`ruleset ${label} has a status-check rule with no list`);
    for (const check of checks) {
      const context = asRecord(check)?.context;
      if (typeof context !== "string" || context === "") {
        return err(`ruleset ${label} has a required status check with no context`);
      }
      contexts.add(context);
    }
  }
  if (contexts.size === 0) return err(`ruleset ${label} requires no status check`);
  return ok(contexts);
}
