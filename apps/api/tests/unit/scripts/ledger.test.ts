/**
 * @file ledger.test.ts
 * @description Pins the test ledger. First its pure core, `scripts/testing/lib/ledger-core.mjs`:
 *   the shape a path takes, the rows of a file's classified blocks, the machine verdict table, the
 *   summary derived from the rows and the deterministic JSON they render to. The real classifier,
 *   `classifyFile` of `packages/eslint-plugin-testing`, reads inline fixture sources, so every
 *   verdict is pinned against the blocks the ledger reads in the tree; those cases spawn and write
 *   nothing.
 *
 *   Then the readers of `scripts/testing/lib/reach-report.mjs`: the report, read from a stand-in
 *   for the engine's process, its per-file map, and the quarantine's owners, each quarantine planted
 *   in a fresh directory under `tmpdir()`.
 * @layer infrastructure
 */
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { findMonorepoRoot } from "@packages/vitest-shared";
import { afterEach, describe, expect, it } from "vitest";

type Shape =
  "test" | "integration-test" | "live-test" | "spec" | "k6" | "runner" | "helper" | "disabled";
type Verdict = "DELETE" | "REWRITE" | "KEEP" | "ADJUDICATE";
type Result<T> = { value: T } | { error: string };

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

interface FileRow {
  readonly path: string;
  readonly shape: Shape | null;
  readonly framework: string | null;
  readonly collectors: readonly string[] | null;
  readonly quarantined: string | null;
  readonly blockCount: number;
  readonly blocks: readonly BlockRow[];
  readonly verdict: Verdict | null;
  readonly basis: string;
  readonly excluded: string | null;
  readonly status: string;
  readonly sliceId: string | null;
  readonly subject: null;
  readonly duplicate: null;
  readonly importers: number | null;
}

interface RowInput {
  readonly path: string;
  readonly classification: Classification | null;
  readonly collectors: readonly string[];
  readonly quarantined: string | null;
}

interface MachineVerdict {
  readonly verdict: Verdict | null;
  readonly basis: string;
  readonly excluded: string | null;
}

interface FileCounts {
  readonly total: number;
  readonly byShape: Readonly<Record<string, number>>;
  readonly byVerdict: Readonly<Record<string, number>>;
}

interface RowCounts {
  readonly machine: number;
  readonly confirmed: number;
  readonly total: number;
}

interface BlockCounts {
  readonly total: number;
  readonly decorative: number;
  readonly byClass: Readonly<Record<string, number>>;
}

interface DeletedCounts {
  readonly files: number;
  readonly blocks: number;
}

interface Summary {
  readonly files: FileCounts;
  readonly rows: RowCounts;
  readonly blocks: BlockCounts;
  readonly deleted: DeletedCounts;
  readonly excluded: readonly string[];
}

interface Ledger {
  readonly version: number;
  readonly summary: Summary;
  readonly slices: Readonly<Record<string, unknown>>;
  readonly files: readonly FileRow[];
}

/** The core's surface; a literal import of an untyped `.mjs` would be an implicit any. */
type LedgerCore = {
  LEDGER_VERSION: number;
  EXCLUDED_BY_DECISION: Readonly<Record<string, string>>;
  CANONICAL_TEST_SHAPED: RegExp;
  shapeOf: (file: string) => Shape | null;
  blockRows: (classification: Classification) => BlockRow[];
  verdictOf: (input: { path: string; classification: Classification | null }) => MachineVerdict;
  fileRow: (input: RowInput) => Result<FileRow>;
  summarize: (rows: readonly FileRow[]) => Summary;
  buildLedger: (rows: readonly FileRow[]) => Result<Ledger>;
  render: (ledger: Ledger) => Promise<string>;
};

/** The classifier's surface the suite calls, typed for the same reason. */
type ClassifierModule = {
  classifyFile: (text: string, fileName: string) => Classification;
};

/** One violation of the reach engine's report. */
interface ReachViolation {
  readonly rule: string;
  readonly message: string;
}

/** A report of the reach engine, as the shared reader returns it. */
interface ReachReport {
  readonly violations: readonly ReachViolation[];
  readonly reach: Readonly<Record<string, readonly string[]>>;
}

