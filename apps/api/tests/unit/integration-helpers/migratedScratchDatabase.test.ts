/**
 * @file migratedScratchDatabase.test.ts
 * @description Unit tests for `runInOwnProcessGroup`, the way the integration helper
 *   `migratedScratchDatabase.ts` runs a migration: its outcome when the process ends by itself,
 *   when it never starts, when it outlives its limit, in which case the process it started ends
 *   with it, and when its process group cannot be ended, in which case the outcome carries the
 *   reason instead of an error raised from the helper's timer.
 *
 *   The two cases that reach the limit hold it on fake timers (`setTimeout` and `clearTimeout`
 *   only), so the limit passes when the case advances the clock and never before: the case first
 *   waits for the started process to write its pid to a file of the case's own, with `vi.waitFor`,
 *   which waits in real time and moves the faked clock by its interval, far less than the limit.
 *   No case depends on how fast the machine runs the process.
 * @layer infrastructure
 */
import { afterEach, describe, it, expect, vi } from "vitest";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { runInOwnProcessGroup } from "../../integration/helpers/migratedScratchDatabase.js";

/** The limit of the cases that reach it: far past what the wait for a pid moves the clock. */
const LIMIT_MS = 60_000;

/** How long a case that waits for a pid may take, wait included. */
const CASE_TIMEOUT_MS = 30_000;

/** The directories the cases made, removed after each. */
const directories: string[] = [];

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

/**
 * Whether the process `pid` has ended: it no longer exists, or only its exit status is left for
 * a parent to collect (state `Z` or `X` in `/proc/<pid>/stat`).
 */
function hasEnded(pid: number): boolean {
  const stat = `/proc/${String(pid)}/stat`;
  if (!existsSync(stat)) return true;
  const line = readFileSync(stat, "utf8");
  const state = line.slice(line.lastIndexOf(")") + 2)[0];
  return state === "Z" || state === "X";
}

/** A path, in a directory of the case's own, for the started process to write a pid to. */
function pidFile(): string {
  const directory = mkdtempSync(path.join(tmpdir(), "process-group-"));
  directories.push(directory);
  return path.join(directory, "pid");
}

/** The pid written to `file`, once the process has written one above 1. */
async function writtenPid(file: string): Promise<number> {
  return vi.waitFor(
    () => {
      const pid = existsSync(file) ? Number(readFileSync(file, "utf8").trim()) : 0;
      if (!Number.isInteger(pid) || pid <= 1) throw new Error(`no pid in ${file} yet`);
      return pid;
    },
    { timeout: 20_000, interval: 20 }
  );
}

describe("runInOwnProcessGroup", () => {
  it("returns the exit code and both streams of a process that ends by itself, with no error", async () => {
    const outcome = await runInOwnProcessGroup("sh", ["-c", "echo out; echo err >&2; exit 3"], {
      cwd: tmpdir(),
      env: process.env,
      timeoutMs: 30_000,
    });

    expect(outcome).toEqual({ status: 3, signal: null, stdout: "out\n", stderr: "err\n" });
  });

  it("returns the spawn's error and no status when the command does not exist", async () => {
    const outcome = await runInOwnProcessGroup("f02-t6-no-such-command", [], {
      cwd: tmpdir(),
      env: process.env,
      timeoutMs: 30_000,
    });

    expect(outcome.status).toBeNull();
    expect(outcome.error).toMatchObject({ code: "ENOENT" });
  });

  it(
    "ends the process and the one it started, and names the limit, when the process outlives it",
    async () => {
      vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
      const file = pidFile();
      const running = runInOwnProcessGroup(
        "sh",
        ["-c", 'sleep 30 & echo $! > "$1"; wait', "sh", file],
        { cwd: tmpdir(), env: process.env, timeoutMs: LIMIT_MS }
      );
      const started = await writtenPid(file);

      vi.advanceTimersByTime(LIMIT_MS);
      const outcome = await running;

      expect(outcome.status).toBeNull();
      expect(outcome.signal).toBe("SIGKILL");
      expect(outcome.error?.message).toBe(
        `sh outlived its limit of ${String(LIMIT_MS)} ms, so its process group was ended`
      );
      expect(hasEnded(started)).toBe(true);
    },
    CASE_TIMEOUT_MS
  );

  it(
    "returns the limit and the refusal, raising nothing, when the process group cannot be ended",
    async () => {
      vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
      const file = pidFile();
      const running = runInOwnProcessGroup(
        "sh",
        ["-c", 'echo $$ > "$1"; exec sleep 30', "sh", file],
        {
          cwd: tmpdir(),
          env: process.env,
          timeoutMs: LIMIT_MS,
        }
      );
      const leader = await writtenPid(file);
      const realKill = process.kill.bind(process);
      const refusal = Object.assign(new Error("kill EPERM"), { code: "EPERM" });
      vi.spyOn(process, "kill").mockImplementation((pid: number, signal?: string | number) => {
        if (pid === -leader) throw refusal;
        return realKill(pid, signal);
      });

      try {
        vi.advanceTimersByTime(LIMIT_MS);
        const outcome = await running;

        expect({ status: outcome.status, signal: outcome.signal }).toEqual({
          status: null,
          signal: null,
        });
        expect(outcome.error?.message).toBe(
          `sh outlived its limit of ${String(LIMIT_MS)} ms, and its process group could not be ended: kill EPERM`
        );
        expect(outcome.error?.cause).toBe(refusal);
      } finally {
        vi.restoreAllMocks();
        // The refused signal left the group running; `writtenPid` returns only a pid above 1, so
        // this ends that group and never every process (-1) or this one's own (-0).
        realKill(-leader, "SIGKILL");
      }
    },
    CASE_TIMEOUT_MS
  );
});
