/**
 * @file workspaceReporters.test.ts
 * @description Unit tests for `workspaceReporters`, the single place that decides which
 *              reporters a run installs. The selection used to live in one command-line flag
 *              inside one workflow step, so a shard printed a machine-readable blob and
 *              NOTHING a human could read: a failure named no file, no test and no diff. The
 *              tests below pin the three reporters (always readable, annotated under GitHub
 *              Actions, blob only when sharded), the fail-closed comparison against the exact
 *              string `"true"`, both signals read from `process.env` when no environment is
 *              injected, and the fresh-array guarantee that keeps one caller from mutating
 *              another's reporter list.
 * @layer infrastructure
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { workspaceReporters } from "../src/index.js";

describe("workspaceReporters", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  describe("the readable reporter is unconditional", () => {
    it("returns only the default reporter when neither signal is set", () => {
      expect(workspaceReporters({})).toEqual(["default"]);
    });
  });

  describe("the two conditional reporters", () => {
    it("adds the github-actions reporter when GITHUB_ACTIONS is exactly true", () => {
      expect(workspaceReporters({ GITHUB_ACTIONS: "true" })).toEqual(["default", "github-actions"]);
    });

    it("adds the blob reporter when VITEST_SHARDED is exactly true", () => {
      expect(workspaceReporters({ VITEST_SHARDED: "true" })).toEqual(["default", "blob"]);
    });

    it("adds both reporters, default first, when both signals are set", () => {
      const reporters = workspaceReporters({ GITHUB_ACTIONS: "true", VITEST_SHARDED: "true" });

      expect(reporters).toEqual(["default", "github-actions", "blob"]);
    });
  });

  describe("the comparison is fail-closed against the exact string", () => {
    // `"1"` and `"false"` are the two spellings a hand-written workflow reaches for first.
    // Neither is the string the runner sets, and treating either as truthy would install a
    // blob reporter in a run that writes no blob anybody reads.
    it("ignores a GITHUB_ACTIONS value that is not the string true", () => {
      expect(workspaceReporters({ GITHUB_ACTIONS: "1" })).toEqual(["default"]);
      expect(workspaceReporters({ GITHUB_ACTIONS: "false" })).toEqual(["default"]);
    });

    it("ignores a VITEST_SHARDED value that is not the string true", () => {
      expect(workspaceReporters({ VITEST_SHARDED: "1" })).toEqual(["default"]);
      expect(workspaceReporters({ VITEST_SHARDED: "false" })).toEqual(["default"]);
    });

    it("ignores an undefined value on either signal", () => {
      expect(workspaceReporters({ GITHUB_ACTIONS: undefined, VITEST_SHARDED: undefined })).toEqual([
        "default",
      ]);
    });
  });

  describe("no shared mutable state", () => {
    it("returns a new array on every call, so mutating one result never reaches a later call", () => {
      const first = workspaceReporters({});

      first.push("blob");
      const later = workspaceReporters({});

      expect(later).not.toBe(first);
      expect(later).toEqual(["default"]);
    });
  });

  describe("the default argument", () => {
    // Both signals are stubbed in each case, so the outcome is the same on a laptop and on a
    // GitHub Actions runner, where the ambient GITHUB_ACTIONS is already "true".
    it("reads both signals from process.env when no environment is injected", () => {
      vi.stubEnv("GITHUB_ACTIONS", "true");
      vi.stubEnv("VITEST_SHARDED", "true");

      expect(workspaceReporters()).toEqual(["default", "github-actions", "blob"]);
    });

    it("returns only the default reporter when process.env carries neither signal", () => {
      vi.stubEnv("GITHUB_ACTIONS", undefined);
      vi.stubEnv("VITEST_SHARDED", undefined);

      expect(workspaceReporters()).toEqual(["default"]);
    });
  });
});
