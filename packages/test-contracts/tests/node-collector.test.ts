/**
 * @file node-collector.test.ts
 * @description Self-tests of the node:test `--list` reader: how a `run-tests.sh --list` output
 *              is read, line by line, and every way it fails closed — no line, a malformed line,
 *              an unknown kind, an absolute or repeated path.
 * @layer infrastructure
 */
import { describe, expect, it } from "vitest";
import { parseRunnerList } from "../src/lib/node-collector.js";

const INTEGRATION = "apps/api/tests/integration/a.integration.test.ts";
const LIVE = "apps/api/tests/b.live.test.ts";
const QUARANTINED = "apps/api/tests/integration/c.integration.test.ts";

/** A `--list` output naming one file of each kind, as the runner names them. */
const LISTING = [
  "integration\ttests/integration/a.integration.test.ts",
  "live\ttests/b.live.test.ts",
  "quarantined\ttests/integration/c.integration.test.ts",
  "",
].join("\n");

describe("node:test --list parsing", () => {
  it("returns every line with its kind and a repository-relative path", () => {
    expect(parseRunnerList(LISTING, "apps/api")).toEqual({
      ok: true,
      value: [
        { kind: "integration", file: INTEGRATION },
        { kind: "live", file: LIVE },
        { kind: "quarantined", file: QUARANTINED },
      ],
    });
  });

  it("returns the listing of an output with no final newline", () => {
    const parsed = parseRunnerList("live\ttests/b.live.test.ts", "apps/api");

    expect(parsed).toEqual({ ok: true, value: [{ kind: "live", file: LIVE }] });
  });

  it.each([
    ["no output", "", "--list printed no line"],
    ["a lone newline", "\n", "--list printed no line"],
    ["a blank line", "live\ttests/b.live.test.ts\n\n", 'line 2 is not "<kind>\\t<path>"'],
    ["a line with no tab", "integration tests/a.test.ts\n", 'line 1 is not "<kind>\\t<path>"'],
    ["a third field", "live\ttests/b.live.test.ts\textra\n", 'line 1 is not "<kind>\\t<path>"'],
    ["an unknown kind", "skipped\ttests/x.test.ts\n", 'line 1 carries the unknown kind "skipped"'],
    ["an absolute path", "live\t/tmp/x.live.test.ts\n", "line 1 names an absolute path"],
    [
      "a path listed under two kinds",
      "integration\ttests/x.test.ts\nlive\ttests/x.test.ts\n",
      "line 2 lists apps/api/tests/x.test.ts a second time",
    ],
  ])("returns a failure for an output with %s", (_label, stdout, expected) => {
    const parsed = parseRunnerList(stdout, "apps/api");

    expect(parsed.ok ? "" : parsed.error).toContain(expected);
  });
});
