/**
 * @file ledger.test.ts
 * @description Pins `scripts/testing/lib/ledger-core.mjs`, the pure core of the test ledger: the
 *   shape a path takes, the rows of a file's classified blocks and the machine verdict table.
 *   The real classifier, `classifyFile` of `packages/eslint-plugin-testing`, reads inline fixture
 *   sources, so every verdict is pinned against the blocks the ledger reads in the tree. Nothing
 *   here spawns or writes; the only files read are the three that define the test-shaped
 *   expression.
 * @layer infrastructure
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { findMonorepoRoot } from "@packages/vitest-shared";
import { describe, expect, it } from "vitest";

type Shape =
  "test" | "integration-test" | "live-test" | "spec" | "k6" | "runner" | "helper" | "disabled";
type Verdict = "DELETE" | "REWRITE" | "KEEP" | "ADJUDICATE";

/** The line a classified block starts on. */
interface BlockLocation {
  readonly line: number;
}

/** A block of the classifier's output, as far as the ledger reads it. */
interface ClassifiedBlock {
  readonly title: string;
  readonly loc: BlockLocation;
  readonly blockClass: string;
  readonly criteria: readonly string[];
  readonly bodyHash: string;
  readonly opaque: boolean;
}

/** The classifier's output for one file, as far as the ledger reads it. */
interface Classification {
  readonly path: string;
  readonly framework: "vitest" | "node" | null;
  readonly blocks: readonly ClassifiedBlock[];
  readonly opaqueHelpers: readonly string[];
}

interface BlockRow {
  readonly id: string;
  readonly line: number;
  readonly blockClass: string;
  readonly criteria: readonly string[];
  readonly bodyHash: string;
}

interface MachineVerdict {
  readonly verdict: Verdict | null;
  readonly basis: string;
  readonly excluded: string | null;
}

/** The core's surface; a literal import of an untyped `.mjs` would be an implicit any. */
type LedgerCore = {
  LEDGER_VERSION: number;
  EXCLUDED_BY_DECISION: Readonly<Record<string, string>>;
  CANONICAL_TEST_SHAPED: RegExp;
  shapeOf: (file: string) => Shape | null;
  blockRows: (classification: Classification) => BlockRow[];
  verdictOf: (input: { path: string; classification: Classification | null }) => MachineVerdict;
};

/** The classifier's surface the suite calls, typed for the same reason. */
type ClassifierModule = {
  classifyFile: (text: string, fileName: string) => Classification;
};

const REPO_ROOT = findMonorepoRoot(path.dirname(fileURLToPath(import.meta.url)));
const CORE_SCRIPT = path.join(REPO_ROOT, "scripts/testing/lib/ledger-core.mjs");
const CLASSIFIER = path.join(REPO_ROOT, "packages/eslint-plugin-testing/src/index.js");
const core = (await import(CORE_SCRIPT)) as LedgerCore;
const { classifyFile } = (await import(CLASSIFIER)) as ClassifierModule;

const VITEST = 'import { describe, expect, it } from "vitest";\n';
const RESTRICTING = 'it("returns the sum", () => {\n  expect(add(1, 1)).toBe(2);\n});\n';
const EXISTENCE = 'it("loads the module", () => {\n  expect(load()).toBeDefined();\n});\n';
const PENDING = 'it("is pending", () => {});\n';
const CONTRADICTION =
  'it("throws on an invalid token", () => {\n  expect(parse("x")).toBeDefined();\n});\n';
/**
 * A block that skips itself through vitest's options object and calls an imported assertion
 * helper the classifier cannot see into: decorative (criterion c) and opaque at once.
 */
const SKIPPED_OPAQUE =
  'import { assertPublished } from "./helpers";\n' +
  'it("publishes the post", { skip: true }, () => {\n  assertPublished(post);\n});\n';
/** Nests deeper than the call stack, so the classifier returns the file unread, as in its suite. */
const DEPTH = 20_000;

