/**
 * @file planClosureGate.test.ts
 * @description Pins `scripts/testing/plan-closure-gate.mjs`, fitness #56, the gate behind
 *   `pnpm check:plan-closure`: a feature whose state in the chain table of `docs/product/PLAN.md`
 *   is `closed` holds no open item under its record, an item being an entry of the record's
 *   attached list or of a findings list, and a closed item being one marked `Closed by #<n>` or
 *   `Closed by decision of the <role> on <date>: <the decision>`. Every case writes its own small
 *   plan tree (the plan, the chain and the areas) in a scratch directory, so the suite measures the
 *   rule and never this repository's plan, and it can prove each red path while the live plan is in
 *   any state. Each fail-closed path is pinned to exit 3, apart from the violations' exit 1, so a
 *   scan that read nothing never renders as a plan with every item closed.
 * @layer infrastructure
 */
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { findMonorepoRoot } from "@packages/vitest-shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

type Outcome = { exitCode: number; stdout: string[]; stderr: string[] };
/** The module's surface; a literal import of an untyped `.mjs` would be an implicit any. */
type GateModule = {
  PLAN: string;
  RECORDS: readonly string[];
  runGate: (input: { root: string }) => Outcome;
};

const REPO_ROOT = findMonorepoRoot(path.dirname(fileURLToPath(import.meta.url)));
const GATE_SCRIPT = path.join(REPO_ROOT, "scripts/testing/plan-closure-gate.mjs");
const { PLAN, RECORDS, runGate } = (await import(GATE_SCRIPT)) as GateModule;
const CHAIN = "docs/product/plan/chain.md";
const AREAS = "docs/product/plan/areas.md";
const GRAMMAR_HINT =
  'close it with "Closed by #<n>." or "Closed by decision of the <Product Owner|Maintainer> on ' +
  '<YYYY-MM-DD>: <the decision>.", or set the feature back to "in progress"';

interface Row {
  readonly id: string;
  readonly state: string;
}

interface RecordFixture {
  readonly id: string;
  readonly attached: readonly string[];
  readonly findings?: readonly string[];
  /** The count the attached label states; the number of attached entries when absent. */
  readonly count?: number;
  /** False writes the record with no attached list at all. */
  readonly withAttached?: boolean;
}

const closedByPullRequest = (id: string, pr = 901): string =>
  `**${id}** (MP:11): Closed by #${String(pr)}. The start needed a file a clean checkout lacks.`;
const openItem = (id: string): string =>
  `**${id}** (MP:12): The health probe reads every account. Where: \`src/health.ts:4\`. Done: one row.`;
const closedByDecision = (id: string, role = "Product Owner", date = "2026-11-20"): string =>
  `**${id}**: Closed by decision of the ${role} on ${date}: it waits for the move to production.`;

const renderPlan = (rows: readonly Row[]): string =>
  [
    "# The plan",
    "",
    "## Rules",
    "",
    "- Tracking: the chain table says where each feature stands.",
    "",
    "## The chain",
    "",
    "| #    | Feature          | Today | Old rows attached | State       | Closed by |",
    "| ---- | ---------------- | ----- | ----------------- | ----------- | --------- |",
    ...rows.map(
      (row) =>
        `| ${row.id} | Feature ${row.id} | WORKS | 1                 | ${row.state} | —         |`
    ),
    "",
    "The order of the Platforms follows the chain.",
    "",
    "## Areas outside the chain",
    "",
    "| Area   | Features | State  |",
    "| ------ | -------- | ------ |",
    "| A-TEAM | 24       | closed |",
    "",
  ].join("\n");

