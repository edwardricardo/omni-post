/**
 * @file sagaLiveSuitePrecondition.static.test.ts
 * @description Merge-blocking source scan over the live publish suite's setup.
 *              The suite depends on a background consumer and used to state that
 *              dependency in a COMMENT, so a consumer-less environment was
 *              reported six minutes later as three per-test timeouts. These
 *              assertions pin the three properties that make the new precondition
 *              worth having: it runs BEFORE any fixture is created, its failure
 *              path FAILS rather than skips, and the runner verifies readiness
 *              before each live file, so a consumer that died while an earlier
 *              file ran is named before this suite starts rather than after it.
 * @layer infrastructure
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const currentDir = dirname(fileURLToPath(import.meta.url));
const apiRoot = join(currentDir, "..", "..", "..");
const suitePath = join(apiRoot, "tests", "integration", "sagaCustomerFlow.live.test.ts");
const runnerPath = join(apiRoot, "scripts", "run-tests.sh");

const suite = readFileSync(suitePath, "utf8");
const suiteLines = suite.split("\n");
const runnerLines = readFileSync(runnerPath, "utf8").split("\n");

/**
 * The runner's lines from the first one that trims to `opening` through the next one
 * that trims to `closing`, joined; empty when either is missing.
 */
function runnerBlock(opening: string, closing: string): string {
  const start = runnerLines.findIndex((line) => line.trim() === opening);
  const end = runnerLines.findIndex((line, index) => index > start && line.trim() === closing);
  return start >= 0 && end > start ? runnerLines.slice(start, end + 1).join("\n") : "";
}

/**
 * Index of the line that CALLS the precondition. The import names it too, and an
 * import that sits above every fixture would satisfy an ordering assertion while
 * proving nothing about where the check actually runs.
 */
function preconditionCallLine(): number {
  return suiteLines.findIndex(
    (line) => line.includes("assertPublishConsumers(") && !line.trimStart().startsWith("import")
  );
}

/** How far past the call the assertion that consumes its verdict may sit. */
const PRECONDITION_BLOCK_LINES = 30;

describe("the live publish suite states its consumer dependency as a check, not a comment", () => {
  it("finds the suite and the runner", () => {
    // Non-vacuity: an index of -1 compares as "earliest" against everything, so a
    // scan that stopped locating either file would satisfy the ordering
    // assertions while reading nothing.
    expect(suite.length).toBeGreaterThan(0);
    expect(runnerLines.length).toBeGreaterThan(0);
  });

  it("asserts consumer presence before creating any fixture", () => {
    // Creating rows first means a consumer-less run leaves fixture rows behind
    // and spends its budget before saying anything useful.
    const preconditionLine = preconditionCallLine();
    const firstCreateLine = suiteLines.findIndex((line) => /prisma\.\w+\.create\(/.test(line));

    expect(preconditionLine).toBeGreaterThanOrEqual(0);
    expect(firstCreateLine).toBeGreaterThanOrEqual(0);
    expect(preconditionLine).toBeLessThan(firstCreateLine);
  });

  it("fails on the precondition rather than skipping", () => {
    // R2-d: the verdict is a FAILURE. A skip here would be the same green-over-
    // nothing the suite exists to disprove, and the batch gate now reddens on a
    // skip anyway — so a skip would be a confusing red, not a quiet green.
    const preconditionLine = preconditionCallLine();
    const window = suiteLines
      .slice(preconditionLine, preconditionLine + PRECONDITION_BLOCK_LINES)
      .join("\n");

    expect({
      assertsTheVerdict: /assert\.(ok|fail)\(/.test(window),
      carriesTheMessage: /\.message/.test(window),
      noSkip: !/\bt\.skip\(/.test(suite),
    }).toEqual({ assertsTheVerdict: true, carriesTheMessage: true, noSkip: true });
  });

  it("keeps no case conditionally skipped on a service being absent", () => {
    expect(suite).not.toMatch(/skipIf\w*Unavailable/);
    expect(suite).not.toMatch(/it\.skip\(|describe\.skip\(/);
  });

  it("runs behind the readiness probe the runner makes before each live file", () => {
    // The suite's own check names the cause once it starts; the runner's probe is
    // what keeps a worker that died during an earlier live file from being found
    // only after this suite has burned its budget. The workers' ready route counts
    // a consumer registered on the publish queue, so it probes this precondition.
    const probeBody = runnerBlock("probe_live() {", "}");
    const loopBody = runnerBlock('for file in "$@"; do', "done");
    const liveCalls = runnerLines.filter(
      (line) =>
        /^\s*(?:[A-Z_]+=\S+\s+)*run_batch\s+"/.test(line) &&
        !line.includes('run_batch "integration" ')
    );

    expect(liveCalls.length).toBeGreaterThan(0);
    expect({
      liveSuffix: suitePath.endsWith(".live.test.ts"),
      probesTheApi: /curl -fsS [^\n]*"\$TEST_API_URL\/health"/.test(probeBody),
      probesTheWorkers: /curl -fsS [^\n]*"\$TEST_WORKERS_READY_URL"/.test(probeBody),
      everyLiveCallProbes: liveCalls.every((line) =>
        /^\s*BATCH_PROBE=probe_live run_batch /.test(line)
      ),
      probeBeforeEachFile:
        /! "\$BATCH_PROBE"/.test(loopBody) &&
        loopBody.indexOf('"$BATCH_PROBE"') < loopBody.indexOf('run_file "$file"'),
    }).toEqual({
      liveSuffix: true,
      probesTheApi: true,
      probesTheWorkers: true,
      everyLiveCallProbes: true,
      probeBeforeEachFile: true,
    });
  });
});
