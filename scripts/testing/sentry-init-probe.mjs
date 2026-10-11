// @ts-check
/**
 * @file sentry-init-probe.mjs
 * @description Proves that Sentry initializes in a portal's production server, which no unit test
 *   can: the unit suites mock `@sentry/nextjs` and import the instrumentation files directly, so
 *   they stay green when the BUILD never wires those files in, which is exactly how DEF-86 hid.
 *
 *   It boots the portal's standalone server (`apps/<portal>/.next/standalone/apps/<portal>/server.js`,
 *   produced by `next build` with `output: "standalone"`) on a free loopback port, with a dummy DSN
 *   under the reserved `.invalid` domain so no event can leave the machine, waits for `/api/health`
 *   to answer 200 (Next awaits `register()` from `instrumentation.ts` before it serves a request),
 *   and then asks the server process for Sentry's state over the IPC channel. The question is
 *   answered inside the server by this same file, preloaded with `--import`: it reads Sentry's
 *   global carrier and `@sentry/core`'s `isInitialized()` and `getClient()`. Sentry keeps its state
 *   on `globalThis.__SENTRY__`, keyed by SDK version, so any `@sentry/core` copy of the server's
 *   version reads it; a copy of another version would read an empty slot, and that is refused.
 *
 *   Usage: `node scripts/testing/sentry-init-probe.mjs <admin|client>`. Prints one JSON line,
 *   `{portal, isInitialized, hasClient, hasDsn, enabled, sdkVersion}`, and exits 0 when all four
 *   flags are true, 1 when any is false, and 2 when it cannot measure: a usage error, no standalone
 *   build, a server that does not become ready, no answer from the server process, or a
 *   `@sentry/core` of another version than the one the server loaded. The server is stopped by its
 *   PID on every path, and once it has run, its last output lines follow on stderr whatever the
 *   verdict, so a run after a dependency bump can be read from the CI log.
 * @layer infrastructure
 */
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import http from "node:http";
import { createRequire } from "node:module";
import net from "node:net";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const SCRIPT = fileURLToPath(import.meta.url);
const ROOT = path.resolve(path.dirname(SCRIPT), "../..");
const PORTALS = ["admin", "client"];
/** A syntactically valid DSN on the reserved `.invalid` domain, which never resolves. */
const DUMMY_DSN = "https://public@o0.ingest.invalid/0";
/** A whole probe of a local admin build takes about 0.6 s; a minute absorbs a loaded CI runner. */
const READY_TIMEOUT_MS = 60_000;
/** Adds at most a quarter second to a ready server without flooding one that is still booting. */
const POLL_INTERVAL_MS = 250;
/**
 * One health request may take four polling intervals (1 s): a server that accepted the connection
 * but answers slowly is asked again rather than waited on until the whole deadline.
 */
const HEALTH_REQUEST_TIMEOUT_MS = POLL_INTERVAL_MS * 4;
/** The answer is an in-process read sent over IPC in milliseconds; silence past 5 s is no answer. */
const ANSWER_TIMEOUT_MS = 5_000;
/** The grace between SIGTERM and SIGKILL; a standalone Next server exits well within it. */
const STOP_TIMEOUT_MS = 5_000;
/** Enough for a stack trace or Next's boot lines, short enough to read in a CI log. */
const OUTPUT_TAIL_LINES = 40;
const QUESTION = "sentry-init-probe:state";
const CHILD_FLAG = "SENTRY_INIT_PROBE_CHILD";
const CHILD_PORTAL = "SENTRY_INIT_PROBE_PORTAL";
const USAGE = "usage: node scripts/testing/sentry-init-probe.mjs <admin|client>";

/**
 * @typedef {{ getDsn(): unknown, getOptions(): { enabled?: boolean } }} SentryClient
 * @typedef {{ SDK_VERSION: string, isInitialized(): boolean, getClient(): SentryClient | undefined }} SentryCore
 * @typedef {{ isInitialized: boolean, hasClient: boolean, hasDsn: boolean, enabled: boolean,
 *   sdkVersion: string | null }} SentryState
 * @typedef {{ state: SentryState } | { error: string }} Answer
 */

/**
 * @description The paths a `@sentry/core` copy is resolved from, in order: the standalone server's
 *   own tree first, then the portal's workspace, through `@sentry/nextjs` because pnpm does not
 *   expose `@sentry/core` to the app directly.
 * @param {string} serverJs - The standalone server entry the child runs.
 * @param {string} portal - The portal name.
 * @returns {Array<() => SentryCore>} Loaders, each throwing when its copy does not resolve.
 */
function coreLoaders(serverJs, portal) {
  const viaNextjs = (/** @type {string} */ from) => () => {
    const nextjs = createRequire(from).resolve("@sentry/nextjs/package.json");
    return /** @type {SentryCore} */ (createRequire(nextjs)("@sentry/core"));
  };
  return [
    () => /** @type {SentryCore} */ (createRequire(serverJs)("@sentry/core")),
    viaNextjs(serverJs),
    viaNextjs(path.join(ROOT, "apps", portal, "package.json")),
  ];
}

