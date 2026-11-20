/**
 * @file firstAdministratorCommandProcess.test.ts
 * @description Runs the first-administrator command as a process, the way its `create-first-admin`
 *   script runs it from a checkout (`node --conditions development --import tsx
 *   src/cli/createFirstAdministrator.ts` in `apps/api`), and pins what it does before it loads its
 *   composition: with no argument, with an unknown argument, with `--help`, and with a valid
 *   argument, in either mode, but a standard output that is a pipe and not a terminal, it ends
 *   with the right exit code and text and opens no connection.
 *
 *   The child's environment holds none of the API's secrets: only `PATH`, a `DATABASE_URL` that
 *   names the sensor below, and `PORT=not-a-port`, a value the API's env module refuses to boot
 *   with. A run that imported that module would therefore end with its validation error instead
 *   of the command's text, whatever env file the machine holds, since a variable the process sets
 *   wins over the file.
 *
 *   The database is a loopback socket this suite opens: it counts the connections it receives and
 *   closes each one at once. Each run has a time limit below its case's own, past which the runner
 *   ends it with SIGTERM and the case fails showing that it was killed; otherwise a case ends on
 *   the process's exit, never on a fixed time.
 * @layer infrastructure
 */

import { execFile } from "node:child_process";
import { createServer, type Server } from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import assert from "node:assert/strict";
import { afterEach, describe, it } from "vitest";
import { runFirstAdministratorCommand } from "../../../src/cli/firstAdministratorCommand.js";

const API_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const ENTRY = "src/cli/createFirstAdministrator.ts";

const USAGE =
  "Usage: create-first-admin --email <address> [--reissue]\nRun it with --help for what it does.\n";

const TERMINAL_REFUSAL =
  "This command prints a single-use password, so it runs only in an interactive terminal: its standard output is not a terminal, and the password would be kept wherever that output goes. Run it again with its output on a terminal.\n";

/** How long one run may take before the runner ends it; below the case's own limit. */
const RUN_LIMIT_MS = 45_000;

/** How long a case may take: one run's limit and the suite's own work around it. */
const CASE_TIMEOUT_MS = 60_000;

const execFileAsync = promisify(execFile);

interface CommandRun {
  readonly code: number;
  /** True when the runner ended the command: its time limit passed or its output overflowed. */
  readonly killed: boolean;
  readonly stdout: string;
  readonly stderr: string;
}

interface DatabaseSensor {
  readonly url: string;
  readonly connections: () => number;
}

const servers: Server[] = [];

/** A loopback socket standing where the database would be: it records and closes each connection. */
async function openDatabaseSensor(): Promise<DatabaseSensor> {
  let connections = 0;
  const server = createServer((socket) => {
    connections += 1;
    socket.destroy();
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("no port was bound");
  return {
    url: `postgresql://first-admin:unused@127.0.0.1:${String(address.port)}/first_admin`,
    connections: () => connections,
  };
}

/** Runs the command as its script does, with exactly the environment given, and resolves on exit. */
async function runCommand(args: readonly string[], databaseUrl: string): Promise<CommandRun> {
  const env = { PATH: process.env.PATH ?? "", DATABASE_URL: databaseUrl, PORT: "not-a-port" };
  try {
    const { stdout, stderr } = await execFileAsync(
      process.execPath,
      ["--conditions", "development", "--import", "tsx", ENTRY, ...args],
      { cwd: API_DIR, env, timeout: RUN_LIMIT_MS, killSignal: "SIGTERM" }
    );
    return { code: 0, killed: false, stdout, stderr };
  } catch (error: unknown) {
    const failure = error as {
      code?: number | string;
      killed?: boolean;
      stdout?: string;
      stderr?: string;
    };
    return {
      code: typeof failure.code === "number" ? failure.code : -1,
      killed: failure.killed === true,
      stdout: failure.stdout ?? "",
      stderr: failure.stderr ?? "",
    };
  }
}

/** The help text, as the command's function writes it. */
async function helpText(): Promise<string> {
  const chunks: string[] = [];
  await runFirstAdministratorCommand(
    ["--help"],
    { stdout: { write: (text: string) => chunks.push(text) }, stderr: { write: () => true } },
    () => Promise.reject(new Error("the help loads nothing"))
  );
  return chunks.join("");
}

describe("the first-administrator command as a process, before it loads its composition", () => {
  afterEach(async () => {
    await Promise.all(
      servers.splice(0).map((server) => new Promise((resolve) => server.close(resolve)))
    );
  });

  it(
    "refuses with exit code 2 and the usage, opening no connection, when given no argument",
    async () => {
      const database = await openDatabaseSensor();

      const run = await runCommand([], database.url);

      assert.deepStrictEqual(
        { ...run, connections: database.connections() },
        {
          code: 2,
          killed: false,
          stdout: "",
          stderr: `The e-mail of the administrator to create is required.\n${USAGE}`,
          connections: 0,
        }
      );
    },
    CASE_TIMEOUT_MS
  );

  it(
    "refuses with exit code 2 and the usage, opening no connection, when given an unknown argument",
    async () => {
      const database = await openDatabaseSensor();

      const run = await runCommand(["--name", "first.admin"], database.url);

      assert.deepStrictEqual(
        { ...run, connections: database.connections() },
        {
          code: 2,
          killed: false,
          stdout: "",
          stderr: `This command takes only --email <address>, --reissue and --help.\n${USAGE}`,
          connections: 0,
        }
      );
    },
    CASE_TIMEOUT_MS
  );

  it(
    "returns 0 with the help on standard output, opening no connection, when given --help",
    async () => {
      const database = await openDatabaseSensor();

      const run = await runCommand(["--help"], database.url);

      assert.deepStrictEqual(
        { ...run, connections: database.connections() },
        { code: 0, killed: false, stdout: await helpText(), stderr: "", connections: 0 }
      );
    },
    CASE_TIMEOUT_MS
  );

  it(
    "refuses with exit code 2, opening no connection, when standard output is a pipe and not a terminal",
    async () => {
      const database = await openDatabaseSensor();

      const run = await runCommand(["--email", "first.admin@example.com"], database.url);

      assert.deepStrictEqual(
        { ...run, connections: database.connections() },
        { code: 2, killed: false, stdout: "", stderr: TERMINAL_REFUSAL, connections: 0 }
      );
    },
    CASE_TIMEOUT_MS
  );

  it(
    "refuses a re-issue with exit code 2, opening no connection, when standard output is a pipe and not a terminal",
    async () => {
      const database = await openDatabaseSensor();

      const run = await runCommand(
        ["--reissue", "--email", "first.admin@example.com"],
        database.url
      );

      assert.deepStrictEqual(
        { ...run, connections: database.connections() },
        { code: 2, killed: false, stdout: "", stderr: TERMINAL_REFUSAL, connections: 0 }
      );
    },
    CASE_TIMEOUT_MS
  );
});
