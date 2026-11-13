// @ts-check
/**
 * @file battery-static.mjs
 * @description Prints the result of a static battery run. `scripts/testing/battery.sh --static`
 *   runs the static steps alone and calls this CLI after its last one; it asks `evaluateBattery`
 *   (`scripts/testing/battery-verdict.mjs`, which holds the rules) for the verdict over the static
 *   log directory, with the number of static steps as the expected count and no tree check, and
 *   prints each warning line, each reason and a last line, `STATIC GREEN` or `STATIC RED`, that
 *   names the failing steps and the logs holding warning lines.
 *
 *   It writes nothing. A static run certifies nothing, so no state file and no state directory
 *   are involved: the verdict a hook reads is `battery-state.mjs`'s alone to write.
 *
 *   Usage: `node scripts/testing/battery-static.mjs <log dir> <number of static steps>`.
 *   Exit codes: 0 GREEN; 1 RED, including a result that could not be computed, which still ends
 *   on a `STATIC RED` line; 2 a usage error.
 * @layer infrastructure
 */
import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";

/** @typedef {import("./battery-verdict.mjs").Verdict} Verdict */

const TAIL = "a static run certifies nothing";
const USAGE = "usage: node scripts/testing/battery-static.mjs <log dir> <number of static steps>";
const COUNT = /^\d+$/;

/**
 * @function staticReport
 * @description Turns the verdict of a static run into the lines to print and the exit code. The
 *   lines are each warning line as `<log>:<line>:<text>`, each reason as `RED because <reason>`,
 *   and a last line: `STATIC GREEN` with the number of steps, or `STATIC RED` naming the failing
 *   steps, the logs that hold warning lines, and how many further reasons the lines above list.
 * @param {Verdict} verdict The verdict `evaluateBattery` returned for the static log directory.
 * @returns {{ lines: string[], exitCode: 0 | 1 }} The lines in print order, and 0 for GREEN or 1
 *   for RED.
 */
export function staticReport(verdict) {
  /** @type {string[]} */
  const lines = [];
  if (verdict.warnings.length > 0) {
    lines.push(`warning lines: ${String(verdict.warnings.length)}`);
    for (const { log, line, text } of verdict.warnings) {
      lines.push(`  ${log}:${String(line)}:${text}`);
    }
  }
  for (const reason of verdict.reasons) lines.push(`RED because ${reason}`);
  if (verdict.status === "GREEN") {
    const count = String(verdict.steps.length);
    lines.push(
      `STATIC GREEN: all ${count} static steps exited 0 and no log holds a warning line; ${TAIL}`
    );
    return { lines, exitCode: 0 };
  }
  const failed = verdict.steps.filter((step) => step.exit !== 0).map((step) => step.name);
  const logs = [...new Set(verdict.warnings.map((warning) => warning.log))];
  /** @type {string[]} */
  const parts = [];
  if (failed.length > 0) {
    parts.push(
      `${String(failed.length)} of ${String(verdict.steps.length)} static steps failed: ` +
        failed.join(" ")
    );
  }
  if (logs.length > 0) {
    parts.push(`${String(verdict.warnings.length)} warning line(s) in ${logs.join(", ")}`);
  }
  // The verdict gives one reason per failing step and one for all warning lines; any further
  // reason (a missing log, a step count off the static plan) is listed above.
  const named = failed.length + (logs.length > 0 ? 1 : 0);
  if (verdict.reasons.length > named) {
    parts.push(`${String(verdict.reasons.length - named)} other reason(s) above`);
  }
  lines.push(`STATIC RED: ${parts.join("; ")}; ${TAIL}`);
  return { lines, exitCode: 1 };
}

/**
 * @param {string[]} argv
 * @returns {Promise<number>} Process exit code.
 */
async function main(argv) {
  const [outDir, planned] = argv;
  if (argv.length !== 2 || outDir === undefined || planned === undefined || !COUNT.test(planned)) {
    process.stderr.write(`battery-static: ${USAGE}\n`);
    return 2;
  }
  /** @type {{ lines: string[], exitCode: number }} */
  let report;
  try {
    // Loaded here rather than at the top, so a verdict module that cannot be loaded still ends
    // the run on a STATIC RED line instead of a bare stack trace.
    const { evaluateBattery } = await import("./battery-verdict.mjs");
    report = staticReport(
      evaluateBattery({ outDir, expectedSteps: Number(planned), dirtyAtEnd: false })
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    report = {
      lines: [`STATIC RED: the static result could not be computed: ${message}; ${TAIL}`],
      exitCode: 1,
    };
  }
  for (const line of report.lines) process.stdout.write(`${line}\n`);
  return report.exitCode;
}

/**
 * True only when this file is the process entry point. `staticReport` is exported, and importing
 * it must not run the CLI as a side effect.
 *
 * @returns {boolean}
 */
function invokedAsScript() {
  const entry = process.argv[1];
  if (entry === undefined) return false;
  try {
    return realpathSync(entry) === fileURLToPath(import.meta.url);
  } catch {
    return false;
  }
}

if (invokedAsScript()) process.exitCode = await main(process.argv.slice(2));