/**
 * @description Reads Sentry's state inside the server process. The global carrier is read before
 *   any `@sentry/core` is loaded here, so a server that never loaded Sentry reports so instead of
 *   the carrier this read would create.
 * @param {string} serverJs - The standalone server entry this process runs.
 * @param {string} portal - The portal name.
 * @returns {Answer} The state, or why it cannot be read.
 */
function readSentryState(serverJs, portal) {
  const holder = /** @type {{ __SENTRY__?: { version?: string } }} */ (
    /** @type {unknown} */ (globalThis)
  );
  const carrierVersion = holder.__SENTRY__?.version;
  if (carrierVersion === undefined) {
    return {
      state: {
        isInitialized: false,
        hasClient: false,
        hasDsn: false,
        enabled: false,
        sdkVersion: null,
      },
    };
  }
  for (const load of coreLoaders(serverJs, portal)) {
    /** @type {SentryCore} */
    let core;
    try {
      core = load();
    } catch {
      continue;
    }
    if (core.SDK_VERSION !== carrierVersion) {
      return {
        error: `the server loaded Sentry ${carrierVersion} but the readable @sentry/core is ${core.SDK_VERSION}; it would read an empty slot of the carrier`,
      };
    }
    const client = core.getClient();
    return {
      state: {
        isInitialized: core.isInitialized(),
        hasClient: client !== undefined,
        hasDsn: client !== undefined && Boolean(client.getDsn()),
        enabled: client !== undefined && client.getOptions().enabled !== false,
        sdkVersion: carrierVersion,
      },
    };
  }
  return {
    error: `the server loaded Sentry ${carrierVersion} but no @sentry/core resolves from its tree or the portal's`,
  };
}

/**
 * @description The preloaded half: answers the parent's question over IPC, inside the server.
 */
function answerFromInside() {
  const serverJs = path.resolve(process.argv[1] ?? "");
  const portal = process.env[CHILD_PORTAL] ?? "";
  process.on("message", (message) => {
    if (message !== QUESTION || process.send === undefined) return;
    process.send(readSentryState(serverJs, portal));
  });
}

/**
 * @description Finds a free loopback port by letting the OS assign one and releasing it.
 * @returns {Promise<number>} The port.
 */
function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address !== null ? address.port : 0;
      server.close(() => (port > 0 ? resolve(port) : reject(new Error("no port assigned"))));
    });
  });
}

/**
 * @description Requests `/api/health` once.
 * @param {number} port - The server's port.
 * @returns {Promise<number | null>} The status code, or null when nothing answered.
 */
function healthStatus(port) {
  return new Promise((resolve) => {
    const request = http.get(
      { host: "127.0.0.1", port, path: "/api/health", timeout: HEALTH_REQUEST_TIMEOUT_MS },
      (response) => {
        response.resume();
        resolve(response.statusCode ?? null);
      }
    );
    request.on("timeout", () => request.destroy());
    request.on("error", () => resolve(null));
  });
}

/**
 * @description Polls `/api/health` until it answers 200, the server exits or the time runs out.
 * @param {number} port - The server's port.
 * @param {() => boolean} exited - Whether the server process has exited.
 * @returns {Promise<string | null>} Null when ready, else why not.
 */
async function waitUntilReady(port, exited) {
  const deadline = Date.now() + READY_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (exited()) return "the server exited before it became ready";
    if ((await healthStatus(port)) === 200) return null;
    await new Promise((settle) => setTimeout(settle, POLL_INTERVAL_MS));
  }
  return `/api/health did not answer 200 within ${READY_TIMEOUT_MS} ms`;
}

/**
 * @description Whether an IPC message is this probe's answer rather than anything else the
 *   server might send.
 * @param {unknown} message - The message received.
 * @returns {message is Answer} True for a `{state}` or `{error}` object.
 */
function isAnswer(message) {
  return (
    typeof message === "object" && message !== null && ("state" in message || "error" in message)
  );
}

/**
 * @description Asks the server process for Sentry's state over IPC.
 * @param {import("node:child_process").ChildProcess} child - The server process.
 * @returns {Promise<Answer>} Its answer, or a timeout error.
 */
function ask(child) {
  return new Promise((resolve) => {
    /** @type {(message: unknown) => void} */
    const onMessage = (message) => {
      if (!isAnswer(message)) return;
      clearTimeout(timer);
      child.off("message", onMessage);
      resolve(message);
    };
    const timer = setTimeout(() => {
      child.off("message", onMessage);
      resolve({ error: `no answer from the server within ${ANSWER_TIMEOUT_MS} ms` });
    }, ANSWER_TIMEOUT_MS);
    child.on("message", onMessage);
    child.send(QUESTION);
  });
}