const renderRecord = (record: RecordFixture): string[] => [
  `### ${record.id} The feature ${record.id}`,
  "",
  "- **Who:** the operator.",
  "- **Today:** WORKS, as read against the code.",
  "- **Wrong as read:**",
  "  - The gate reads one cookie only, and this sentence is prose, not an item.",
  ...(record.withAttached === false
    ? []
    : [
        `- **Attached (${String(record.count ?? record.attached.length)}):**`,
        ...record.attached.map((entry) => `  - ${entry}`),
      ]),
  ...(record.findings === undefined
    ? []
    : [
        "- **Findings since the feature opened:**",
        ...record.findings.map((entry) => `  - ${entry}`),
      ]),
  "",
];

const renderChain = (records: readonly RecordFixture[]): string =>
  [
    "# The chain: features",
    "",
    "## Platform and operation",
    "",
    ...records.flatMap(renderRecord),
    "## Decisions",
    "",
    "- **A decision of the base:** it stands.",
    "",
  ].join("\n");

const AREAS_TEXT = [
  "# Areas outside the chain",
  "",
  "## A-TEAM Members, roles and access",
  "",
  "- **DEF-9** (MP:607): An open row of an area, which no feature of the chain holds.",
  "",
].join("\n");

let root = "";

const write = (file: string, content: string): void => {
  const full = path.join(root, file);
  mkdirSync(path.dirname(full), { recursive: true });
  writeFileSync(full, content);
};

/** Writes a plan tree of the given rows and records, the areas part included. */
const plant = (rows: readonly Row[], records: readonly RecordFixture[]): void => {
  write(PLAN, renderPlan(rows));
  write(CHAIN, renderChain(records));
  write(AREAS, AREAS_TEXT);
};

const scan = (): Outcome => runGate({ root });

beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), "plan-closure-gate-test-"));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("scope", () => {
  it("reads the chain table of the plan and the records of the chain and the areas", () => {
    expect(PLAN).toBe("docs/product/PLAN.md");
    expect(RECORDS).toEqual([CHAIN, AREAS]);
  });
});