/** One fixture source per verdict the table can reach. */
const SOURCES = {
  behavioural: VITEST + RESTRICTING,
  existence: VITEST + EXISTENCE,
  decorative: VITEST + EXISTENCE + PENDING,
  mixed: VITEST + RESTRICTING + EXISTENCE,
  contradiction: VITEST + CONTRADICTION + EXISTENCE,
  opaque: VITEST + SKIPPED_OPAQUE + EXISTENCE,
  noBlocks: "export const answer = 42;\n",
  unreadable: `it("nests", () => {\n${"if (a) {\n".repeat(DEPTH)}expect(1).toBe(1);\n${"}\n".repeat(DEPTH)}});\n`,
} as const;
type Source = keyof typeof SOURCES;

const classify = (file: string, source: Source): Classification =>
  classifyFile(SOURCES[source], file);

describe("the constants", () => {
  it("returns version 1 and the two paths decision D17 keeps out of every delete slice", () => {
    expect(core.LEDGER_VERSION).toBe(1);
    expect(core.EXCLUDED_BY_DECISION).toEqual({
      "apps/api/scripts/seed-demo-data.ts": "D17",
      "apps/api/scripts/seed-large-dataset.ts": "D17",
    });
  });

  it("holds the test-shaped expression byte-equal to the two places M1 and the reach engine define it", () => {
    const literal = /^(?:export )?const CANONICAL_TEST_SHAPED = \/(.+)\/([a-z]*);$/m;
    const definedIn = (file: string): string | null => {
      const match = literal.exec(readFileSync(path.join(REPO_ROOT, file), "utf8"));
      return match === null ? null : `/${match[1] ?? ""}/${match[2] ?? ""}`;
    };
    const { source, flags } = core.CANONICAL_TEST_SHAPED;
    const expected = `/${source}/${flags}`;

    const literals = [
      "scripts/testing/lib/ledger-core.mjs",
      "scripts/testing/metrics.mjs",
      "packages/test-contracts/src/lib/disk.ts",
    ].map(definedIn);

    expect(literals).toEqual([expected, expected, expected]);
    expect(expected).toBe("/(\\.(test|spec)\\.[cm]?[jt]sx?|\\.k6\\.js)$/");
  });
});

describe("shapeOf", () => {
  it.each<[string, Shape | null]>([
    ["apps/api/tests/unit/post.test.ts", "test"],
    ["apps/client/components/Card.test.tsx", "test"],
    ["apps/api/tests/integration/post.integration.test.ts", "integration-test"],
    ["apps/api/tests/live/x.live.test.ts", "live-test"],
    ["apps/client/e2e/login.spec.ts", "spec"],
    ["performance/k6/scenarios/load.k6.js", "k6"],
    ["apps/api/tests/run.ts", "runner"],
    ["apps/api/tests/run-with-coverage.ts", "runner"],
    ["apps/api/tests/unit/post.test-helpers.ts", "helper"],
    ["apps/api/tests/setup/database.ts", "helper"],
    ["apps/client/lib/api/__tests__/setup.ts", "helper"],
    ["packages/shared/test/fixtures.ts", "helper"],
    ["performance/k6/utils/auth-helpers.js", "helper"],
    ["security/scanners/headers.ts", "helper"],
    ["apps/api/tests/analytics-ml-integration.test.ts.disabled", "disabled"],
    ["apps/api/tests/threading.flow.test.ts.old", "disabled"],
    ["apps/api/tests/unit/post.test.ts.bak", "disabled"],
    ["apps/api/tests/run.ts.bak", "disabled"],
    ["apps/api/src/post.ts", null],
    ["apps/api/src/post.ts.bak", null],
    ["apps/api/scripts/seed-demo-data.ts", null],
    ["apps/api/tests/fixtures/post.json", null],
    ["apps/api/tests/unit/runner/config.ts", "helper"],
  ])("returns the shape of %s as %s", (file, shape) => {
    expect(core.shapeOf(file)).toBe(shape);
  });
});

