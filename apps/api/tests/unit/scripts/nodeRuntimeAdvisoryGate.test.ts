/**
 * @file nodeRuntimeAdvisoryGate.test.ts
 * @description Pins `scripts/testing/node-runtime-advisory-gate.mjs`, the gate the `Node Runtime
 *   Advisory` job runs on the Node version each image prints: it exits 1 when Node's release index
 *   lists a later stable release of the image's major line with `security: true`, 0 when none, 2 on a
 *   usage error, 3, never 0 and never 1, when the index cannot be read in full, and 4, never 1, when
 *   the gate itself fails.
 *
 *   HERMETIC: the rule is pinned through the pure `evaluate` on fixture indexes, and the reading of
 *   the index through `main` with an injected `fetch`, wait and per-attempt timeout, so no case
 *   reaches the network and none waits on a clock beyond the gate's own per-attempt bound, which
 *   the cases that need it to fire set to 1 ms. Two cases run the script as a process: the
 *   usage error, which reads no index, and a failure of the gate itself, made by a preload whose
 *   fetch rejects at once and whose timer throws, so it reaches no network and waits on no time;
 *   two cases read the four Dockerfiles, one so the remedy the verdict states cannot drift from the
 *   stages it names, and one so all four pin the same build digest and the same runtime digest,
 *   because a base re-pin reaches every image in one change (`docs/deployment/base-images.md`,
 *   "How to extend").
 * @layer infrastructure
 */
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { findMonorepoRoot } from "@packages/vitest-shared";
import { beforeEach, describe, expect, it, type Mock, vi } from "vitest";

type ImageVersion = { text: string; major: number; minor: number; patch: number };
type Outcome = { exitCode: number; lines: string[] };
type Run = { code: number; stdout: string; stderr: string };
type Io = { fetchImpl: typeof fetch; wait: (ms: number) => Promise<void>; timeoutMs: number };
type MockedIo = Io & { fetchImpl: Mock<typeof fetch> };
/** The module's surface; a literal import of an untyped `.mjs` would be an implicit any. */
type GateModule = {
  INDEX_URL: string;
  RETRY_DELAY_MS: number;
  DOCKERFILES: readonly string[];
  evaluate: (image: ImageVersion, index: unknown) => Outcome;
  main: (argv: readonly string[], io: Io) => Promise<Run>;
};
type Release = { version: unknown; date: unknown; security: unknown };

const REPO_ROOT = findMonorepoRoot(path.dirname(fileURLToPath(import.meta.url)));
const GATE_SCRIPT = path.join(REPO_ROOT, "scripts/testing/node-runtime-advisory-gate.mjs");
const { INDEX_URL, RETRY_DELAY_MS, DOCKERFILES, evaluate, main } = (await import(
  GATE_SCRIPT
)) as GateModule;

const GATE = "node-runtime-advisory-gate";
const USAGE = "usage: node scripts/testing/node-runtime-advisory-gate.mjs --version <vX.Y.Z>";
const BASE_IMAGES_DOC = "docs/deployment/base-images.md";
/** The build stage's `FROM`, which captures its digest. */
const BUILD_FROM = /^FROM node:\d+\.\d+\.\d+-bookworm-slim@sha256:([0-9a-f]{64}) /;
/** The runtime stage's `FROM`, which captures its digest. */
const RUNTIME_FROM = /^FROM gcr\.io\/distroless\/nodejs\d+-debian13@sha256:([0-9a-f]{64}) /;

/** The `FROM` lines of one Dockerfile of the repository the suite runs in. */
const fromLinesOf = (file: string): string[] =>
  readFileSync(path.join(REPO_ROOT, file), "utf8")
    .split("\n")
    .filter((line) => line.startsWith("FROM "));

const makeRelease = (version: unknown, overrides: Partial<Release> = {}): Release => ({
  version,
  date: "2026-11-01",
  security: false,
  ...overrides,
});

/** An image two security releases behind the newest of its line. */
const IMAGE_BEHIND: ImageVersion = { text: "v26.12.0", major: 26, minor: 12, patch: 0 };
/** An image past every security release of its line. */
const IMAGE_CURRENT: ImageVersion = { text: "v26.13.1", major: 26, minor: 13, patch: 1 };

