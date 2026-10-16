/**
 * @file holdsGate.test.ts
 * @description Pins `scripts/testing/holds-gate.mjs`, the gate that refuses an undocumented
 *   toolchain lag past its budget: a direct testing dependency sitting below a release that has been
 *   mature for 30 days or more, with no row in `docs/security/SECURITY_CANON.md` §"Build-tool version
 *   holds & dated-debt overrides". A younger lag is reported and never red (ADR-0036), so the
 *   budget's two sides and the second it turns are driven here with an injected instant, as is the
 *   refusal of a row that still describes itself as a scheduled hold.
 *
 *   Every input of the gate is injected from a fixture here — the installed set, the outdated
 *   document, the registry publish times, the measurement instant, the holds table and the
 *   population. That is what makes this suite HERMETIC: it never reaches the npm registry, never
 *   runs `pnpm`, and never reads the repository's own canon, so it measures the gate's RULE rather
 *   than today's dependency tree. A suite that read the live tree would go green or red for reasons
 *   that have nothing to do with the code under test, and would stop being able to prove the red
 *   path at all once the tree was clean. Two cases read a tracked file, the population itself, to
 *   pin the gate's SCOPE: the Prisma family's freshness is measured through its CLI, `prisma`, and
 *   the family is declared for the lockstep check, CLI, client and adapter; each case fails when its
 *   declaration leaves the population, still without the registry or pnpm.
 *
 *   The FAMILY cases present importers as `pnpm ls -r --depth 1 --json` prints them: a member's own
 *   dependencies and peers one level below the importer, and a later copy at the same store path
 *   printed as `deduped`, its children only on the copy that was expanded. That is how a member that
 *   keeps an older sibling as its peer is presented, the drift lockfile preference leaves although
 *   every manifest agrees.
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
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const REPO_ROOT = execFileSync("git", ["rev-parse", "--show-toplevel"], {
  encoding: "utf8",
}).trim();

const GATE_SCRIPT = path.join(REPO_ROOT, "scripts", "testing", "holds-gate.mjs");

/**
 * The instant every fixture measures against unless it names its own. The maturity boundary is
 * 2026-09-20T00:00:00Z, and the budget boundary 2026-08-21T00:00:00Z: a release published on or
 * before it has been mature for 30 days or more, so a lag behind it needs a row.
 */
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

/** One dependency entry as `pnpm ls -r --depth 1 --json` prints it, for the family cases. */
interface ListedDependency {
  readonly version: string;
  /** The store path; copies at one path are one installed package. Derived when omitted. */
  readonly path?: string;
  /** A later copy, printed without children: they appear only on the copy that was expanded. */
  readonly deduped?: boolean;
  /** Its own dependencies and resolved peers, one level below the importer. */
  readonly dependencies?: Record<string, ListedDependency>;
}

interface ListedImporter {
  readonly name: string;
  readonly dependencies: Record<string, ListedDependency>;
}

interface Fixture {
  /** Package name → installed semver, as the importer level of `pnpm ls -r --json` reports it. */
  readonly installed: Record<string, string>;
  /** A second importer, so one name can be installed at two versions across the workspace. */
  readonly alsoInstalled?: Record<string, string>;
  /** Further importers, entries and children included, for the family cases. */
  readonly importers?: readonly ListedImporter[];
  /** The population's `families`, verbatim, so a malformed declaration can be presented. */
  readonly families?: readonly unknown[];
  /** Further top-level keys of the population document. */
  readonly populationExtra?: Readonly<Record<string, unknown>>;
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
  /** Replaces `INSTANT`, for the cases whose subject is the second the budget runs out. */
  readonly instant?: string;
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

  const listedEntry = (pkg: string, entry: ListedDependency): Record<string, unknown> => ({
    from: pkg,
    version: entry.version,
    path: entry.path ?? path.join(dir, "store", `${pkg.replaceAll("/", "+")}@${entry.version}`),
    ...(entry.deduped === true && { deduped: true, dedupedDependenciesCount: 1 }),
    ...(entry.dependencies !== undefined && {
      dependencies: Object.fromEntries(
        Object.entries(entry.dependencies).map(([child, body]) => [child, listedEntry(child, body)])
      ),
    }),
  });