/**
 * @description Stops the server by its PID: SIGTERM, then SIGKILL if it outlives the grace period.
 * @param {import("node:child_process").ChildProcess} child - The server process.
 * @returns {Promise<void>} Resolves once the process has exited.
 */
async function stop(child) {
  const pid = child.pid;
  if (pid === undefined || child.exitCode !== null || child.signalCode !== null) return;
  const exited = new Promise((settle) => child.once("exit", settle));
  process.kill(pid, "SIGTERM");
  const timer = setTimeout(() => {
    if (child.exitCode === null && child.signalCode === null) process.kill(pid, "SIGKILL");
  }, STOP_TIMEOUT_MS);
  await exited;
  clearTimeout(timer);
}

/**
 * @description Keeps the last lines of a growing text, with one element to spare for the line
 *   still being written, so the kept text never grows past the tail it is read for.
 * @param {string} text - The text so far.
 * @param {number} count - How many complete lines to keep.
 * @returns {string} The text's last `count` lines, plus any unfinished one.
 */
function lastLines(text, count) {
  const lines = text.split("\n");
  return lines.length > count + 1 ? lines.slice(-(count + 1)).join("\n") : text;
}

/**
 * @description Writes the server's last output lines to stderr under a label, after the verdict,
 *   so a pass, a failure and a refusal can each be read against what the server printed. Writes
 *   nothing when the server printed nothing.
 * @param {string} tail - The kept tail of the server's stdout and stderr.
 */
function writeServerTail(tail) {
  const lines = tail.replace(/\s+$/, "").split("\n").slice(-OUTPUT_TAIL_LINES);
  if (lines.join("").trim() === "") return;
  process.stderr.write(
    `sentry-init-probe: server output, last ${lines.length} lines:\n${lines.join("\n")}\n`
  );
}

/**
 * @description Boots the portal's standalone server, asks it for Sentry's state and judges it.
 * @param {string[]} argv - The arguments after the script path.
 * @returns {Promise<0 | 1 | 2>} The exit code.
 */
export async function main(argv) {
  const [portal] = argv;
  if (argv.length !== 1 || portal === undefined || !PORTALS.includes(portal)) {
    process.stderr.write(`${USAGE}\n`);
    return 2;
  }
  const serverJs = path.join(
    ROOT,
    "apps",
    portal,
    ".next",
    "standalone",
    "apps",
    portal,
    "server.js"
  );
  if (!existsSync(serverJs)) {
    process.stderr.write(
      `sentry-init-probe: no standalone server at ${path.relative(ROOT, serverJs)}; build it first with \`pnpm --filter @apps/${portal} build\`.\n`
    );
    return 2;
  }
  const port = await freePort();
  // A minimal environment, so no DSN or secret of the calling shell reaches the server.
  const child = spawn(process.execPath, ["--import", pathToFileURL(SCRIPT).href, serverJs], {
    cwd: path.dirname(serverJs),
    env: {
      PATH: process.env.PATH ?? "",
      NODE_ENV: "production",
      NEXT_TELEMETRY_DISABLED: "1",
      HOSTNAME: "127.0.0.1",
      PORT: String(port),
      SENTRY_DSN: DUMMY_DSN,
      NEXT_PUBLIC_SENTRY_DSN: DUMMY_DSN,
      [CHILD_FLAG]: "1",
      [CHILD_PORTAL]: portal,
    },
    stdio: ["ignore", "pipe", "pipe", "ipc"],
  });
  // One text for both streams, so a line split across two chunks is kept whole.
  let tail = "";
  const keep = (/** @type {Buffer} */ chunk) => {
    tail = lastLines(tail + chunk.toString("utf8"), OUTPUT_TAIL_LINES);
  };
  child.stdout?.on("data", keep);
  child.stderr?.on("data", keep);
  let exited = false;
  child.once("exit", () => {
    exited = true;
  });
  try {
    const notReady = await waitUntilReady(port, () => exited);
    if (notReady !== null) {
      process.stderr.write(`sentry-init-probe: ${notReady}.\n`);
      return 2;
    }
    const answer = await ask(child);
    if ("error" in answer) {
      process.stderr.write(`sentry-init-probe: ${answer.error}.\n`);
      return 2;
    }
    const { state } = answer;
    process.stdout.write(`${JSON.stringify({ portal, ...state })}\n`);
    return state.isInitialized && state.hasClient && state.hasDsn && state.enabled ? 0 : 1;
  } finally {
    await stop(child);
    // On every exit once the server ran, after the verdict: a passing run after a dependency bump
    // is as worth reading in a CI log as a failing one.
    writeServerTail(tail);
  }
}

const invokedAsScript =
  process.argv[1] !== undefined &&
  pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;

if (invokedAsScript) {
  process.exitCode = await main(process.argv.slice(2));
} else if (process.env[CHILD_FLAG] === "1") {
  answerFromInside();
}
