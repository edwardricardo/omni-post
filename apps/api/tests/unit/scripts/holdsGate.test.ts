/**
 * @file holdsGate.test.ts
 * @description Pins `scripts/testing/holds-gate.mjs`, the gate that refuses an undocumented
 *   toolchain lag: a direct testing dependency sitting below its latest-mature version with no row
 *   in `docs/security/SECURITY_CANON.md` §"Build-tool version holds & dated-debt overrides".
 *
 *   Every input of the gate is injected from a fixture here — the installed set, the outdated
 *   document, the registry publish times, the measurement instant, the holds table and the
 *   population. That is what makes this suite HERMETIC: it never reaches the npm registry, never
 *   runs `pnpm`, and never reads the repository's own canon, so it measures the gate's RULE rather
 *   than today's dependency tree. A suite that read the live tree would go green or red for reasons
 *   that have nothing to do with the code under test, and would stop being able to prove the red
 *   path at all once the tree was clean.
 *
 *   The fail-closed cases carry as much weight as the happy path. A gate that reports a clean zero
 *   when its table cannot be parsed, or silently skips a package it cannot resolve, is worse than no
 *   gate: it asserts an invariant nobody measured. Each of those refusals is therefore driven here,
 *   including the one where the table cannot be read at all, and the summary line the gate prints on
 *   a clean run is asserted ABSENT on that path.
 *
 *   The TABLE'S OWN SHAPE is driven separately, through `Fixture.table`, because reading the
 *   remove-when from a fixed column INDEX fails SILENTLY rather than loudly: a table that grows a
 *   column keeps parsing, and the gate then tests whichever cell moved into that position — which in
 *   the real canon was the reason, so a row with an empty remove-when passed. Those cases render the
 *   header and the rows verbatim, so a header with no `Remove-when` column, a row whose cell count
 *   disagrees with the header, and an escaped pipe inside a cell can each be presented to the gate
 *   exactly as markdown would present them.
 * @layer infrastructure
 */
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const REPO_ROOT = execFileSync("git", ["rev-parse", "--show-toplevel"], {
  encoding: "utf8",
}).trim();

const GATE_SCRIPT = path.join(REPO_ROOT, "scripts", "testing", "holds-gate.mjs");

/** The instant every fixture measures against; the maturity boundary is 2026-09-20T00:00:00Z. */
const INSTANT = "2026-09-27T00:00:00Z";

const HOLDS_HEADING = "### Build-tool version holds & dated-debt overrides";

interface PopulationEntry {
  readonly name: string;
  readonly absence?: string;
}

interface HoldRow {
  readonly packages: string;
  readonly hold: string;
  readonly where: string;
  readonly removeWhen: string;
}

/** A holds table rendered cell-for-cell, for the cases whose subject IS the table's shape. */
interface RawTable {
  readonly header: readonly string[];
  readonly rows: readonly (readonly string[])[];
  /** Overrides the rendered separator, for the case whose subject IS the separator. */
  readonly separator?: readonly string[];
}

interface Fixture {
  /** Package name → installed semver, as `pnpm ls -r --depth 0 --json` reports it. */
  readonly installed: Record<string, string>;
  /** A second importer, so one name can be installed at two versions across the workspace. */
  readonly alsoInstalled?: Record<string, string>;
  /** Package name → the registry's `time` document: every version with its publish instant. */
  readonly published: Record<string, Record<string, string>>;
  readonly population: readonly PopulationEntry[];
  readonly holds: readonly HoldRow[];
  /** Replaces the rendered table, header included, for the cases about its shape. */
  readonly table?: RawTable;
  /** Replaces the whole canon fixture, for the unreadable-table cases. */
  readonly canonOverride?: string;
  /** Runs against the fixture directory after it is written, to remove an input. */
  readonly mutate?: (dir: string) => void;
}

interface GateResult {
  readonly status: number;
  readonly stdout: string;
  readonly stderr: string;
}

const scratchDirs: string[] = [];

afterEach(() => {
  while (scratchDirs.length > 0) {
    const dir = scratchDirs.pop();
    if (dir !== undefined) rmSync(dir, { recursive: true, force: true });
  }
});

/** The registry cache file name for a package: `@scope/name` → `_scope_name.json`. */
const registryFileName = (name: string): string =>
  `${name.replaceAll("@", "_").replaceAll("/", "_")}.json`;

