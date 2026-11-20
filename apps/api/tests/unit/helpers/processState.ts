/**
 * @file processState.ts
 * @description Whether a process has ended, read from procfs: the one probe the suites that end
 *   processes use to check that they did. The state the kernel reports decides, because an ended
 *   process its parent has not collected yet (a zombie) still answers a signal-0 probe as if it
 *   ran. A missing entry means the process is gone only where procfs exists; where it does not,
 *   the probe raises, saying the suite needs procfs, so a case never passes on a probe that
 *   proved nothing.
 * @layer infrastructure
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

/** Where the kernel's process filesystem is mounted: the only root outside this probe's tests. */
const PROC_ROOT = "/proc";

/**
 * @description Returns whether the process `pid` has ended: its entry is gone, or its state is
 *   zombie (`Z`) or dead (`X`). Raises when `procRoot` holds no procfs, which it tells from its own
 *   process's entry, `<procRoot>/self/stat`.
 * @param pid - The process to probe
 * @param procRoot - Where procfs is mounted; `/proc` unless a test of this probe names another
 * @returns True when the process has ended, false while it runs
 */
export function hasProcessEnded(pid: number, procRoot: string = PROC_ROOT): boolean {
  if (!existsSync(path.join(procRoot, "self", "stat"))) {
    throw new Error(
      `No procfs at ${procRoot}: this suite needs procfs to tell whether a process has ended.`
    );
  }
  let stat: string;
  try {
    stat = readFileSync(path.join(procRoot, String(pid), "stat"), "utf8");
  } catch (error: unknown) {
    // A process that ends while it is read can fail the read with ESRCH instead of ENOENT.
    const code = error instanceof Error && "code" in error ? error.code : undefined;
    if (code === "ENOENT" || code === "ESRCH") return true;
    throw error;
  }
  // The command name is in parentheses and may hold any character, so the state follows the last.
  const state = stat.slice(stat.lastIndexOf(")") + 2)[0];
  return state === "Z" || state === "X";
}