/** The process the reader runs the engine in; it throws as `execFileSync` does on a non-zero exit. */
type Spawn = (command: string, args: readonly string[], cwd: string) => string;

/** The shared reader of the reach engine's report and quarantine, typed for the same reason. */
type ReachLib = {
  reachReport: (root: string, seams?: { readonly spawn?: Spawn }) => ReachReport | string;
  reachLabels: (report: { readonly reach: unknown }) => Map<string, string[]> | string;
  quarantineOwners: (root: string) => Map<string, string> | string;
};

const REPO_ROOT = findMonorepoRoot(path.dirname(fileURLToPath(import.meta.url)));
const CORE_SCRIPT = path.join(REPO_ROOT, "scripts/testing/lib/ledger-core.mjs");
const REACH_LIB = path.join(REPO_ROOT, "scripts/testing/lib/reach-report.mjs");
const CLASSIFIER = path.join(REPO_ROOT, "packages/eslint-plugin-testing/src/index.js");
const core = (await import(CORE_SCRIPT)) as LedgerCore;
const reachLib = (await import(REACH_LIB)) as ReachLib;
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

const SHAPE_ORDER = [
  "test",
  "integration-test",
  "live-test",
  "spec",
  "k6",
  "runner",
  "helper",
  "disabled",
  "none",
];
const ROW_KEYS = [
  "path",
  "shape",
  "framework",
  "collectors",
  "quarantined",
  "blockCount",
  "blocks",
  "verdict",
  "basis",
  "excluded",
  "status",
  "sliceId",
  "subject",
  "duplicate",
  "importers",
];
const VITEST_LABEL = "vitest:apps/api/vitest.config.ts";

const valueOf = <T>(result: Result<T>): T => {
  if ("error" in result) throw new Error(result.error);
  return result.value;
};

const classify = (file: string, source: Source): Classification =>
  classifyFile(SOURCES[source], file);

const row = (
  file: string,
  source: Source | null,
  collectors: readonly string[] = [],
  quarantined: string | null = null
): FileRow =>
  valueOf(
    core.fileRow({
      path: file,
      classification: source === null ? null : classify(file, source),
      collectors,
      quarantined,
    })
  );

/** One row per shape the summary counts, the paths deliberately out of code-unit order. */
const sampleRows = (): FileRow[] => [
  row("apps/api/tests/unit/post.test.ts", "mixed", [VITEST_LABEL]),
  row("apps/client/e2e/login.spec.ts", "contradiction", ["playwright:apps/client/e2e.config.ts"]),
  row("apps/api/tests/unit/Post.test.ts", "behavioural", [], "platform-engineering"),
  row("performance/k6/scenarios/load.k6.js", "noBlocks", ["k6:performance/k6/scenarios"]),
  row("apps/api/tests/old.test.ts.disabled", "existence"),
  row("apps/api/tests/run.ts", null),
  row("apps/api/scripts/seed-demo-data.ts", "decorative"),
];

const total = (counts: Readonly<Record<string, number>>): number =>
  Object.values(counts).reduce((sum, count) => sum + count, 0);

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