const renderCanonTable = (table: RawTable): string =>
  [
    "# Security Canon — fixture",
    "",
    "## Audited audit-ignores",
    "",
    HOLDS_HEADING,
    "",
    "> Fixture prose, so the parser must skip it rather than read it as a row.",
    "",
    `| ${table.header.join(" | ")} |`,
    `| ${(table.separator ?? table.header.map(() => "---")).join(" | ")} |`,
    ...table.rows.map((cells) => `| ${cells.join(" | ")} |`),
    "",
    "## How to extend",
    "",
  ].join("\n");

const renderCanon = (holds: readonly HoldRow[]): string =>
  renderCanonTable({
    header: ["Package", "Hold / floor", "Where", "Remove-when"],
    rows: holds.map((row) => [row.packages, row.hold, row.where, row.removeWhen]),
  });

/** Writes one fixture tree and runs the complete gate against it. */
const runGate = (fixture: Fixture): GateResult => {
  const dir = mkdtempSync(path.join(tmpdir(), "holds-gate-"));
  scratchDirs.push(dir);

  const importer = (
    name: string,
    dependencies: Record<string, string>
  ): Record<string, unknown> => ({
    name,
    path: dir,
    private: true,
    version: "0.0.0",
    devDependencies: Object.fromEntries(
      Object.entries(dependencies).map(([pkg, version]) => [pkg, { from: pkg, version, path: dir }])
    ),
  });

  const installedDocument = [
    importer("fixture-workspace", fixture.installed),
    ...(fixture.alsoInstalled === undefined
      ? []
      : [importer("fixture-sibling", fixture.alsoInstalled)]),
  ];
  // `pnpm outdated` reports only what it considers behind the `latest` dist-tag, which is exactly
  // how the gate bounds its registry reads. `latest` here is the highest published version, mature
  // or not — the immaturity of a newer release is the gate's job to notice, not this document's.
  const outdatedDocument = Object.fromEntries(
    Object.entries(fixture.installed).flatMap(([name, current]) => {
      const versions = Object.keys(fixture.published[name] ?? {}).filter(
        (key) => key !== "created" && key !== "modified"
      );
      const latest = versions[versions.length - 1] ?? current;
      return latest === current
        ? []
        : [[name, { current, latest, wanted: latest, dependencyType: "devDependencies" }]];
    })
  );

  const registryDir = path.join(dir, "registry");
  mkdirSync(registryDir);
  for (const [name, times] of Object.entries(fixture.published)) {
    writeFileSync(path.join(registryDir, registryFileName(name)), JSON.stringify(times));
  }

  const inFixture = (file: string): string => path.join(dir, file);
  writeFileSync(inFixture("installed.json"), JSON.stringify(installedDocument));
  writeFileSync(inFixture("outdated.json"), JSON.stringify(outdatedDocument));
  writeFileSync(inFixture("population.json"), JSON.stringify({ packages: fixture.population }));
  const canon =
    fixture.table === undefined ? renderCanon(fixture.holds) : renderCanonTable(fixture.table);
  writeFileSync(inFixture("canon.md"), fixture.canonOverride ?? canon);
  fixture.mutate?.(dir);

  const result = spawnSync(
    process.execPath,
    [
      GATE_SCRIPT,
      "--installed",
      inFixture("installed.json"),
      "--outdated",
      inFixture("outdated.json"),
      "--registry",
      registryDir,
      "--population",
      inFixture("population.json"),
      "--canon",
      inFixture("canon.md"),
      "--instant",
      INSTANT,
    ],
    { encoding: "utf8" }
  );
  return { status: result.status ?? -1, stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
};

const UNRELATED_HOLD: HoldRow = {
  packages: "`unrelated`",
  hold: "`3.0.0` override",
  where: "`overrides` (`pnpm-workspace.yaml`)",
  removeWhen: "every consumer resolves `>=3.0.0` unaided",
};

const WIDGET_HOLD: HoldRow = {
  packages: "`widget`",
  hold: "`1.0.0` held below 2.x",
  where: "catalog (`pnpm-workspace.yaml`)",
  removeWhen: "upstream publishes a 2.x that keeps the callable default export",
};

/** `widget` 2.0.0 published a fortnight before the instant: mature, so 1.0.0 is a lag. */
const WIDGET_MATURE_LAG: Fixture["published"] = {
  widget: {
    created: "2024-01-01T00:00:00Z",
    "1.0.0": "2026-01-01T00:00:00Z",
    "2.0.0": "2026-09-13T00:00:00Z",
  },
};

describe("testing toolchain holds gate", () => {
  describe("a lag with no documented hold", () => {
    it("exits 1 naming the package, its installed version and its latest-mature target", () => {
      const result = runGate({
        installed: { widget: "1.0.0" },
        published: WIDGET_MATURE_LAG,
        population: [{ name: "widget" }],
        holds: [UNRELATED_HOLD],
      });

      expect(result.status).toBe(1);
      expect(result.stderr).toContain("widget");
      expect(result.stderr).toContain("1.0.0");
      expect(result.stderr).toContain("2.0.0");
    });
  });

  describe("a lag that is documented", () => {
    it("exits 0 when a hold row names the lagging package", () => {
      const result = runGate({
        installed: { widget: "1.0.0" },
        published: WIDGET_MATURE_LAG,
        population: [{ name: "widget" }],
        holds: [WIDGET_HOLD],
      });

      expect(result.stderr).toBe("");
      expect(result.status).toBe(0);
    });

    it("exits 0 when a family hold row names the package by glob", () => {
      const result = runGate({
        installed: { "@widget/addon": "1.0.0" },
        published: {
          "@widget/addon": { "1.0.0": "2026-01-01T00:00:00Z", "2.0.0": "2026-09-13T00:00:00Z" },
        },
        population: [{ name: "@widget/addon" }],
        holds: [
          {
            packages: "`widget` (+ `@widget/*` family)",
            hold: "`1.0.0` atomic family-lock",
            where: "catalog (`pnpm-workspace.yaml`)",
            removeWhen: "the family publishes a newer atomic set compatible with the toolchain",
          },
        ],
      });

      expect(result.stderr).toBe("");
      expect(result.status).toBe(0);
    });

    it("exits 0 when a hold row outlives the lag it was written for", () => {
      // A row documents a decision; it is not an assertion that the lag still exists. Failing on a
      // row without a lag would push authors to delete rows to get green, which is the opposite of
      // what the table is for.
      const result = runGate({
        installed: { widget: "2.0.0" },
        published: WIDGET_MATURE_LAG,
        population: [{ name: "widget" }],
        holds: [WIDGET_HOLD],
      });

      expect(result.stderr).toBe("");
      expect(result.status).toBe(0);
    });
  });

  describe("what is not a lag", () => {
    it("does not treat a newer prerelease as a lag", () => {
      const result = runGate({
        installed: { widget: "1.0.0" },
        published: {
          widget: {
            "1.0.0": "2026-01-01T00:00:00Z",
            "2.0.0-beta.4": "2026-07-01T00:00:00Z",
            "2.0.0-rc.1": "2026-08-01T00:00:00Z",
          },
        },
        population: [{ name: "widget" }],
        holds: [UNRELATED_HOLD],
      });

      expect(result.stderr).toBe("");
      expect(result.status).toBe(0);
    });

    it("does not treat a version published inside the maturity buffer as a lag", () => {
      const result = runGate({
        installed: { widget: "1.0.0" },
        published: {
          widget: {
            "1.0.0": "2026-01-01T00:00:00Z",
            // Six days before the instant: newer, stable, and NOT yet a target.
            "2.0.0": "2026-09-21T00:00:00Z",
          },
        },
        population: [{ name: "widget" }],
        holds: [UNRELATED_HOLD],
      });

      expect(result.stderr).toBe("");
      expect(result.status).toBe(0);
    });
  });

  describe("failing closed", () => {
    it("exits 1 when zero hold rows parse from the canon table", () => {
      const result = runGate({
        installed: { widget: "2.0.0" },
        published: WIDGET_MATURE_LAG,
        population: [{ name: "widget" }],
        holds: [],
        canonOverride: ["# Security Canon — fixture", "", "## How to extend", ""].join("\n"),
      });

      expect(result.status).toBe(1);
      expect(result.stderr).toContain("zero");
    });

    it("exits 1 when a hold row carries no remove-when", () => {
      const result = runGate({
        installed: { widget: "1.0.0" },
        published: WIDGET_MATURE_LAG,
        population: [{ name: "widget" }],
        holds: [{ ...WIDGET_HOLD, removeWhen: "—" }],
      });

      expect(result.status).toBe(1);
      expect(result.stderr).toContain("remove-when");
    });

    it("exits 1 naming a population package that is not installed and declares no absence", () => {
      const result = runGate({
        installed: {},
        published: WIDGET_MATURE_LAG,
        population: [{ name: "widget" }],
        holds: [WIDGET_HOLD],
      });

      expect(result.status).toBe(1);
      expect(result.stderr).toContain("widget");
      expect(result.stderr).toContain("not installed");
    });

    it("exits 1 when the registry document of a reported lag cannot be read", () => {
      const result = runGate({
        installed: { widget: "1.0.0", gadget: "1.0.0" },
        published: {
          ...WIDGET_MATURE_LAG,
          gadget: { "1.0.0": "2026-01-01T00:00:00Z", "2.0.0": "2026-09-13T00:00:00Z" },
        },
        population: [{ name: "widget" }, { name: "gadget" }],
        holds: [WIDGET_HOLD],
        // `gadget` is reported outdated, so its target is unknown without this document. Removing it
        // proves the gate refuses rather than assuming "no lag" — the difference between a gate and
        // a decoration.
        mutate: (dir) => {
          rmSync(path.join(dir, "registry", "gadget.json"), { force: true });
        },
      });

      expect(result.status).toBe(1);
      expect(result.stderr).toContain("gadget");
    });

    it("exits 1 without printing a summary when the holds table cannot be read at all", () => {
      // The nastier sibling of "zero rows parsed": there is no table to parse because the file is
      // gone. Both must refuse, and neither may print the run summary, because a summary over
      // inputs that were never read is the clean zero this gate exists to prevent.
      const result = runGate({
        installed: { widget: "2.0.0" },
        published: WIDGET_MATURE_LAG,
        population: [{ name: "widget" }],
        holds: [WIDGET_HOLD],
        mutate: (dir) => {
          rmSync(path.join(dir, "canon.md"), { force: true });
        },
      });

      expect(result.status).toBe(1);
      expect(result.stderr).toContain("could not be read");
      expect(result.stdout).not.toContain("population packages measured");
    });

    it("exits 1 when the population file lists no packages", () => {
      const result = runGate({
        installed: { widget: "2.0.0" },
        published: WIDGET_MATURE_LAG,
        population: [],
        holds: [WIDGET_HOLD],
      });

      expect(result.status).toBe(1);
      expect(result.stderr).toContain("zero packages");
    });

    it("exits 1 when one direct dependency is installed at two different versions", () => {
      // The single-version invariant has its own guard in the same job (syncpack), but a split that
      // reached this gate would make "the installed version" ambiguous, and an ambiguous comparator
      // silently measures whichever copy it happened to pick.
      const result = runGate({
        installed: { widget: "1.0.0" },
        alsoInstalled: { widget: "2.0.0" },
        published: WIDGET_MATURE_LAG,
        population: [{ name: "widget" }],
        holds: [WIDGET_HOLD],
      });

      expect(result.status).toBe(1);
      expect(result.stderr).toContain("two installed versions");
      expect(result.stderr).toContain("1.0.0, 2.0.0");
    });
  });

  describe("a declared absence", () => {
    it("accepts a candidate that is deliberately not installed yet", () => {
      const result = runGate({
        installed: { widget: "2.0.0" },
        published: WIDGET_MATURE_LAG,
        population: [{ name: "widget" }, { name: "gadget", absence: "candidate" }],
        holds: [WIDGET_HOLD],
      });

      expect(result.stderr).toBe("");
      expect(result.status).toBe(0);
      expect(result.stdout).toContain("gadget");
    });

    it("exits 1 when a declared absence is stale because the package is installed", () => {
      const result = runGate({
        installed: { widget: "2.0.0", gadget: "1.0.0" },
        published: WIDGET_MATURE_LAG,
        population: [{ name: "widget" }, { name: "gadget", absence: "candidate" }],
        holds: [WIDGET_HOLD],
      });

      expect(result.status).toBe(1);
      expect(result.stderr).toContain("gadget");
    });

    it("exits 1 on an absence reason the gate does not recognise", () => {
      const result = runGate({
        installed: { widget: "2.0.0" },
        published: WIDGET_MATURE_LAG,
        population: [{ name: "widget" }, { name: "gadget", absence: "someday" }],
        holds: [WIDGET_HOLD],
      });

      expect(result.status).toBe(1);
      expect(result.stderr).toContain("someday");
    });
  });

  describe("the table's own shape", () => {
    const FIVE_COLUMNS = ["Package", "Hold / floor", "Where", "Reason", "Remove-when"] as const;
    const WHERE = "catalog (`pnpm-workspace.yaml`)";
    const REASON = "measured 2026-09-27: the 2.x line drops the callable default export";

    it("exits 1 when a five-column row's remove-when cell is empty", () => {
      // The defect this case exists for: the gate used to read column INDEX 3, which in a
      // five-column table is the REASON. A row whose remove-when was blank therefore passed while
      // the reason answered for it — the invariant read as enforced and was not.
      const result = runGate({
        installed: { widget: "1.0.0" },
        published: WIDGET_MATURE_LAG,
        population: [{ name: "widget" }],
        holds: [],
        table: {
          header: FIVE_COLUMNS,
          rows: [["`widget`", "`1.0.0` held below 2.x", WHERE, REASON, ""]],
        },
      });

      expect(result.status).toBe(1);
      expect(result.stderr).toContain("`widget`");
      expect(result.stderr).toContain("remove-when");
    });

    it("exits 1 naming the header when the table declares no remove-when column", () => {
      // A table whose remove-when column was renamed or dropped cannot be checked for one. Reading
      // whatever sits in its place is how the previous defect happened, so the gate must refuse the
      // TABLE and say which column it wanted.
      const result = runGate({
        installed: { widget: "1.0.0" },
        published: WIDGET_MATURE_LAG,
        population: [{ name: "widget" }],
        holds: [],
        table: {
          header: ["Package", "Hold / floor", "Where", "Notes"],
          rows: [["`widget`", "`1.0.0` held below 2.x", WHERE, REASON]],
        },
      });

      expect(result.status).toBe(1);
      expect(result.stderr).toContain("Remove-when");
      expect(result.stderr).toContain("Notes");
    });

    it("exits 1 naming a row whose cell count disagrees with the header", () => {
      // GFM DROPS a cell a row has beyond the header's count and pads a missing one, so a ragged row
      // renders as if it were whole. The reader sees a complete row; the parser sees a different
      // one. Refusing the row is the only reading that cannot be silently wrong.
      const result = runGate({
        installed: { widget: "1.0.0" },
        published: WIDGET_MATURE_LAG,
        population: [{ name: "widget" }],
        holds: [],
        table: {
          header: FIVE_COLUMNS,
          rows: [["`widget`", "`1.0.0` held below 2.x", WHERE, "upstream keeps the export"]],
        },
      });

      expect(result.status).toBe(1);
      expect(result.stderr).toContain("`widget`");
      expect(result.stderr).toContain("4");
      expect(result.stderr).toContain("5");
    });

    it("exits 1 naming the separator when its cell count disagrees with the header", () => {
      // The separator is the row that MAKES the block a table: when its count disagrees with the
      // header, GFM renders no table at all and every row below it is prose that merely looks
      // tabular. Skipping it by content before counting let that pass, which is the one shape where
      // a reader and the parser disagree about whether a table exists.
      const result = runGate({
        installed: { widget: "1.0.0" },
        published: WIDGET_MATURE_LAG,
        population: [{ name: "widget" }],
        holds: [],
        table: {
          header: FIVE_COLUMNS,
          separator: ["---", "---", "---", "---"],
          rows: [
            ["`widget`", "`1.0.0` held below 2.x", WHERE, REASON, "upstream keeps the export"],
          ],
        },
      });

      expect(result.status).toBe(1);
      expect(result.stderr).toContain("SEPARATOR");
      expect(result.stderr).toContain("4");
      expect(result.stderr).toContain("5");
    });

    it("exits 0 when a cell carries an escaped pipe", () => {
      // `engines.node: ^22 \|\| ^24` is a real cell in the canon. An escaped pipe is cell CONTENT,
      // not a delimiter, so a splitter that cannot tell them apart turns one whole row into a ragged
      // one and fails the tree over markdown that is correct.
      const result = runGate({
        installed: { widget: "1.0.0" },
        published: WIDGET_MATURE_LAG,
        population: [{ name: "widget" }],
        holds: [],
        table: {
          header: FIVE_COLUMNS,
          rows: [
            [
              "`widget`",
              "`1.0.0` held below 2.x",
              WHERE,
              String.raw`2.x declares \`engines.node: ^22 \|\| ^24\``,
              "upstream publishes a 2.x that keeps the callable default export",
            ],
          ],
        },
      });

      expect(result.stderr).toBe("");
      expect(result.status).toBe(0);
    });
  });
});
