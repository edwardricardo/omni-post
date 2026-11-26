/**
 * @file planQueryCommand.test.ts
 * @description Pins `scripts/plan/plan-query.mjs`, the command behind `pnpm plan:show`,
 *   `pnpm plan:list` and `pnpm plan:check`: `show` prints one record by its id or its location,
 *   `list` filters the records by kind, by file and by any field and prints them as lines, as
 *   JSON or as a count, and `check` fails while a line of the plan is unclassified. Exit 0 is
 *   success, 1 a record not found or a failed check, 2 a usage error. The security view is pinned
 *   too: an argument is data, never a shell command or a regular expression, the file filter
 *   names one of the plan's fixed files and nothing else, and nothing is written to disk. Every
 *   case writes its own small plan tree in a scratch directory, so the suite never reads this
 *   repository's plan.
 * @layer infrastructure
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { findMonorepoRoot } from "@packages/vitest-shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

interface Outcome {
  readonly exitCode: number;
  readonly stdout: readonly string[];
  readonly stderr: readonly string[];
}

/** The module's surface; a literal import of an untyped `.mjs` would be an implicit any. */
interface QueryModule {
  runQuery: (input: { argv: readonly string[]; root: string; now?: Date }) => Outcome;
}

const REPO_ROOT = findMonorepoRoot(path.dirname(fileURLToPath(import.meta.url)));
const COMMAND = path.join(REPO_ROOT, "scripts/plan/plan-query.mjs");
const { runQuery } = (await import(COMMAND)) as QueryModule;

const NOW = new Date("2026-11-26T12:00:00Z");
const FILES = {
  plan: "docs/product/PLAN.md",
  chain: "docs/product/plan/chain.md",
  areas: "docs/product/plan/areas.md",
  crossCutting: "docs/product/plan/cross-cutting.md",
  offTheMap: "docs/product/plan/off-the-map.md",
  parking: "docs/product/plan/parking.md",
} as const;
type FileKey = keyof typeof FILES;

const PLAN_TEXT = [
  "# The plan",
  "",
  "## The chain",
  "",
  "| #    | Feature           | State  | Closed by |",
  "| ---- | ----------------- | ------ | --------- |",
  "| F-01 | The first feature | closed | #980      |",
  "| F-02 | The next feature  | open   | —         |",
  "",
].join("\n");

const chainRecord = (id: string, title: string, entries: readonly string[]): string[] => [
  `### ${id} ${title}`,
  "",
  "- **Who:** the operator.",
  "- **Today:** WORKS.",
  `- **Attached (${String(entries.length)}):**`,
  ...entries.map((entry) => `  - ${entry}`),
  "",
];

const CHAIN_TEXT = [
  "# The chain",
  "",
  "## Platform and operation",
  "",
  ...chainRecord("F-01", "The platform starts from an empty database", [
    "**DEF-1** (MP:768): Closed by #900. The start passes.",
  ]),
  ...chainRecord("F-02", "The first administrator comes to exist", [
    "**DEF-2** (MP:770): The command asks nothing. Done: one prompt.",
    "**DUP-1**: Written twice on purpose.",
  ]),
].join("\n");

const AREAS_TEXT = [
  "# Areas outside the chain",
  "",
  "## A-TEAM Members, roles and access",
  "",
  "| Feature                                   | Who        | Today   | Depends on |",
  "| ----------------------------------------- | ---------- | ------- | ---------- |",
  "| A-TEAM-01 A Member sees the Organization  | any Member | PARTIAL | F-02       |",
  "| A-TEAM-02 A person accepts an invitation  | invitee    | DEAD    | A-TEAM-01  |",
  "",
  "Old plan rows attached to this area (1):",
  "",
  "- **DEF-9** (MP:607): The OIDC state is kept in a map. Done: not stated.",
  "",
].join("\n");

const CROSS_CUTTING_TEXT = [
  "# Cross-cutting work",
  "",
  "## Findings since the plan entered",
  "",
  "- **DUP-1**: Written twice on purpose.",
  "- **REGEX-LOOKALIKE**: The pattern (a+)+ is written literally here.",
  "",
].join("\n");