describe("fileRow", () => {
  it("returns the row in the ledger's key order, its verdict computed and the fields no scan fills yet null", () => {
    const file = "apps/api/tests/unit/post.test.ts";

    const result = row(file, "mixed", [VITEST_LABEL]);

    expect(Object.keys(result)).toEqual(ROW_KEYS);
    expect(result).toMatchObject({
      path: file,
      shape: "test",
      framework: "vitest",
      collectors: [VITEST_LABEL],
      quarantined: null,
      blockCount: 2,
      verdict: "REWRITE",
      basis: "some-decorative",
      excluded: null,
      status: "machine",
      sliceId: null,
      subject: null,
      duplicate: null,
      importers: null,
    });
  });

  it("sorts reach's labels by code unit and keeps an orphan's list empty, with its quarantine owner", () => {
    const labels = ["vitest:b.config.ts", "node:apps/api/scripts/run-tests.sh", "Vitest:a"];

    const reached = row("apps/api/tests/unit/a.test.ts", "behavioural", labels);
    const orphan = row("apps/api/tests/unit/b.test.ts", "behavioural", [], "platform-engineering");

    expect(reached.collectors).toEqual([
      "Vitest:a",
      "node:apps/api/scripts/run-tests.sh",
      "vitest:b.config.ts",
    ]);
    expect(orphan.collectors).toEqual([]);
    expect(orphan.quarantined).toBe("platform-engineering");
  });

  it.each<[string, Source | null]>([
    ["apps/api/tests/unit/post.test-helpers.ts", "existence"],
    ["apps/api/tests/run.ts", null],
    ["apps/api/scripts/seed-demo-data.ts", "decorative"],
  ])("returns null collectors for %s, which is not test-shaped", (file, source) => {
    expect(row(file, source).collectors).toBeNull();
  });

  it.each<[string, RowInput, string]>([
    [
      "a path no shape and no decision admits",
      { path: "apps/api/src/post.ts", classification: null, collectors: [], quarantined: null },
      "apps/api/src/post.ts is not a ledger candidate: no shape and no decision admits it",
    ],
    [
      "the classification of another file",
      {
        path: "apps/api/tests/unit/a.test.ts",
        classification: classifyFile(SOURCES.behavioural, "apps/api/tests/unit/b.test.ts"),
        collectors: [],
        quarantined: null,
      },
      "apps/api/tests/unit/a.test.ts carries the classification of apps/api/tests/unit/b.test.ts",
    ],
    [
      "collectors for a file that is not test-shaped",
      {
        path: "apps/api/tests/run.ts",
        classification: null,
        collectors: [VITEST_LABEL],
        quarantined: null,
      },
      `apps/api/tests/run.ts is not test-shaped, yet reach lists it under ${VITEST_LABEL}`,
    ],
  ])("returns an error for %s", (_case, input, message) => {
    expect(core.fileRow(input)).toEqual({ error: message });
  });
});

describe("summarize", () => {
  it("returns every count of the sample rows, keyed in a fixed order", () => {
    const summary = core.summarize(sampleRows());

    expect(summary).toEqual({
      files: {
        total: 7,
        byShape: {
          test: 2,
          "integration-test": 0,
          "live-test": 0,
          spec: 1,
          k6: 1,
          runner: 1,
          helper: 0,
          disabled: 1,
          none: 1,
        },
        byVerdict: { DELETE: 1, REWRITE: 1, KEEP: 1, ADJUDICATE: 3, unmeasured: 1 },
      },
      rows: { machine: 7, confirmed: 0, total: 7 },
      blocks: {
        total: 8,
        decorative: 5,
        byClass: {
          EMPTY: 1,
          "TAUTOLOGY-ONLY": 0,
          "EXISTENCE-ONLY": 4,
          "CONDITIONAL-ONLY": 0,
          "SELF-SKIP": 0,
          "PRINTS-SUCCESS": 0,
          "TITLE-CONTRADICTION": 1,
          BEHAVIOURAL: 2,
        },
      },
      deleted: { files: 0, blocks: 0 },
      excluded: ["apps/api/scripts/seed-demo-data.ts: D17"],
    });
    expect(Object.keys(summary)).toEqual(["files", "rows", "blocks", "deleted", "excluded"]);
    expect(Object.keys(summary.files.byShape)).toEqual(SHAPE_ORDER);
    expect(Object.keys(summary.files.byVerdict)).toEqual([
      "DELETE",
      "REWRITE",
      "KEEP",
      "ADJUDICATE",
      "unmeasured",
    ]);
  });

  it("derives every total from a direct count over the rows it is given", () => {
    const rows = sampleRows();
    const blocks = rows.flatMap((file) => file.blocks);

    const summary = core.summarize(rows);

    expect(summary.files.total).toBe(rows.length);
    expect(total(summary.files.byShape)).toBe(rows.length);
    expect(total(summary.files.byVerdict)).toBe(rows.length);
    expect(summary.files.byVerdict["unmeasured"]).toBe(
      rows.filter((file) => file.verdict === null).length
    );
    expect(summary.rows.total).toBe(rows.length);
    expect(summary.blocks.total).toBe(blocks.length);
    expect(summary.blocks.total).toBe(rows.reduce((sum, file) => sum + file.blockCount, 0));
    expect(summary.blocks.decorative).toBe(
      blocks.filter((block) => block.criteria.length > 0).length
    );
    expect(total(summary.blocks.byClass)).toBe(blocks.length);
  });
});