describe("a closed feature", () => {
  it("passes when every item of its record is closed by a pull request", () => {
    plant(
      [
        { id: "F-01", state: "closed" },
        { id: "F-02", state: "open" },
      ],
      [
        { id: "F-01", attached: [closedByPullRequest("DEF-1"), closedByPullRequest("DEF-2", 902)] },
        { id: "F-02", attached: [openItem("DEF-3")] },
      ]
    );

    const outcome = scan();

    expect(outcome.stderr).toEqual([]);
    expect(outcome.exitCode).toBe(0);
    expect(outcome.stdout).toEqual([
      "plan-closure-gate: 2 features in the chain table, 1 closed; 2 items under the records of the closed features, every one closed",
    ]);
  });

  it("refuses one open item, naming the feature and the item with its line", () => {
    plant(
      [{ id: "F-01", state: "closed" }],
      [{ id: "F-01", attached: [closedByPullRequest("DEF-1"), openItem("DEF-29")] }]
    );

    const outcome = scan();

    expect(outcome.exitCode).toBe(1);
    expect(outcome.stdout).toEqual([]);
    expect(outcome.stderr).toEqual([
      `plan-closure-gate: F-01 is closed (${PLAN}:11) and its record holds an open item: DEF-29 (${CHAIN}:13, in "Attached (2)"); ${GRAMMAR_HINT}`,
      "plan-closure-gate: 1 open item under 1 closed feature",
    ]);
  });

  it("refuses an open item of a findings list as it refuses one of the attached list", () => {
    plant(
      [{ id: "F-01", state: "closed" }],
      [
        {
          id: "F-01",
          attached: [closedByPullRequest("DEF-1")],
          findings: [closedByPullRequest("START-ENV", 915), openItem("WORKERS-READY")],
        },
      ]
    );

    const outcome = scan();

    expect(outcome.exitCode).toBe(1);
    expect(outcome.stderr).toEqual([
      `plan-closure-gate: F-01 is closed (${PLAN}:11) and its record holds an open item: WORKERS-READY (${CHAIN}:15, in "Findings since the feature opened"); ${GRAMMAR_HINT}`,
      "plan-closure-gate: 1 open item under 1 closed feature",
    ]);
  });

  it("passes an item closed by a recorded decision that names its role and its date", () => {
    plant(
      [{ id: "F-01", state: "closed" }],
      [
        {
          id: "F-01",
          attached: [closedByDecision("K8S-1"), closedByDecision("IMAGE-1", "Maintainer")],
          findings: [closedByPullRequest("DB-UP", 916)],
        },
      ]
    );

    const outcome = scan();

    expect(outcome.stderr).toEqual([]);
    expect(outcome.exitCode).toBe(0);
    expect(outcome.stdout).toEqual([
      "plan-closure-gate: 1 feature in the chain table, 1 closed; 3 items under the records of the closed features, every one closed",
    ]);
  });

  it.each([
    [
      "its role",
      "**K8S-1**: Closed by decision on 2026-11-20: it waits for the move to production.",
    ],
    ["its date", "**K8S-1**: Closed by decision of the Product Owner: it waits for production."],
    [
      "a role the governance names",
      "**K8S-1**: Closed by decision of the operator on 2026-11-20: it waits for production.",
    ],
    [
      "a calendar date",
      "**K8S-1**: Closed by decision of the Product Owner on 2026-02-30: it waits for production.",
    ],
    ["the decision itself", "**K8S-1**: Closed by decision of the Product Owner on 2026-11-20."],
    ["the pull request's number", "**K8S-1**: Closed by pull request 916. The start passes."],
  ])("refuses a closure that lacks %s, as an open item that names both forms", (_lack, entry) => {
    plant([{ id: "F-01", state: "closed" }], [{ id: "F-01", attached: [entry] }]);

    const outcome = scan();

    expect(outcome.exitCode).toBe(1);
    expect(outcome.stderr).toEqual([
      `plan-closure-gate: F-01 is closed (${PLAN}:11) and its record holds an item that starts "Closed by" in neither form, so it is open: K8S-1 (${CHAIN}:12, in "Attached (1)"); ${GRAMMAR_HINT}`,
      "plan-closure-gate: 1 open item under 1 closed feature",
    ]);
  });

  it("counts every open item of every closed feature, and a note is not an item", () => {
    plant(
      [
        { id: "F-01", state: "closed" },
        { id: "F-02", state: "closed" },
      ],
      [
        { id: "F-01", attached: [openItem("DEF-29"), openItem("DEF-44")] },
        {
          id: "F-02",
          attached: [openItem("L-546"), "Note: DEF-7, attached to F-08, names this flow too."],
          count: 1,
        },
      ]
    );

    const outcome = scan();

    expect(outcome.exitCode).toBe(1);
    expect(outcome.stderr.map((line) => line.split(" (")[0])).toEqual([
      "plan-closure-gate: F-01 is closed",
      "plan-closure-gate: F-01 is closed",
      "plan-closure-gate: F-02 is closed",
      "plan-closure-gate: 3 open items under 2 closed features",
    ]);
    expect(outcome.stderr.slice(0, 3).map((line) => line.split(": ")[2]?.split(" (")[0])).toEqual([
      "DEF-29",
      "DEF-44",
      "L-546",
    ]);
  });
});

describe("a feature that is not closed", () => {
  it("passes in progress or open with open items under its record", () => {
    plant(
      [
        { id: "F-01", state: "in progress" },
        { id: "F-02", state: "open" },
      ],
      [
        { id: "F-01", attached: [openItem("DEF-29")], findings: [openItem("SEED-1")] },
        { id: "F-02", attached: [openItem("DEF-30")] },
      ]
    );

    const outcome = scan();

    expect(outcome.stderr).toEqual([]);
    expect(outcome.exitCode).toBe(0);
    expect(outcome.stdout).toEqual([
      "plan-closure-gate: 2 features in the chain table, 0 closed; 0 items under the records of the closed features, every one closed",
    ]);
  });
});

