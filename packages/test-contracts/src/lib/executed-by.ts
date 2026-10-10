/**
 * @file executed-by.ts
 * @description Rule R2 of the reach engine: which collector sources a required check runs.
 *              `collectors.json` maps every collector the engine runs to the CI jobs that execute
 *              it: `{ "collectors": { "<id>": { "executedBy": [entry], "note"? } } }`, each entry
 *              `{ workflow, jobId, entrypoint, packages | exclude }`. An entry holds when its
 *              workflow holds the job, a `run` of one of the job's steps contains the entrypoint,
 *              and every check name the job renders (one per matrix combination) is a required
 *              status check of the committed ruleset. Its scope names the sources it runs:
 *              `packages`, directory prefixes each of which must cover a source; `exclude`, every
 *              source outside these prefixes; or neither, every source of the collector.
 *
 *              A source no entry covers is not run by a required check: the verdict in `rules.ts`
 *              then counts the files only it collects as unreached. A collector with an empty
 *              `executedBy` still runs, so its own listing is held to its floors, and reaches
 *              nothing. A check name is rendered only when it is predictable: a job name with any
 *              expression other than a matrix value, a matrix job that leaves its matrix out of
 *              its name, or a matrix with `include`, `exclude` or an expression is a violation,
 *              never a guess at what GitHub would display.
 * @layer infrastructure
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { parse as parseYaml } from "yaml";
import { err, ok, type Result } from "@shared/types";
import { asRecord, describeError, sourceLabel, type Collection } from "./registry.js";
import { RULE, type Violation } from "./rules.js";

/** Where the registry and the ruleset live, repository-relative. */
export const REGISTRY_FILE = "packages/test-contracts/collectors.json";
export const RULESET_FILE = ".github/rulesets/main.json";

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

/** Everything R2 reads. */
export interface ExecutedByInput {
  readonly registry: CollectorRegistry;
  /** The required status-check contexts of the ruleset. */
  readonly contexts: ReadonlySet<string>;
  /** Workflow path → its parsed document, or why it could not be read. */
  readonly workflows: ReadonlyMap<string, Result<unknown, string>>;
  /** The ids of the collectors the engine ran. */
  readonly collectorIds: readonly string[];
  readonly collections: readonly Collection[];
}

/** What R2 decides. */
export interface ExecutedByVerdict {
  readonly violations: Violation[];
  /** The labels of the sources an entry covers. */
  readonly runSources: Set<string>;
}

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
 * Renders the distinct check names a job reports. GitHub reports one check run per matrix
 * combination, and combinations whose names render alike report under the same name; a required
 * context is a name, so the distinct names are what rule R2 holds against the ruleset.
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

/**
 * @param source - A collection's source, possibly suffixed `#<project>`.
 * @param prefix - A directory prefix.
 * @returns Whether the source's path lies under the prefix.
 */
function isUnder(source: string, prefix: string): boolean {
  const file = source.split("#")[0] ?? source;
  const directory = prefix.replace(/\/+$/, "");
  return file === directory || file.startsWith(`${directory}/`);
}

/**
 * @param entry - A registry entry.
 * @param source - A collection's source.
 * @returns Whether the entry's scope runs the source.
 */
function covers(entry: ExecutedByEntry, source: string): boolean {
  if (entry.packages !== undefined) return entry.packages.some((p) => isUnder(source, p));
  if (entry.exclude !== undefined) return !entry.exclude.some((p) => isUnder(source, p));
  return true;
}

/**
 * Checks one entry's job against its workflow and the ruleset.
 *
 * @param entry - The entry.
 * @param input - The workflows and the required contexts.
 * @returns Why the entry does not hold, one message per broken condition.
 */
function checkEntryJob(entry: ExecutedByEntry, input: ExecutedByInput): string[] {
  const document = input.workflows.get(entry.workflow);
  if (document === undefined) return [`its workflow ${entry.workflow} was not read`];
  if (!document.ok) return [`its workflow cannot be read: ${document.error}`];
  const job = asRecord(asRecord(asRecord(document.value)?.jobs)?.[entry.jobId]);
  if (job === null) return [`${entry.workflow} has no job "${entry.jobId}"`];
  const messages: string[] = [];
  const steps = Array.isArray(job.steps) ? job.steps : [];
  const runs = steps.some((step) => {
    const run = asRecord(step)?.run;
    return typeof run === "string" && run.includes(entry.entrypoint);
  });
  if (!runs) messages.push(`no step of the job runs "${entry.entrypoint}"`);
  const names = renderCheckNames(entry.jobId, job);
  if (!names.ok) {
    messages.push(`its check names cannot be rendered: ${names.error}`);
  } else {
    for (const name of names.value) {
      if (!input.contexts.has(name)) messages.push(`its check "${name}" is not a required check`);
    }
  }
  return messages;
}

/**
 * Holds the registry against R2 and returns the sources a required check runs.
 *
 * @param input - The registry, the ruleset's contexts, the workflows and the collections.
 * @returns Every R2 violation, in registry order, and the run sources.
 */
export function checkExecutedBy(input: ExecutedByInput): ExecutedByVerdict {
  const violations: Violation[] = [];
  const violation = (file: string, message: string): void => {
    violations.push({ rule: RULE.R2, file, message });
  };
  for (const id of input.collectorIds) {
    if (!input.registry.has(id)) violation(REGISTRY_FILE, `collector "${id}" is not registered`);
  }
  for (const id of input.registry.keys()) {
    if (!input.collectorIds.includes(id)) {
      violation(REGISTRY_FILE, `registers "${id}", which the engine does not run`);
    }
  }
  const runSources = new Set<string>();
  for (const [id, entries] of input.registry) {
    const sources = input.collections.filter((c) => c.collector === id);
    for (const entry of entries) {
      const subject = `${id}:${entry.workflow}#${entry.jobId}`;
      for (const message of checkEntryJob(entry, input)) violation(subject, message);
      for (const prefix of entry.packages ?? []) {
        if (!sources.some((source) => isUnder(source.source, prefix))) {
          violation(subject, `packages "${prefix}" covers no source of ${id}`);
        }
      }
      for (const source of sources) {
        if (covers(entry, source.source)) runSources.add(sourceLabel(source));
      }
    }
  }
  return { violations, runSources };
}

/**
 * Reads and parses every workflow the registry names.
 *
 * @param root - Absolute repository root.
 * @param registry - The registry.
 * @returns Workflow path → its parsed document, or why it could not be read.
 */
export function readWorkflows(
  root: string,
  registry: CollectorRegistry
): Map<string, Result<unknown, string>> {
  const workflows = new Map<string, Result<unknown, string>>();
  for (const entries of registry.values()) {
    for (const { workflow } of entries) {
      if (workflows.has(workflow)) continue;
      try {
        workflows.set(workflow, ok(parseYaml(readFileSync(path.join(root, workflow), "utf8"))));
      } catch (error: unknown) {
        workflows.set(workflow, err(describeError(error)));
      }
    }
  }
  return workflows;
}
