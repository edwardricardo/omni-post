/**
 * @file imageSupply.test.ts
 * @description Holds the shape of the image supply of the checks required to merge, as the
 *   repository's files state it: the Dockerfile frontend each image's line 1 names, how the jobs
 *   start their Postgres and Redis and show their logs, how the image scan runs Trivy and caches
 *   its database, where its report reaches code scanning, and the run that shows the pull's
 *   fallback.
 *
 *   - Line 1 of every image's Dockerfile names the frontend by an exact version and its digest,
 *     the same in all four, so the digest decides which bytes build an image.
 *   - No job of the six workflows has a `services:` block, whose pull happens before any step and
 *     cannot be retried. The jobs that run a Postgres and a Redis start them through the shared
 *     action, with the images and the credentials the table below states, and end with the shared
 *     step that prints both containers' logs when the job failed. The action pulls with the
 *     routine, and runs each container with its port, `--pull never`, the password from its
 *     environment and its health check.
 *   - Both Trivy steps run the action at a full commit with its version in a trailing comment,
 *     name the Trivy version and turn the action's own cache off. They read the scanner's database
 *     from a directory the job's environment names, restored before either step runs, saved by
 *     `main` alone and restored read-only on every other ref.
 *   - The SARIF is handed over by a step that never gates, downloaded under the name it was
 *     handed over with and uploaded under the category of the scan job's analysis, by a job no
 *     ruleset requires that runs whatever the scan's verdict was. That job holds
 *     `security-events: write` and nothing else; the scan job holds `contents: read` and
 *     `packages: write`.
 *   - The platform start pulls, before it starts, the two images Compose names.
 *   - The fallback job runs the routine with a mirror that cannot answer, then with no source
 *     that can.
 *   - Every script these files add starts with `set -euo pipefail`.
 *
 *   The files are read when the suite runs, by the reader of `workflowYaml.test-helpers.ts`; the
 *   required contexts come from `.github/rulesets/main.json`.
 * @layer infrastructure
 */
