/**
 * @file ledger.test.ts
 * @description Pins the test ledger. First its pure core, `scripts/testing/lib/ledger-core.mjs`:
 *   the shape a path takes, the rows of a file's classified blocks, the machine verdict table, the
 *   summary derived from the rows and the deterministic JSON they render to. The real classifier,
 *   `classifyFile` of `packages/eslint-plugin-testing`, reads inline fixture sources, so every
 *   verdict is pinned against the blocks the ledger reads in the tree; those cases spawn and write
 *   nothing.
 *
 *   Then the readers of `scripts/testing/lib/reach-report.mjs` (the report, its per-file map, the
 *   quarantine's owners) and the command, `scripts/testing/ledger.mjs`: `build(root, seams)` (the
 *   reach join, the quarantine owner, what is listed, what stops the build), then write mode and
 *   `--check` through `main(argv, seams)`, with #48's exit codes (0 clean, 1 drift, 2 usage, 3 an
 *   unread input, 3 winning over 1). They run over fixture trees planted in fresh directories under
 *   `tmpdir()`, the git listing and the reach engine replaced, so they spawn nothing. Last, the run
 *   over this repository: the reach engine runs once and its report is handed back through
 *   `--reach`; the ledger's block counts must equal a direct `classifyFile` fold over the same
 *   tracked files, its test-shaped rows M1's count from `metrics.mjs --m1`, and a second run
 *   through the seam the first run's bytes.
 *
 *   Between them, the import graph of `scripts/testing/lib/ledger-imports.mjs` (where a specifier,
 *   a relative string, a command line and a TypeScript project land, the live importers of each
 *   helper, the module a test's stem names) and the core's duplicate scan, each pinned on its own
 *   and then through `build` over one planted tree that holds every signal.
 * @layer infrastructure
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { findMonorepoRoot } from "@packages/vitest-shared";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

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

/** The module a test's stem names. */
interface Subject {
  readonly stem: string;
  readonly module: string;
  readonly imported: boolean;
}

/** The siblings a file's blocks copy. */
interface Duplicate {
  readonly kind: "EXACT" | "UNION";
  readonly of: readonly string[];
}

/** What the scans beyond the classifier found for a path. */
interface Signals {
  readonly subject?: Subject | null;
  readonly duplicate?: Duplicate | null;
  readonly importers?: number | null;
}

/** One classified file, as the duplicate scan reads it. */
interface DuplicateInput {
  readonly path: string;
  readonly group: string;
  readonly collected: boolean;
  readonly blocks: readonly { readonly title: string; readonly bodyHash: string }[];
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
  readonly subject: Subject | null;
  readonly duplicate: Duplicate | null;
  readonly importers: number | null;
}