/**
 * Two later security releases of the image's line, listed out of the order nodejs.org serves, so
 * the order of the verdict is the gate's own; beside them, a later release that is not a security
 * release, and a later security release of another line and of a pre-release.
 */
const INDEX_BEHIND: readonly Release[] = [
  makeRelease("v26.12.1", { date: "2026-10-21", security: true }),
  makeRelease("v27.0.0-alpha.0.1.1", { date: "2026-11-16", security: true }),
  makeRelease("v26.13.1", { date: "2026-11-10", security: true }),
  makeRelease("v26.13.0", { date: "2026-10-28" }),
  makeRelease("v26.12.0", { date: "2026-10-14" }),
  makeRelease("v25.9.0", { date: "2026-10-01", security: true }),
];

/**
 * The image's own release and an earlier one are security releases, and so are a later release of
 * another line and a later pre-release of its own; the one later stable release of its line is
 * not. Another line's entry carries a `security` that is not a boolean, which the gate never reads.
 */
const INDEX_CURRENT: readonly Release[] = [
  makeRelease("v27.1.0", { date: "2026-11-19", security: true }),
  makeRelease("v26.14.0-rc.1", { date: "2026-11-18", security: true }),
  makeRelease("v26.13.2", { date: "2026-11-17" }),
  makeRelease("v26.13.1", { date: "2026-11-10", security: true }),
  makeRelease("v26.12.1", { date: "2026-10-21", security: true }),
  makeRelease("v25.9.0", { date: "2026-10-01", security: "yes" }),
];

const VERDICT_BEHIND = [
  `v26.12.0 is older than 2 security releases of the v26 line in ${INDEX_URL}:`,
  "  v26.13.1 (2026-11-10)",
  "  v26.12.1 (2026-10-21)",
  "raise the Node base to v26.13.1 or later in both stages of apps/api/Dockerfile, " +
    "apps/workers/Dockerfile, apps/admin/Dockerfile, apps/client/Dockerfile: the build stage's " +
    "`FROM node:<version>-bookworm-slim@sha256:<digest>` and the runtime stage's " +
    "`FROM gcr.io/distroless/nodejs26-debian13@sha256:<digest>`, each at a digest that runs that " +
    `release (${BASE_IMAGES_DOC})`,
];

const PASS_CURRENT = `v26.13.1: the v26 line has 1 later release in ${INDEX_URL}, and none is a security release`;

/** The line an index that cannot be read leaves, for the image that was not judged. */
const notJudged = (image: ImageVersion, problem: string): string =>
  `could not read the release index, so ${image.text} was not judged: ${problem}`;

const answer = (body: unknown, status = 200): Response =>
  new Response(typeof body === "string" ? body : JSON.stringify(body), { status });

/** A 200 whose body fails before it ends, as a connection reset in the middle of the body does. */
const unreadableBody = (): Response =>
  new Response(
    new ReadableStream({
      start(controller) {
        controller.error(new TypeError("terminated"));
      },
    }),
    { status: 200 }
  );

/**
 * A 200 whose body sends its first byte and then nothing more until `signal` aborts, which errors
 * the body with the signal's reason, as Node's fetch errors the body of a request whose signal
 * aborts. With no signal the body fails at once, naming that, rather than never ending.
 */
const bodyUntilAborted = (signal: AbortSignal | null | undefined): Response =>
  new Response(
    new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode("["));
        if (signal === null || signal === undefined) {
          controller.error(new Error("the attempt carried no signal"));
          return;
        }
        signal.addEventListener("abort", () => controller.error(signal.reason), { once: true });
      },
    }),
    { status: 200 }
  );

const wait = vi.fn<(ms: number) => Promise<void>>();

/** An io whose `fetch` answers each attempt with the next of `answers`, and refuses any other. */
const ioAnswering = (...answers: (Response | Error)[]): MockedIo => {
  const fetchImpl = vi.fn<typeof fetch>(() =>
    Promise.reject(new Error("an unplanned fetch: the case planned no further answer"))
  );
  for (const next of answers) {
    if (next instanceof Error) fetchImpl.mockRejectedValueOnce(next);
    else fetchImpl.mockResolvedValueOnce(next);
  }
  return { fetchImpl, wait, timeoutMs: 1 };
};

