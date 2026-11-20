/**
 * @file processState.test.ts
 * @description Pins `hasProcessEnded` (`processState.ts`), the probe the suites that end processes
 *   use. It raises where there is no procfs, so a case that checks a process ended fails instead
 *   of passing on a probe that proved nothing; where procfs exists, a gone entry and a zombie or
 *   dead state are ended, and any other state is running; an entry that cannot be read for any
 *   other reason raises with the read's own error. Each case but the last builds a procfs of its
 *   own in a temporary directory, so the rule is held without a second platform; the last reads
 *   the real one for this process. The ESRCH arm has no case: only the kernel's procfs gives it,
 *   for a process that ends while its entry is read, and a procfs built in a directory cannot.
 * @layer infrastructure
 */
import { afterEach, describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { hasProcessEnded } from "./processState.js";

/** The pid every case's procfs describes. */
const PID = 4242;

/** The directories the cases made, removed after each. */
const directories: string[] = [];

afterEach(() => {
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

/** A directory of the case's own. */
function caseDirectory(): string {
  const directory = mkdtempSync(path.join(tmpdir(), "process-state-"));
  directories.push(directory);
  return directory;
}

/** A procfs of the case's own that holds this process's entry and, when given, `PID`'s `stat`. */
function procfsWith(stat?: string): string {
  const root = caseDirectory();
  mkdirSync(path.join(root, "self"));
  writeFileSync(path.join(root, "self", "stat"), "1 (vitest) S 0 1 1\n");
  if (stat !== undefined) {
    mkdirSync(path.join(root, String(PID)));
    writeFileSync(path.join(root, String(PID), "stat"), stat);
  }
  return root;
}

describe("hasProcessEnded", () => {
  it("raises, saying the suite needs procfs, where there is no procfs", () => {
    const root = path.join(caseDirectory(), "no-procfs");

    expect(() => hasProcessEnded(PID, root)).toThrow(
      `No procfs at ${root}: this suite needs procfs to tell whether a process has ended.`
    );
  });

  it("returns true when the process's entry is gone from a procfs", () => {
    expect(hasProcessEnded(PID, procfsWith())).toBe(true);
  });

  it.each(["Z", "X"])("returns true when the process's state is %s", (state) => {
    expect(hasProcessEnded(PID, procfsWith(`${PID} (sleep) ${state} 1 1 1\n`))).toBe(true);
  });

  it("returns false when the process runs, reading the state after the last parenthesis", () => {
    expect(hasProcessEnded(PID, procfsWith(`${PID} (a) Z (b) S 1 1 1\n`))).toBe(false);
  });

  it("raises the read's own error when the process's entry cannot be read", () => {
    const root = procfsWith();
    mkdirSync(path.join(root, String(PID), "stat"), { recursive: true });

    expect(() => hasProcessEnded(PID, root)).toThrow(/^EISDIR: /);
  });

  it("returns false for this process, read from the real procfs", () => {
    expect(hasProcessEnded(process.pid)).toBe(false);
  });
});
