/**
 * @file migratedScratchDatabase.test.ts
 * @description Unit tests for `runInOwnProcessGroup`, the way the integration helper
 *   `migratedScratchDatabase.ts` runs a migration: its outcome when the process ends by itself,
 *   when it never starts, and when it outlives its limit, in which case the process it started
 *   ends with it. The last case needs no real hang: the command starts a 30-second sleep and the
 *   limit is a fraction of a second.
 * @layer infrastructure
 */
import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { runInOwnProcessGroup } from "../../integration/helpers/migratedScratchDatabase.js";

/** The limit of the timeout case: far below the sleep the command starts. */
const LIMIT_MS = 300;

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

  it("ends the process and the one it started, and names the limit, when the process outlives it", async () => {
    const outcome = await runInOwnProcessGroup("sh", ["-c", "sleep 30 & echo $!; wait"], {
      cwd: tmpdir(),
      env: process.env,
      timeoutMs: LIMIT_MS,
    });

    const started = Number(outcome.stdout.trim());
    expect(outcome.status).toBeNull();
    expect(outcome.signal).toBe("SIGKILL");
    expect(outcome.error?.message).toBe(
      `sh outlived its limit of ${String(LIMIT_MS)} ms, so its process group was ended`
    );
    expect(Number.isInteger(started) && started > 1).toBe(true);
    expect(hasEnded(started)).toBe(true);
  });
});
