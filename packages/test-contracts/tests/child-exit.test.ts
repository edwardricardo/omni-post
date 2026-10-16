/**
 * @file child-exit.test.ts
 * @description Self-tests of the one wording the collectors give a child process that did not
 *              exit 0: an exit code, the signal that stopped it, or neither. The last arm is
 *              tested here directly, because a real spawnSync result never reaches it: spawnSync
 *              reports no status and no signal only beside an `error`, which every collector
 *              reads first.
 * @layer infrastructure
 */
import { describe, expect, it } from "vitest";
import { describeExit } from "../src/lib/child-exit.js";

describe("child exit wording", () => {
  it.each([
    ["an exit code", { status: 2, signal: null }, "exited 2"],
    [
      "an exit code beside a signal, by its exit code",
      { status: 3, signal: "SIGTERM" },
      "exited 3",
    ],
    ["a signal and no exit code", { status: null, signal: "SIGKILL" }, "was stopped by SIGKILL"],
    [
      "neither an exit code nor a signal",
      { status: null, signal: null },
      "produced no exit status",
    ],
  ])("returns how a run ended for %s", (_label, run, expected) => {
    expect(describeExit(run)).toBe(expected);
  });
});
