/**
 * @file pullImage.test.ts
 * @description Pins `scripts/ci/pull-image.mjs`, the routine the CI jobs pull their Docker Hub
 *   images with: it tries each source in order, Google's mirror and then Docker Hub by default,
 *   each a bounded number of times with a growing pause between attempts, tags an image a mirror
 *   served under the reference the caller asked for, says which source served it, and exits 1
 *   naming the image when no source does.
 *
 *   Two kinds of case. A process case runs the routine as a process whose `PATH` holds only a
 *   stand-in for `docker`. The stand-in logs every call as one line, each argument in brackets, so
 *   the log shows the arguments exactly as the routine handed them over, and answers as the case
 *   plans it: a pull of a reference refused a given number of times or always, with two lines on
 *   its error stream, a pull that never answers, a tag that fails. These cases make one attempt
 *   per source, or succeed at the first, so the routine never pauses; the one bound a case must
 *   see fire is set to one second, the least the routine takes. An in-process case calls the
 *   routine's `main` with a `docker` and a pause of its own, so the pauses, the bound handed to
 *   each call and the defaults are read exactly and no case waits on a clock. Every process case
 *   runs in a directory of its own under the system's scratch location, outside the checkout,
 *   removed after it.
 * @layer infrastructure
 */
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { findMonorepoRoot } from "@packages/vitest-shared";
import { afterEach, beforeEach, describe, expect, it, type Mock, vi } from "vitest";

/** What one `docker` call returns to the routine, as `spawnSync` returns it. */
interface DockerResult {
  readonly status: number | null;
  readonly signal?: string | null;
  readonly stderr: string;
  readonly error?: Error & { code?: string };
}

/** The routine's seams: the `docker` call, the pause and its two output streams. */
interface Io {
  readonly docker: Mock<(args: readonly string[], timeoutMs: number) => DockerResult>;
  readonly wait: Mock<(ms: number) => Promise<void>>;
  readonly out: (line: string) => void;
  readonly err: (line: string) => void;
}

/** The module's surface; a literal import of an untyped `.mjs` would be an implicit any. */
interface RoutineModule {
  readonly main: (argv: readonly string[], io: Io) => Promise<number>;
}

const REPO_ROOT = findMonorepoRoot(path.dirname(fileURLToPath(import.meta.url)));
const SCRIPT = path.join(REPO_ROOT, "scripts/ci/pull-image.mjs");
const { main } = (await import(SCRIPT)) as RoutineModule;

const USAGE =
  "usage: node scripts/ci/pull-image.mjs [--source <registry>]... [--attempts <n>] " +
  "[--wait-seconds <s>] [--attempt-timeout-seconds <s>] <image>";

const MIRROR = "mirror.gcr.io";
const DOCKER_HUB = "docker.io";
/** An official image: Docker Hub keeps it under `library/`, which a mirror's path spells out. */
const OFFICIAL = "redis:7-alpine";
const OFFICIAL_AT_MIRROR = "mirror.gcr.io/library/redis:7-alpine";
/** An image of a namespace, whose path is the same at the mirror. */
const NAMESPACED = "pgvector/pgvector:pg16";
const NAMESPACED_AT_MIRROR = "mirror.gcr.io/pgvector/pgvector:pg16";
/** Hosts under `.invalid`, which never resolves (RFC 6761 §6.4), as the CI fallback run uses. */
const UNANSWERING = "mirror.invalid";
const SECOND_REGISTRY = "registry.example";

/** The defaults the routine states: 3 attempts, pauses of 5 s times the attempt, 90 s each. */
const DEFAULT_PAUSE_MS = 5_000;
const DEFAULT_BOUND_MS = 90_000;
/** Docker's limit on a repository path, `library/` of an official image counted. */
const NAME_LIMIT = 255;
const LIBRARY = "library/";

/**
 * The stand-in for `docker`. It appends the call to `$FAKE_DOCKER_LOG`, then: a `tag` fails with
 * `$FAKE_DOCKER_TAG_EXIT` when that is set; a `pull` of `$FAKE_DOCKER_HANG` never answers; a
 * `pull` of a reference that `$FAKE_DOCKER_REFUSE` lists as `<reference>=<n>` is refused on its
 * first n calls, and as `<reference>=always` on every call, with a progress line and then the
 * error on its error stream; any other pull succeeds.
 */