interface RowInput extends Signals {
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

/** What deleting a set of rows removes. */
interface Drop {
  readonly files: number;
  readonly blocks: number;
}

/** One demolition slice of the ledger. */
interface LedgerSlice {
  readonly files: readonly string[];
  readonly expectedDrop: Drop;
}

interface Ledger {
  readonly version: number;
  readonly summary: Summary;
  readonly slices: Readonly<Record<string, LedgerSlice>>;
  readonly files: readonly FileRow[];
}

/** The core's surface; a literal import of an untyped `.mjs` would be an implicit any. */
type LedgerCore = {
  LEDGER_VERSION: number;
  EXCLUDED_BY_DECISION: Readonly<Record<string, string>>;
  CANONICAL_TEST_SHAPED: RegExp;
  shapeOf: (file: string) => Shape | null;
  blockRows: (classification: Classification) => BlockRow[];
  verdictOf: (
    input: { path: string; classification: Classification | null } & Signals
  ) => MachineVerdict;
  fileRow: (input: RowInput) => Result<FileRow>;
  duplicatesOf: (inputs: readonly DuplicateInput[]) => Map<string, Duplicate>;
  summarize: (rows: readonly FileRow[]) => Summary;
  buildLedger: (rows: readonly FileRow[]) => Result<Ledger>;
  render: (ledger: Ledger) => Promise<string>;
};

/** A workspace package, as the import graph resolves bare specifiers against it. */
interface WorkspacePackage {
  readonly name: string;
  readonly dir: string;
  readonly depends: readonly string[];
}

/** What a specifier resolves against. */
interface ImportContext {
  readonly tracked: ReadonlySet<string>;
  readonly packages: readonly WorkspacePackage[];
}

/** The import graph's surface, typed for the same reason. */
type ImportsLib = {
  workspaceOf: (file: string, packages: readonly WorkspacePackage[]) => WorkspacePackage | null;
  moduleReferences: (
    file: string,
    text: string,
    context: ImportContext
  ) => { imports: string[]; references: string[] };
  commandReferences: (file: string, commands: string, tracked: ReadonlySet<string>) => string[];
  projectReferences: (file: string, text: string, candidates: readonly string[]) => string[];
  liveImporters: (
    candidates: readonly string[],
    references: ReadonlyMap<string, readonly string[]>
  ) => Map<string, number>;
  importClosure: (
    file: string,
    imports: ReadonlyMap<string, readonly string[]>,
    carries: (file: string) => boolean
  ) => string[];
  modulesByStem: (modules: readonly string[]) => Map<string, string[]>;
  subjectOf: (
    file: string,
    shape: Shape | null,
    imports: readonly string[],
    index: ReadonlyMap<string, readonly string[]>,
    packages: readonly WorkspacePackage[]
  ) => Subject | null;
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

/** What the suite replaces in the command: the git listing, the reach engine's run and the rendering. */
interface LedgerSeams {
  readonly listFiles?: (root: string) => Result<string[]>;
  readonly runReach?: (root: string) => ReachReport | string;
  readonly render?: (ledger: Ledger) => Promise<string>;
  readonly renderMarkdown?: (
    ledger: Ledger,
    machine: ReadonlyMap<string, Verdict | null>
  ) => Promise<string>;
}

/**
 * A built ledger, a note per file the classifier could not read, a problem per overlay entry or
 * slice assignment refused, and each row's machine verdict before the overlay.
 */
interface Built {
  readonly ledger: Ledger;
  readonly notes: readonly string[];
  readonly problems: readonly string[];
  readonly machine: ReadonlyMap<string, Verdict | null>;
}

/** What the command prints and the exit code it ends with. */
interface CliResult {
  readonly code: number;
  readonly output: string;
}

/** The command's surface, typed for the same reason as the core's. */
type LedgerCli = {
  build: (root: string, seams?: LedgerSeams) => Result<Built>;
  main: (argv: readonly string[], seams?: LedgerSeams) => Promise<CliResult>;
};

const REPO_ROOT = findMonorepoRoot(path.dirname(fileURLToPath(import.meta.url)));
const CORE_SCRIPT = path.join(REPO_ROOT, "scripts/testing/lib/ledger-core.mjs");
const CLI_SCRIPT = path.join(REPO_ROOT, "scripts/testing/ledger.mjs");
const REACH_LIB = path.join(REPO_ROOT, "scripts/testing/lib/reach-report.mjs");
const IMPORTS_LIB = path.join(REPO_ROOT, "scripts/testing/lib/ledger-imports.mjs");
const METRICS_SCRIPT = path.join(REPO_ROOT, "scripts/testing/metrics.mjs");
const CLASSIFIER = path.join(REPO_ROOT, "packages/eslint-plugin-testing/src/index.js");
const core = (await import(CORE_SCRIPT)) as LedgerCore;
const cli = (await import(CLI_SCRIPT)) as LedgerCli;
const reachLib = (await import(REACH_LIB)) as ReachLib;
const imports = (await import(IMPORTS_LIB)) as ImportsLib;
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
const A_TEST = "apps/api/tests/unit/a.test.ts";

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

const SUBJECT_MISSED: Subject = {
  stem: "sum",
  module: "apps/api/src/sum.ts",
  imported: false,
};
const EXACT_COPY: Duplicate = { kind: "EXACT", of: ["apps/api/tests/unit/a.test.ts"] };
const UNION_COPY: Duplicate = { kind: "UNION", of: ["apps/api/tests/unit/a.test.ts"] };

describe("verdictOf over the subject, duplicate and importer signals", () => {
  it.each<[string, string, Source | null, Signals, Verdict | null, string]>([
    [
      "a helper no live file references",
      "apps/api/tests/unit/post.test-helpers.ts",
      null,
      { importers: 0 },
      "DELETE",
      "dead-helper",
    ],
    [
      "a runner no live file references",
      "apps/api/tests/run.ts",
      null,
      { importers: 0 },
      "DELETE",
      "dead-helper",
    ],
    [
      "a helper two live files reference",
      "apps/api/tests/unit/post.test-helpers.ts",
      null,
      { importers: 2 },
      "KEEP",
      "imported",
    ],
    [
      "an exact duplicate whose blocks restrict behaviour",
      "apps/api/tests/unit/sum.test.ts",
      "behavioural",
      { duplicate: EXACT_COPY },
      "DELETE",
      "exact-duplicate",
    ],
    [
      "an exact duplicate holding a title contradiction",
      "apps/api/tests/unit/token.test.ts",
      "contradiction",
      { duplicate: EXACT_COPY },
      "DELETE",
      "exact-duplicate",
    ],
    [
      "a test that never imports its stem's module",
      "apps/api/tests/unit/sum.test.ts",
      "behavioural",
      { subject: SUBJECT_MISSED },
      "ADJUDICATE",
      "subject-not-imported",
    ],
    [
      "an all-decorative test that never imports its stem's module",
      "apps/api/tests/unit/sum.test.ts",
      "decorative",
      { subject: SUBJECT_MISSED },
      "DELETE",
      "all-decorative",
    ],
    [
      "a test that imports its stem's module",
      "apps/api/tests/unit/sum.test.ts",
      "behavioural",
      { subject: { ...SUBJECT_MISSED, imported: true } },
      "KEEP",
      "behavioural",
    ],
    [
      "a union duplicate with one decorative block of two",
      "apps/api/tests/unit/post.test.ts",
      "mixed",
      { duplicate: UNION_COPY },
      "ADJUDICATE",
      "duplicate-union",
    ],
    [
      "a path decision D17 excludes, whatever the signals",
      "apps/api/scripts/seed-demo-data.ts",
      "decorative",
      { duplicate: EXACT_COPY, subject: SUBJECT_MISSED },
      "ADJUDICATE",
      "excluded-by-decision",
    ],
  ])("returns the machine verdict of %s", (_case, file, source, signals, verdict, basis) => {
    const classification = source === null ? null : classify(file, source);

    expect(core.verdictOf({ path: file, classification, ...signals })).toMatchObject({
      verdict,
      basis,
    });
  });
});

describe("fileRow with the scan signals", () => {
  it("carries the subject, the duplicate and the importer count in the row's key order", () => {
    const test = valueOf(
      core.fileRow({
        path: "apps/api/tests/unit/sum.test.ts",
        classification: classify("apps/api/tests/unit/sum.test.ts", "behavioural"),
        collectors: [],
        quarantined: null,
        subject: SUBJECT_MISSED,
        duplicate: UNION_COPY,
      })
    );
    const helper = valueOf(
      core.fileRow({
        path: "apps/api/tests/unit/post.test-helpers.ts",
        classification: null,
        collectors: [],
        quarantined: null,
        importers: 3,
      })
    );

    expect(Object.keys(test)).toEqual(ROW_KEYS);
    expect(test).toMatchObject({
      subject: SUBJECT_MISSED,
      duplicate: UNION_COPY,
      importers: null,
      verdict: "ADJUDICATE",
      basis: "subject-not-imported",
    });
    expect(Object.keys(test.subject ?? {})).toEqual(["stem", "module", "imported"]);
    expect(Object.keys(test.duplicate ?? {})).toEqual(["kind", "of"]);
    expect(helper).toMatchObject({ subject: null, duplicate: null, importers: 3, verdict: "KEEP" });
  });

  it.each<[string, RowInput, string]>([
    [
      "an importer count on a test-shaped file",
      { path: A_TEST, classification: null, collectors: [], quarantined: null, importers: 1 },
      `${A_TEST} is no runner or helper, yet carries an importer count`,
    ],
    [
      "a subject on a helper",
      {
        path: "apps/api/tests/unit/a.test-helpers.ts",
        classification: null,
        collectors: [],
        quarantined: null,
        subject: SUBJECT_MISSED,
      },
      "apps/api/tests/unit/a.test-helpers.ts is not test-shaped, yet carries a subject or a duplicate",
    ],
  ])("returns an error for %s", (_case, input, message) => {
    expect(core.fileRow(input)).toEqual({ error: message });
  });
});

/** A classified file of the duplicate scan, its blocks given as `title=hash` pairs. */
const copyInput = (
  file: string,
  pairs: readonly string[],
  { group = "apps/api", collected = false }: { group?: string; collected?: boolean } = {}
): DuplicateInput => ({
  path: file,
  group,
  collected,
  blocks: pairs.map((pair) => {
    const [title = "", bodyHash = ""] = pair.split("=");
    return { title, bodyHash };
  }),
});

const FIVE = ["one=1", "two=2", "three=3", "four=4", "five=5"];

describe("duplicatesOf", () => {
  it("keeps the copy a source collects and marks the other an exact duplicate of it, titles normalised", () => {
    const found = core.duplicatesOf([
      copyInput("apps/api/tests/unit/a.test.ts", ["returns the sum=h1", "loads=h2"]),
      copyInput("apps/api/tests/unit/b.test.ts", ["Loads =h2", "returns  the sum=h1"], {
        collected: true,
      }),
    ]);

    expect([...found]).toEqual([
      ["apps/api/tests/unit/a.test.ts", { kind: "EXACT", of: ["apps/api/tests/unit/b.test.ts"] }],
    ]);
  });

  it.each<[string, DuplicateInput[]]>([
    [
      "the same titles over different bodies",
      [
        copyInput("apps/api/tests/unit/a.test.ts", ["x=1"]),
        copyInput("apps/api/tests/unit/b.test.ts", ["x=2"]),
      ],
    ],
    [
      "the same blocks in two workspaces",
      [
        copyInput("apps/admin/tests/a.test.ts", ["x=1"], { group: "apps/admin" }),
        copyInput("apps/client/tests/a.test.ts", ["x=1"], { group: "apps/client" }),
      ],
    ],
    [
      "four blocks held by siblings",
      [
        copyInput("apps/api/tests/unit/all.test.ts", [...FIVE.slice(0, 4), "own=9"]),
        copyInput("apps/api/tests/unit/part.test.ts", FIVE.slice(0, 4)),
      ],
    ],
    [
      "two files with no block",
      [
        copyInput("apps/api/tests/unit/a.test.ts", []),
        copyInput("apps/api/tests/unit/b.test.ts", []),
      ],
    ],
  ])("returns no duplicate for %s", (_case, inputs) => {
    expect(core.duplicatesOf(inputs)).toEqual(new Map());
  });

  it("marks a file five of whose blocks its siblings hold a union duplicate of them, an exact copy left out", () => {
    const whole = "apps/api/tests/unit/service.test.ts";
    const first = "apps/api/tests/unit/service.first.test.ts";
    const second = "apps/api/tests/unit/service.second.test.ts";
    const copy = "apps/api/tests/unit/service.third.test.ts";

    const found = core.duplicatesOf([
      copyInput(whole, [...FIVE, "own=9"]),
      copyInput(first, ["one=1", "two=2", "three=3"]),
      copyInput(second, ["four=4", "five=5", "other=8"]),
      copyInput(copy, ["one=1", "two=2", "three=3"]),
    ]);

    expect(found.get(whole)).toEqual({ kind: "UNION", of: [first, second] });
    expect(found.get(copy)).toEqual({ kind: "EXACT", of: [first] });
    expect([...found.keys()].sort()).toEqual([copy, whole].sort());
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
const B = "apps/api/tests/unit/b.test.ts";
const C = "apps/api/tests/unit/c.test.ts";
const HELPER = "apps/api/tests/unit/a.test-helpers.ts";
const DEEP = "apps/api/tests/unit/deep.test.ts";
const MISSING = "apps/api/tests/unit/missing.test.ts";
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

const PACKAGES: readonly WorkspacePackage[] = [
  { name: "@apps/api", dir: "apps/api", depends: ["@core/posts", "vitest"] },
  { name: "@apps/client", dir: "apps/client", depends: [] },
  { name: "@core/posts", dir: "packages/core/posts", depends: [] },
  { name: "@core/posts-extra", dir: "packages/core/posts-extra", depends: [] },
];
const TRACKED = new Set([
  "apps/api/src/post.ts",
  "apps/api/src/sum.ts",
  "apps/api/tests/unit/a.test.ts",
  "apps/api/tests/unit/b.ts",
  "apps/api/tests/unit/c.ts",
  "apps/api/tests/unit/dir/index.ts",
  "apps/api/tests/setup-env.ts",
  "apps/client/lib/env.ts",
  "apps/client/tests/x.test.ts",
  "packages/core/posts/src/index.ts",
  "packages/core/posts/src/PostService.ts",
  "packages/core/posts/package.json",
  "performance/monitoring/detector.ts",
]);
const CONTEXT: ImportContext = { tracked: TRACKED, packages: PACKAGES };

describe("ledger-imports.mjs", () => {
  it.each<[string, string, string, string | null]>([
    ["a .js name, to its TypeScript twin", "./b.js", A_TEST, "apps/api/tests/unit/b.ts"],
    ["an extensionless relative path", "../../src/post", A_TEST, "apps/api/src/post.ts"],
    ["a directory, to its index", "./dir", A_TEST, "apps/api/tests/unit/dir/index.ts"],
    [
      "a workspace package, to its src index",
      "@core/posts",
      A_TEST,
      "packages/core/posts/src/index.ts",
    ],
    [
      "a workspace subpath, below its src",
      "@core/posts/PostService.js",
      A_TEST,
      "packages/core/posts/src/PostService.ts",
    ],
    [
      "the @/ alias, from the importing workspace",
      "@/lib/env",
      "apps/client/tests/x.test.ts",
      "apps/client/lib/env.ts",
    ],
    ["a package no workspace holds", "vitest", A_TEST, null],
    ["a package whose name only starts like a workspace's", "@core/postsy", A_TEST, null],
    ["a relative path to no tracked file", "./missing.js", A_TEST, null],
  ])("moduleReferences resolves %s", (_case, specifier, from, expected) => {
    const read = imports.moduleReferences(from, `import "${specifier}";\n`, CONTEXT);

    expect(read).toEqual(
      expected === null
        ? { imports: [], references: [] }
        : { imports: [expected], references: [expected] }
    );
  });

  it("moduleReferences returns the run-time imports apart from every reference, relative and workspace strings included and a root path left out", () => {
    const text =
      'import { post } from "../../src/post.js";\n' +
      'import type { Sum } from "../../src/sum.js";\n' +
      'vi.mock("./dir");\n' +
      'const setup = ["../setup-env.ts", "b.ts", "tests/unit/c.ts", "apps/client/lib/env.ts"];\n' +
      'const self = "./a.test.ts";\n';

    expect(imports.moduleReferences(A_TEST, text, CONTEXT)).toEqual({
      imports: ["apps/api/src/post.ts"],
      references: [
        "apps/api/src/post.ts",
        "apps/api/src/sum.ts",
        "apps/api/tests/setup-env.ts",
        "apps/api/tests/unit/b.ts",
        "apps/api/tests/unit/c.ts",
        "apps/api/tests/unit/dir/index.ts",
      ],
    });
  });

  it("moduleReferences counts no root path a module outside every workspace names, so a lint scope keeps no file alive", () => {
    const text = 'const scope = ["apps/api/tests/unit/c.ts", "apps/api/src/post.ts"];\n';

    expect(imports.moduleReferences("eslint.config.ts", text, CONTEXT)).toEqual({
      imports: [],
      references: [],
    });
  });

  it("commandReferences returns the tracked source files a command line runs, from its directory or the root", () => {
    const commands =
      "NODE_ENV=test tsx ../../performance/monitoring/detector.ts\n" +
      "vitest run --config=tests/setup-env.ts\nnode apps/api/src/post.ts missing.ts";

    expect(imports.commandReferences("apps/api/package.json", commands, TRACKED)).toEqual([
      "apps/api/src/post.ts",
      "apps/api/tests/setup-env.ts",
      "performance/monitoring/detector.ts",
    ]);
  });

  it("projectReferences returns the candidates a project collects by a narrow name or by its files, not by an extension", () => {
    const candidates = [
      "apps/api/tests/unit/port.type-test.ts",
      "apps/api/tests/unit/helper.ts",
      "apps/api/tests/listed.ts",
    ];
    const text =
      '{\n  // pins only\n  "include": ["tests/**/*.type-test.ts", "tests/**/*.ts"],\n' +
      '  "files": ["tests/listed.ts"]\n}\n';

    expect(imports.projectReferences("apps/api/tsconfig.pins.json", text, candidates)).toEqual([
      "apps/api/tests/listed.ts",
      "apps/api/tests/unit/port.type-test.ts",
    ]);
    expect(() => imports.projectReferences("apps/api/tsconfig.json", "[", candidates)).toThrow(
      "apps/api/tsconfig.json is not a TypeScript configuration"
    );
  });

  it("liveImporters counts each candidate's live referencing files, through chains, helpers that only reference each other dead", () => {
    const counts = imports.liveImporters(
      ["used.ts", "chained.ts", "loop-a.ts", "loop-b.ts", "orphan.ts"],
      new Map([
        ["a.test.ts", ["used.ts"]],
        ["b.test.ts", ["used.ts", "missing.ts"]],
        ["used.ts", ["chained.ts"]],
        ["loop-a.ts", ["loop-b.ts", "chained.ts"]],
        ["loop-b.ts", ["loop-a.ts"]],
      ])
    );

    expect([...counts]).toEqual([
      ["used.ts", 2],
      ["chained.ts", 1],
      ["loop-a.ts", 0],
      ["loop-b.ts", 0],
      ["orphan.ts", 0],
    ]);
  });

  it("importClosure follows the test's imports through its helpers and barrels, and no further", () => {
    const reached = imports.importClosure(
      A_TEST,
      new Map([
        [A_TEST, ["apps/api/tests/unit/a.test-helpers.ts", "packages/core/posts/src/index.ts"]],
        ["apps/api/tests/unit/a.test-helpers.ts", ["apps/api/src/sum.ts", A_TEST]],
        ["packages/core/posts/src/index.ts", ["packages/core/posts/src/PostService.ts"]],
        ["apps/api/src/sum.ts", ["apps/api/src/post.ts"]],
      ]),
      (file) => file.endsWith(".test-helpers.ts")
    );

    expect(reached).toEqual([
      "apps/api/src/sum.ts",
      "apps/api/tests/unit/a.test-helpers.ts",
      "packages/core/posts/src/PostService.ts",
      "packages/core/posts/src/index.ts",
    ]);
  });

  const index = imports.modulesByStem([
    "apps/api/src/sum.ts",
    "apps/api/src/post.ts",
    "packages/core/posts/src/post.ts",
    "packages/core/posts/src/PostService.ts",
    "apps/client/lib/utils.ts",
    "apps/client/components/utils.tsx",
  ]);

  it.each<[string, string, Shape, readonly string[], Subject | null]>([
    [
      "the module the test imports",
      "apps/api/tests/unit/post.test.ts",
      "test",
      ["packages/core/posts/src/post.ts"],
      { stem: "post", module: "packages/core/posts/src/post.ts", imported: true },
    ],
    [
      "its own workspace's module when it imports none, before another workspace's",
      "apps/api/tests/unit/post.flow.test.ts",
      "test",
      [],
      { stem: "post", module: "apps/api/src/post.ts", imported: false },
    ],
    [
      "the one module of its name in a workspace its manifest declares",
      "apps/api/tests/integration/PostService.integration.test.ts",
      "integration-test",
      [],
      { stem: "PostService", module: "packages/core/posts/src/PostService.ts", imported: false },
    ],
    [
      "no module for a stem whose one module sits in a workspace its manifest does not declare",
      "packages/core/posts/tests/sum.test.ts",
      "test",
      [],
      null,
    ],
    [
      "no module for a stem that names none",
      "apps/api/tests/unit/absent.test.ts",
      "test",
      [],
      null,
    ],
    [
      "no module for a stem that names several",
      "apps/client/tests/utils.test.ts",
      "test",
      [],
      null,
    ],
    ["no module for an end-to-end spec", "apps/api/e2e/sum.spec.ts", "spec", [], null],
  ])("subjectOf returns %s", (_case, file, shape, imported, expected) => {
    expect(imports.subjectOf(file, shape, imported, index, PACKAGES)).toEqual(expected);
  });
});

/**
 * A planted tree: three test-shaped files (one reached twice, two orphans, one of them
 * quarantined), a helper, a source file and a test-shaped file outside every workspace, which the
 * ledger leaves out with the source file.
 */
const FIXTURE: Readonly<Record<string, string>> = {
  "pnpm-workspace.yaml": 'packages:\n  - "apps/*"\n  # a comment\n  - packages/*\n',
  [QUARANTINE_FILE]: JSON.stringify({
    entries: [{ path: C, reason: "runs nowhere", owner: OWNER, since: "2026-10-23" }],
  }),
  [A]: SOURCES.behavioural,
  [B]: SOURCES.mixed,
  [C]: SOURCES.decorative,
  [HELPER]: SOURCES.noBlocks,
  "apps/api/src/post.ts": SOURCES.noBlocks,
  "scripts/outside.test.ts": SOURCES.behavioural,
};
/** Reach's report: A collected by two sources, its labels out of code-unit order. */
const REACH: ReachReport = { violations: [], reach: { [A]: [VITEST_LABEL, NODE_LABEL] } };

/** Builds the ledger of a planted tree, its listing every planted path and reach `REACH`. */
const built = (root: string, seams: LedgerSeams = {}): Result<Built> =>
  cli.build(root, {
    listFiles: () => ({ value: Object.keys(FIXTURE) }),
    runReach: () => REACH,
    ...seams,
  });

describe("ledger.mjs build", () => {
  it("returns reach's labels sorted, an orphan's empty list, a quarantined orphan's owner and null for a helper, leaving out the paths outside every workspace", () => {
    const { ledger, notes } = valueOf(built(plant(FIXTURE)));

    const rows = new Map(ledger.files.map((file) => [file.path, file]));
    expect([...rows.keys()]).toEqual([HELPER, A, B, C]);
    expect(rows.get(A)).toMatchObject({
      collectors: [NODE_LABEL, VITEST_LABEL],
      quarantined: null,
      verdict: "KEEP",
    });
    expect(rows.get(B)).toMatchObject({ collectors: [], quarantined: null, verdict: "REWRITE" });
    expect(rows.get(C)).toMatchObject({ collectors: [], quarantined: OWNER, verdict: "DELETE" });
    expect(rows.get(HELPER)).toMatchObject({ collectors: null, blockCount: 0, importers: 0 });
    expect(notes).toEqual([]);
  });

  it("returns no subject, no duplicate and no importer count for test files whose stems name no module and whose blocks copy no sibling", () => {
    const { ledger } = valueOf(built(plant(FIXTURE)));

    const tests = ledger.files.filter((file) => file.collectors !== null);
    expect(tests.map((file) => [file.subject, file.duplicate, file.importers])).toEqual([
      [null, null, null],
      [null, null, null],
      [null, null, null],
    ]);
  });

  it("renders the same bytes whatever order the listing gives the paths in", async () => {
    const root = plant(FIXTURE);

    const forward = valueOf(built(root)).ledger;
    const reversed = Object.keys(FIXTURE).reverse();
    const backward = valueOf(built(root, { listFiles: () => ({ value: reversed }) })).ledger;

    expect(await core.render(backward)).toBe(await core.render(forward));
  });

  it.each<[string, LedgerSeams, string]>([
    [
      "git ls-files failed",
      { listFiles: () => ({ error: "git ls-files failed: not a git repository" }) },
      "git ls-files failed: not a git repository",
    ],
    [
      "the listing holds no test-shaped file",
      { listFiles: () => ({ value: ["pnpm-workspace.yaml", HELPER] }) },
      "git ls-files listed no test-shaped file under apps/, packages/, performance/, security/",
    ],
    [
      "reach printed no report",
      { runReach: () => "test-contracts reach printed no JSON report" },
      "test-contracts reach printed no JSON report",
    ],
  ])("returns an error when %s", (_case, seams, error) => {
    expect(built(plant(FIXTURE), seams)).toEqual({ error });
  });

  it("returns an error naming a listed file it cannot read", () => {
    const listing = [...Object.keys(FIXTURE), MISSING];

    const result = built(plant(FIXTURE), { listFiles: () => ({ value: listing }) });

    expect(result).toEqual({
      error: expect.stringMatching(new RegExp(`^${MISSING} could not be read: ENOENT`)),
    });
  });

  it("returns a row with no framework and a note for a file the classifier cannot read", () => {
    const root = plant({ ...FIXTURE, [DEEP]: SOURCES.unreadable });

    const result = valueOf(
      built(root, { listFiles: () => ({ value: [...Object.keys(FIXTURE), DEEP] }) })
    );

    expect(result.ledger.files.find((file) => file.path === DEEP)).toMatchObject({
      framework: null,
      blockCount: 0,
      verdict: "ADJUDICATE",
      basis: "unreadable",
    });
    expect(result.ledger.files.find((file) => file.path === HELPER)).toMatchObject({
      importers: null,
      verdict: null,
      basis: "importers-not-measured",
    });
    expect(result.notes).toEqual([
      expect.stringMatching(
        new RegExp(`^${DEEP}: its references could not be read: Maximum call stack`)
      ),
      expect.stringMatching(new RegExp(`^${DEEP}: the classifier could not read it: RangeError`)),
    ]);
  });
});

const UNIT = "apps/api/tests/unit";
/**
 * A planted tree with every signal: a test that imports its stem's module and one that does not;
 * an exact copy of a sibling; a helper a test imports through a `.js` name, and the index it
 * imports in turn; a helper no file names, and two that name only each other; a setup file a
 * vitest config names, a type pin a TypeScript project collects, and a script a manifest runs.
 */
const GRAPH: Readonly<Record<string, string>> = {
  "pnpm-workspace.yaml": 'packages:\n  - "apps/*"\n',
  [QUARANTINE_FILE]: JSON.stringify({ entries: [] }),
  "apps/api/package.json": JSON.stringify({
    name: "@apps/api",
    scripts: { perf: "NODE_ENV=test tsx ../../performance/monitoring/detector.ts" },
  }),
  "apps/api/vitest.config.ts":
    'export default { test: { setupFiles: ["./tests/setup-env.ts"] } };\n',
  "apps/api/tsconfig.type-tests.json":
    '{\n  // pins\n  "include": ["tests/**/*.type-test.ts"]\n}\n',
  "apps/api/src/post.ts": "export const post = 1;\n",
  "apps/api/src/sum.ts": "export const add = (a, b) => a + b;\n",
  [`${UNIT}/post.test.ts`]: VITEST + 'import { post } from "../../src/post.js";\n' + RESTRICTING,
  [`${UNIT}/sum.test.ts`]:
    VITEST +
    'import { factory } from "./used.test-helpers.js";\n' +
    'it("returns the total", () => {\n  expect(add(2, 2)).toBe(4);\n});\n',
  [`${UNIT}/copy-a.test.ts`]: SOURCES.mixed,
  [`${UNIT}/copy-b.test.ts`]: SOURCES.mixed,
  [`${UNIT}/used.test-helpers.ts`]:
    'import { deep } from "./chain";\nexport const factory = deep;\n',
  [`${UNIT}/chain/index.ts`]: "export const deep = 1;\n",
  [`${UNIT}/orphan.test-helpers.ts`]: "export const orphan = 1;\n",
  [`${UNIT}/loop-a.ts`]: 'import "./loop-b";\n',
  [`${UNIT}/loop-b.ts`]: 'import "./loop-a";\n',
  [`${UNIT}/port.type-test.ts`]: "export {};\n",
  "apps/api/tests/setup-env.ts": "export {};\n",
  "performance/monitoring/detector.ts": "export {};\n",
};

describe("ledger.mjs build over the import graph and the duplicate scan", () => {
  it("returns each row's subject, duplicate, importer count and the verdict they decide, and counts them in the summary", () => {
    const root = plant(GRAPH);

    const { ledger, notes } = valueOf(
      cli.build(root, {
        listFiles: () => ({ value: Object.keys(GRAPH) }),
        runReach: () => ({ violations: [], reach: {} }),
      })
    );

    const rows = ledger.files.map((file) => [
      file.path,
      file.subject,
      file.duplicate,
      file.importers,
      file.verdict,
      file.basis,
    ]);
    expect(rows).toEqual([
      ["apps/api/tests/setup-env.ts", null, null, 1, "KEEP", "imported"],
      [`${UNIT}/chain/index.ts`, null, null, 1, "KEEP", "imported"],
      [`${UNIT}/copy-a.test.ts`, null, null, null, "REWRITE", "some-decorative"],
      [
        `${UNIT}/copy-b.test.ts`,
        null,
        { kind: "EXACT", of: [`${UNIT}/copy-a.test.ts`] },
        null,
        "DELETE",
        "exact-duplicate",
      ],
      [`${UNIT}/loop-a.ts`, null, null, 0, "DELETE", "dead-helper"],
      [`${UNIT}/loop-b.ts`, null, null, 0, "DELETE", "dead-helper"],
      [`${UNIT}/orphan.test-helpers.ts`, null, null, 0, "DELETE", "dead-helper"],
      [`${UNIT}/port.type-test.ts`, null, null, 1, "KEEP", "imported"],
      [
        `${UNIT}/post.test.ts`,
        { stem: "post", module: "apps/api/src/post.ts", imported: true },
        null,
        null,
        "KEEP",
        "behavioural",
      ],
      [
        `${UNIT}/sum.test.ts`,
        { stem: "sum", module: "apps/api/src/sum.ts", imported: false },
        null,
        null,
        "ADJUDICATE",
        "subject-not-imported",
      ],
      [`${UNIT}/used.test-helpers.ts`, null, null, 1, "KEEP", "imported"],
      ["performance/monitoring/detector.ts", null, null, 1, "KEEP", "imported"],
    ]);
    expect(ledger.summary.files.byVerdict).toEqual({
      DELETE: 4,
      REWRITE: 1,
      KEEP: 6,
      ADJUDICATE: 1,
      unmeasured: 0,
    });
    expect(notes).toEqual([]);
  });
});

/** The reason the reader gives for a report that names an input the engine could not read. */
const REACH_UNREAD = `test-contracts reach could not read an input: ${UNREAD_INPUT}`;

/** Runs the command over a planted tree, its listing every planted path and reach `REACH`. */
const run = (root: string, argv: readonly string[] = [], seams: LedgerSeams = {}) =>
  cli.main(["--root", root, ...argv], {
    listFiles: () => ({ value: Object.keys(FIXTURE) }),
    runReach: () => REACH,
    ...seams,
  });

const ledgerFile = (root: string): string => path.join(root, "ledger.json");
const readLedger = (file: string): Ledger => JSON.parse(readFileSync(file, "utf8")) as Ledger;

describe("ledger.mjs write mode", () => {
  it("writes the rendered ledger to ledger.json at the root and reports its counts", async () => {
    const root = plant(FIXTURE);

    const result = await run(root);

    expect(result).toEqual({
      code: 0,
      output:
        "ledger: wrote ledger.json: 4 files, 3 test-shaped, 5 blocks, 3 with a criterion\n" +
        "ledger: wrote docs/development/testing-refoundation/LEDGER.md\n",
    });
    expect(readFileSync(ledgerFile(root), "utf8")).toBe(
      await core.render(valueOf(built(root)).ledger)
    );
  });

  it("writes where --out points, from the saved report --reach names rather than a run", async () => {
    const root = plant({ ...FIXTURE, "reach.json": JSON.stringify({ ...REACH, errors: [] }) });
    const out = path.join(root, "out.json");

    const result = await run(root, ["--out", out, "--reach", path.join(root, "reach.json")], {
      runReach: () => "a run of the engine",
    });

    expect(result.code).toBe(0);
    expect(readLedger(out).files.find((file) => file.path === A)?.collectors).toEqual([
      NODE_LABEL,
      VITEST_LABEL,
    ]);
    expect(existsSync(ledgerFile(root))).toBe(false);
  });

  it.each([
    ["an unknown flag", ["--frobnicate"]],
    ["a positional argument", ["ledger.json"]],
    ["--out with no value", ["--out"]],
    ["an empty --root", ["--root="]],
  ])("returns 2 on %s and writes nothing", async (_case, argv) => {
    const root = plant(FIXTURE);

    const result = await run(root, argv);

    expect(result.code).toBe(2);
    expect(result.output).toContain("usage: node scripts/testing/ledger.mjs");
    expect(existsSync(ledgerFile(root))).toBe(false);
  });

  it.each<[string, readonly string[], LedgerSeams, string]>([
    [
      "reach reports an input it could not read",
      [],
      { runReach: () => REACH_UNREAD },
      `ledger: unread: test-contracts reach could not read an input: ${UNREAD_INPUT}\n`,
    ],
    [
      "git ls-files failed",
      [],
      { listFiles: () => ({ error: "git ls-files failed: not a git repository" }) },
      "ledger: unread: git ls-files failed: not a git repository\n",
    ],
    [
      "--reach names no file",
      ["--reach", "absent-reach.json"],
      {},
      "ledger: unread: --reach absent-reach.json could not be read: ENOENT",
    ],
    [
      "the ledger cannot be rendered",
      [],
      { render: () => Promise.reject(new Error("the configuration could not be read")) },
      "ledger: unread: the ledger could not be rendered: the configuration could not be read\n",
    ],
  ])("returns 3 and writes nothing when %s", async (_case, argv, seams, line) => {
    const root = plant(FIXTURE);

    const result = await run(root, argv, seams);

    expect(result.code).toBe(3);
    expect(result.output).toContain(line);
    expect(existsSync(ledgerFile(root))).toBe(false);
  });
});

/** Renames one block of B in the written ledger, the drift `--check` must name. */
const retitle = (root: string): void => {
  const text = readFileSync(ledgerFile(root), "utf8");
  writeFileSync(ledgerFile(root), text.replace(`${B}::loads the module"`, `${B}::loads it"`));
};

describe("ledger.mjs --check", () => {
  it("returns 0 over the ledger it wrote, and 1 naming the one path whose block title drifted", async () => {
    const root = plant(FIXTURE);
    await run(root);

    const current = await run(root, ["--check"]);
    retitle(root);
    const drifted = await run(root, ["--check"]);

    const page = "ledger: docs/development/testing-refoundation/LEDGER.md is current\n";
    expect(current).toEqual({ code: 0, output: `ledger: ledger.json is current\n${page}` });
    expect(drifted).toEqual({
      code: 1,
      output:
        `ledger: drift: ${B}: its row differs\n` +
        "ledger: ledger.json is stale; run `pnpm ledger` and commit the result\n" +
        page,
    });
  });

  it("returns 3 when there is no committed ledger to check", async () => {
    const root = plant(FIXTURE);

    const result = await run(root, ["--check"]);

    expect(result.code).toBe(3);
    expect(result.output).toContain("ledger: unread: no committed ledger at ledger.json");
  });

  it("returns 3 over 1 when the committed ledger drifted and reach could not read an input, comparing nothing", async () => {
    const root = plant(FIXTURE);
    await run(root);
    retitle(root);

    const result = await run(root, ["--check"], {
      runReach: () => REACH_UNREAD,
    });

    expect(result).toEqual({
      code: 3,
      output: `ledger: unread: test-contracts reach could not read an input: ${UNREAD_INPUT}\n`,
    });
  });
});

/** The overlay a reviewer writes, the slice assignment beside it and the page the ledger renders. */
const ADJUDICATIONS = "docs/development/testing-refoundation/adjudications.json";
const SLICES = "docs/development/testing-refoundation/slices.json";
const MARKDOWN = "docs/development/testing-refoundation/LEDGER.md";
/** sha256 of the ledger `FIXTURE` rendered to before the overlay existed, at befcdae1. */
const C1_FIXTURE_SHA256 = "23c2df68fa9544bb2e76bc5287c643aea68f7a5de7b489edf1d8a351c18e04c8";

/** B, machine REWRITE, confirmed KEEP: every field the overlay requires, each valid. */
const CONFIRMATION = {
  verdict: "KEEP",
  criteria: [],
  blocks: [`${B}::loads the module`],
  evidence: "the hard probe turned the block red",
  status: "confirmed",
  reviewer: "Edward",
  date: "2026-10-27",
};

/** `FIXTURE` with the overlay's files written as JSON. */
const withOverlay = (files: Readonly<Record<string, unknown>>): Record<string, string> => ({
  ...FIXTURE,
  ...Object.fromEntries(Object.entries(files).map(([file, data]) => [file, JSON.stringify(data)])),
});

const rowOf = (ledger: Ledger, file: string): FileRow | undefined =>
  ledger.files.find((entry) => entry.path === file);

const sha256 = (text: string): string => createHash("sha256").update(text).digest("hex");

describe("ledger.mjs with no overlay and no slices", () => {
  it("renders the bytes it rendered before the overlay existed, an empty overlay included", async () => {
    const bare = valueOf(built(plant(FIXTURE)));
    const empty = valueOf(
      built(plant(withOverlay({ [ADJUDICATIONS]: { entries: {} }, [SLICES]: { slices: {} } })))
    );

    expect(sha256(await core.render(bare.ledger))).toBe(C1_FIXTURE_SHA256);
    expect(await core.render(empty.ledger)).toBe(await core.render(bare.ledger));
    expect([bare.problems, empty.problems]).toEqual([[], []]);
  });
});

describe("ledger.mjs adjudications.json", () => {
  it("confirms a row with the overlay's verdict, keeps its machine basis and verdict beside it, and counts it confirmed", () => {
    const { ledger, problems, machine } = valueOf(
      built(plant(withOverlay({ [ADJUDICATIONS]: { entries: { [B]: CONFIRMATION } } })))
    );

    expect(rowOf(ledger, B)).toMatchObject({
      verdict: "KEEP",
      basis: "some-decorative",
      status: "confirmed",
      sliceId: null,
    });
    expect(machine.get(B)).toBe("REWRITE");
    expect(rowOf(ledger, A)).toMatchObject({ verdict: "KEEP", status: "machine" });
    expect(ledger.summary.rows).toEqual({ machine: 3, confirmed: 1, total: 4 });
    expect(ledger.summary.files.byVerdict).toEqual({
      DELETE: 2,
      REWRITE: 0,
      KEEP: 2,
      ADJUDICATE: 0,
      unmeasured: 0,
    });
    expect(problems).toEqual([]);
  });

  it.each<[string, string, unknown, string]>([
    ["a path the ledger does not list", MISSING, CONFIRMATION, "the ledger lists no such row"],
    ["an entry that is no object", B, "KEEP", "is not an object"],
    ["an unknown key", B, { ...CONFIRMATION, note: "x" }, "has unknown keys note"],
    [
      "a verdict that decides nothing",
      B,
      { ...CONFIRMATION, verdict: "ADJUDICATE" },
      'has verdict "ADJUDICATE", not DELETE|REWRITE|KEEP',
    ],
    [
      "a criterion outside the plan's four",
      B,
      { ...CONFIRMATION, criteria: ["e"] },
      'has criteria ["e"], not distinct criteria of a|b|c|d',
    ],
    [
      "a block the row does not hold",
      B,
      { ...CONFIRMATION, blocks: [`${B}::gone`] },
      `has blocks ["${B}::gone"], not distinct block ids of its row`,
    ],
    ["no evidence", B, { ...CONFIRMATION, evidence: "" }, "has no evidence"],
    [
      "a status other than confirmed",
      B,
      { ...CONFIRMATION, status: "machine" },
      'has status "machine", not confirmed',
    ],
    ["no reviewer", B, { ...CONFIRMATION, reviewer: undefined }, "has no reviewer"],
    [
      "a date that is no calendar day",
      B,
      { ...CONFIRMATION, date: "2026-02-30" },
      'has date "2026-02-30", not a YYYY-MM-DD day',
    ],
  ])(
    "refuses %s, naming the path, and leaves every row the machine's",
    (_case, file, entry, why) => {
      const { ledger, problems } = valueOf(
        built(plant(withOverlay({ [ADJUDICATIONS]: { entries: { [file]: entry } } })))
      );

      expect(problems).toEqual([`${ADJUDICATIONS}: ${file}: ${why}`]);
      expect(rowOf(ledger, B)).toMatchObject({ verdict: "REWRITE", status: "machine" });
      expect(ledger.summary.rows.confirmed).toBe(0);
    }
  );

  it("writes the ledger with the refused entry left out, prints the refusal and exits 1", async () => {
    const root = plant(withOverlay({ [ADJUDICATIONS]: { entries: { [MISSING]: CONFIRMATION } } }));

    const result = await run(root);

    expect(result.code).toBe(1);
    expect(result.output).toContain(
      `ledger: refused: ${ADJUDICATIONS}: ${MISSING}: the ledger lists no such row\n`
    );
    expect(readLedger(ledgerFile(root)).summary.rows.confirmed).toBe(0);
  });

  it.each<[string, string, string]>([
    ["no JSON", "{ entries", `${ADJUDICATIONS} is not JSON: `],
    [
      "no entries object",
      JSON.stringify({ [B]: CONFIRMATION }),
      `${ADJUDICATIONS} is not one object, { "entries": { ... } }`,
    ],
  ])("returns 3 and writes nothing when the overlay holds %s", async (_case, text, line) => {
    const root = plant({ ...FIXTURE, [ADJUDICATIONS]: text });

    const result = await run(root);

    expect(result.code).toBe(3);
    expect(result.output).toContain(`ledger: unread: ${line}`);
    expect(existsSync(ledgerFile(root))).toBe(false);
  });
});

describe("ledger.mjs slices.json", () => {
  it("renders each assigned row's sliceId and the slice's sorted files and expected drop", () => {
    const { ledger, problems } = valueOf(
      built(plant(withOverlay({ [SLICES]: { slices: { "2.6a": { files: [C, B] } } } })))
    );

    expect(ledger.slices).toEqual({
      "2.6a": { files: [B, C], expectedDrop: { files: 1, blocks: 2 } },
    });
    expect(ledger.files.map((file) => [file.path, file.sliceId])).toEqual([
      [HELPER, null],
      [A, null],
      [B, "2.6a"],
      [C, "2.6a"],
    ]);
    expect(problems).toEqual([]);
  });

  it("counts a confirmed DELETE in its slice's expected drop", () => {
    const deleted = { ...CONFIRMATION, verdict: "DELETE", criteria: ["a"] };
    const { ledger } = valueOf(
      built(
        plant(
          withOverlay({
            [ADJUDICATIONS]: { entries: { [B]: deleted } },
            [SLICES]: { slices: { "2.6a": { files: [B, C] } } },
          })
        )
      )
    );

    expect(ledger.slices["2.6a"]?.expectedDrop).toEqual({ files: 2, blocks: 4 });
  });

  it.each<
    [string, Readonly<Record<string, unknown>>, string, Readonly<Record<string, LedgerSlice>>]
  >([
    [
      "a slice id outside ADR-0039's grammar",
      { "slice-one": { files: [C] } },
      "slice-one: is not a slice id of ADR-0039's grammar [0-9]+(\\.[0-9]+)+[a-z]?",
      {},
    ],
    [
      "a slice that is no files object",
      { "2.6a": [C] },
      '2.6a: is not one object, { "files": [<distinct paths>] }',
      {},
    ],
    ["a slice that lists no file", { "2.6a": { files: [] } }, "2.6a: lists no file", {}],
    [
      "a path the ledger does not list",
      { "2.6a": { files: [MISSING] } },
      `2.6a: ${MISSING}: the ledger lists no such row`,
      { "2.6a": { files: [], expectedDrop: { files: 0, blocks: 0 } } },
    ],
    [
      "a path in two slices",
      { "2.6a": { files: [C] }, "2.6b": { files: [C] } },
      `2.6b: ${C}: already in slice 2.6a`,
      {
        "2.6a": { files: [C], expectedDrop: { files: 1, blocks: 2 } },
        "2.6b": { files: [], expectedDrop: { files: 0, blocks: 0 } },
      },
    ],
  ])("refuses %s, naming it", (_case, slices, why, rendered) => {
    const { ledger, problems } = valueOf(built(plant(withOverlay({ [SLICES]: { slices } }))));

    expect(problems).toEqual([`${SLICES}: ${why}`]);
    expect(ledger.slices).toEqual(rendered);
  });

  it("returns 1 on --check naming a planted malformed slice id, the committed ledger otherwise current", async () => {
    const root = plant(FIXTURE);
    await run(root);
    writeFileSync(path.join(root, SLICES), JSON.stringify({ slices: { "2.6-a": { files: [B] } } }));

    const result = await run(root, ["--check"]);

    expect(result).toEqual({
      code: 1,
      output:
        `ledger: refused: ${SLICES}: 2.6-a: is not a slice id of ADR-0039's grammar [0-9]+(\\.[0-9]+)+[a-z]?\n` +
        `ledger: ${MARKDOWN} is current\n`,
    });
  });

  it("returns 3 and writes nothing when slices.json holds no slices object", async () => {
    const root = plant({ ...FIXTURE, [SLICES]: JSON.stringify({ "2.6a": { files: [C] } }) });

    const result = await run(root);

    expect(result).toEqual({
      code: 3,
      output: `ledger: unread: ${SLICES} is not one object, { "slices": { ... } }\n`,
    });
    expect(existsSync(ledgerFile(root))).toBe(false);
  });
});

/** A seed script decision D17 excludes from every delete slice, listed beside `FIXTURE`. */
const SEED = "apps/api/scripts/seed-demo-data.ts";

describe("ledger.mjs overlay guards", () => {
  const keep = JSON.stringify(CONFIRMATION);
  const deleted = JSON.stringify({ ...CONFIRMATION, verdict: "DELETE", criteria: ["a"] });

  it.each<[string, string, string, string]>([
    [
      "a path confirmed twice",
      ADJUDICATIONS,
      `{ "entries": { "${B}": ${keep}, "${B}": ${deleted} } }`,
      `the key "${B}" twice under entries`,
    ],
    [
      "a field written twice in one entry",
      ADJUDICATIONS,
      `{ "entries": { "${B}": { "verdict": "DELETE", ${keep.slice(1)} } }`,
      `the key "verdict" twice under entries > ${B}`,
    ],
    [
      "a slice declared twice",
      SLICES,
      `{ "slices": { "2.6a": { "files": ["${C}"] }, "2.6a": { "files": ["${B}"] } } }`,
      'the key "2.6a" twice under slices',
    ],
    [
      "a top-level key written twice",
      SLICES,
      '{ "slices": {}, "slices": {} }',
      'the key "slices" twice at its top level',
    ],
  ])(
    "returns 3 and writes nothing on %s, naming the file and the key",
    async (_case, file, text, what) => {
      const root = plant({ ...FIXTURE, [file]: text });

      const result = await run(root);

      expect(result).toEqual({ code: 3, output: `ledger: unread: ${file} holds ${what}\n` });
      expect(existsSync(ledgerFile(root))).toBe(false);
    }
  );

  it("refuses to confirm DELETE for a row decision D17 excludes, and to place it in a slice, naming the path and D17", () => {
    const root = plant(
      withOverlay({
        [SEED]: "export {};\n",
        [ADJUDICATIONS]: {
          entries: { [SEED]: { ...CONFIRMATION, verdict: "DELETE", blocks: [] } },
        },
        [SLICES]: { slices: { "2.6a": { files: [SEED, C] } } },
      })
    );
    const listing = [...Object.keys(FIXTURE), SEED];

    const { ledger, problems } = valueOf(built(root, { listFiles: () => ({ value: listing }) }));

    expect(problems).toEqual([
      `${ADJUDICATIONS}: ${SEED}: is excluded by D17, which no confirmation turns into DELETE`,
      `${SLICES}: 2.6a: ${SEED}: is excluded by D17 from every delete slice`,
    ]);
    expect(rowOf(ledger, SEED)).toMatchObject({
      verdict: "ADJUDICATE",
      excluded: "D17",
      status: "machine",
      sliceId: null,
    });
    expect(ledger.slices).toEqual({
      "2.6a": { files: [C], expectedDrop: { files: 1, blocks: 2 } },
    });
  });

  it("confirms KEEP for a row decision D17 excludes", () => {
    const root = plant(
      withOverlay({
        [SEED]: "export {};\n",
        [ADJUDICATIONS]: { entries: { [SEED]: { ...CONFIRMATION, blocks: [] } } },
      })
    );
    const listing = [...Object.keys(FIXTURE), SEED];

    const { ledger, problems } = valueOf(built(root, { listFiles: () => ({ value: listing }) }));

    expect(problems).toEqual([]);
    expect(rowOf(ledger, SEED)).toMatchObject({ verdict: "KEEP", status: "confirmed" });
  });

  it("reports one file, one test-shaped file and one block in the singular", async () => {
    const files = {
      "pnpm-workspace.yaml": FIXTURE["pnpm-workspace.yaml"] ?? "",
      [QUARANTINE_FILE]: FIXTURE[QUARANTINE_FILE] ?? "",
      [A]: SOURCES.behavioural,
    };
    const root = plant(files);

    const result = await run(root, [], { listFiles: () => ({ value: Object.keys(files) }) });

    expect(result.output).toContain(
      "ledger: wrote ledger.json: 1 file, 1 test-shaped, 1 block, 0 with a criterion\n"
    );
  });
});

/** The page `FIXTURE` renders to with no overlay and no slice. */
const FIXTURE_MARKDOWN = [
  "# Test ledger",
  "",
  "> Generated by `scripts/testing/ledger.mjs` from the tracked tree and the `adjudications.json` and `slices.json` beside this page; never edit it by hand. `pnpm ledger` regenerates it and `pnpm check:ledger` fails when it is stale.",
  "",
  "## Summary",
  "",
  "| Measure                 | Count |",
  "| ----------------------- | ----- |",
  "| Files                   | 4     |",
  "| DELETE                  | 2     |",
  "| REWRITE                 | 1     |",
  "| KEEP                    | 1     |",
  "| ADJUDICATE              | 0     |",
  "| unmeasured              | 0     |",
  "| Machine rows            | 4     |",
  "| Confirmed rows          | 0     |",
  "| Blocks                  | 5     |",
  "| Blocks with a criterion | 3     |",
  "",
  "## Rows without a slice",
  "",
  "| Path                                    | Shape  | Blocks | Decorative | Verdict | Status  | Basis           |",
  "| --------------------------------------- | ------ | ------ | ---------- | ------- | ------- | --------------- |",
  "| `apps/api/tests/unit/a.test-helpers.ts` | helper | 0      | 0          | DELETE  | machine | dead-helper     |",
  "| `apps/api/tests/unit/a.test.ts`         | test   | 1      | 0          | KEEP    | machine | behavioural     |",
  "| `apps/api/tests/unit/b.test.ts`         | test   | 2      | 1          | REWRITE | machine | some-decorative |",
  "| `apps/api/tests/unit/c.test.ts`         | test   | 2      | 2          | DELETE  | machine | all-decorative  |",
  "",
].join("\n");

describe("ledger.mjs LEDGER.md", () => {
  it("writes the page beside the overlay, deterministic, with no clock and no absolute path", async () => {
    const root = plant(FIXTURE);

    const result = await run(root);
    const page = readFileSync(path.join(root, MARKDOWN), "utf8");
    await run(root, [], { listFiles: () => ({ value: Object.keys(FIXTURE).reverse() }) });

    expect(result).toEqual({
      code: 0,
      output:
        "ledger: wrote ledger.json: 4 files, 3 test-shaped, 5 blocks, 3 with a criterion\n" +
        `ledger: wrote ${MARKDOWN}\n`,
    });
    expect(page).toBe(FIXTURE_MARKDOWN);
    expect(readFileSync(path.join(root, MARKDOWN), "utf8")).toBe(page);
    expect(page).not.toContain(root);
    expect(page).not.toMatch(/\d{4}-\d{2}-\d{2}T|\d{2}:\d{2}:\d{2}/);
  });

  it("renders one section per slice with its expected drop, and the status column machine against confirmed", async () => {
    const root = plant(
      withOverlay({
        [ADJUDICATIONS]: { entries: { [B]: CONFIRMATION } },
        [SLICES]: { slices: { "2.6a": { files: [C, B] } } },
      })
    );

    await run(root);
    const page = readFileSync(path.join(root, MARKDOWN), "utf8");

    const slice = page.slice(
      page.indexOf("## Slice 2.6a"),
      page.indexOf("## Rows without a slice")
    );
    const rest = page.slice(page.indexOf("## Rows without a slice"));
    expect(slice).toContain("Expected drop: 1 file, 2 blocks.");
    expect(slice).toMatch(
      new RegExp(
        `\\| \`${B}\` +\\| test +\\| 2 +\\| 1 +\\| KEEP +\\| confirmed \\(machine: REWRITE\\) +\\| some-decorative +\\|`
      )
    );
    expect(slice).toMatch(
      new RegExp(
        `\\| \`${C}\` +\\| test +\\| 2 +\\| 2 +\\| DELETE +\\| machine +\\| all-decorative +\\|`
      )
    );
    expect(rest).toContain(`\`${A}\``);
    expect(rest).not.toContain(`\`${B}\``);
    expect(page).toMatch(/\| Confirmed rows +\| 1 +\|/);
  });

  it("writes the page beside --out's file when --out lies outside the root, so a scratch run writes nothing into the tree", async () => {
    const root = plant(FIXTURE);
    const scratch = plant({});
    const out = path.join(scratch, "ledger.json");

    const result = await run(root, ["--out", out]);

    expect(result.code).toBe(0);
    expect(readFileSync(path.join(scratch, "LEDGER.md"), "utf8")).toBe(FIXTURE_MARKDOWN);
    expect(existsSync(path.join(root, MARKDOWN))).toBe(false);
  });

  it("writes the page under docs/ when --out names a file inside the root, never a Markdown file at the root", async () => {
    const root = plant(FIXTURE);

    const result = await run(root, ["--out", ledgerFile(root)]);

    expect(result.output).toContain(`ledger: wrote ${MARKDOWN}\n`);
    expect(readFileSync(path.join(root, MARKDOWN), "utf8")).toBe(FIXTURE_MARKDOWN);
    expect(existsSync(path.join(root, "LEDGER.md"))).toBe(false);
  });

  it("returns 3 naming the page when it cannot be written", async () => {
    const root = plant(FIXTURE);
    mkdirSync(path.join(root, MARKDOWN), { recursive: true });

    const result = await run(root);

    expect(result.code).toBe(3);
    expect(result.output).toContain(`ledger: ${MARKDOWN} could not be written: EISDIR`);
  });

  it("returns 0 on --check over the page it wrote, and 1 naming the page once it drifts", async () => {
    const root = plant(FIXTURE);
    await run(root);

    const current = await run(root, ["--check"]);
    writeFileSync(path.join(root, MARKDOWN), `${FIXTURE_MARKDOWN}\nedited by hand\n`);
    const drifted = await run(root, ["--check"]);

    expect(current).toEqual({
      code: 0,
      output: `ledger: ledger.json is current\nledger: ${MARKDOWN} is current\n`,
    });
    expect(drifted).toEqual({
      code: 1,
      output:
        "ledger: ledger.json is current\n" +
        `ledger: drift: ${MARKDOWN} differs from the rendered ledger\n` +
        `ledger: ${MARKDOWN} is stale; run \`pnpm ledger\` and commit the result\n`,
    });
  });

  it("returns 3 on --check with no committed page, naming it and no drift of the ledger", async () => {
    const root = plant(FIXTURE);
    await run(root);
    rmSync(path.join(root, MARKDOWN));
    retitle(root);

    const result = await run(root, ["--check"]);

    expect(result).toEqual({
      code: 3,
      output: `ledger: unread: no committed page at ${MARKDOWN}; run \`pnpm ledger\` and commit it\n`,
    });
  });

  it("returns 3 and writes nothing when the page cannot be rendered", async () => {
    const root = plant(FIXTURE);

    const result = await run(root, [], {
      renderMarkdown: () => Promise.reject(new Error("the configuration could not be read")),
    });

    expect(result).toEqual({
      code: 3,
      output: `ledger: unread: ${MARKDOWN} could not be rendered: the configuration could not be read\n`,
    });
    expect([existsSync(ledgerFile(root)), existsSync(path.join(root, MARKDOWN))]).toEqual([
      false,
      false,
    ]);
  });
});

describe("ledger.mjs --area", () => {
  it("prints file:line:title for every block of the matching DELETE rows, a block-less file by its path, and the expected drop, writing nothing", async () => {
    const root = plant(FIXTURE);

    const result = await run(root, ["--area", "apps/api/tests/unit/*"]);

    expect(result).toEqual({
      code: 0,
      output:
        `${HELPER}\n` +
        `${C}:2:loads the module\n` +
        `${C}:5:is pending\n` +
        "ledger: area apps/api/tests/unit/*: expected drop 2 files, 2 blocks\n",
    });
    expect([existsSync(ledgerFile(root)), existsSync(path.join(root, MARKDOWN))]).toEqual([
      false,
      false,
    ]);
  });

  it("lists a row the overlay confirms DELETE and leaves out a matching row it confirms KEEP", async () => {
    const root = plant(
      withOverlay({
        [ADJUDICATIONS]: {
          entries: {
            [B]: { ...CONFIRMATION, verdict: "DELETE", criteria: ["a"] },
            [C]: { ...CONFIRMATION, blocks: [] },
          },
        },
      })
    );

    const result = await run(root, ["--area", "apps/api/tests/unit/[bc].test.ts"]);

    expect(result).toEqual({
      code: 0,
      output:
        `${B}:2:returns the sum\n` +
        `${B}:5:loads the module\n` +
        "ledger: area apps/api/tests/unit/[bc].test.ts: expected drop 1 file, 2 blocks\n",
    });
  });

  it("returns 1 with the listing still printed when an overlay entry is refused", async () => {
    const root = plant(withOverlay({ [ADJUDICATIONS]: { entries: { [MISSING]: CONFIRMATION } } }));

    const result = await run(root, ["--area", C]);

    expect(result).toEqual({
      code: 1,
      output:
        `ledger: refused: ${ADJUDICATIONS}: ${MISSING}: the ledger lists no such row\n` +
        `${C}:2:loads the module\n` +
        `${C}:5:is pending\n` +
        `ledger: area ${C}: expected drop 1 file, 2 blocks\n`,
    });
  });

  it.each<[string, readonly string[], number, string]>([
    [
      "a glob that matches no row",
      ["--area", "apps/web/**"],
      1,
      "ledger: area apps/web/** matches no row of the ledger\n",
    ],
    [
      "--area with --check",
      ["--area", "apps/**", "--check"],
      2,
      "ledger: --area lists a deletion and takes no --check\n",
    ],
    ["an empty --area", ["--area="], 2, "ledger: --area takes a non-empty value\n"],
  ])("returns %s's code", async (_case, argv, code, line) => {
    const result = await run(plant(FIXTURE), argv);

    expect(result.code).toBe(code);
    expect(result.output).toContain(line);
  });
});

/** The run over the repository pays the reach engine and two full ledgers, as `metrics.mjs` M5. */
const REPOSITORY_TIMEOUT = 60_000;

describe("ledger.mjs over the repository", () => {
  let scratch = "";
  let saved: ReachReport | string = "";
  let first: CliResult = { code: -1, output: "" };

  beforeAll(async () => {
    scratch = mkdtempSync(path.join(tmpdir(), "ledger-repository-test-"));
    saved = reachLib.reachReport(REPO_ROOT);
    // Saved as the engine prints it: the reader returns a report only when its errors list is empty.
    const printed = typeof saved === "string" ? saved : JSON.stringify({ ...saved, errors: [] });
    writeFileSync(path.join(scratch, "reach.json"), printed);
    first = await cli.main([
      "--out",
      path.join(scratch, "ledger.json"),
      "--reach",
      path.join(scratch, "reach.json"),
    ]);
  }, REPOSITORY_TIMEOUT);

  afterAll(() => {
    rmSync(scratch, { recursive: true, force: true });
  });

  it(
    "returns the blocks and decorative blocks of a direct classifyFile fold, over M1's test-shaped files",
    { timeout: REPOSITORY_TIMEOUT },
    () => {
      const tracked = execFileSync("git", ["ls-files", "-z"], {
        cwd: REPO_ROOT,
        encoding: "utf8",
        maxBuffer: 64 * 1024 * 1024,
      })
        .split("\0")
        .filter((file) => core.CANONICAL_TEST_SHAPED.test(file));
      const blocks = tracked.flatMap(
        (file) => classifyFile(readFileSync(path.join(REPO_ROOT, file), "utf8"), file).blocks
      );
      const m1 = /^M1\t(\d+) \+ (\d+)\t/m.exec(
        execFileSync(process.execPath, [METRICS_SCRIPT, "--m1"], {
          cwd: REPO_ROOT,
          encoding: "utf8",
        })
      );

      const ledger = readLedger(path.join(scratch, "ledger.json"));

      const testShaped = ledger.files.filter((file) => file.collectors !== null).length;
      expect(typeof saved).toBe("object");
      expect(first.code).toBe(0);
      expect(ledger.summary.blocks.total).toBe(blocks.length);
      expect(ledger.summary.blocks.decorative).toBe(
        blocks.filter((block) => block.criteria.length > 0).length
      );
      expect(testShaped).toBe(tracked.length);
      expect(testShaped).toBe(Number(m1?.[1]) + Number(m1?.[2]));
      const helpers = ledger.files.filter((file) =>
        ["runner", "helper"].includes(file.shape ?? "")
      );
      expect(helpers.filter((file) => typeof file.importers !== "number")).toEqual([]);
    }
  );

  it(
    "writes the same bytes again when reach's report comes through the seam instead of --reach",
    { timeout: REPOSITORY_TIMEOUT },
    async () => {
      const again = path.join(scratch, "again.json");

      const result = await cli.main(["--out", again], { runReach: () => saved });

      expect(result.code).toBe(0);
      expect(readFileSync(again, "utf8")).toBe(
        readFileSync(path.join(scratch, "ledger.json"), "utf8")
      );
    }
  );
});
