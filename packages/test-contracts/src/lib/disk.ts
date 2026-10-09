/**
 * @file disk.ts
 * @description The disk side of the reach engine: every tracked file, and the subset that is
 *              test-shaped. "Tracked" means listed by `git ls-files` AND present in the working
 *              tree, so a file deleted but not yet staged is not counted as a test nobody runs.
 *              The listing fails closed below {@link DISK_FLOOR} test-shaped files: a short count
 *              means the engine read less of the tree than it holds, and every rule downstream
 *              would then pass over files it never saw.
 * @layer infrastructure
 */
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { err, ok, type Result } from "@shared/types";
import { describeError } from "./registry.js";

/**
 * A basename that names a test by convention, `.k6.js` being a tier of its own. It is the same
 * expression as `CANONICAL_TEST_SHAPED` in `scripts/testing/metrics.mjs`, which defines metric
 * M1, and a self-test holds the two byte-equal: that script runs on import, so it cannot be
 * imported here. Anchored at the end, so a `.disabled` or `.old` tail is not test-shaped.
 */
export const CANONICAL_TEST_SHAPED = /(\.(test|spec)\.[cm]?[jt]sx?|\.k6\.js)$/;

/**
 * The fewest test-shaped tracked files a listing of this repository may hold. The tree holds
 * about a thousand; a listing below this read the wrong directory or a partial index.
 */
export const DISK_FLOOR = 800;

/** The tracked files of a tree, and the test-shaped subset. */
export interface DiskInventory {
  /** Every tracked file that exists, repository-relative, sorted and unique. */
  readonly tracked: readonly string[];
  /** The tracked files whose name is test-shaped, sorted. */
  readonly testShaped: readonly string[];
}

/** Why a disk listing could not be trusted. */
export interface DiskFailure {
  readonly message: string;
}

/**
 * @param file - A repository-relative path.
 * @returns Whether its name is test-shaped.
 */
export function isTestShaped(file: string): boolean {
  return CANONICAL_TEST_SHAPED.test(file);
}

/**
 * Lists the files git tracks under a repository root that exist in the working tree.
 *
 * @param root - Absolute repository root.
 * @returns The repository-relative paths, or the failure of `git ls-files`.
 */
export function listTrackedFiles(root: string): Result<string[], DiskFailure> {
  let listing: string;
  try {
    listing = execFileSync("git", ["ls-files", "-z"], {
      cwd: root,
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
      // Piped, not inherited, so git's own message lands in the failure instead of the console.
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (error: unknown) {
    return err({ message: `git ls-files failed in ${root}: ${describeError(error)}` });
  }
  return ok(
    listing.split("\0").filter((file) => file.length > 0 && existsSync(path.join(root, file)))
  );
}

/**
 * Builds the inventory from a file list and holds it to the floor.
 *
 * @param files - Repository-relative paths, in any order, possibly repeated.
 * @param floor - The fewest test-shaped files the list may hold.
 * @returns The inventory, or a failure naming the count and the floor.
 */
export function inventoryFromFiles(
  files: readonly string[],
  floor: number = DISK_FLOOR
): Result<DiskInventory, DiskFailure> {
  const tracked = [...new Set(files)].sort();
  const testShaped = tracked.filter(isTestShaped);
  if (testShaped.length < floor) {
    return err({
      message:
        `disk: ${String(testShaped.length)} test-shaped tracked files, below the floor of ` +
        `${String(floor)}; the listing read less of the tree than it holds`,
    });
  }
  return ok({ tracked, testShaped });
}