const DOCKER_STAND_IN = `#!/bin/sh
call=""
for argument; do call="$call[$argument]"; done
printf '%s\\n' "$call" >> "$FAKE_DOCKER_LOG"
case "$1" in
  tag)
    if [ -n "$FAKE_DOCKER_TAG_EXIT" ]; then
      printf 'Error response from daemon: no such image: %s\\n' "$2" >&2
      exit "$FAKE_DOCKER_TAG_EXIT"
    fi
    exit 0 ;;
  pull) ;;
  *) exit 64 ;;
esac
pulls=0
while IFS= read -r logged; do
  if [ "$logged" = "[pull][$2]" ]; then pulls=$((pulls + 1)); fi
done < "$FAKE_DOCKER_LOG"
if [ "$2" = "$FAKE_DOCKER_HANG" ]; then exec /bin/sleep 30; fi
for rule in $FAKE_DOCKER_REFUSE; do
  if [ "\${rule%=*}" = "$2" ]; then
    times="\${rule##*=}"
    if [ "$times" = always ] || [ "$pulls" -le "$times" ]; then
      printf 'pulling %s from the stand-in\\n' "$2" >&2
      printf 'Error response from daemon: refused pull %s of %s\\n' "$pulls" "$2" >&2
      exit 1
    fi
  fi
done
printf '%s: Pulling from stand-in\\n' "$2"
exit 0
`;

/** What the stand-in does beyond succeeding; an empty field plans nothing. */
interface DockerPlan {
  /** Space-separated `<reference>=<n>` or `<reference>=always` entries. */
  readonly refuse: string;
  /** The one reference whose pull never answers. */
  readonly hang: string;
  /** The exit code of every `tag`, when tags fail. */
  readonly tagExit: string;
}

interface Run {
  readonly code: number | null;
  readonly stdout: string;
  readonly stderr: string;
  /** The stand-in's calls, one line each; none when it was never run. */
  readonly calls: readonly string[];
}

/** What an in-process run printed and returned, with the seams it was given. */
interface InProcessRun {
  readonly code: number;
  readonly out: readonly string[];
  readonly err: readonly string[];
  readonly io: Io;
}

const makePlan = (overrides: Partial<DockerPlan> = {}): DockerPlan => ({
  refuse: "",
  hang: "",
  tagExit: "",
  ...overrides,
});

/** A `docker` call that succeeded. */
const makeServed = (): DockerResult => ({ status: 0, signal: null, stderr: "" });

/** A refused pull: a progress line, then the error, on the error stream. */
const makeRefused = (reference: string): DockerResult => ({
  status: 1,
  signal: null,
  stderr: `pulling ${reference}\nError response from daemon: refused ${reference}\n`,
});

/** A `docker` call a signal ended. */
const makeSignalled = (signal: string): DockerResult => ({ status: null, signal, stderr: "" });

/** The stand-in's line for one call. */
const called = (...args: string[]): string => args.map((arg) => `[${arg}]`).join("");

/** The reason a pull the stand-in refused gives, as the routine reports its last error line. */
const refused = (nth: number, reference: string): string =>
  `docker exited 1: Error response from daemon: refused pull ${String(nth)} of ${reference}`;

/** The reason a pull an in-process `docker` refused gives. */
const refusedInProcess = (reference: string): string =>
  `docker exited 1: Error response from daemon: refused ${reference}`;

/** One failed attempt's text, with what the routine does next when it does anything. */
const attemptText = (
  image: string,
  attempt: string,
  source: string,
  reason: string,
  next?: string
): string =>
  `${image}: attempt ${attempt} at ${source} failed: ${reason}${next === undefined ? "" : `; ${next}`}`;

/** One failed attempt's line, as the process prints it. */
const failedAttempt = (
  image: string,
  attempt: string,
  source: string,
  reason: string,
  next?: string
): string => `pull-image: ${attemptText(image, attempt, source, reason, next)}\n`;

const servedByMirror = (image: string, source: string, pulled: string): string =>
  `pull-image: ${image} served by ${source} as ${pulled}, tagged ${image}\n`;

/** An official image whose path at Docker Hub, `library/` counted, has `length` characters. */
const officialOfPathLength = (length: number): string => `${"a".repeat(length - LIBRARY.length)}:1`;

let scratch = "";