describe("fail-closed", () => {
  const failure = (outcome: Outcome): { exitCode: number; stderr: string[] } => ({
    exitCode: outcome.exitCode,
    stderr: outcome.stderr,
  });

  it("exits 3 when the plan is missing, never reading the absent file as no closed feature", () => {
    write(CHAIN, renderChain([{ id: "F-01", attached: [openItem("DEF-1")] }]));
    write(AREAS, AREAS_TEXT);

    const outcome = scan();

    expect(outcome.exitCode).toBe(3);
    expect(outcome.stderr).toHaveLength(1);
    expect(outcome.stderr[0]).toMatch(
      new RegExp(`^plan-closure-gate: ${PLAN} could not be read, so no feature's state was read: `)
    );
  });

  it.each([[CHAIN], [AREAS]])("exits 3 when the record file %s is missing", (missing) => {
    plant([{ id: "F-01", state: "open" }], [{ id: "F-01", attached: [openItem("DEF-1")] }]);
    rmSync(path.join(root, missing));

    const outcome = scan();

    expect(outcome.exitCode).toBe(3);
    expect(outcome.stderr[0]).toMatch(
      new RegExp(`^plan-closure-gate: ${missing} could not be read, so no record was read: `)
    );
  });

  it("exits 3 when the plan has no chain section", () => {
    plant([{ id: "F-01", state: "closed" }], [{ id: "F-01", attached: [openItem("DEF-1")] }]);
    write(PLAN, renderPlan([{ id: "F-01", state: "closed" }]).replace("## The chain", "## Chain"));

    expect(failure(scan())).toEqual({
      exitCode: 3,
      stderr: [
        `plan-closure-gate: ${PLAN} has no "## The chain" section, so no feature's state was read`,
      ],
    });
  });

  it("exits 3 when the chain section holds no table", () => {
    plant([], [{ id: "F-01", attached: [openItem("DEF-1")] }]);
    write(
      PLAN,
      ["# The plan", "", "## The chain", "", "The features, in order.", "", "## Closure", ""].join(
        "\n"
      )
    );

    expect(failure(scan())).toEqual({
      exitCode: 3,
      stderr: [
        `plan-closure-gate: the "## The chain" section of ${PLAN} holds no table, so no feature's state was read`,
      ],
    });
  });

  it("exits 3 when the chain table holds no feature row", () => {
    plant([], [{ id: "F-01", attached: [openItem("DEF-1")] }]);

    expect(failure(scan())).toEqual({
      exitCode: 3,
      stderr: [
        `plan-closure-gate: the chain table of ${PLAN} holds no feature row, so no feature's state was read`,
      ],
    });
  });

  it("exits 3 when the chain table has no State column", () => {
    plant([{ id: "F-01", state: "closed" }], [{ id: "F-01", attached: [openItem("DEF-1")] }]);
    write(PLAN, renderPlan([{ id: "F-01", state: "closed" }]).replace("| State ", "| Stage "));

    expect(failure(scan())).toEqual({
      exitCode: 3,
      stderr: [
        `plan-closure-gate: the chain table of ${PLAN}:9 has no "State" column, so no feature's state was read`,
      ],
    });
  });

  it("exits 3 on a state that is not open, in progress or closed", () => {
    plant([{ id: "F-01", state: "done" }], [{ id: "F-01", attached: [openItem("DEF-1")] }]);

    expect(failure(scan())).toEqual({
      exitCode: 3,
      stderr: [
        `plan-closure-gate: ${PLAN}:11 gives F-01 the state "done", which is none of open, in progress and closed`,
      ],
    });
  });

  it("exits 3 when a closed feature's record is not found", () => {
    plant([{ id: "F-01", state: "closed" }], [{ id: "F-02", attached: [openItem("DEF-1")] }]);

    expect(failure(scan())).toEqual({
      exitCode: 3,
      stderr: [
        `plan-closure-gate: F-01 is closed (${PLAN}:11) and no heading of ${CHAIN} or ${AREAS} opens its record, so no item of it was read`,
      ],
    });
  });

  it("exits 3 when a closed feature's record is opened twice, in the chain and in the areas", () => {
    plant(
      [{ id: "F-01", state: "closed" }],
      [{ id: "F-01", attached: [closedByPullRequest("DEF-1")] }]
    );
    write(AREAS, `${AREAS_TEXT}\n### F-01 The feature again\n\n- **Attached (0):**\n`);

    expect(failure(scan())).toEqual({
      exitCode: 3,
      stderr: [
        `plan-closure-gate: F-01 is closed (${PLAN}:11) and its record is opened more than once (${CHAIN}:5, ${AREAS}:7), so which one holds its items is ambiguous`,
      ],
    });
  });

  it("exits 3 when a closed feature's record holds no attached list", () => {
    plant(
      [{ id: "F-01", state: "closed" }],
      [{ id: "F-01", attached: [], findings: [closedByPullRequest("DEF-1")], withAttached: false }]
    );

    expect(failure(scan())).toEqual({
      exitCode: 3,
      stderr: [
        `plan-closure-gate: the record of F-01 (${CHAIN}:5) holds no "Attached (<n>)" list, so whether it holds an open item cannot be read`,
      ],
    });
  });

  it("exits 3 when the attached count the record states differs from the items read under it", () => {
    plant(
      [{ id: "F-01", state: "closed" }],
      [{ id: "F-01", attached: [closedByPullRequest("DEF-1")], count: 2 }]
    );

    expect(failure(scan())).toEqual({
      exitCode: 3,
      stderr: [
        `plan-closure-gate: the record of F-01 (${CHAIN}:11) states "Attached (2)" and 1 item was read under it, so an item is written where the gate cannot read it`,
      ],
    });
  });

  it("exits 3 when an item list holds a line that is neither an item nor a note", () => {
    plant(
      [{ id: "F-01", state: "closed" }],
      [
        {
          id: "F-01",
          attached: [closedByPullRequest("DEF-1"), "DEF-2 (MP:13): Closed by #903. No bold id."],
        },
      ]
    );

    expect(failure(scan())).toEqual({
      exitCode: 3,
      stderr: [
        `plan-closure-gate: ${CHAIN}:13, in "Attached (2)" of F-01, reads "  - DEF-2 (MP:13): Closed by #903. No bold id.", which is neither an item ("  - **<id>**: <text>", with an optional "(<reference>)" after the id) nor a note ("  - Note: <text>")`,
      ],
    });
  });
});

