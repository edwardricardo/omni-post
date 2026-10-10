/**
 * @file playwright-collector.ts
 * @description The report reader of the reach engine's Playwright collector. `playwright test
 *              --list --reporter=json` prints a JSON report whose specs name their files relative
 *              to the report's `config.rootDir`. A file Playwright projects repeat across browsers
 *              is read once: it is one file run by one config. It fails closed on output that is
 *              not the JSON report, a report with no absolute rootDir, any load error it reports,
 *              and a spec with no file.
 * @layer infrastructure
 */
import path from "node:path";
import { err, ok, type Result } from "@shared/types";
import { asRecord, describeError } from "./registry.js";

/**
 * Collects the `file` of every spec under a suite, recursively.
 *
 * @param suite - One suite of the JSON report.
 * @param files - Where each spec's file is added.
 * @returns Why a spec could not be read, or `null`.
 */
function collectSpecFiles(suite: unknown, files: Set<string>): string | null {
  const record = asRecord(suite);
  if (record === null) return "a suite that is not an object";
  const specs = record.specs ?? [];
  const suites = record.suites ?? [];
  if (!Array.isArray(specs) || !Array.isArray(suites)) return "a suite whose specs are not a list";
  for (const spec of specs) {
    const file = asRecord(spec)?.file;
    if (typeof file !== "string" || file === "") return "a spec with no file";
    files.add(file);
  }
  for (const child of suites) {
    const failure = collectSpecFiles(child, files);
    if (failure !== null) return failure;
  }
  return null;
}

/**
 * Reads what `playwright test --list --reporter=json` printed on stdout. Measured on Playwright
 * 1.63.0: stdout is the JSON report and nothing else, its `config.rootDir` is absolute, every
 * spec's `file` is relative to it, and a config that cannot load lands in `errors`.
 *
 * @param stdout - The command's standard output.
 * @returns The spec files as absolute paths, or why the output is not the report.
 */
export function parsePlaywrightList(stdout: string): Result<string[], string> {
  const text = stdout.trim();
  if (!text.startsWith("{")) {
    return err(`printed no JSON report; it begins ${JSON.stringify(text.slice(0, 60))}`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error: unknown) {
    return err(`printed a report that is not valid JSON: ${describeError(error)}`);
  }
  const report = asRecord(parsed);
  const rootDir = asRecord(report?.config)?.rootDir;
  if (typeof rootDir !== "string" || !path.isAbsolute(rootDir)) {
    return err("printed a report with no absolute config.rootDir");
  }
  const errors = report?.errors;
  if (!Array.isArray(errors)) return err("printed a report with no errors list");
  if (errors.length > 0) {
    const first = asRecord(errors[0])?.message;
    const message = typeof first === "string" ? first : "(no message)";
    return err(`reported ${String(errors.length)} errors: ${message}`);
  }
  const suites = report?.suites;
  if (!Array.isArray(suites)) return err("printed a report with no suites list");
  const files = new Set<string>();
  for (const suite of suites) {
    const failure = collectSpecFiles(suite, files);
    if (failure !== null) return err(`printed ${failure}`);
  }
  return ok([...files].map((file) => path.resolve(rootDir, file)));
}
