/**
 * @file shardReporters.test.ts
 * @description Pins the pairing between the CI shard step and `apps/api/vitest.config.ts` that
 *   decides what a shard reports. The api config does not go through
 *   `defineWorkspaceVitestConfig`, so nothing else checks that its `test.reporters` agrees with
 *   `workspaceReporters()`; and the shard step in `.github/workflows/ci.yml` gets its blob ONLY
 *   through that agreement, because its command carries no `--reporter` flag. Three ways to break
 *   it are each silent or late without this suite: a `--reporter` flag put back on the command
 *   (the flag REPLACES the configured reporters, so a failing shard prints no file, no test and
 *   no diff), the `VITEST_SHARDED` variable dropped from the step (no blob, discovered only when
 *   the upload runs), and the upload's `if-no-files-found: error` relaxed (the missing blob then
 *   passes in silence).
 *
 *   The workflow is read as text, step by step, from one `- name:` or `- uses:` line to the
 *   next: a YAML parser is not a dependency of this package, and that boundary is the one
 *   fitness #34 already reads the workflows by.
 * @layer infrastructure
 */
import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { workspaceReporters, type ReporterSignals } from "@packages/vitest-shared";

const WORKFLOW = new URL("../../../../../.github/workflows/ci.yml", import.meta.url);

/** The directory vitest writes a sharded blob to, relative to `apps/api`, and the upload reads. */
const BLOB_DIRECTORY = "apps/api/.vitest-reports/";

interface ReporterConfig {
  test?: { reporters?: unknown };
}

/**
 * Loads `apps/api/vitest.config.ts` through module evaluation under explicit signals. Both are
 * set rather than inherited: this suite runs inside the CI shard jobs, where the ambient values
 * are the very ones under test.
 *
 * @param signals - The two variables `workspaceReporters` reads; an absent key is unset.
 * @returns The `test.reporters` value the config resolves to under those signals.
 */
async function loadApiReporters(signals: ReporterSignals): Promise<unknown> {
  vi.stubEnv("GITHUB_ACTIONS", signals.GITHUB_ACTIONS);
  vi.stubEnv("VITEST_SHARDED", signals.VITEST_SHARDED);
  vi.resetModules();

  const configModule = (await import("../../../vitest.config.js")) as { default: ReporterConfig };
  return configModule.default.test?.reporters;
}

/**
 * Splits a workflow into its steps, each the run of lines from a `- name:` or `- uses:` line up
 * to the line before the next one.
 *
 * @param workflow - Raw workflow text.
 * @returns The lines of every step, in file order.
 */
function workflowSteps(workflow: string): string[][] {
  const lines = workflow.split("\n");
  const starts = lines.flatMap((line, index) => (/^\s*- (name|uses):/.test(line) ? [index] : []));

  return starts.map((start, position) => lines.slice(start, starts[position + 1] ?? lines.length));
}

/**
 * Reads the value of the first `key: value` line in a step, with surrounding quotes removed.
 *
 * @param step - The step's lines.
 * @param key - The key, matched at the start of a line so a comment naming it never counts.
 * @returns The value, or `undefined` when the step does not set the key.
 */
function stepValue(step: string[], key: string): string | undefined {
  const pattern = new RegExp(`^\\s*${key}:\\s*(.*?)\\s*$`);
  const value = step.map((line) => pattern.exec(line)?.[1]).find((match) => match !== undefined);

  return value?.replace(/^(["'])(.*)\1$/, "$2");
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe("apps/api/vitest.config.ts reporters", () => {
  it.each<{ signals: ReporterSignals; expected: string[] }>([
    { signals: {}, expected: ["default"] },
    { signals: { GITHUB_ACTIONS: "true" }, expected: ["default", "github-actions"] },
    { signals: { VITEST_SHARDED: "true" }, expected: ["default", "blob"] },
    {
      signals: { GITHUB_ACTIONS: "true", VITEST_SHARDED: "true" },
      expected: ["default", "github-actions", "blob"],
    },
  ])("resolves to the shared selection $expected under $signals", async ({ signals, expected }) => {
    const reporters = await loadApiReporters(signals);

    expect(reporters).toEqual(expected);
    expect(reporters).toEqual(workspaceReporters(signals));
  });
});

describe("the CI shard step", () => {
  const steps = workflowSteps(readFileSync(WORKFLOW, "utf8"));
  const shardIndex = steps.findIndex((step) =>
    step.some((line) => /^\s*run:.*\bvitest run\b.*--shard=/.test(line))
  );
  const shardStep = steps[shardIndex] ?? [];
  const uploadStep = steps[shardIndex + 1] ?? [];

  it("is found exactly once in the workflow", () => {
    const shardSteps = steps.filter((step) =>
      step.some((line) => /^\s*run:.*\bvitest run\b.*--shard=/.test(line))
    );

    expect(shardSteps).toHaveLength(1);
  });

  it("names no reporter on its command, so the configured reporters are the ones installed", () => {
    expect(stepValue(shardStep, "run")).toBeDefined();
    expect(stepValue(shardStep, "run")).not.toMatch(/--reporter\b/);
  });

  it("sets the variable that makes the api config write the blob beside the readable output", async () => {
    const sharded = stepValue(shardStep, "VITEST_SHARDED");

    expect(sharded).toBe("true");
    await expect(
      loadApiReporters({ GITHUB_ACTIONS: "true", VITEST_SHARDED: sharded })
    ).resolves.toEqual(["default", "github-actions", "blob"]);
  });

  it("is followed by an upload of the blob directory that fails when no blob was written", () => {
    expect(stepValue(uploadStep, "path")).toBe(BLOB_DIRECTORY);
    expect(stepValue(uploadStep, "if-no-files-found")).toBe("error");
  });
});