beforeEach(() => {
  vi.clearAllMocks();
  wait.mockResolvedValue(undefined);
});

describe("evaluate: the rule over Node's release index", () => {
  it("returns exit 1 naming every later security release, newest first, and the remedy, when the image's line has later security releases", () => {
    const outcome = evaluate(IMAGE_BEHIND, INDEX_BEHIND);

    expect(outcome).toEqual({ exitCode: 1, lines: VERDICT_BEHIND });
  });

  it("returns exit 0 in one line when no later stable release of the image's line is a security release", () => {
    const outcome = evaluate(IMAGE_CURRENT, INDEX_CURRENT);

    expect(outcome).toEqual({ exitCode: 0, lines: [PASS_CURRENT] });
  });

  it("returns exit 3 when the index is JSON but not an array of releases", () => {
    const outcome = evaluate(IMAGE_CURRENT, { releases: INDEX_CURRENT });

    expect(outcome).toEqual({
      exitCode: 3,
      lines: [
        notJudged(IMAGE_CURRENT, `${INDEX_URL} answered JSON that is not an array of releases`),
      ],
    });
  });

  it.each([
    { name: "a version with no patch number", entry: makeRelease("v26.13"), shown: '"v26.13"' },
    {
      name: "a version with text after its patch number",
      entry: makeRelease("v26.13.2x"),
      shown: '"v26.13.2x"',
    },
    { name: "a version that is a number", entry: makeRelease(26), shown: "26" },
    {
      name: "an entry with no version",
      entry: { date: "2026-11-10", security: true },
      shown: "undefined",
    },
    { name: "an entry that is not an object", entry: "v26.13.1", shown: "undefined" },
  ])("returns exit 3 when an entry cannot be placed in a line: $name", ({ entry, shown }) => {
    const outcome = evaluate(IMAGE_CURRENT, [...INDEX_CURRENT, entry]);

    expect(outcome).toEqual({
      exitCode: 3,
      lines: [
        notJudged(
          IMAGE_CURRENT,
          `entry ${String(INDEX_CURRENT.length)} of the index has the version ${shown}, which reads ` +
            "as neither vX.Y.Z nor vX.Y.Z-<pre-release>, so its line is unknown and it may be of v26"
        ),
      ],
    });
  });

  it.each([
    { name: "a string", security: "true", shown: '"true"' },
    { name: "null", security: null, shown: "null" },
    { name: "absent", security: undefined, shown: "undefined" },
  ])(
    "returns exit 3 when a release of the image's line has a security flag that is $name",
    ({ security, shown }) => {
      const index = [makeRelease("v26.13.2", { security }), ...INDEX_CURRENT.slice(3)];

      expect(evaluate(IMAGE_CURRENT, index)).toEqual({
        exitCode: 3,
        lines: [
          notJudged(
            IMAGE_CURRENT,
            `v26.13.2 has the security flag ${shown}, not a boolean, so whether it is a security release is unknown`
          ),
        ],
      });
    }
  );

  it.each([
    { name: "written in words", date: "17 Nov 2026" },
    { name: "a full instant", date: "2026-11-17T00:00:00Z" },
  ])(
    "returns exit 3 when a release of the image's line has a date that is $name, not YYYY-MM-DD",
    ({ date }) => {
      const index = [makeRelease("v26.13.2", { date }), ...INDEX_CURRENT.slice(3)];

      expect(evaluate(IMAGE_CURRENT, index)).toEqual({
        exitCode: 3,
        lines: [notJudged(IMAGE_CURRENT, `v26.13.2 has the date "${date}", not YYYY-MM-DD`)],
      });
    }
  );

  it("returns exit 3 when the index lists the image's line but not the image's own version", () => {
    const image: ImageVersion = { text: "v26.13.9", major: 26, minor: 13, patch: 9 };

    expect(evaluate(image, INDEX_CURRENT)).toEqual({
      exitCode: 3,
      lines: [
        notJudged(
          image,
          "the index lists the v26 line but not v26.13.9, so v26.13.9 cannot be placed in it"
        ),
      ],
    });
  });

  it("returns exit 3 when the index lists no release of the image's major line", () => {
    const image: ImageVersion = { text: "v24.1.0", major: 24, minor: 1, patch: 0 };

    expect(evaluate(image, INDEX_CURRENT)).toEqual({
      exitCode: 3,
      lines: [notJudged(image, "the index lists no release of the v24 line")],
    });
  });
});