describe("buildLedger and render", () => {
  it("returns the ledger keyed in a fixed order, its files sorted by code unit rather than by locale", () => {
    const ledger = valueOf(core.buildLedger(sampleRows()));

    expect(Object.keys(ledger)).toEqual(["version", "summary", "slices", "files"]);
    expect(ledger.version).toBe(1);
    expect(ledger.slices).toEqual({});
    expect(ledger.files.map((file) => file.path)).toEqual([
      "apps/api/scripts/seed-demo-data.ts",
      "apps/api/tests/old.test.ts.disabled",
      "apps/api/tests/run.ts",
      "apps/api/tests/unit/Post.test.ts",
      "apps/api/tests/unit/post.test.ts",
      "apps/client/e2e/login.spec.ts",
      "performance/k6/scenarios/load.k6.js",
    ]);
    expect(ledger.summary).toEqual(core.summarize(ledger.files));
  });

  it("returns an error naming a path that two rows share", () => {
    const twice = row("apps/api/tests/unit/a.test.ts", "behavioural");

    expect(core.buildLedger([twice, twice])).toEqual({
      error: "apps/api/tests/unit/a.test.ts has 2 rows",
    });
  });

  it("renders byte-equal JSON from the same rows given in two orders", async () => {
    const rows = sampleRows();

    const forward = await core.render(valueOf(core.buildLedger(rows)));
    const backward = await core.render(valueOf(core.buildLedger([...rows].reverse())));

    expect(backward).toBe(forward);
    expect(await core.render(valueOf(core.buildLedger(rows)))).toBe(forward);
  });

  it("renders JSON that parses back to the ledger and carries no clock, no commit and no absolute path", async () => {
    const ledger = valueOf(core.buildLedger(sampleRows()));

    const text = await core.render(ledger);

    expect(JSON.parse(text)).toEqual(ledger);
    expect(text.endsWith("}\n")).toBe(true);
    expect(text).not.toMatch(/T\d\d:\d\d/);
    expect(text).not.toMatch(/(?<![0-9a-f])[0-9a-f]{40}(?![0-9a-f])/);
    expect(text).not.toContain("/root/");
    expect(text).not.toContain(REPO_ROOT);
    expect(text).not.toContain(tmpdir());
    expect(text).not.toMatch(/"\//);
  });
});

const A = "apps/api/tests/unit/a.test.ts";
const C = "apps/api/tests/unit/c.test.ts";
const NODE_LABEL = "node:apps/api/scripts/run-tests.sh";
const OWNER = "WU-2.6a";
const UNREAD_INPUT = "a vitest config could not be resolved";
const QUARANTINE_FILE = "packages/test-contracts/quarantine.json";

let planted: string[] = [];

afterEach(() => {
  for (const root of planted) rmSync(root, { recursive: true, force: true });
  planted = [];
});

/** Plants files under a fresh directory below `tmpdir()`, which goes after the test. */
const plant = (files: Readonly<Record<string, string>>): string => {
  const root = mkdtempSync(path.join(tmpdir(), "ledger-test-"));
  planted.push(root);
  for (const [file, text] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    writeFileSync(path.join(root, file), text);
  }
  return root;
};

/** What the engine prints: one violation, reach's map and no input it could not read. */
const PRINTED = JSON.stringify({
  ok: false,
  violations: [{ rule: "R1", message: `unreached: ${C}` }],
  errors: [],
  reach: { [A]: [VITEST_LABEL] },
});
/** The report the reader returns for `PRINTED`. */
const READ: ReachReport = {
  violations: [{ rule: "R1", message: `unreached: ${C}` }],
  reach: { [A]: [VITEST_LABEL] },
};

/** A process that prints `stdout` and exits 0. */
const prints =
  (stdout: string): Spawn =>
  () =>
    stdout;

/** A process that exits `status` having printed `stdout`, thrown as `execFileSync` throws it. */
const exits =
  (status: number, stdout: string): Spawn =>
  () => {
    throw Object.assign(new Error(`Command failed: pnpm (exit ${status})`), { status, stdout });
  };

describe("reach-report.mjs", () => {
  it.each<[string, Spawn, ReachReport | string]>([
    ["exit 0 with a report", prints(PRINTED), READ],
    ["exit 1 with a report, the engine's exit on a violation", exits(1, PRINTED), READ],
    ["exit 1 with nothing printed", exits(1, ""), "test-contracts reach printed no JSON report"],
    ["exit 2, a usage error", exits(2, PRINTED), "test-contracts reach exited 2 with no report"],
    [
      "text that is not a report",
      prints("reach: PASS\n"),
      "test-contracts reach printed no JSON report",
    ],
    [
      "a report with no errors list",
      prints(JSON.stringify({ violations: [] })),
      "test-contracts reach printed a report with no violations or errors list",
    ],
    [
      "a report naming inputs it could not read",
      prints(
        JSON.stringify({ violations: [], errors: [UNREAD_INPUT, "a second input"], reach: {} })
      ),
      `test-contracts reach could not read an input: ${UNREAD_INPUT}; a second input`,
    ],
    [
      "a process that cannot start",
      () => {
        throw Object.assign(new Error("spawnSync pnpm ENOENT"), { code: "ENOENT" });
      },
      "test-contracts reach could not run: spawnSync pnpm ENOENT",
    ],
  ])("reachReport returns the report, or why there is none, given %s", (_case, spawn, expected) => {
    expect(reachLib.reachReport("/repository", { spawn })).toEqual(expected);
  });

  it("reachReport runs fitness #30's command, plus --json, in the root it is given", () => {
    const calls: [string, readonly string[], string][] = [];

    reachLib.reachReport("/repository", {
      spawn: (command, args, cwd) => {
        calls.push([command, args, cwd]);
        return PRINTED;
      },
    });

    expect(calls).toEqual([
      [
        "pnpm",
        [
          "--silent",
          "--filter",
          "@packages/test-contracts",
          "reach",
          "--quarantine",
          "quarantine.json",
          "--json",
        ],
        "/repository",
      ],
    ]);
  });

  it.each<[string, unknown, Map<string, string[]> | string]>([
    [
      "a map of label lists",
      { [A]: [VITEST_LABEL, NODE_LABEL] },
      new Map([[A, [VITEST_LABEL, NODE_LABEL]]]),
    ],
    ["no map", undefined, "test-contracts reach printed a report with no reach map"],
    ["a list", [], "test-contracts reach printed a report with no reach map"],
    ["an empty label list, kept as it was printed", { [A]: [] }, new Map([[A, []]])],
    [
      "a label that is not a string",
      { [A]: [7] },
      `test-contracts reach printed labels for ${A} that are not strings`,
    ],
  ])(
    "reachLabels returns each file's labels, or why the report holds none, given %s",
    (_case, reach, expected) => {
      expect(reachLib.reachLabels({ reach })).toEqual(expected);
    }
  );

  it.each<[string, string, Map<string, string> | string]>([
    [
      "an entry per quarantined file",
      JSON.stringify({
        entries: [{ path: C, reason: "runs nowhere", owner: OWNER, since: "2026-10-23" }],
      }),
      new Map([[C, OWNER]]),
    ],
    ["no entries list", JSON.stringify({ items: [] }), `${QUARANTINE_FILE} holds no entries list`],
    [
      "an entry with no owner",
      JSON.stringify({ entries: [{ path: C }] }),
      `${QUARANTINE_FILE}: entry 0 has no path or no owner`,
    ],
    [
      "two entries for one path",
      JSON.stringify({
        entries: [
          { path: C, owner: OWNER },
          { path: C, owner: "WU-2.7" },
        ],
      }),
      `${QUARANTINE_FILE}: entry 1 repeats ${C}`,
    ],
  ])(
    "quarantineOwners returns each file's owner, or why the quarantine is unread, given %s",
    (_case, text, expected) => {
      const root = plant({ [QUARANTINE_FILE]: text });

      expect(reachLib.quarantineOwners(root)).toEqual(expected);
    }
  );

  it("quarantineOwners returns why the quarantine is unread when there is no quarantine file", () => {
    const root = plant({});

    expect(reachLib.quarantineOwners(root)).toMatch(
      /^packages\/test-contracts\/quarantine\.json could not be read: ENOENT/
    );
  });
});