import { readFileSync, readdirSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { findMonorepoRoot } from "@packages/vitest-shared";
import { beforeEach, describe, expect, it } from "vitest";
import {
  collectionOf,
  readMapping,
  readSequence,
  scalarOf,
  type Mapping,
} from "./workflowYaml.test-helpers.js";

const REPO_ROOT = findMonorepoRoot(path.dirname(fileURLToPath(import.meta.url)));

const CI = ".github/workflows/ci.yml";
const PRODUCTION_CI = ".github/workflows/production-ci.yml";
const CHAOS = ".github/workflows/chaos.yml";
const NIGHTLY = ".github/workflows/nightly.yml";
const PERFORMANCE = ".github/workflows/performance.yml";
const SECURITY_TESTING = ".github/workflows/security-testing.yml";
/** The workflows whose jobs start a Postgres and a Redis for their steps. */
const WORKFLOWS = [CI, PRODUCTION_CI, CHAOS, NIGHTLY, PERFORMANCE, SECURITY_TESTING];

const START_SERVICES = "./.github/actions/start-service-containers";
const SERVICE_LOGS = "./.github/actions/service-container-logs";
const PULL_IMAGE = "scripts/ci/pull-image.mjs";
const SCAN_JOB = "container-security";
const FALLBACK_JOB = "image-pull-fallback";
const MAIN_ONLY = "github.ref == 'refs/heads/main'";
const NOT_MAIN = "github.ref != 'refs/heads/main'";
const STRICT_SHELL = "set -euo pipefail";
/** The condition of every step that reads the built image without deciding the job. */
const AFTER_THE_BUILD = "${{ !cancelled() && steps.build.outcome == 'success' }}";
/** The job's environment entry that names the database's directory, and its value. */
const SCANNER_DB_DIR = "SCANNER_DB_DIR";
const SCANNER_DB_DIR_VALUE = "${{ github.workspace }}/.cache/trivy";

/** The Dockerfile frontend, named by an exact version and the digest of its image index. */
const PINNED_FRONTEND = /^# syntax=docker\/dockerfile:\d+\.\d+\.\d+@sha256:[0-9a-f]{64}$/;
/** The Trivy action at a full commit, with the release it is in as the trailing comment. */
const PINNED_TRIVY_ACTION = /^aquasecurity\/trivy-action@[0-9a-f]{40} # v\d+\.\d+\.\d+$/;

/** What one job hands the shared action: the images and the Postgres credentials. */
interface ServiceInputs {
  readonly "postgres-image": string;
  readonly "postgres-db": string;
  readonly "postgres-user": string;
  readonly "postgres-password": string;
  readonly "redis-image": string;
}

/** A job that runs a Postgres and a Redis, and what it hands the shared action. */
interface ServiceJob {
  readonly workflow: string;
  readonly job: string;
  readonly inputs: ServiceInputs;
}

/** One container the shared action runs, as its `docker run` names it. */
interface ContainerRun {
  readonly name: string;
  readonly env: readonly string[];
  readonly port: number;
  readonly health: string;
  readonly imageVariable: string;
}

/** The inputs most of the jobs pass: pgvector, for the `vector` extension the migrations create. */
const makeInputs = (overrides: Partial<ServiceInputs> = {}): ServiceInputs => ({
  "postgres-image": "pgvector/pgvector:pg16",
  "postgres-db": "omnipostdb",
  "postgres-user": "postgres",
  "postgres-password": "password123",
  "redis-image": "redis:7-alpine",
  ...overrides,
});

const makeServiceJob = (
  workflow: string,
  job: string,
  overrides: Partial<ServiceInputs> = {}
): ServiceJob => ({ workflow, job, inputs: makeInputs(overrides) });

/** Every job that runs a Postgres and a Redis, with the images and credentials it passes. */
const SERVICE_JOBS: readonly ServiceJob[] = [
  makeServiceJob(PRODUCTION_CI, "test-and-build", {
    "postgres-image": "postgres:16-alpine",
    "postgres-db": "test_db",
    "postgres-user": "test_user",
    "postgres-password": "test_pass",
  }),
  makeServiceJob(CI, "test"),
  makeServiceJob(CI, "test-integration"),
  makeServiceJob(CHAOS, "chaos"),
  makeServiceJob(NIGHTLY, "full-suite"),
  makeServiceJob(NIGHTLY, "integration-randomized"),
  makeServiceJob(PERFORMANCE, "k6-load"),
  makeServiceJob(SECURITY_TESTING, "dast-owasp-zap", {
    "postgres-db": "omnipost_dast",
    "postgres-password": "postgres",
  }),
];

/** The health timing both containers share: a check every 10 s, 5 s each, 5 failures allowed. */
const HEALTH_TIMING = "--health-interval 10s --health-timeout 5s --health-retries 5";

const makeContainerRun = (overrides: Partial<ContainerRun> = {}): ContainerRun => ({
  name: "postgres",
  env: ["POSTGRES_DB", "POSTGRES_USER", "POSTGRES_PASSWORD"],
  port: 5432,
  health: "pg_isready",
  imageVariable: "POSTGRES_IMAGE",
  ...overrides,
});

const CONTAINER_RUNS: readonly ContainerRun[] = [
  makeContainerRun(),
  makeContainerRun({
    name: "redis",
    env: [],
    port: 6379,
    health: '"redis-cli ping"',
    imageVariable: "REDIS_IMAGE",
  }),
];

/** The one command that runs a container: its own name, environment, port and health check. */
const dockerRunOf = (run: ContainerRun): string =>
  [
    "docker run --detach --pull never",
    `--name ${run.name}`,
    ...run.env.map((variable) => `--env ${variable}`),
    `--publish ${String(run.port)}:${String(run.port)}`,
    `--health-cmd ${run.health}`,
    HEALTH_TIMING,
    `"$${run.imageVariable}" > /dev/null`,
  ].join(" ");

const textOf = (file: string): string => readFileSync(path.join(REPO_ROOT, file), "utf8");

/** The top-level mapping of a YAML file of the repository. */
const fileMapping = (file: string): Mapping => readMapping(textOf(file).split("\n"), file);

/** The jobs of a workflow, by id. */
const jobsOf = (workflow: string): Mapping =>
  readMapping(collectionOf(fileMapping(workflow), "jobs"), `${workflow} > jobs`);

/** One job's own mapping. */
function jobOf(workflow: string, id: string): Mapping {
  const entry = jobsOf(workflow).get(id);
  if (entry === undefined) throw new Error(`${workflow}: no job "${id}"`);
  return readMapping(entry.body, entry.where);
}

/** Each entry of a block sequence of steps, as its mapping. */
const stepMappings = (lines: readonly string[], where: string): Mapping[] =>
  readSequence(lines, where).map((step, position) =>
    readMapping(step, `${where}[${String(position)}]`)
  );

/** A job's steps, each as its mapping. */
const stepsOf = (workflow: string, id: string): Mapping[] =>
  stepMappings(collectionOf(jobOf(workflow, id), "steps"), `${workflow} > jobs > ${id} > steps`);

/** A local composite action's steps, each as its mapping. */
function actionStepsOf(action: string): Mapping[] {
  const file = `${action.replace(/^\.\//, "")}/action.yml`;
  const runs = readMapping(collectionOf(fileMapping(file), "runs"), `${file} > runs`);
  return stepMappings(collectionOf(runs, "steps"), `${file} > runs > steps`);
}

/** A nested block mapping's keys and scalar values. */
function scalarsOf(mapping: Mapping, key: string): Record<string, string | undefined> {
  const nested = readMapping(collectionOf(mapping, key), key);
  return Object.fromEntries([...nested.keys()].map((name) => [name, scalarOf(nested, name)]));
}

/** The steps of a job whose `uses` starts with `prefix`. */
const stepsUsing = (steps: readonly Mapping[], prefix: string): Mapping[] =>
  steps.filter((step) => (scalarOf(step, "uses") ?? "").startsWith(prefix));

/**
 * @description The commands of a step's script: comments and blank lines dropped, and a line
 *   that ends in a backslash joined with the next by one space.
 * @param step - The step.
 * @returns One string per command, in order.
 */
function commandsOf(step: Mapping): string[] {
  const commands: string[] = [];
  let pending = "";
  for (const raw of (scalarOf(step, "run") ?? "").split("\n")) {
    const line = raw.trim();
    if (line === "" || line.startsWith("#")) continue;
    const joined = pending === "" ? line : `${pending} ${line}`;
    if (joined.endsWith("\\")) {
      pending = joined.slice(0, -1).trimEnd();
      continue;
    }
    commands.push(joined);
    pending = "";
  }
  return commands;
}

/** The commands of a step that call the pull routine. */
const routineCallsOf = (step: Mapping): string[] =>
  commandsOf(step).filter((command) => command.includes(PULL_IMAGE));

/** The contexts a job reports: its name, once per value of a one-key matrix. */
function contextsOf(job: Mapping): string[] {
  const name = scalarOf(job, "name") ?? "";
  if (!job.has("strategy")) return [name];
  const matrix = readMapping(
    collectionOf(readMapping(collectionOf(job, "strategy"), "strategy"), "matrix"),
    "matrix"
  );
  const [key, entry] =
    [...matrix.entries()].find(([field]) => field !== "include" && field !== "exclude") ?? [];
  if (key === undefined || entry === undefined) return [name];
  const values =
    /^\[(.*)\]$/
      .exec(entry.inline.trim())?.[1]
      ?.split(",")
      .map((value) => value.trim()) ?? [];
  const matrixExpression = new RegExp(`\\$\\{\\{\\s*matrix\\.${key}\\s*\\}\\}`);
  return values.map((value) =>
    matrixExpression.test(name) ? name.replace(matrixExpression, value) : `${name} (${value})`
  );
}

/** The contexts `.github/rulesets/main.json` requires to merge. */
function requiredContexts(): string[] {
  const ruleset = JSON.parse(textOf(".github/rulesets/main.json")) as {
    rules: { type: string; parameters?: { required_status_checks?: { context: string }[] } }[];
  };
  return ruleset.rules
    .filter((rule) => rule.type === "required_status_checks")
    .flatMap((rule) => rule.parameters?.required_status_checks ?? [])
    .map((check) => check.context);
}

/** The id of the one job of production-ci.yml that uploads to code scanning. */
function uploadJobId(): string {
  const uploading = [...jobsOf(PRODUCTION_CI).keys()].filter(
    (id) => stepsUsing(stepsOf(PRODUCTION_CI, id), "github/codeql-action/upload-sarif@").length > 0
  );
  expect(uploading).toHaveLength(1);
  return uploading[0] ?? "";
}

/** The steps of the scan job that write the SARIF and hand it over. */
function sarifSteps(): { sarif: Mapping; handOver: Mapping } {
  const steps = stepsOf(PRODUCTION_CI, SCAN_JOB);
  const sarif = stepsUsing(steps, "aquasecurity/trivy-action@").filter(
    (step) => scalarsOf(step, "with").format === "sarif"
  );
  const output = sarif[0] === undefined ? undefined : scalarsOf(sarif[0], "with").output;
  const handOver = stepsUsing(steps, "actions/upload-artifact@").filter(
    (step) => scalarsOf(step, "with").path === output
  );
  expect(sarif).toHaveLength(1);
  expect(handOver).toHaveLength(1);
  return { sarif: sarif[0] ?? new Map(), handOver: handOver[0] ?? new Map() };
}

let required: string[] = [];

beforeEach(() => {
  required = requiredContexts();
});

describe("the Dockerfile frontend", () => {
  it("is named on line 1 of every image's Dockerfile by an exact version and its digest, the same in all four", () => {
    const dockerfiles = readdirSync(path.join(REPO_ROOT, "apps"))
      .map((app) => `apps/${app}/Dockerfile`)
      .filter((file) => existsSync(path.join(REPO_ROOT, file)));
    const firstLines = dockerfiles.map((file) => ({ file, line: textOf(file).split("\n")[0] }));
    const pin = firstLines[0]?.line ?? "";

    expect(dockerfiles).toHaveLength(4);
    expect(pin).toMatch(PINNED_FRONTEND);
    expect(firstLines).toEqual(dockerfiles.map((file) => ({ file, line: pin })));
  });
});

describe("the service containers of the jobs", () => {
  it.each(WORKFLOWS)("are started by no services block in any job of %s", (workflow) => {
    const withServices = [...jobsOf(workflow).keys()].filter((id) =>
      jobOf(workflow, id).has("services")
    );

    expect(withServices).toEqual([]);
  });

  it.each(SERVICE_JOBS)(
    "are started in $workflow job $job by the shared action, with that job's images and credentials",
    ({ workflow, job, inputs }) => {
      const starts = stepsUsing(stepsOf(workflow, job), START_SERVICES);

      expect(starts.map((step) => scalarOf(step, "uses"))).toEqual([START_SERVICES]);
      expect(scalarsOf(starts[0] ?? new Map(), "with")).toEqual(inputs);
    }
  );

  it.each(SERVICE_JOBS)(
    "are followed in $workflow job $job, as its last step, by the shared step that prints their logs when the job failed",
    ({ workflow, job }) => {
      const last = stepsOf(workflow, job).at(-1) ?? new Map();

      expect(scalarOf(last, "uses")).toBe(SERVICE_LOGS);
      expect(scalarOf(last, "if")).toBe("failure()");
    }
  );
});

describe("the shared actions that start the containers and print their logs", () => {
  it("pull both images with the routine and run each container with its port, --pull never, the password from the environment and its health check", () => {
    const [pull, run] = actionStepsOf(START_SERVICES);
    const commands = [pull, run].flatMap((step) => (step === undefined ? [] : commandsOf(step)));

    expect(pull === undefined ? [] : commandsOf(pull)).toEqual([
      STRICT_SHELL,
      `node ${PULL_IMAGE} "$POSTGRES_IMAGE"`,
      `node ${PULL_IMAGE} "$REDIS_IMAGE"`,
    ]);
    expect(commands.filter((command) => /\bdocker (image )?pull\b/.test(command))).toEqual([]);
    expect(commands.filter((command) => command.startsWith("docker run "))).toEqual(
      CONTAINER_RUNS.map(dockerRunOf)
    );
    expect(scalarsOf(run ?? new Map(), "env").POSTGRES_PASSWORD).toBe(
      "${{ inputs.postgres-password }}"
    );
  });

  it("print the log of each container the start action runs", () => {
    const [print] = actionStepsOf(SERVICE_LOGS);
    const commands = print === undefined ? [] : commandsOf(print);
    const names = /^for name in (.+); do$/.exec(commands[1] ?? "")?.[1]?.split(" ");

    expect(names).toEqual(CONTAINER_RUNS.map((container) => container.name));
    expect(commands).toContain(
      'docker logs "$name" 2>&1 || echo "the $name container has no log: it was never started"'
    );
  });
});

describe("the Trivy steps of the image scan", () => {
  it("run the action at a full commit, name one Trivy version and turn the action's cache off", () => {
    const trivy = stepsUsing(stepsOf(PRODUCTION_CI, SCAN_JOB), "aquasecurity/trivy-action@");
    const inputs = trivy.map((step) => scalarsOf(step, "with"));
    const version = inputs[0]?.version;

    expect(trivy).toHaveLength(2);
    expect(trivy.map((step) => step.get("uses")?.inline)).toEqual([
      expect.stringMatching(PINNED_TRIVY_ACTION),
      expect.stringMatching(PINNED_TRIVY_ACTION),
    ]);
    expect(version).toMatch(/^v\d+\.\d+\.\d+$/);
    expect(inputs.map((input) => [input.version, input.cache])).toEqual([
      [version, "false"],
      [version, "false"],
    ]);
  });

  it("read a database that main alone saves and every other ref restores, at the directory both steps name", () => {
    const steps = stepsOf(PRODUCTION_CI, SCAN_JOB);
    const directories = stepsUsing(steps, "aquasecurity/trivy-action@").map(
      (step) => scalarsOf(step, "with")["cache-dir"]
    );
    const directory = directories[0] ?? "";
    const atDirectory = (prefix: string): Mapping[] =>
      stepsUsing(steps, prefix).filter((step) => scalarsOf(step, "with").path === directory);
    const saving = atDirectory("actions/cache@");
    const restoring = atDirectory("actions/cache/restore@");

    expect(directory).not.toBe("");
    expect(directories).toEqual([directory, directory]);
    expect(saving.map((step) => scalarOf(step, "if"))).toEqual([MAIN_ONLY]);
    expect(restoring.map((step) => scalarOf(step, "if"))).toEqual([NOT_MAIN]);
    expect(scalarsOf(restoring[0] ?? new Map(), "with")).toEqual(
      scalarsOf(saving[0] ?? new Map(), "with")
    );
  });

  it("read the database's directory from the job's environment, which no step's condition can leave empty", () => {
    const steps = stepsOf(PRODUCTION_CI, SCAN_JOB);
    const fromEnvironment = `\${{ env.${SCANNER_DB_DIR} }}`;

    expect(scalarsOf(jobOf(PRODUCTION_CI, SCAN_JOB), "env")[SCANNER_DB_DIR]).toBe(
      SCANNER_DB_DIR_VALUE
    );
    expect(
      stepsUsing(steps, "aquasecurity/trivy-action@").map(
        (step) => scalarsOf(step, "with")["cache-dir"]
      )
    ).toEqual([fromEnvironment, fromEnvironment]);
  });

  it("restore the database before either Trivy step runs", () => {
    const steps = stepsOf(PRODUCTION_CI, SCAN_JOB);
    const indexOf = (prefix: string): number[] =>
      steps.flatMap((step, index) =>
        (scalarOf(step, "uses") ?? "").startsWith(prefix) ? [index] : []
      );
    const caching = [...indexOf("actions/cache@"), ...indexOf("actions/cache/restore@")];
    const scanning = indexOf("aquasecurity/trivy-action@");

    expect(caching).toHaveLength(2);
    expect(scanning).toHaveLength(2);
    expect(Math.max(...caching)).toBeLessThan(Math.min(...scanning));
  });
});

describe("the upload of the scan's report", () => {
  it("hands the SARIF over in a step that never gates and runs whenever the SARIF step runs", () => {
    const { sarif, handOver } = sarifSteps();

    expect(scalarOf(sarif, "if")).toBe(AFTER_THE_BUILD);
    expect(scalarOf(sarif, "continue-on-error")).toBe("true");
    expect(scalarOf(handOver, "if")).toBe(AFTER_THE_BUILD);
    expect(scalarOf(handOver, "continue-on-error")).toBe("true");
  });

  it("downloads the report under the name the scan hands it over with and uploads it under the category of the scan job's analysis", () => {
    const { sarif, handOver } = sarifSteps();
    const steps = stepsOf(PRODUCTION_CI, uploadJobId());
    const download = stepsUsing(steps, "actions/download-artifact@");
    const upload = stepsUsing(steps, "github/codeql-action/upload-sarif@");
    const uploaded = scalarsOf(upload[0] ?? new Map(), "with");

    expect(download).toHaveLength(1);
    expect(scalarsOf(download[0] ?? new Map(), "with").name).toBe(scalarsOf(handOver, "with").name);
    expect(uploaded.sarif_file).toBe(scalarsOf(sarif, "with").output);
    expect(uploaded.category).toBe(
      `${PRODUCTION_CI}:${SCAN_JOB}/service:` + "${{ matrix.service }}"
    );
  });

  it("runs in a job no ruleset requires, after the scan and whatever its verdict, while the scan keeps its required contexts", () => {
    const upload = jobOf(PRODUCTION_CI, uploadJobId());
    const scanContexts = contextsOf(jobOf(PRODUCTION_CI, SCAN_JOB));

    expect(contextsOf(upload).filter((context) => required.includes(context))).toEqual([]);
    expect(scalarOf(upload, "needs")).toBe(SCAN_JOB);
    expect(scalarOf(upload, "if")).toBe(
      `\${{ !cancelled() && needs.${SCAN_JOB}.result != 'skipped' }}`
    );
    expect(scanContexts).toHaveLength(4);
    expect(scanContexts.filter((context) => !required.includes(context))).toEqual([]);
  });

  it("holds security-events: write and nothing else, a permission the scan job does not hold", () => {
    expect(scalarsOf(jobOf(PRODUCTION_CI, uploadJobId()), "permissions")).toEqual({
      "security-events": "write",
    });
    expect(scalarsOf(jobOf(PRODUCTION_CI, SCAN_JOB), "permissions")).toEqual({
      contents: "read",
      packages: "write",
    });
  });
});

describe("the platform start", () => {
  it("pulls the images Compose names for Postgres and Redis with the routine, before the start", () => {
    const compose = readMapping(
      collectionOf(fileMapping("docker-compose.yml"), "services"),
      "services"
    );
    const imageOf = (service: string): string | undefined => {
      const entry = compose.get(service);
      return entry === undefined
        ? undefined
        : scalarOf(readMapping(entry.body, entry.where), "image");
    };
    const steps = stepsOf(CI, "platform-start");
    const commands = steps.map((step) => scalarOf(step, "run") ?? "");
    const pullAt = commands.findIndex((command) => command.includes(PULL_IMAGE));
    const startAt = commands.findIndex((command) => /^pnpm start:platform\b/m.test(command));
    const pulled = [
      ...(commands[pullAt] ?? "").matchAll(/^node scripts\/ci\/pull-image\.mjs (\S+)$/gm),
    ].map((match) => match[1]);

    expect(pullAt).toBeGreaterThanOrEqual(0);
    expect(startAt).toBeGreaterThan(pullAt);
    expect(pulled).toEqual([imageOf("postgres"), imageOf("redis")]);
  });
});

describe("the fallback of the image pulls", () => {
  it("runs the routine with a mirror that cannot answer and requires Docker Hub, then with no source that can answer and requires the exit that names the image", () => {
    const steps = stepsOf(CI, FALLBACK_JOB).filter((step) => routineCallsOf(step).length > 0);
    const commands = steps.map(commandsOf);

    expect(steps.map(routineCallsOf)).toEqual([
      [`served="$(node ${PULL_IMAGE} --source mirror.invalid --source docker.io redis:7-alpine)"`],
      [
        `node ${PULL_IMAGE} --source mirror.invalid --source registry.invalid --attempts 1 ` +
          'redis:7-alpine 2> "$RUNNER_TEMP/unserved.txt" || status=$?',
      ],
    ]);
    expect(commands[0]).toContain(
      'if [ "$served" != "pull-image: redis:7-alpine served by docker.io" ]; then'
    );
    expect(commands[1]).toContain(
      'expected="pull-image: no source served redis:7-alpine after 1 attempt at each of ' +
        'mirror.invalid, registry.invalid"'
    );
    expect(commands[1]).toContain('if [ "$status" -ne 1 ] || [ "$last" != "$expected" ]; then');
  });
});

describe("the scripts of the image supply", () => {
  it("each start with set -euo pipefail", () => {
    const scripts = [
      ...actionStepsOf(START_SERVICES),
      ...actionStepsOf(SERVICE_LOGS),
      ...stepsOf(CI, FALLBACK_JOB),
      ...stepsOf(CI, "platform-start").filter((step) => routineCallsOf(step).length > 0),
      ...stepsOf(PRODUCTION_CI, SCAN_JOB).filter((step) => scalarOf(step, "id") === "trivy-db"),
    ].filter((step) => step.has("run"));

    expect(scripts).toHaveLength(7);
    expect(scripts.map((step) => commandsOf(step)[0])).toEqual(scripts.map(() => STRICT_SHELL));
  });
});