  const installedDocument = [
    importer("fixture-workspace", fixture.installed),
    ...(fixture.alsoInstalled === undefined
      ? []
      : [importer("fixture-sibling", fixture.alsoInstalled)]),
    ...(fixture.importers ?? []).map((listed) => ({
      name: listed.name,
      path: path.join(dir, listed.name),
      private: true,
      version: "0.0.0",
      dependencies: Object.fromEntries(
        Object.entries(listed.dependencies).map(([pkg, entry]) => [pkg, listedEntry(pkg, entry)])
      ),
    })),
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
  writeFileSync(
    inFixture("population.json"),
    JSON.stringify({
      packages: fixture.population,
      ...(fixture.families !== undefined && { families: fixture.families }),
      ...fixture.populationExtra,
    })
  );
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
      fixture.instant ?? INSTANT,
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

/**
 * `widget` 2.0.0 published 57 days before the instant, so mature for 50: 1.0.0 is a lag past the
 * 30-day budget, and only a row can make it legal.
 */
const WIDGET_MATURE_LAG: Fixture["published"] = {
  widget: {
    created: "2024-01-01T00:00:00Z",
    "1.0.0": "2026-01-01T00:00:00Z",
    "2.0.0": "2026-08-01T00:00:00Z",
  },
};

/** `widget` 1.0.0 → 2.0.0, with 2.0.0 published at the given instant. */
const widgetPublishedAt = (published: string): Fixture["published"] => ({
  widget: { "1.0.0": "2026-01-01T00:00:00Z", "2.0.0": published },
});

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
    it("exits 0 reporting the row when a hold row names a lag past the budget", () => {
      const result = runGate({
        installed: { widget: "1.0.0" },
        published: WIDGET_MATURE_LAG,
        population: [{ name: "widget" }],
        holds: [WIDGET_HOLD],
      });

      expect(result.stderr).toBe("");
      expect(result.status).toBe(0);
      expect(result.stdout).toContain("widget\t1.0.0\t2.0.0\tlag: held by `widget`");
    });

    it("exits 0 when a family hold row names the package by glob", () => {
      const result = runGate({
        installed: { "@widget/addon": "1.0.0" },
        published: {
          "@widget/addon": { "1.0.0": "2026-01-01T00:00:00Z", "2.0.0": "2026-08-01T00:00:00Z" },
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
      expect(result.stdout).toContain("lag: held by `widget` (+ `@widget/*` family)");
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

  describe("the Prisma family, measured through its CLI", () => {
    /**
     * The registry's own times for `prisma`, read 2026-10-15: its `latest` dist-tag is a release
     * candidate of the next major, while the stable line ends at 7.10.0 (the `prev` dist-tag). The
     * outdated document therefore reports the CLI as behind even when it sits at 7.10.0, and only
     * the gate's own stable-and-mature reading decides.
     */
    const PRISMA_PUBLISHED: Fixture["published"] = {
      prisma: {
        created: "2019-07-24T00:00:00Z",
        "7.9.1": "2026-07-27T13:49:09Z",
        "7.10.0": "2026-08-25T12:47:51Z",
        "8.0.0-rc.23": "2026-10-15T09:32:33Z",
      },
    };
    const PRISMA_INSTANT = "2026-10-15T18:00:00Z";

    it("exits 1 when the CLI sits on 7.9.1 past the budget of 7.10.0, under a prerelease latest", () => {
      // The dates derive from the publish instant and the gate's two windows: 7.10.0 was published
      // 2026-08-25T12:47:51Z, so the 7-day maturity buffer (ADR-0018) makes it a target from
      // 2026-09-01T12:47:51Z, and the 30-day budget (ADR-0036) that counts from that instant ran out
      // 2026-10-01T12:47:51Z, two weeks before PRISMA_INSTANT.
      const result = runGate({
        installed: { prisma: "7.9.1" },
        published: PRISMA_PUBLISHED,
        population: [{ name: "prisma" }],
        holds: [UNRELATED_HOLD],
        instant: PRISMA_INSTANT,
      });

      expect(result.status).toBe(1);
      expect(result.stdout).toContain("prisma\t7.9.1\t7.10.0\tlag: UNDOCUMENTED");
      expect(result.stderr).toContain("prisma is installed at 7.9.1");
    });

    it("exits 0 when the CLI sits on the latest stable release although latest is a candidate", () => {
      const result = runGate({
        installed: { prisma: "7.10.0" },
        published: PRISMA_PUBLISHED,
        population: [{ name: "prisma" }],
        holds: [UNRELATED_HOLD],
        instant: PRISMA_INSTANT,
      });

      expect(result.stderr).toBe("");
      expect(result.status).toBe(0);
      expect(result.stdout).toContain("prisma\t7.10.0\t7.10.0\tat or above latest mature");
    });

    it("names the CLI in the tracked population, with no declared absence", () => {
      // The one case that reads a tracked file instead of a fixture: what it pins is the gate's
      // SCOPE, the population, not the dependency tree, so it stays independent of the registry
      // and of pnpm.
      const tracked = JSON.parse(
        readFileSync(
          path.join(REPO_ROOT, "scripts", "testing", "toolchain-population.json"),
          "utf8"
        )
      ) as { packages: PopulationEntry[] };

      const entry = tracked.packages.find((candidate) => candidate.name === "prisma");

      expect(entry).toEqual({ name: "prisma" });
    });

    it("declares the CLI, the client and the adapter as one family in the tracked population", () => {
      // The second case that reads the tracked population: without this declaration the lockstep
      // check has nothing to compare and passes, so the scope it pins is the family itself.
      const tracked = JSON.parse(
        readFileSync(
          path.join(REPO_ROOT, "scripts", "testing", "toolchain-population.json"),
          "utf8"
        )
      ) as { families?: { name: string; members: string[] }[] };

      const family = tracked.families?.find((candidate) => candidate.name === "prisma");

      expect(family?.members).toEqual(["prisma", "@prisma/client", "@prisma/adapter-pg"]);
    });
  });

  describe("a family checked for lockstep", () => {
    const GEN_FAMILY = {
      name: "gen",
      members: ["gen-cli", "gen-client", "gen-adapter"],
      note: "the CLI generates the client that the adapter drives",
    } as const;

    /**
     * The members as the Prisma family sits in the tree: the CLI, the client and the adapter in one
     * importer, the client in a second, and every copy of the client resolving the CLI as its peer.
     */
    const genImporters = (versions: {
      readonly cli?: string;
      readonly adapter?: string;
      readonly peerInApi?: string;
    }): ListedImporter[] => [
      {
        name: "@fixture/db",
        dependencies: {
          "gen-cli": { version: versions.cli ?? "1.2.0" },
          "gen-adapter": { version: versions.adapter ?? "1.2.0" },
          "gen-client": {
            version: "1.2.0",
            dependencies: { "gen-cli": { version: versions.cli ?? "1.2.0" } },
          },
        },
      },
      {
        name: "@fixture/api",
        dependencies: {
          "gen-client": {
            version: "1.2.0",
            path: "/store/gen-client@1.2.0(gen-cli@api)",
            dependencies: { "gen-cli": { version: versions.peerInApi ?? "1.2.0" } },
          },
        },
      },
    ];

    /** A population at its latest, so every red below is the family's. */
    const AT_LATEST = {
      installed: { widget: "2.0.0" },
      published: WIDGET_MATURE_LAG,
      population: [{ name: "widget" }],
      holds: [WIDGET_HOLD],
    } as const;

    it("exits 0 reporting the family in lockstep when every member resolves to one version", () => {
      const result = runGate({ ...AT_LATEST, importers: genImporters({}), families: [GEN_FAMILY] });

      expect(result.stderr).toBe("");
      expect(result.status).toBe(0);
      expect(result.stdout).toContain(
        "family gen\t1.2.0\tin lockstep (3 members, 6 resolutions read in 2 importers)"
      );
    });

    it("exits 1 naming both versions and the importer when one member is a patch apart", () => {
      const result = runGate({
        ...AT_LATEST,
        importers: genImporters({ adapter: "1.2.1" }),
        families: [GEN_FAMILY],
      });

      expect(result.status).toBe(1);
      expect(result.stderr).toContain("family gen does not resolve to one version");
      expect(result.stderr).toContain("1.2.0 — gen-cli in @fixture/db");
      expect(result.stderr).toContain("1.2.1 — gen-adapter in @fixture/db");
      expect(result.stdout).toContain("family gen\t1.2.0, 1.2.1\tNOT in lockstep");
    });

    it("exits 1 when a member keeps an older sibling as its peer although every declaration agrees", () => {
      // Lockfile preference leaves this shape: each manifest names 1.2.0, and the client in a second
      // importer still resolves the previous CLI as its peer.
      const result = runGate({
        ...AT_LATEST,
        importers: genImporters({ peerInApi: "1.1.0" }),
        families: [GEN_FAMILY],
      });

      expect(result.status).toBe(1);
      expect(result.stderr).toContain("1.1.0 — gen-cli in @fixture/api under gen-client");
    });

    it("reads a deduplicated copy through the copy that was expanded, naming its own importer", () => {
      // `pnpm ls` prints a store path's children once. The divergence below is visible only through
      // the expanded copy in @fixture/db, so naming @fixture/api proves the deduplicated copy was
      // read rather than skipped.
      const shared = "/store/gen-client@1.2.0(gen-cli@1.1.0)";
      const result = runGate({
        ...AT_LATEST,
        importers: [
          {
            name: "@fixture/db",
            dependencies: {
              "gen-cli": { version: "1.2.0" },
              "gen-adapter": { version: "1.2.0" },
              "gen-client": {
                version: "1.2.0",
                path: shared,
                dependencies: { "gen-cli": { version: "1.1.0" } },
              },
            },
          },
          {
            name: "@fixture/api",
            dependencies: { "gen-client": { version: "1.2.0", path: shared, deduped: true } },
          },
        ],
        families: [GEN_FAMILY],
      });

      expect(result.status).toBe(1);
      expect(result.stderr).toContain("gen-cli in @fixture/api under gen-client");
    });

    it("exits 1 when a deduplicated copy has no expanded copy in the listing", () => {
      const result = runGate({
        ...AT_LATEST,
        importers: [
          ...genImporters({}),
          {
            name: "@fixture/web",
            dependencies: {
              "gen-client": { version: "1.2.0", path: "/store/never-expanded", deduped: true },
            },
          },
        ],
        families: [GEN_FAMILY],
      });

      expect(result.status).toBe(1);
      expect(result.stderr).toContain("gen-client in @fixture/web is listed as deduplicated");
      expect(result.stderr).toContain("cannot be read");
    });

    it("exits 1 naming a family member that no importer declares", () => {
      const result = runGate({
        ...AT_LATEST,
        importers: genImporters({}),
        families: [{ ...GEN_FAMILY, members: [...GEN_FAMILY.members, "gen-plugin"] }],
      });

      expect(result.status).toBe(1);
      expect(result.stderr).toContain("gen-plugin is a member that no importer declares");
    });

    it("exits 1 on a family with fewer than two members", () => {
      const result = runGate({
        ...AT_LATEST,
        importers: genImporters({}),
        families: [{ ...GEN_FAMILY, members: ["gen-cli"] }],
      });

      expect(result.status).toBe(1);
      expect(result.stderr).toContain("family gen has 1 member(s)");
      expect(result.stdout).not.toContain("family gen\t");
    });

    it("exits 1 on a family field the gate does not read", () => {
      const result = runGate({
        ...AT_LATEST,
        importers: genImporters({}),
        families: [{ ...GEN_FAMILY, lockstep: true }],
      });

      expect(result.status).toBe(1);
      expect(result.stderr).toContain('family gen declares "lockstep"');
    });

    it("exits 1 on a family with no note saying why its members move together", () => {
      const result = runGate({
        ...AT_LATEST,
        importers: genImporters({}),
        families: [{ name: GEN_FAMILY.name, members: GEN_FAMILY.members }],
      });

      expect(result.status).toBe(1);
      expect(result.stderr).toContain("family gen carries no note");
    });

    it("exits 1 when one package is a member of two families", () => {
      const result = runGate({
        ...AT_LATEST,
        importers: genImporters({}),
        families: [
          GEN_FAMILY,
          { name: "other", members: ["gen-client", "other-tool"], note: "a second claim" },
        ],
      });

      expect(result.status).toBe(1);
      expect(result.stderr).toContain("gen-client is a member of both family gen and family other");
    });

    it("exits 1 on a population key the gate does not read", () => {
      // A misspelled `families` would otherwise check nothing and pass.
      const result = runGate({
        ...AT_LATEST,
        importers: genImporters({}),
        populationExtra: { familes: [GEN_FAMILY] },
      });

      expect(result.status).toBe(1);
      expect(result.stderr).toContain('declares "familes"');
    });
  });

  describe("the 30-day staleness budget", () => {
    it("exits 1 naming the package when an unheld lag has been mature for 31 days", () => {
      // Published 38 days before the instant, so mature for 31: one day past the budget.
      const result = runGate({
        installed: { widget: "1.0.0" },
        published: widgetPublishedAt("2026-08-20T00:00:00Z"),
        population: [{ name: "widget" }],
        holds: [UNRELATED_HOLD],
      });

      expect(result.status).toBe(1);
      expect(result.stderr).toContain("widget");
      expect(result.stderr).toContain("2.0.0");
      expect(result.stdout).toContain("widget\t1.0.0\t2.0.0\tlag: UNDOCUMENTED");
    });

    it("exits 0 reporting the days used when an unheld lag has been mature for 29 days", () => {
      const result = runGate({
        installed: { widget: "1.0.0" },
        published: widgetPublishedAt("2026-08-22T00:00:00Z"),
        population: [{ name: "widget" }],
        holds: [UNRELATED_HOLD],
      });

      expect(result.stderr).toBe("");
      expect(result.status).toBe(0);
      expect(result.stdout).toContain("widget\t1.0.0\t2.0.0\tlag: within budget (29 d of 30)");
    });

    it("exits 0 one second before the budget runs out", () => {
      // 2.0.0 matured at 2026-08-28T00:00:00Z, so its 30 days end at 2026-09-27T00:00:00Z.
      const result = runGate({
        installed: { widget: "1.0.0" },
        published: widgetPublishedAt("2026-08-21T00:00:00Z"),
        population: [{ name: "widget" }],
        holds: [UNRELATED_HOLD],
        instant: "2026-09-26T23:59:59Z",
      });

      expect(result.stderr).toBe("");
      expect(result.status).toBe(0);
      expect(result.stdout).toContain("lag: within budget (29 d of 30)");
    });

    it("exits 1 one second after the budget runs out", () => {
      const result = runGate({
        installed: { widget: "1.0.0" },
        published: widgetPublishedAt("2026-08-21T00:00:00Z"),
        population: [{ name: "widget" }],
        holds: [UNRELATED_HOLD],
        instant: "2026-09-27T00:00:01Z",
      });

      expect(result.status).toBe(1);
      expect(result.stderr).toContain("widget");
      expect(result.stdout).toContain("lag: UNDOCUMENTED");
    });

    it("exits 1 when the oldest unmet release is past the budget although the newest is not", () => {
      // 1.1.0 has been mature for 50 days and 2.0.0, the latest mature, for 5. A clock started by
      // the newest release would restart on every release, and a package that ships weekly would
      // never reach the budget.
      const result = runGate({
        installed: { widget: "1.0.0" },
        published: {
          widget: {
            "1.0.0": "2026-01-01T00:00:00Z",
            "1.1.0": "2026-08-01T00:00:00Z",
            "2.0.0": "2026-09-15T00:00:00Z",
          },
        },
        population: [{ name: "widget" }],
        holds: [UNRELATED_HOLD],
      });

      expect(result.status).toBe(1);
      expect(result.stderr).toContain("1.1.0");
      expect(result.stdout).toContain("widget\t1.0.0\t2.0.0\tlag: UNDOCUMENTED");
    });

    it("counts the days from the oldest unmet release, not the newest", () => {
      // 1.1.0 has been mature for 26 days and 2.0.0 for 5: the line reports 26.
      const result = runGate({
        installed: { widget: "1.0.0" },
        published: {
          widget: {
            "1.0.0": "2026-01-01T00:00:00Z",
            "1.1.0": "2026-08-25T00:00:00Z",
            "2.0.0": "2026-09-15T00:00:00Z",
          },
        },
        population: [{ name: "widget" }],
        holds: [UNRELATED_HOLD],
      });

      expect(result.stderr).toBe("");
      expect(result.status).toBe(0);
      expect(result.stdout).toContain("widget\t1.0.0\t2.0.0\tlag: within budget (26 d of 30)");
    });

    it("splits the summary's lag count into within budget, held and undocumented", () => {
      const result = runGate({
        installed: { widget: "1.0.0", gadget: "1.0.0", gizmo: "1.0.0", sprocket: "1.0.0" },
        published: {
          ...WIDGET_MATURE_LAG,
          gadget: { "1.0.0": "2026-01-01T00:00:00Z", "2.0.0": "2026-09-01T00:00:00Z" },
          gizmo: { "1.0.0": "2026-01-01T00:00:00Z", "2.0.0": "2026-08-01T00:00:00Z" },
          sprocket: { "1.0.0": "2026-01-01T00:00:00Z" },
        },
        population: [
          { name: "widget" },
          { name: "gadget" },
          { name: "gizmo" },
          { name: "sprocket" },
        ],
        holds: [WIDGET_HOLD],
      });

      expect(result.status).toBe(1);
      expect(result.stdout).toContain(
        "4 population packages measured, 3 below latest mature " +
          "(1 within budget, 1 held, 1 undocumented)"
      );
    });
  });

  describe("a row that still describes a scheduled hold", () => {
    it("exits 1 naming a row whose cells say Scheduled, with no lag at all", () => {
      // The budget replaced scheduled rows. A row that reads as one would exempt its package from
      // the budget for good, because nothing reads the date in its text.
      const result = runGate({
        installed: { widget: "2.0.0" },
        published: WIDGET_MATURE_LAG,
        population: [{ name: "widget" }],
        holds: [
          UNRELATED_HOLD,
          { ...WIDGET_HOLD, hold: "`2.0.0`; Scheduled, not blocked: 3.0.0 matures on 2026-10-01" },
        ],
      });

      expect(result.status).toBe(1);
      expect(result.stderr).toContain('row `widget` says "Scheduled"');
      expect(result.stderr).toContain(
        "the words `scheduled` and `pre-registered`, in any case, describe a retired scheduled hold"
      );
      expect(result.stderr).toContain("ADR-0036");
    });

    it("exits 1 on the retired words in any case and in any column", () => {
      const result = runGate({
        installed: { widget: "2.0.0" },
        published: WIDGET_MATURE_LAG,
        population: [{ name: "widget" }],
        holds: [],
        table: {
          header: ["Package", "Hold / floor", "Where", "Reason", "Remove-when"],
          rows: [
            [
              "`unrelated`",
              "`3.0.0` override",
              "`overrides`",
              "measured",
              "every consumer resolves `>=3.0.0` unaided",
            ],
            [
              "`widget`",
              "`2.0.0`",
              "catalog (`pnpm-workspace.yaml`)",
              "pre-registered on 2026-09-27 for the day 3.0.0 matures",
              "3.0.0 matures",
            ],
          ],
        },
      });

      expect(result.status).toBe(1);
      expect(result.stderr).toContain('row `widget` says "pre-registered"');
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
