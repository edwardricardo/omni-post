/**
 * @file node-collector.ts
 * @description The `--list` reader of the reach engine's node:test collector.
 *              `apps/api/scripts/run-tests.sh --list` prints what the runner selects, one
 *              `<kind>\t<path>` line per file: `<kind>` is `integration`, `live` or
 *              `quarantined`, and `<path>` is relative to the runner's package, the way the
 *              runner names its files. It fails closed on a listing with no line, a line that is
 *              not `<kind>\t<path>`, an unknown kind, and an absolute or repeated path.
 * @layer infrastructure
 */
import path from "node:path";
import { err, ok, type Result } from "@shared/types";

/** The kinds a `--list` line can carry. */
const NODE_KIND = {
  INTEGRATION: "integration",
  LIVE: "live",
  QUARANTINED: "quarantined",
} as const;

/** A listing kind, derived from {@link NODE_KIND}. */
type NodeKind = (typeof NODE_KIND)[keyof typeof NODE_KIND];

/** One line of the listing: its kind and its repository-relative path. */
export interface ListedFile {
  readonly kind: NodeKind;
  readonly file: string;
}

/**
 * @param value - The kind text of one line.
 * @returns Whether it is a kind the listing may carry.
 */
function isNodeKind(value: string): value is NodeKind {
  return Object.values<string>(NODE_KIND).includes(value);
}

/**
 * Reads the `--list` output: every line `<kind>\t<path>`, each path once.
 *
 * @param stdout - The runner's standard output.
 * @param packageDir - The runner's repository-relative package, the base of every path.
 * @returns The listed files with repository-relative paths, or why the output is not a listing.
 */
export function parseRunnerList(stdout: string, packageDir: string): Result<ListedFile[], string> {
  if (stdout === "" || stdout === "\n") return err("--list printed no line");
  const lines = (stdout.endsWith("\n") ? stdout.slice(0, -1) : stdout).split("\n");
  const listed: ListedFile[] = [];
  const seen = new Set<string>();
  for (const [index, line] of lines.entries()) {
    const where = `--list line ${String(index + 1)}`;
    const match = /^([^\t]+)\t([^\t]+)$/.exec(line);
    if (match?.[1] === undefined || match[2] === undefined) {
      return err(`${where} is not "<kind>\\t<path>": ${JSON.stringify(line)}`);
    }
    const kind = match[1];
    const relative = match[2];
    if (!isNodeKind(kind)) return err(`${where} carries the unknown kind "${kind}"`);
    if (path.posix.isAbsolute(relative)) return err(`${where} names an absolute path`);
    const file = path.posix.normalize(path.posix.join(packageDir, relative));
    if (seen.has(file)) return err(`${where} lists ${file} a second time`);
    seen.add(file);
    listed.push({ kind, file });
  }
  return ok(listed);
}
