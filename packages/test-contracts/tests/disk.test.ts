/**
 * @file disk.test.ts
 * @description Self-tests of the disk side of the reach engine: the test-shaped expression stays
 *              the one metric M1 counts with, the floor fails closed, the git listing reads this
 *              repository in full and drops what the working tree lost, and a directory outside
 *              any repository is a failure.
 * @layer infrastructure
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { devNull, tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  CANONICAL_TEST_SHAPED,
  DISK_FLOOR,
  inventoryFromFiles,
  isTestShaped,
  listTrackedFiles,
  type DiskFailure,
  type DiskInventory,
} from "../src/lib/disk.js";
import { metricsExpression, REPOSITORY_ROOT } from "./fixtures/metrics.js";

/**
 * Runs `action` with git confined to `root`, and restores the environment afterwards. Discovery
 * stops at the root's parent (`GIT_CEILING_DIRECTORIES`), the variables that point git at another
 * repository are unset, and no global or system config applies, so neither a repository around
 * `os.tmpdir()` nor the developer's hooks, signing or identity changes what git does. It works on
 * `process.env` because `listTrackedFiles` starts git without an `env` option, so git inherits it.
 */
function withConfinedGit<T>(root: string, action: () => T): T {
  try {
    vi.stubEnv("GIT_CEILING_DIRECTORIES", path.dirname(root));
    vi.stubEnv("GIT_CONFIG_GLOBAL", devNull);
    vi.stubEnv("GIT_CONFIG_NOSYSTEM", "1");
    for (const name of ["GIT_DIR", "GIT_WORK_TREE", "GIT_INDEX_FILE"]) vi.stubEnv(name, undefined);
    return action();
  } finally {
    vi.unstubAllEnvs();
  }
}

/**
 * Makes `repository` a git repository holding one committed test, `kept.test.ts`, and one test
 * that was committed and then deleted from the working tree without staging, `lost.test.ts`.
 */
function commitTwoTestsThenLoseOne(repository: string): void {
  const git = (...args: string[]): void => {
    execFileSync("git", args, { cwd: repository, stdio: "pipe" });
  };
  git("init", "--quiet");
  git("config", "user.name", "Reach Self-Test");
  git("config", "user.email", "reach-self-test@example.invalid");
  for (const file of ["kept.test.ts", "lost.test.ts"]) {
    writeFileSync(path.join(repository, file), "export {};\n");
  }
  git("add", "kept.test.ts", "lost.test.ts");
  git("commit", "--quiet", "--no-verify", "-m", "Plant two tracked tests");
  rmSync(path.join(repository, "lost.test.ts"));
}

describe("disk inventory", () => {
  it("uses the expression scripts/testing/metrics.mjs counts M1 with, pattern and flags", () => {
    const { source, flags } = CANONICAL_TEST_SHAPED;

    expect(metricsExpression("CANONICAL_TEST_SHAPED")).toEqual({ source, flags });
  });

  it.each([
    ["a.test.ts", true],
    ["a.spec.tsx", true],
    ["a.integration.test.ts", true],
    ["a.test.mjs", true],
    ["scenario.k6.js", true],
    ["a.test.ts.disabled", false],
    ["a.test-d.ts", false],
    ["vitest.config.ts", false],
  ])("classifies %s as test-shaped: %s", (file, expected) => {
    expect(isTestShaped(file)).toBe(expected);
  });

  it("returns a failure naming the count and the floor when the listing is below the floor", () => {
    const expected: DiskFailure = {
      message: `disk: 2 test-shaped tracked files, below the floor of ${String(DISK_FLOOR)}; the listing read less of the tree than it holds`,
    };

    const inventory = inventoryFromFiles(["a.test.ts", "b.ts", "c.spec.ts"]);

    expect(inventory).toEqual({ ok: false, error: expected });
  });

  it("returns the tracked files sorted and unique, with their test-shaped subset", () => {
    const expected: DiskInventory = { tracked: ["a.ts", "b.test.ts"], testShaped: ["b.test.ts"] };

    const inventory = inventoryFromFiles(["b.test.ts", "a.ts", "b.test.ts"], 1);

    expect(inventory).toEqual({ ok: true, value: expected });
  });

  it("returns at least the floor of test-shaped files when it lists this repository", () => {
    const listed = listTrackedFiles(REPOSITORY_ROOT);

    expect(listed.ok && inventoryFromFiles(listed.value).ok).toBe(true);
  });

  it("returns no file that git tracks but the working tree no longer holds", () => {
    const repository = mkdtempSync(path.join(tmpdir(), "test-contracts-"));
    try {
      const listed = withConfinedGit(repository, () => {
        commitTwoTestsThenLoseOne(repository);
        return listTrackedFiles(repository);
      });

      expect(listed).toEqual({ ok: true, value: ["kept.test.ts"] });
    } finally {
      rmSync(repository, { recursive: true, force: true });
    }
  });

  it("returns a failure naming git when the root is not a repository", () => {
    const outside = mkdtempSync(path.join(tmpdir(), "test-contracts-"));
    try {
      const listed = withConfinedGit(outside, () => listTrackedFiles(outside));

      expect(listed.ok ? "" : listed.error.message).toContain(`git ls-files failed in ${outside}`);
    } finally {
      rmSync(outside, { recursive: true, force: true });
    }
  });
});
