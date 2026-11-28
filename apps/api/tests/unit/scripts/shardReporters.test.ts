/**
 * @file shardReporters.test.ts
 * @description Pins the pairing between the CI shard step and `apps/api/vitest.config.ts` that
 *   decides what a shard reports. The api config does not go through
 *   `defineWorkspaceVitestConfig`, so nothing else checks that its `test.reporters` agrees with
 *   `workspaceReporters()`; and the shard step in `.github/workflows/ci.yml` gets its blob ONLY
 *   through that agreement, because its command carries no `--reporter` flag. Three ways to break
 *   it are each silent or late without this suite: a `--reporter` flag put back on the command
 *   (the flag REPLACES the configured reporters, so a failing shard prints no file, no test and
 *   no diff), the `VITEST_SHARDED` variable dropped from the step's `env` (no blob, discovered
 *   only when the upload runs), and the upload's `if-no-files-found: error` relaxed (the missing
 *   blob then passes in silence).
 *
 *   The workflow is read by the line-based reader of `workflowYaml.test-helpers.ts`, whose header
 *   states what it understands and what it refuses.
 * @layer infrastructure
 */
import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { workspaceReporters, type ReporterSignals } from "@packages/vitest-shared";
import {
  collectionOf,
  isStructural,
  readMapping,
  readSequence,
  scalarOf,
  type Mapping,
  type MappingEntry,
} from "./workflowYaml.test-helpers.js";

const WORKFLOW = new URL("../../../../../.github/workflows/ci.yml", import.meta.url);

/** The directory vitest writes a sharded blob to, relative to `apps/api`, and the upload reads. */
const BLOB_DIRECTORY = "apps/api/.vitest-reports/";

interface ReporterConfig {
  test?: { reporters?: unknown };
}

interface ShardPairing {
  /** Every step, in any job, whose command runs a vitest shard. */
  readonly shardSteps: readonly Mapping[];
  /** The upload steps of the blob directory that follow the shard step in its own job. */
  readonly blobUploads: readonly Mapping[];
}

/**
 * Locates the shard step and the uploads of its blob directory that follow it in its job.
 *
 * @param workflowText - Raw workflow text.
 * @returns The steps found, for the checks to count and read.
 */
function readShardPairing(workflowText: string): ShardPairing {
  const workflow = readMapping(workflowText.split("\n"), "ci.yml");
  const jobs = readMapping(collectionOf(workflow, "jobs"), "ci.yml > jobs");
  const shardSteps: Mapping[] = [];
  const blobUploads: Mapping[] = [];

  for (const [name, job] of jobs) {
    const jobMapping = readMapping(job.body, job.where);
    if (!jobMapping.has("steps")) continue;
    const steps = readSequence(
      collectionOf(jobMapping, "steps"),
      `ci.yml > jobs > ${name} > steps`
    );

    let shardSeen = false;
    steps.forEach((lines, position) => {
      const where = `ci.yml > jobs > ${name} > steps[${String(position)}]`;
      const code = lines.filter(isStructural).join("\n");
      if (/\bvitest run\b[\s\S]*--shard=/.test(code)) {
        shardSteps.push(readMapping(lines, where));
        shardSeen = true;
        return;
      }
      if (!shardSeen || !/upload-artifact@/.test(code)) return;
      const step = readMapping(lines, where);
      if (!(scalarOf(step, "uses") ?? "").startsWith("actions/upload-artifact@")) return;
      const inputs = readMapping(collectionOf(step, "with"), `${where} > with`);
      if (scalarOf(inputs, "path") === BLOB_DIRECTORY) blobUploads.push(step);
    });
  }
  return { shardSteps, blobUploads };
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
  const readPairing = (): ShardPairing => readShardPairing(readFileSync(WORKFLOW, "utf8"));

  /**
   * The one shard step, after asserting there is exactly one.
   *
   * @returns The shard step's mapping.
   */
  function onlyShardStep(): Mapping {
    const { shardSteps } = readPairing();
    expect(shardSteps).toHaveLength(1);
    return shardSteps[0] ?? new Map<string, MappingEntry>();
  }

  it("is found exactly once in the workflow", () => {
    expect(readPairing().shardSteps).toHaveLength(1);
  });

  it("names no reporter on its command, so the configured reporters are the ones installed", () => {
    const command = scalarOf(onlyShardStep(), "run") ?? "";

    expect(command).toMatch(/\bvitest run\b/);
    expect(command).not.toMatch(/--reporter\b/);
  });

  it("sets the variable that makes the api config write the blob beside the readable output", async () => {
    const env = readMapping(collectionOf(onlyShardStep(), "env"), "shard step > env");
    const sharded = scalarOf(env, "VITEST_SHARDED");

    expect(sharded).toBe("true");
    await expect(
      loadApiReporters({ GITHUB_ACTIONS: "true", VITEST_SHARDED: sharded })
    ).resolves.toEqual(["default", "github-actions", "blob"]);
  });

  it("is followed in its job by exactly one upload of the blob directory, failing when it is empty", () => {
    const { blobUploads } = readPairing();
    expect(blobUploads).toHaveLength(1);

    const inputs = readMapping(
      collectionOf(blobUploads[0] ?? new Map<string, MappingEntry>(), "with"),
      "upload > with"
    );
    expect(scalarOf(inputs, "if-no-files-found")).toBe("error");
  });
});
