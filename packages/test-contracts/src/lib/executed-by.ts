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
 *
 *              A job's check names are rendered only when they are predictable: a job name with any
 *              expression other than a matrix value, a matrix job that leaves its matrix out of
 *              its name, or a matrix with `include`, `exclude` or an expression is refused, never
 *              a guess at what GitHub would display.
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
const MATRIX_REFERENCE = /\$\{\{\s*matrix\.([A-Za-z_][\w-]*)\s*\}\}/g;

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

/**
 * @param strategy - A job's `strategy`, or `undefined`.
 * @returns Every matrix combination, key → rendered value, or why it cannot be expanded.
 */
function matrixCombinations(strategy: unknown): Result<Map<string, string>[], string> {
  const matrix = asRecord(strategy)?.matrix;
  if (matrix === undefined) return ok([new Map()]);
  const record = asRecord(matrix);
  if (record === null) return err("its matrix is not a mapping of lists");
  let combinations = [new Map<string, string>()];
  for (const [key, values] of Object.entries(record)) {
    if (key === "include" || key === "exclude") return err(`its matrix uses ${key}`);
    const notPlain = err(`its matrix key "${key}" is not a list of plain values`);
    if (!Array.isArray(values) || values.length === 0) return notPlain;
    const list: unknown[] = values;
    const rendered: string[] = [];
    for (const value of list) {
      const plain =
        typeof value === "string" || typeof value === "number" || typeof value === "boolean";
      if (!plain) return notPlain;
      rendered.push(String(value));
    }
    combinations = combinations.flatMap((combination) =>
      rendered.map((value) => new Map([...combination, [key, value]]))
    );
  }
  return ok(combinations);
}

/**
 * Renders the check names a job reports, one per matrix combination.
 *
 * @param jobId - The job's id.
 * @param job - The job's parsed mapping.
 * @returns The names, or why they cannot be rendered without guessing.
 */
export function renderCheckNames(
  jobId: string,
  job: Record<string, unknown>
): Result<string[], string> {
  const combinations = matrixCombinations(job.strategy);
  if (!combinations.ok) return combinations;
  const isMatrix = combinations.value.some((combination) => combination.size > 0);
  const { name } = job;
  if (name === undefined) {
    return isMatrix ? err("it is a matrix job with no name") : ok([jobId]);
  }
  if (typeof name !== "string") return err("its name is not a string");
  const keys = [...name.matchAll(MATRIX_REFERENCE)].map((match) => match[1] ?? "");
  if (isMatrix && keys.length === 0) {
    return err("it is a matrix job whose name leaves its matrix values out");
  }
  const names = new Set<string>();
  for (const combination of combinations.value) {
    const absent = keys.find((key) => !combination.has(key));
    if (absent !== undefined)
      return err(`its name uses matrix.${absent}, which no matrix key sets`);
    const rendered = name.replace(
      MATRIX_REFERENCE,
      (_whole, key: string) => combination.get(key) ?? ""
    );
    if (rendered.includes("${{")) {
      return err("its name uses an expression other than a matrix value");
    }
    names.add(rendered);
  }
  return ok([...names]);
}