describe("main: reading the index and the command line", () => {
  it("returns exit 0 on stdout after fetching the index once, with a per-attempt signal, when the first answer is good", async () => {
    const io = ioAnswering(answer(INDEX_CURRENT));

    const run = await main(["--version", "v26.13.1"], io);

    expect(run).toEqual({ code: 0, stdout: `${GATE}: ${PASS_CURRENT}\n`, stderr: "" });
    expect(io.fetchImpl).toHaveBeenCalledTimes(1);
    expect(io.fetchImpl).toHaveBeenCalledWith(INDEX_URL, { signal: expect.any(AbortSignal) });
    expect(wait).not.toHaveBeenCalled();
  });

  it("returns exit 1 on stderr with every verdict line when the image is behind a security release", async () => {
    const io = ioAnswering(answer(INDEX_BEHIND));

    const run = await main(["--version", "v26.12.0"], io);

    expect(run).toEqual({
      code: 1,
      stdout: "",
      stderr: VERDICT_BEHIND.map((line) => `${GATE}: ${line}\n`).join(""),
    });
  });

  it("returns the verdict of the second answer, after one wait, when the first answer is not a success status", async () => {
    const io = ioAnswering(answer("Service Unavailable", 503), answer(INDEX_BEHIND));

    const run = await main(["--version", "v26.12.0"], io);

    expect(run.code).toBe(1);
    expect(run.stderr).toBe(VERDICT_BEHIND.map((line) => `${GATE}: ${line}\n`).join(""));
    expect(io.fetchImpl).toHaveBeenCalledTimes(2);
    expect(wait.mock.calls).toEqual([[RETRY_DELAY_MS]]);
  });

  it("returns exit 3 after exactly three attempts and two waits when every attempt fails", async () => {
    const failure = new TypeError("fetch failed");
    const io = ioAnswering(failure, answer("Bad Gateway", 502), failure);

    const run = await main(["--version", "v26.12.0"], io);

    expect(run).toEqual({
      code: 3,
      stdout: "",
      stderr:
        `${GATE}: ` +
        notJudged(
          IMAGE_BEHIND,
          `${INDEX_URL} did not answer after 3 attempts ` +
            "(attempt 1: fetch failed; attempt 2: HTTP 502; attempt 3: fetch failed)"
        ) +
        "\n",
    });
    expect(io.fetchImpl).toHaveBeenCalledTimes(3);
    expect(wait.mock.calls).toEqual([[RETRY_DELAY_MS], [2 * RETRY_DELAY_MS]]);
  });

  it("returns exit 3 after three attempts when every attempt hangs until its timeout aborts it", async () => {
    const fetchImpl = vi.fn<typeof fetch>(
      (_url, init) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(init.signal?.reason));
        })
    );

    const run = await main(["--version", "v26.12.0"], { fetchImpl, wait, timeoutMs: 1 });

    expect(run.code).toBe(3);
    expect(run.stdout).toBe("");
    expect(run.stderr).toMatch(
      /^node-runtime-advisory-gate: could not read the release index, so v26\.12\.0 was not judged: .* did not answer after 3 attempts \(attempt 1: .*timeout.*; attempt 2: .*timeout.*; attempt 3: .*timeout.*\)\n$/
    );
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it("returns the verdict of the second answer, after one wait, when the first 200's body cannot be read", async () => {
    const io = ioAnswering(unreadableBody(), answer(INDEX_BEHIND));

    const run = await main(["--version", "v26.12.0"], io);

    expect(run).toEqual({
      code: 1,
      stdout: "",
      stderr: VERDICT_BEHIND.map((line) => `${GATE}: ${line}\n`).join(""),
    });
    expect(io.fetchImpl).toHaveBeenCalledTimes(2);
    expect(wait.mock.calls).toEqual([[RETRY_DELAY_MS]]);
  });

  it("returns exit 3 after three attempts and two waits when no 200's body can be read", async () => {
    const io = ioAnswering(unreadableBody(), unreadableBody(), unreadableBody());

    const run = await main(["--version", "v26.12.0"], io);

    expect(run).toEqual({
      code: 3,
      stdout: "",
      stderr:
        `${GATE}: ` +
        notJudged(
          IMAGE_BEHIND,
          `${INDEX_URL} did not answer after 3 attempts ` +
            "(attempt 1: terminated; attempt 2: terminated; attempt 3: terminated)"
        ) +
        "\n",
    });
    expect(io.fetchImpl).toHaveBeenCalledTimes(3);
    expect(wait.mock.calls).toEqual([[RETRY_DELAY_MS], [2 * RETRY_DELAY_MS]]);
  });

  it("returns exit 3 after three attempts when each 200's body never ends, because each attempt's own bound aborts the read in the middle of the body", async () => {
    // Each answer arrives at once and its body ends only when that attempt's signal aborts, so the
    // order is fixed whatever the machine's speed: the response is in hand before the bound fires.
    const fetchImpl = vi.fn<typeof fetch>((_url, init) =>
      Promise.resolve(bodyUntilAborted(init?.signal))
    );

    const run = await main(["--version", "v26.12.0"], { fetchImpl, wait, timeoutMs: 1 });

    expect(run).toEqual({
      code: 3,
      stdout: "",
      stderr:
        `${GATE}: ` +
        notJudged(
          IMAGE_BEHIND,
          `${INDEX_URL} did not answer after 3 attempts (attempt 1: The operation was aborted ` +
            "due to timeout; attempt 2: The operation was aborted due to timeout; attempt 3: The " +
            "operation was aborted due to timeout)"
        ) +
        "\n",
    });
    expect(fetchImpl).toHaveBeenCalledTimes(3);
    expect(wait.mock.calls).toEqual([[RETRY_DELAY_MS], [2 * RETRY_DELAY_MS]]);
  });

  it("returns exit 3 without a second attempt when the body is not JSON", async () => {
    const io = ioAnswering(answer("<html>maintenance</html>"));

    const run = await main(["--version", "v26.12.0"], io);

    expect(run.code).toBe(3);
    expect(run.stdout).toBe("");
    expect(run.stderr).toMatch(
      /^node-runtime-advisory-gate: could not read the release index, so v26\.12\.0 was not judged: the body of https:\/\/nodejs\.org\/dist\/index\.json is not JSON: .+\n$/
    );
    expect(io.fetchImpl).toHaveBeenCalledTimes(1);
    expect(wait).not.toHaveBeenCalled();
  });

  it.each([
    {
      name: "no --version",
      argv: [],
      problem: "give --version <vX.Y.Z>, the line `node --version` prints",
    },
    {
      name: "a version without its v",
      argv: ["--version", "26.13.1"],
      problem: '"26.13.1" is not a version as `node --version` prints it (vX.Y.Z)',
    },
    {
      name: "a pre-release",
      argv: ["--version", "v27.0.0-alpha.0.1.1"],
      problem:
        '"v27.0.0-alpha.0.1.1" is a pre-release or nightly build: the gate judges stable releases ' +
        "only, the kind the images' Node bases ship",
    },
    {
      name: "a nightly build",
      argv: ["--version", "v27.0.0-nightly20261116a1b2c3d4e5"],
      problem:
        '"v27.0.0-nightly20261116a1b2c3d4e5" is a pre-release or nightly build: the gate judges ' +
        "stable releases only, the kind the images' Node bases ship",
    },
  ])(
    "returns exit 2 with the usage and fetches nothing when given $name",
    async ({ argv, problem }) => {
      const io = ioAnswering();

      const run = await main(argv, io);

      expect(run).toEqual({ code: 2, stdout: "", stderr: `${GATE}: ${problem}\n${USAGE}\n` });
      expect(io.fetchImpl).not.toHaveBeenCalled();
    }
  );

  it("returns exit 2 with the usage and fetches nothing when --version has no value", async () => {
    const io = ioAnswering();

    const run = await main(["--version"], io);

    expect(run.code).toBe(2);
    expect(run.stdout).toBe("");
    expect(run.stderr).toMatch(/^node-runtime-advisory-gate: .*--version.*\n/);
    expect(run.stderr.endsWith(`\n${USAGE}\n`)).toBe(true);
    expect(io.fetchImpl).not.toHaveBeenCalled();
  });

  it("exits 2 with the usage on stderr when run as a process with no arguments", () => {
    const result = spawnSync(process.execPath, [GATE_SCRIPT], { cwd: REPO_ROOT, encoding: "utf8" });

    expect(result.status).toBe(2);
    expect(result.stdout).toBe("");
    expect(result.stderr).toBe(
      `${GATE}: give --version <vX.Y.Z>, the line \`node --version\` prints\n${USAGE}\n`
    );
  });

  it("exits 4 on stderr, naming the failure and carrying its trace, when the gate itself fails while run as a process", () => {
    // The preload rejects every fetch and throws from every timer, so the wait between two
    // attempts fails where the gate handles nothing, while the gate's own code is as shipped.
    const preload = `data:text/javascript,${encodeURIComponent(
      'globalThis.fetch = () => Promise.reject(new Error("no network"));' +
        'globalThis.setTimeout = () => { throw new Error("no timer"); };'
    )}`;

    const result = spawnSync(
      process.execPath,
      ["--import", preload, GATE_SCRIPT, "--version", "v26.12.0"],
      { cwd: REPO_ROOT, encoding: "utf8" }
    );

    expect(result.status).toBe(4);
    expect(result.stdout).toBe("");
    const lines = result.stderr.split("\n");
    expect(lines[0]).toBe(`${GATE}: the gate itself failed, so nothing was judged: no timer`);
    expect(lines.slice(1, -1).length).toBeGreaterThan(0);
    expect(lines.slice(1, -1).every((line) => line.startsWith(`${GATE}:     at `))).toBe(true);
    expect(lines.at(-1)).toBe("");
  });
});