describe("blockRows", () => {
  it("returns one row per block in source order, keyed path::title, with the classifier's class, criteria and hash", () => {
    const file = "apps/api/tests/unit/post.test.ts";
    const classification = classify(file, "mixed");

    const rows = core.blockRows(classification);

    expect(rows).toEqual([
      {
        id: `${file}::returns the sum`,
        line: 2,
        blockClass: "BEHAVIOURAL",
        criteria: [],
        bodyHash: classification.blocks[0]?.bodyHash,
      },
      {
        id: `${file}::loads the module`,
        line: 5,
        blockClass: "EXISTENCE-ONLY",
        criteria: ["a"],
        bodyHash: classification.blocks[1]?.bodyHash,
      },
    ]);
    expect(rows.map((block) => Object.keys(block))).toEqual([
      ["id", "line", "blockClass", "criteria", "bodyHash"],
      ["id", "line", "blockClass", "criteria", "bodyHash"],
    ]);
  });

  it.each([
    ["a repeated title", ["same", "same", "same"], ["same", "same #2", "same #3"]],
    ["a title already ending in #2", ["same", "same #2", "same"], ["same", "same #2", "same #3"]],
  ])("numbers %s from #2 in source order, every id distinct", (_case, titles, ids) => {
    const file = "apps/api/tests/unit/same.test.ts";
    const blocks = titles.map((title) => `it("${title}", () => {\n  expect(a).toBe(1);\n});\n`);

    const rows = core.blockRows(classifyFile(VITEST + blocks.join(""), file));

    expect(rows.map((block) => block.id)).toEqual(ids.map((id) => `${file}::${id}`));
  });
});

describe("verdictOf", () => {
  it.each<[string, string, Source | null, Verdict | null, string, string | null]>([
    [
      "a path decision D17 excludes, every block decorative",
      "apps/api/scripts/seed-demo-data.ts",
      "decorative",
      "ADJUDICATE",
      "excluded-by-decision",
      "D17",
    ],
    [
      "the other path decision D17 excludes",
      "apps/api/scripts/seed-large-dataset.ts",
      "existence",
      "ADJUDICATE",
      "excluded-by-decision",
      "D17",
    ],
    [
      "a dead-suffix file whose blocks restrict behaviour",
      "apps/api/tests/old.test.ts.disabled",
      "behavioural",
      "DELETE",
      "dead-suffix",
      null,
    ],
    ["a runner", "apps/api/tests/run.ts", "noBlocks", null, "importers-not-measured", null],
    [
      "a helper whose blocks are decorative",
      "apps/api/tests/unit/post.test-helpers.ts",
      "existence",
      null,
      "importers-not-measured",
      null,
    ],
    [
      "a file the classifier could not read",
      "apps/api/tests/unit/deep.test.ts",
      "unreadable",
      "ADJUDICATE",
      "unreadable",
      null,
    ],
    [
      "a test-shaped file with no classification",
      "apps/api/tests/unit/missing.test.ts",
      null,
      "ADJUDICATE",
      "unreadable",
      null,
    ],
    [
      "a file with no block",
      "apps/api/tests/unit/none.test.ts",
      "noBlocks",
      "ADJUDICATE",
      "no-blocks",
      null,
    ],
    [
      "a title contradiction beside a decorative block",
      "apps/api/tests/unit/token.test.ts",
      "contradiction",
      "ADJUDICATE",
      "title-contradiction",
      null,
    ],
    [
      "an opaque helper in a file whose blocks are all decorative",
      "apps/api/tests/unit/publish.test.ts",
      "opaque",
      "ADJUDICATE",
      "opaque",
      null,
    ],
    [
      "a file whose blocks are all decorative",
      "apps/api/tests/unit/load.test.ts",
      "decorative",
      "DELETE",
      "all-decorative",
      null,
    ],
    [
      "a file with one decorative block of two",
      "apps/api/tests/unit/post.test.ts",
      "mixed",
      "REWRITE",
      "some-decorative",
      null,
    ],
    [
      "a file whose blocks all restrict behaviour",
      "apps/api/tests/unit/sum.test.ts",
      "behavioural",
      "KEEP",
      "behavioural",
      null,
    ],
  ])("returns the machine verdict of %s", (_case, file, source, verdict, basis, excluded) => {
    const classification = source === null ? null : classify(file, source);

    expect(core.verdictOf({ path: file, classification })).toEqual({ verdict, basis, excluded });
  });
});