describe("the process", () => {
  const run = (args: readonly string[]): { status: number; stdout: string; stderr: string } => {
    const result = spawnSync(process.execPath, [GATE_SCRIPT, ...args], { encoding: "utf8" });
    return { status: result.status ?? -1, stdout: result.stdout, stderr: result.stderr };
  };

  it("exits with the verdict's code and writes each line to its stream", () => {
    plant([{ id: "F-01", state: "closed" }], [{ id: "F-01", attached: [openItem("DEF-29")] }]);

    const result = run(["--root", root]);

    expect(result.status).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr.split("\n").filter((line) => line !== "")).toHaveLength(2);
    expect(result.stderr).toContain("plan-closure-gate: 1 open item under 1 closed feature\n");
  });

  it("exits 0 with its one line on stdout over a plan with nothing open under a closed feature", () => {
    plant([{ id: "F-01", state: "closed" }], [{ id: "F-01", attached: [closedByDecision("K8S")] }]);

    const result = run(["--root", root]);

    expect(result.status).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.stdout).toBe(
      "plan-closure-gate: 1 feature in the chain table, 1 closed; 1 item under the records of the closed features, every one closed\n"
    );
  });

  it.each([[["--root"]], [["--root", "a", "--root", "b"]], [["--unknown"]]])(
    "exits 2 on the usage error %j",
    (args) => {
      const result = run(args);

      expect(result.status).toBe(2);
      expect(result.stderr).toBe(
        "usage: node scripts/testing/plan-closure-gate.mjs [--root <dir>]\n"
      );
    }
  );
});