describe("the remedy the verdict states", () => {
  it("names every image's Dockerfile, each of which pins Node in exactly the two stages the remedy names", () => {
    const images = readdirSync(path.join(REPO_ROOT, "apps"))
      .map((app) => `apps/${app}/Dockerfile`)
      .filter((file) => existsSync(path.join(REPO_ROOT, file)));
    const stages = DOCKERFILES.map((file) => {
      const froms = readFileSync(path.join(REPO_ROOT, file), "utf8")
        .split("\n")
        .filter((line) => line.startsWith("FROM "));
      return {
        file,
        build: froms.filter((line) =>
          /^FROM node:\d+\.\d+\.\d+-bookworm-slim@sha256:[0-9a-f]{64} /.test(line)
        ).length,
        runtime: froms.filter((line) =>
          /^FROM gcr\.io\/distroless\/nodejs\d+-debian13@sha256:[0-9a-f]{64} /.test(line)
        ).length,
      };
    });

    expect([...DOCKERFILES].sort()).toEqual(images.sort());
    expect(stages).toEqual(DOCKERFILES.map((file) => ({ file, build: 1, runtime: 1 })));
    expect(existsSync(path.join(REPO_ROOT, BASE_IMAGES_DOC))).toBe(true);
  });

  it("finds one build digest and one runtime digest across every image's Dockerfile, so a re-pin that leaves one image on the earlier base fails", () => {
    const pins = DOCKERFILES.map((file) => {
      const froms = fromLinesOf(file);
      const digestOf = (stage: RegExp): string | undefined =>
        froms.map((line) => stage.exec(line)?.[1]).find((digest) => digest !== undefined);
      return { file, build: digestOf(BUILD_FROM), runtime: digestOf(RUNTIME_FROM) };
    });
    const build = pins[0]?.build;
    const runtime = pins[0]?.runtime;

    expect(build).toMatch(/^[0-9a-f]{64}$/);
    expect(runtime).toMatch(/^[0-9a-f]{64}$/);
    expect(pins).toEqual(DOCKERFILES.map((file) => ({ file, build, runtime })));
  });
});
