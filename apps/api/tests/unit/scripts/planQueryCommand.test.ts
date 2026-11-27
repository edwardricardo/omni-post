/**
 * @file planQueryCommand.test.ts
 * @description Pins `scripts/plan/plan-query.mjs`, the command behind `pnpm plan:show`,
 *   `pnpm plan:list` and `pnpm plan:check`: `show` prints one record by its id, by another name
 *   an item carries or by its location, or names each record that only names the id; `list`
 *   filters the records by kind, by file and by any field and prints them as lines, as JSON or as
 *   a count; and `check` fails while a line of the plan is unclassified. Exit 0 is
 *   success, 1 a record not found or a failed check, 2 a usage error. The security view is pinned
 *   too: an argument is data, never a shell command or a regular expression, the file filter
 *   names one of the plan's fixed files and nothing else, and nothing is written to disk. Every
 *   case writes its own small plan tree in a scratch directory, so the suite never reads this
 *   repository's plan.
 * @layer infrastructure
 */
import { execFileSync, spawnSync } from "node:child_process";
import {
  closeSync,
  constants,
  existsSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
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
    "**DEF-1** (SMELL-768): Closed by #900. The start passes.",
  ]),
  ...chainRecord("F-02", "The first administrator comes to exist", [
    "**DEF-2** (SMELL-770): The command asks nothing. Done: one prompt.",
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
  "Items attached to this area (1):",
  "",
  "- **DEF-9** (SMELL-607): The OIDC state is kept in a map. Done: not stated.",
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
  "# Off the map\n\n## Deletion candidates\n\n- **STOR-1** (SMELL-525): Delete it.\n";
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

/** The command run as a script with its arguments exactly as given, `--root` placed by the case. */
const spawnAsGiven = (...argv: string[]): { status: number | null; stdout: string } => {
  const result = spawnSync(process.execPath, [COMMAND, ...argv], { encoding: "utf8" });
  return { status: result.status, stdout: result.stdout };
};

/**
 * The command run as a script whose standard output is a pipe its reader has already closed, as
 * `| head` leaves it once it has read what it wants: its first write fails with EPIPE every run,
 * because the read end is closed before the command starts.
 */
const spawnWithClosedOutput = (...argv: string[]): { status: number | null; stderr: string } => {
  const dir = mkdtempSync(path.join(tmpdir(), "plan-query-pipe-"));
  const fifo = path.join(dir, "stdout");
  execFileSync("mkfifo", [fifo]);
  const reader = openSync(fifo, constants.O_RDONLY | constants.O_NONBLOCK);
  const writer = openSync(fifo, constants.O_WRONLY | constants.O_NONBLOCK);
  closeSync(reader);
  try {
    const result = spawnSync(process.execPath, [COMMAND, "--root", root, ...argv], {
      stdio: ["ignore", writer, "pipe"],
      encoding: "utf8",
    });
    return { status: result.status, stderr: result.stderr };
  } finally {
    closeSync(writer);
    rmSync(dir, { recursive: true, force: true });
  }
};

/** Plans every file of which is readable but whose structure lacks a part. */
const STRUCTURAL_BREAKS: Record<string, Partial<Record<FileKey, string>>> = {
  "a chain table with no State column": { plan: PLAN_TEXT.replaceAll("| State  ", "| Status ") },
  "an area table whose header is renamed": {
    areas: AREAS_TEXT.replace("| Depends on |", "| Depends    |"),
  },
  "a chain row that no record holds": {
    plan: PLAN_TEXT.replace(
      "| F-02 | The next feature  | open   | —         |",
      "| F-02 | The next feature  | open   | —         |\n| F-19 | A later feature   | open   | —         |"
    ),
  },
};

/** The lines `check` prints for the plan's failures, its unclassified lines left out. */
const structuralFailuresOf = (outcome: Outcome): string[] =>
  outcome.stderr.filter(
    (line) => !line.includes(" is unclassified: ") && !/ unclassified lines?$/.test(line)
  );

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
        tags: ["DEF-2", "SMELL-770"],
      });
    });

    it("prints the item's own id as its only tag when show is given --json for an item that writes an MP:<n> reference after its id", () => {
      makeTree({ areas: AREAS_TEXT.replace("- **DEF-9** (SMELL-607):", "- **DEF-9** (MP:607):") });

      const outcome = run("show", "DEF-9", "--json");

      expect({
        exitCode: outcome.exitCode,
        tags: (JSON.parse(outcome.stdout.join("\n")) as { tags: string[] }).tags,
      }).toEqual({ exitCode: 0, tags: ["DEF-9"] });
    });

    it("prints the record that carries the id as another name, and says so first, when show is given that name", () => {
      makeTree({
        offTheMap: `${OFF_THE_MAP_TEXT}- **BILL-3** (SMELL-184): The invoice total is read twice.\n`,
      });

      const text = run("show", "SMELL-184");
      const json = run("show", "SMELL-184", "--json");

      expect({
        text: { exitCode: text.exitCode, head: text.stdout.slice(0, 2), stderr: text.stderr },
        json: {
          exitCode: json.exitCode,
          id: (JSON.parse(json.stdout.join("\n")) as { id: string }).id,
          stderr: json.stderr,
        },
      }).toEqual({
        text: {
          exitCode: 0,
          head: ["SMELL-184 is another name of BILL-3", "id: BILL-3"],
          stderr: [],
        },
        json: {
          exitCode: 0,
          id: "BILL-3",
          stderr: ["plan-query: SMELL-184 is another name of BILL-3"],
        },
      });
    });

    it("prints the record whose own id is the key, with no note, when another item carries the key as another name", () => {
      makeTree({
        offTheMap:
          `${OFF_THE_MAP_TEXT}- **SMELL-184**: The own row.\n` +
          "- **BILL-3** (SMELL-184): The invoice total is read twice.\n",
      });

      const shown = run("show", "SMELL-184");

      expect({
        exitCode: shown.exitCode,
        head: shown.stdout.slice(0, 1),
        stderr: shown.stderr,
      }).toEqual({
        exitCode: 0,
        head: ["id: SMELL-184"],
        stderr: [],
      });
    });

    it("prints the record that carries the id as another name when other records only name it", () => {
      makeTree({
        offTheMap:
          `${OFF_THE_MAP_TEXT}- **BILL-3** (SMELL-184): The invoice total is read twice.\n` +
          "- **BILL-4**: The change path of SMELL-184.\n",
      });

      const shown = run("show", "SMELL-184");

      expect({ exitCode: shown.exitCode, head: shown.stdout.slice(0, 2) }).toEqual({
        exitCode: 0,
        head: ["SMELL-184 is another name of BILL-3", "id: BILL-3"],
      });
    });

    it("prints one line per record that names the id, in the plan's order, when show is given an id records only name", () => {
      makeTree({
        chain: CHAIN_TEXT.replace(
          "The command asks nothing. Done: one prompt.",
          "The command asks nothing, as SMELL-41 says. Done: one prompt."
        ),
        areas: AREAS_TEXT.replace("| DEAD    | A-TEAM-01  |", "| DEAD    | SMELL-41   |"),
        offTheMap: `${OFF_THE_MAP_TEXT}- **DEF-40 (with SMELL-41)**: Two findings in one row.\n`,
      });
      const named = [
        `SMELL-41 is named by DEF-2 (${FILES.chain}:17)`,
        `SMELL-41 is named by A-TEAM-02 (${FILES.areas}:8)`,
        `SMELL-41 is named by DEF-40 (with SMELL-41) (${FILES.offTheMap}:6)`,
      ];

      const text = run("show", "SMELL-41");
      const json = run("show", "SMELL-41", "--json");

      expect({
        text,
        json: {
          exitCode: json.exitCode,
          ids: (JSON.parse(json.stdout.join("\n")) as { id: string }[]).map((record) => record.id),
          stderr: json.stderr,
        },
      }).toEqual({
        text: { exitCode: 0, stdout: named, stderr: [] },
        json: {
          exitCode: 0,
          ids: ["DEF-2", "A-TEAM-02", "DEF-40 (with SMELL-41)"],
          stderr: named.map((line) => `plan-query: ${line}`),
        },
      });
    });

    it.each([
      [
        "carries the id as another name",
        "- **(no id)** (SMELL-96): A row the plan writes with no id.\n",
        "SMELL-96",
        `SMELL-96 is another name of the item at ${FILES.offTheMap}:6`,
      ],
      [
        "names the id in its text",
        "- **(no id)**: The change path of SMELL-97.\n",
        "SMELL-97",
        `SMELL-97 is named by the item at ${FILES.offTheMap}:6`,
      ],
    ])("names an item written with no id by its place when it %s", (_case, item, key, first) => {
      makeTree({ offTheMap: `${OFF_THE_MAP_TEXT}${item}` });

      const shown = run("show", key);

      expect({ exitCode: shown.exitCode, first: shown.stdout[0] }).toEqual({
        exitCode: 0,
        first,
      });
    });

    it("exits 1 and says the id is another name of each record when two records carry it as another name", () => {
      makeTree({
        offTheMap:
          `${OFF_THE_MAP_TEXT}- **BILL-3** (SMELL-184): The invoice total is read twice.\n` +
          "- **BILL-4** (SMELL-184): The invoice date is read twice.\n",
      });

      expect(run("show", "SMELL-184")).toEqual({
        exitCode: 1,
        stdout: [],
        stderr: [
          `plan-query: 2 records carry "SMELL-184" as another name (${FILES.offTheMap}:6, ` +
            `${FILES.offTheMap}:7); show one by its location`,
        ],
      });
    });

    it("exits 1 and names the id when show is given a unit a chain feature lists in its proof base", () => {
      makeTree({
        chain: CHAIN_TEXT.replace(
          "- **Today:** WORKS.",
          "- **Today:** WORKS.\n- **Proof base:** 4b.1 the start proof (not started)."
        ),
      });

      expect(run("show", "4b.1")).toEqual({
        exitCode: 1,
        stdout: [],
        stderr: ['plan-query: no record carries the id "4b.1"'],
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
      expect(run("list", "--tag", "SMELL-607").stdout).toEqual([
        `DEF-9\titem\t${FILES.areas}:12\tThe OIDC state is kept in a map.`,
      ]);
    });

    it("prints no record and exits 0 when list is given --tag with the MP:<n> reference an item writes after its id", () => {
      makeTree({ areas: AREAS_TEXT.replace("- **DEF-9** (SMELL-607):", "- **DEF-9** (MP:607):") });

      expect({
        byOwnId: run("list", "--tag", "DEF-9").stdout,
        byFormerReference: run("list", "--tag", "SMELL-607").stdout,
        byReference: run("list", "--tag", "MP:607"),
      }).toEqual({
        byOwnId: [`DEF-9\titem\t${FILES.areas}:12\tThe OIDC state is kept in a map.`],
        byFormerReference: [],
        byReference: { exitCode: 0, stdout: [], stderr: [] },
      });
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

  describe("a structurally broken plan", () => {
    it.each(
      Object.entries(STRUCTURAL_BREAKS).flatMap(([name, overrides]) => [
        ["show", name, overrides, ["show", "F-01"]] as const,
        ["list", name, overrides, ["list", "--count"]] as const,
      ])
    )(
      "exits 1 with nothing on stdout and names each failure when %s runs on %s",
      (_command, _case, overrides, argv) => {
        makeTree(overrides);
        const failures = structuralFailuresOf(run("check"));

        const outcome = run(...argv);

        expect({ outcome, named: failures.length > 0 }).toEqual({
          outcome: { exitCode: 1, stdout: [], stderr: failures },
          named: true,
        });
      }
    );

    it.each([["show"], ["list"]])(
      "says in the help of %s that a plan whose structure lacks a part exits 1",
      (command) => {
        expect(run(command, "--help").stdout).toContain(
          "  Exit 1, each failure named on stderr and nothing on stdout, when a plan file cannot be"
        );
      }
    );
  });

  describe("the root option", () => {
    it("exits 2 when --root is given no directory", () => {
      expect(spawnAsGiven("--root")).toEqual({ status: 2, stdout: "" });
    });

    it.each([
      ["show", ["F-01"]],
      ["list", ["--count"]],
      ["check", []],
    ])("exits 2 when --root is given after %s", (command, options) => {
      expect(spawnAsGiven(command, ...options, "--root", root)).toEqual({ status: 2, stdout: "" });
    });

    it("says in its usage that --root stands before the command", () => {
      expect(run("--help").stdout).toContain(
        "  --root <dir> stands before the command; <dir> holds docs/product/, this repository by default"
      );
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

    it.each([
      ["show", ["show", "F-01"]],
      ["list", ["list", "--kind", "feature"]],
      ["check", ["check"]],
    ])(
      "exits 0 with nothing on stderr when %s writes to a pipe its reader has closed",
      (_command, argv) => {
        expect(spawnWithClosedOutput(...argv)).toEqual({ status: 0, stderr: "" });
      }
    );
  });
});