const OFF_THE_MAP_TEXT =
  "# Off the map\n\n## Deletion candidates\n\n- **STOR-1** (MP:525): Delete it.\n";
const PARKING_TEXT = "# Parking\n\nIdeas with no slice.\n\n- An idea with no id.\n";

let root = "";

const makeTree = (overrides: Partial<Record<FileKey, string>> = {}): void => {
  const texts: Record<FileKey, string> = {
    plan: PLAN_TEXT,
    chain: CHAIN_TEXT,
    areas: AREAS_TEXT,
    crossCutting: CROSS_CUTTING_TEXT,
    offTheMap: OFF_THE_MAP_TEXT,
    parking: PARKING_TEXT,
    ...overrides,
  };
  for (const key of Object.keys(FILES) as FileKey[]) {
    const full = path.join(root, FILES[key]);
    mkdirSync(path.dirname(full), { recursive: true });
    writeFileSync(full, texts[key]);
  }
};

const run = (...argv: string[]): Outcome => runQuery({ argv, root, now: NOW });

const spawnCommand = (...argv: string[]): { status: number | null; stdout: string } => {
  const result = spawnSync(process.execPath, [COMMAND, "--root", root, ...argv], {
    encoding: "utf8",
  });
  return { status: result.status, stdout: result.stdout };
};

const treeOf = (dir: string): string[] =>
  readdirSync(dir, { recursive: true, encoding: "utf8" }).sort();