/**
 * Runs the routine as a process with the stand-in as the only `docker` on its `PATH`.
 *
 * @param args - The routine's arguments.
 * @param plan - What the stand-in does.
 * @returns Its exit code, both streams and the stand-in's calls.
 */
function runRoutine(args: readonly string[], plan: DockerPlan = makePlan()): Run {
  const bin = path.join(scratch, "bin");
  mkdirSync(bin, { recursive: true });
  writeFileSync(path.join(bin, "docker"), DOCKER_STAND_IN, { mode: 0o755 });
  const log = path.join(scratch, "docker.log");

  const result = spawnSync(process.execPath, [SCRIPT, ...args], {
    cwd: scratch,
    encoding: "utf8",
    env: {
      PATH: bin,
      FAKE_DOCKER_LOG: log,
      FAKE_DOCKER_REFUSE: plan.refuse,
      FAKE_DOCKER_HANG: plan.hang,
      FAKE_DOCKER_TAG_EXIT: plan.tagExit,
    },
  });
  let calls: string[] = [];
  try {
    calls = readFileSync(log, "utf8").trimEnd().split("\n");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  return { code: result.status, stdout: result.stdout, stderr: result.stderr, calls };
}

/**
 * Runs the routine's `main` in this process with a `docker` that returns `answers` in order, and
 * succeeds once they are spent, and a pause that returns at once.
 *
 * @param args - The routine's arguments.
 * @param answers - What the first `docker` calls return, in order.
 * @returns The exit code, the lines of each stream and the seams, for their calls.
 */
async function runInProcess(
  args: readonly string[],
  answers: readonly DockerResult[]
): Promise<InProcessRun> {
  const planned = [...answers];
  const out: string[] = [];
  const err: string[] = [];
  const io: Io = {
    docker: vi.fn(() => planned.shift() ?? makeServed()),
    wait: vi.fn(() => Promise.resolve()),
    out: (line) => out.push(line),
    err: (line) => err.push(line),
  };
  const code = await main(args, io);
  return { code, out, err, io };
}

beforeEach(() => {
  scratch = mkdtempSync(path.join(tmpdir(), "pull-image-"));
});

afterEach(() => {
  rmSync(scratch, { recursive: true, force: true });
});

describe("pull-image: the source that serves the image", () => {
  it.each([
    { image: OFFICIAL, atMirror: OFFICIAL_AT_MIRROR },
    { image: NAMESPACED, atMirror: NAMESPACED_AT_MIRROR },
  ])(
    "returns exit 0 and tags $image under the asked reference when the mirror serves it at $atMirror",
    ({ image, atMirror }) => {
      const run = runRoutine([image]);

      expect(run).toEqual({
        code: 0,
        stdout: servedByMirror(image, MIRROR, atMirror),
        stderr: "",
        calls: [called("pull", atMirror), called("tag", atMirror, image)],
      });
    }
  );

  it("returns exit 0 from Docker Hub, untagged, after the mirror's three attempts fail, pausing 5 s then 10 s and bounding each attempt at 90 s when the command line names neither", async () => {
    const run = await runInProcess(
      [OFFICIAL],
      [
        makeRefused(OFFICIAL_AT_MIRROR),
        makeRefused(OFFICIAL_AT_MIRROR),
        makeRefused(OFFICIAL_AT_MIRROR),
      ]
    );

    expect(run.code).toBe(0);
    expect(run.out).toEqual([`${OFFICIAL} served by ${DOCKER_HUB}`]);
    expect(run.err).toEqual([
      attemptText(
        OFFICIAL,
        "1 of 3",
        MIRROR,
        refusedInProcess(OFFICIAL_AT_MIRROR),
        "next attempt in 5 s"
      ),
      attemptText(
        OFFICIAL,
        "2 of 3",
        MIRROR,
        refusedInProcess(OFFICIAL_AT_MIRROR),
        "next attempt in 10 s"
      ),
      attemptText(
        OFFICIAL,
        "3 of 3",
        MIRROR,
        refusedInProcess(OFFICIAL_AT_MIRROR),
        `trying ${DOCKER_HUB}`
      ),
    ]);
    expect(run.io.wait.mock.calls).toEqual([[DEFAULT_PAUSE_MS], [2 * DEFAULT_PAUSE_MS]]);
    expect(run.io.docker.mock.calls).toEqual([
      [["pull", OFFICIAL_AT_MIRROR], DEFAULT_BOUND_MS],
      [["pull", OFFICIAL_AT_MIRROR], DEFAULT_BOUND_MS],
      [["pull", OFFICIAL_AT_MIRROR], DEFAULT_BOUND_MS],
      [["pull", OFFICIAL], DEFAULT_BOUND_MS],
    ]);
  });

  it("returns exit 0 from the mirror on its second attempt, after one pause of the wait the command line names, each call bounded as it names", async () => {
    const run = await runInProcess(
      ["--wait-seconds", "2", "--attempt-timeout-seconds", "30", OFFICIAL],
      [makeRefused(OFFICIAL_AT_MIRROR)]
    );

    expect(run.code).toBe(0);
    expect(run.out).toEqual([
      `${OFFICIAL} served by ${MIRROR} as ${OFFICIAL_AT_MIRROR}, tagged ${OFFICIAL}`,
    ]);
    expect(run.err).toEqual([
      attemptText(
        OFFICIAL,
        "1 of 3",
        MIRROR,
        refusedInProcess(OFFICIAL_AT_MIRROR),
        "next attempt in 2 s"
      ),
    ]);
    expect(run.io.wait.mock.calls).toEqual([[2_000]]);
    expect(run.io.docker.mock.calls).toEqual([
      [["pull", OFFICIAL_AT_MIRROR], 30_000],
      [["pull", OFFICIAL_AT_MIRROR], 30_000],
      [["tag", OFFICIAL_AT_MIRROR, OFFICIAL], 30_000],
    ]);
  });

  it("returns exit 1 naming the image after every attempt at every source fails, pausing within a source and never after its last attempt", async () => {
    const run = await runInProcess(
      [OFFICIAL],
      [
        makeRefused(OFFICIAL_AT_MIRROR),
        makeRefused(OFFICIAL_AT_MIRROR),
        makeRefused(OFFICIAL_AT_MIRROR),
        makeRefused(OFFICIAL),
        makeRefused(OFFICIAL),
        makeRefused(OFFICIAL),
      ]
    );

    expect(run.code).toBe(1);
    expect(run.out).toEqual([]);
    expect(run.err).toEqual([
      attemptText(
        OFFICIAL,
        "1 of 3",
        MIRROR,
        refusedInProcess(OFFICIAL_AT_MIRROR),
        "next attempt in 5 s"
      ),
      attemptText(
        OFFICIAL,
        "2 of 3",
        MIRROR,
        refusedInProcess(OFFICIAL_AT_MIRROR),
        "next attempt in 10 s"
      ),
      attemptText(
        OFFICIAL,
        "3 of 3",
        MIRROR,
        refusedInProcess(OFFICIAL_AT_MIRROR),
        `trying ${DOCKER_HUB}`
      ),
      attemptText(
        OFFICIAL,
        "1 of 3",
        DOCKER_HUB,
        refusedInProcess(OFFICIAL),
        "next attempt in 5 s"
      ),
      attemptText(
        OFFICIAL,
        "2 of 3",
        DOCKER_HUB,
        refusedInProcess(OFFICIAL),
        "next attempt in 10 s"
      ),
      attemptText(OFFICIAL, "3 of 3", DOCKER_HUB, refusedInProcess(OFFICIAL)),
      `no source served ${OFFICIAL} after 3 attempts at each of ${MIRROR}, ${DOCKER_HUB}`,
    ]);
    expect(run.io.wait.mock.calls).toEqual([
      [DEFAULT_PAUSE_MS],
      [2 * DEFAULT_PAUSE_MS],
      [DEFAULT_PAUSE_MS],
      [2 * DEFAULT_PAUSE_MS],
    ]);
    expect(run.io.docker).toHaveBeenCalledTimes(6);
  });

  it("counts an attempt a signal ended as failed and names the signal", async () => {
    const run = await runInProcess([OFFICIAL], [makeSignalled("SIGKILL")]);

    expect(run.code).toBe(0);
    expect(run.out).toEqual([
      `${OFFICIAL} served by ${MIRROR} as ${OFFICIAL_AT_MIRROR}, tagged ${OFFICIAL}`,
    ]);
    expect(run.err).toEqual([
      attemptText(
        OFFICIAL,
        "1 of 3",
        MIRROR,
        "docker ended by signal SIGKILL",
        "next attempt in 5 s"
      ),
    ]);
    expect(run.io.wait.mock.calls).toEqual([[DEFAULT_PAUSE_MS]]);
    expect(run.io.docker).toHaveBeenCalledTimes(3);
  });

  it("reports, for a refused pull, the last line docker wrote on its error stream", () => {
    const run = runRoutine(
      ["--attempts", "1", OFFICIAL],
      makePlan({ refuse: `${OFFICIAL_AT_MIRROR}=always` })
    );

    expect(run).toEqual({
      code: 0,
      stdout: `pull-image: ${OFFICIAL} served by ${DOCKER_HUB}\n`,
      stderr: failedAttempt(
        OFFICIAL,
        "1 of 1",
        MIRROR,
        refused(1, OFFICIAL_AT_MIRROR),
        `trying ${DOCKER_HUB}`
      ),
      calls: [called("pull", OFFICIAL_AT_MIRROR), called("pull", OFFICIAL)],
    });
  });

  it("returns exit 1 naming the image after the one attempt at each source the command line names fails", () => {
    const atUnanswering = `${UNANSWERING}/library/redis:7-alpine`;
    const atSecond = `${SECOND_REGISTRY}/library/redis:7-alpine`;

    const run = runRoutine(
      ["--source", UNANSWERING, "--source", SECOND_REGISTRY, "--attempts", "1", OFFICIAL],
      makePlan({ refuse: `${atUnanswering}=always ${atSecond}=always` })
    );

    expect(run).toEqual({
      code: 1,
      stdout: "",
      stderr:
        failedAttempt(
          OFFICIAL,
          "1 of 1",
          UNANSWERING,
          refused(1, atUnanswering),
          `trying ${SECOND_REGISTRY}`
        ) +
        failedAttempt(OFFICIAL, "1 of 1", SECOND_REGISTRY, refused(1, atSecond)) +
        `pull-image: no source served ${OFFICIAL} after 1 attempt at each of ${UNANSWERING}, ${SECOND_REGISTRY}\n`,
      calls: [called("pull", atUnanswering), called("pull", atSecond)],
    });
  });

  it("names the source that served the image when the sources and the attempts come from the command line", () => {
    const atUnanswering = `${UNANSWERING}/library/redis:7-alpine`;
    const atSecond = `${SECOND_REGISTRY}/library/redis:7-alpine`;

    const run = runRoutine(
      [
        "--source",
        UNANSWERING,
        "--source",
        SECOND_REGISTRY,
        "--source",
        DOCKER_HUB,
        "--attempts",
        "1",
        OFFICIAL,
      ],
      makePlan({ refuse: `${atUnanswering}=always` })
    );

    expect(run).toEqual({
      code: 0,
      stdout: servedByMirror(OFFICIAL, SECOND_REGISTRY, atSecond),
      stderr: failedAttempt(
        OFFICIAL,
        "1 of 1",
        UNANSWERING,
        refused(1, atUnanswering),
        `trying ${SECOND_REGISTRY}`
      ),
      calls: [
        called("pull", atUnanswering),
        called("pull", atSecond),
        called("tag", atSecond, OFFICIAL),
      ],
    });
  });

  it("ends an attempt that gives no answer within its bound and counts it as failed", () => {
    const run = runRoutine(
      ["--attempts", "1", "--attempt-timeout-seconds", "1", OFFICIAL],
      makePlan({ hang: OFFICIAL_AT_MIRROR })
    );

    expect(run).toEqual({
      code: 0,
      stdout: `pull-image: ${OFFICIAL} served by ${DOCKER_HUB}\n`,
      stderr: failedAttempt(
        OFFICIAL,
        "1 of 1",
        MIRROR,
        "docker gave no answer within 1 s",
        `trying ${DOCKER_HUB}`
      ),
      calls: [called("pull", OFFICIAL_AT_MIRROR), called("pull", OFFICIAL)],
    });
  });

  it("counts a pull from the mirror whose tag fails as a failed attempt", () => {
    const run = runRoutine(["--attempts", "1", OFFICIAL], makePlan({ tagExit: "1" }));

    expect(run).toEqual({
      code: 0,
      stdout: `pull-image: ${OFFICIAL} served by ${DOCKER_HUB}\n`,
      stderr: failedAttempt(
        OFFICIAL,
        "1 of 1",
        MIRROR,
        `pulled ${OFFICIAL_AT_MIRROR} but could not tag it ${OFFICIAL}: docker exited 1: ` +
          `Error response from daemon: no such image: ${OFFICIAL_AT_MIRROR}`,
        `trying ${DOCKER_HUB}`
      ),
      calls: [
        called("pull", OFFICIAL_AT_MIRROR),
        called("tag", OFFICIAL_AT_MIRROR, OFFICIAL),
        called("pull", OFFICIAL),
      ],
    });
  });

  it("pulls an image whose path at Docker Hub is exactly Docker's limit of 255 characters", () => {
    const image = officialOfPathLength(NAME_LIMIT);
    const atMirror = `${MIRROR}/${LIBRARY}${image}`;

    const run = runRoutine([image]);

    expect(run).toEqual({
      code: 0,
      stdout: servedByMirror(image, MIRROR, atMirror),
      stderr: "",
      calls: [called("pull", atMirror), called("tag", atMirror, image)],
    });
  });
});

describe("pull-image: the command line", () => {
  const tooLong = officialOfPathLength(NAME_LIMIT + 1);

  it.each([
    { name: "no image", args: [], problem: "give one image reference" },
    {
      name: "two images",
      args: [OFFICIAL, NAMESPACED],
      problem: "give one image reference, not 2",
    },
    {
      name: "an image of another registry",
      args: ["ghcr.io/org/app:1"],
      problem:
        '"ghcr.io/org/app:1" names the registry ghcr.io: the routine pulls Docker Hub images, ' +
        "the ones the mirror caches",
    },
    {
      name: "a reference a shell would read as two commands",
      args: ["redis:7;id"],
      problem: '"redis:7;id" is not a Docker Hub image reference (name[:tag])',
    },
    {
      name: "an image whose path at Docker Hub is one character over Docker's limit",
      args: [tooLong],
      problem: `"${tooLong}" names a repository path of 256 characters at Docker Hub, over Docker's limit of 255`,
    },
    {
      name: "a source that is not a registry host",
      args: ["--source", "https://mirror.gcr.io", OFFICIAL],
      problem: '"https://mirror.gcr.io" is not a registry host (host or host:port)',
    },
    {
      name: "no attempt",
      args: ["--attempts", "0", OFFICIAL],
      problem: '--attempts takes a whole number from 1, not "0"',
    },
    {
      name: "a fraction of an attempt",
      args: ["--attempts", "1.5", OFFICIAL],
      problem: '--attempts takes a whole number from 1, not "1.5"',
    },
    {
      name: "a wait that is not a number",
      args: ["--wait-seconds", "soon", OFFICIAL],
      problem: '--wait-seconds takes a whole number of seconds from 1, not "soon"',
    },
    {
      name: "a wait of zero",
      args: ["--wait-seconds", "0", OFFICIAL],
      problem: '--wait-seconds takes a whole number of seconds from 1, not "0"',
    },
    {
      name: "a wait with a fraction of a second",
      args: ["--wait-seconds", "2.5", OFFICIAL],
      problem: '--wait-seconds takes a whole number of seconds from 1, not "2.5"',
    },
    {
      name: "an attempt bound of zero",
      args: ["--attempt-timeout-seconds", "0", OFFICIAL],
      problem: '--attempt-timeout-seconds takes a whole number of seconds from 1, not "0"',
    },
    {
      name: "an attempt bound that rounds to no millisecond",
      args: ["--attempt-timeout-seconds", "0.0004", OFFICIAL],
      problem: '--attempt-timeout-seconds takes a whole number of seconds from 1, not "0.0004"',
    },
  ])("returns exit 2 with the usage and calls no docker when given $name", ({ args, problem }) => {
    const run = runRoutine(args);

    expect(run).toEqual({
      code: 2,
      stdout: "",
      stderr: `pull-image: ${problem}\n${USAGE}\n`,
      calls: [],
    });
  });

  it("returns exit 2 with the usage and calls no docker when given an option it does not take", () => {
    const run = runRoutine(["--retries", "3", OFFICIAL]);

    expect(run.code).toBe(2);
    expect(run.stdout).toBe("");
    expect(run.stderr).toMatch(/^pull-image: .*--retries.*\n/);
    expect(run.stderr.endsWith(`\n${USAGE}\n`)).toBe(true);
    expect(run.calls).toEqual([]);
  });
});