describe("plan-query", () => {
  beforeEach(() => {
    root = mkdtempSync(path.join(tmpdir(), "plan-query-"));
    makeTree();
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  describe("show", () => {
    it("prints the record of one feature and exits 0 when show is given its id", () => {
      const outcome = run("show", "F-01");

      expect(outcome).toMatchObject({ exitCode: 0, stderr: [] });
      expect(outcome.stdout).toEqual(
        expect.arrayContaining([
          "id: F-01",
          "kind: feature",
          `location: ${FILES.chain}:5`,
          "title: The platform starts from an empty database",
          "state: closed",
          "closed by: #980",
        ])
      );
    });

    it("prints the record as JSON when show is given --json", () => {
      const outcome = run("show", "DEF-2", "--json");

      expect(JSON.parse(outcome.stdout.join("\n"))).toMatchObject({
        id: "DEF-2",
        owner: "F-02",
        state: "open",
        tags: ["MP:770", "DEF-2"],
      });
    });

    it("exits 1 and names the id when show is given an id no record carries", () => {
      expect(run("show", "F-99")).toEqual({
        exitCode: 1,
        stdout: [],
        stderr: ['plan-query: no record carries the id "F-99"'],
      });
    });

    it("exits 1 and names every location when show is given an id two records carry", () => {
      expect(run("show", "DUP-1")).toEqual({
        exitCode: 1,
        stdout: [],
        stderr: [
          `plan-query: 2 records carry the id "DUP-1" (${FILES.chain}:18, ${FILES.crossCutting}:5); ` +
            "show one by its location, <file>:<line>, the file one of plan, chain, areas, " +
            "cross-cutting, off-the-map and parking",
        ],
      });
    });

    it("prints the record at a location when show is given <file>:<line>", () => {
      expect(run("show", "cross-cutting:5").stdout).toContain(`location: ${FILES.crossCutting}:5`);
    });
  });

  describe("list", () => {
    it("prints the number of features and exits 0 when list is given --kind feature --count", () => {
      expect(run("list", "--kind", "feature", "--count")).toEqual({
        exitCode: 0,
        stdout: ["4"],
        stderr: [],
      });
    });

    it("prints one line per record with its id, kind, location and title", () => {
      expect(run("list", "--file", "areas", "--kind", "feature").stdout).toEqual([
        `A-TEAM-01\tfeature\t${FILES.areas}:7\tA Member sees the Organization`,
        `A-TEAM-02\tfeature\t${FILES.areas}:8\tA person accepts an invitation`,
      ]);
    });

    it("lists only the records of one file when list is given --file", () => {
      expect(run("list", "--file", "off-the-map").stdout).toEqual([
        `STOR-1\titem\t${FILES.offTheMap}:5\tDelete it.`,
      ]);
    });

    it("lists the records whose field holds the value when list is given a field filter", () => {
      expect(run("list", "--today", "DEAD", "--count").stdout).toEqual(["1"]);
    });

    it("lists the records that carry a tag when list is given --tag", () => {
      expect(run("list", "--tag", "MP:607").stdout).toEqual([
        `DEF-9\titem\t${FILES.areas}:12\tThe OIDC state is kept in a map.`,
      ]);
    });

    it("lists the records that every filter matches when list is given several", () => {
      expect(
        run("list", "--kind", "item", "--state", "open", "--owner", "F-02", "--count").stdout
      ).toEqual(["2"]);
    });

    it("prints the records as a JSON array when list is given --json", () => {
      const records = JSON.parse(
        run("list", "--done-state", "not-stated", "--json").stdout.join("\n")
      ) as {
        id: string;
      }[];

      expect(records.map((record) => record.id)).toEqual(["DEF-9"]);
    });

    it("prints 0 and exits 0 when no record matches the filters", () => {
      expect(run("list", "--owner", "nobody", "--count")).toEqual({
        exitCode: 0,
        stdout: ["0"],
        stderr: [],
      });
    });

    it("prints 0 and exits 0 when list is given a filter value of 120,000 characters", () => {
      expect(run("list", "--title", "a".repeat(120_000), "--count")).toEqual({
        exitCode: 0,
        stdout: ["0"],
        stderr: [],
      });
    });
  });

  describe("an unreadable plan", () => {
    it.each([
      ["show", ["show", "F-01"]],
      ["list", ["list", "--count"]],
    ])(
      "exits 1 and names the file when %s runs on a plan file that cannot be read",
      (_case, argv) => {
        rmSync(path.join(root, FILES.chain));

        const outcome = run(...argv);

        expect(outcome).toMatchObject({ exitCode: 1, stdout: [] });
        expect(outcome.stderr[0]).toMatch(
          new RegExp(`^plan-query: ${FILES.chain} could not be read`)
        );
      }
    );
  });

  describe("check", () => {
    it("exits 0 and says every line is classified when check reads a plan whose lines all fit", () => {
      const outcome = run("check");

      expect(outcome).toMatchObject({ exitCode: 0, stderr: [] });
      expect(outcome.stdout).toEqual([
        "plan-query: 60 lines read in 6 files, every line outside fenced code classified",
      ]);
    });

    it("exits 1 and names file:line when check finds an unclassified line", () => {
      makeTree({ parking: "# Parking\n\nIdeas with no slice.\n   an indented line.\n" });

      const outcome = run("check");

      expect(outcome.exitCode).toBe(1);
      expect(outcome.stderr[0]).toMatch(
        new RegExp(`^plan-query: ${FILES.parking}:4 is unclassified: `)
      );
      expect(outcome.stderr.at(-1)).toBe("plan-query: 1 unclassified line");
    });

    it("exits 1 and names the file when a plan file cannot be read", () => {
      rmSync(path.join(root, FILES.parking));

      const outcome = run("check");

      expect(outcome.exitCode).toBe(1);
      expect(outcome.stderr[0]).toMatch(
        new RegExp(`^plan-query: ${FILES.parking} could not be read`)
      );
    });

    it("exits 1 and names the missing column when check reads a chain table with no State column", () => {
      makeTree({ plan: PLAN_TEXT.replaceAll("| State  ", "| Status ") });

      expect(run("check")).toEqual({
        exitCode: 1,
        stdout: [],
        stderr: [
          `plan-query: the chain table of ${FILES.plan}:5 has no "State" column, so no feature's ` +
            "state was read",
        ],
      });
    });

    it("exits 1 and names the header when check reads an area table whose Depends on column is renamed", () => {
      makeTree({ areas: AREAS_TEXT.replace("| Depends on |", "| Depends    |") });

      const outcome = run("check");

      expect(outcome.exitCode).toBe(1);
      expect(
        outcome.stderr.filter((line) =>
          line.startsWith(`plan-query: ${FILES.areas}:5 is unclassified: `)
        )
      ).toHaveLength(1);
    });

    it("exits 1 and names the feature when check reads a chain row that no record holds", () => {
      makeTree({
        plan: PLAN_TEXT.replace(
          "| F-02 | The next feature  | open   | —         |",
          "| F-02 | The next feature  | open   | —         |\n| F-19 | A later feature   | open   | —         |"
        ),
      });

      const outcome = run("check");

      expect(outcome.exitCode).toBe(1);
      expect(outcome.stderr.some((line) => line.includes("F-19"))).toBe(true);
    });
  });

  describe("usage", () => {
    it.each([["show"], ["list"], ["check"]])(
      "prints the usage of %s and exits 0 when it is given --help",
      (command) => {
        const outcome = run(command, "--help");

        expect(outcome.exitCode).toBe(0);
        expect(outcome.stdout[0]).toBe(
          command === "show"
            ? "usage: pnpm plan:show <id | <file>:<line>> [--json]"
            : command === "list"
              ? "usage: pnpm plan:list [--kind feature|item] [--file <name>] [--<field> <value>]... [--json | --count]"
              : "usage: pnpm plan:check"
        );
      }
    );

    it("prints the commands and exits 0 when it is given --help alone", () => {
      expect(run("--help")).toMatchObject({ exitCode: 0, stderr: [] });
    });

    it.each([
      ["no command", []],
      ["an unknown command", ["frobnicate"]],
      ["show with no id", ["show"]],
      ["show with two ids", ["show", "F-01", "F-02"]],
      ["an unknown kind", ["list", "--kind", "widget"]],
      ["an unknown field", ["list", "--colour", "red"]],
      ["a field with no value", ["list", "--today"]],
      ["--json with --count", ["list", "--json", "--count"]],
      ["check with an argument", ["check", "now"]],
      ["an empty filter value", ["list", "--title", ""]],
      ["a filter value that looks like an option", ["list", "--title", "--json"]],
      ["a filter value that is --help", ["list", "--title", "--help"]],
      ["an empty id to show", ["show", ""]],
    ])("exits 2 when it is given %s", (_case, argv) => {
      expect(run(...argv)).toMatchObject({ exitCode: 2, stdout: [] });
    });
  });

  describe("security", () => {
    it.each([
      ["a traversal", "../../etc/passwd"],
      ["a repository path", "docs/product/plan/chain.md"],
      ["an absolute path", "/etc/passwd"],
      ["a name with a traversal", "chain/../areas"],
      ["a file name with its extension", "chain.md"],
    ])("exits 2 and reads nothing when --file is %s", (_case, value) => {
      expect(run("list", "--file", value)).toEqual({
        exitCode: 2,
        stdout: [],
        stderr: [
          `plan-query: --file takes one of plan, chain, areas, cross-cutting, off-the-map and parking, not "${value}"`,
        ],
      });
    });

    it("matches a filter value as literal text, never as a regular expression", () => {
      const outcome = {
        pattern: run("list", "--title", ".*", "--count").stdout,
        literal: run("list", "--title", "(a+)+", "--count").stdout,
      };

      expect(outcome).toEqual({ pattern: ["0"], literal: ["1"] });
    });

    it("runs nothing a value names when the value holds shell syntax", () => {
      const marker = path.join(root, "ran");

      const outcomes = [`$(touch ${marker})`, `; touch ${marker}`, `\`touch ${marker}\``].map(
        (value) => spawnCommand("show", value).status
      );

      expect({ outcomes, ran: existsSync(marker) }).toEqual({ outcomes: [1, 1, 1], ran: false });
    });

    it("writes nothing to disk when show, list and check run", () => {
      const before = treeOf(root);

      run("show", "F-01");
      run("list", "--json");
      run("check");

      expect(treeOf(root)).toEqual(before);
    });
  });

  describe("process", () => {
    it("exits with the outcome's code and prints its lines when it runs as a script", () => {
      expect(spawnCommand("list", "--kind", "feature", "--count")).toEqual({
        status: 0,
        stdout: "4\n",
      });
    });
  });
});
