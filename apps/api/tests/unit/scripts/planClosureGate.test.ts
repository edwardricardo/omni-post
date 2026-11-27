/**
 * @file planClosureGate.test.ts
 * @description Pins `scripts/testing/plan-closure-gate.mjs`, fitness #56, the gate behind
 *   `pnpm check:plan-closure`: a feature whose state in the chain table of `docs/product/PLAN.md`
 *   is `closed` holds no open item under its record, an item being an entry of the record's
 *   attached list or of a findings list, and a closed item being one whose text starts with
 *   `Closed by #<n>` or `Closed by decision of the <role> on <date>: <the decision>`, the date a
 *   calendar date no later than the day the check runs and the decision holding a word of three
 *   letters or more. Every case writes its own small
 *   plan tree (the plan, the chain and the areas) in a scratch directory, so the suite measures the
 *   rule and never this repository's plan, and it can prove each red path while the live plan is in
 *   any state. Every fail-closed path the gate's header names is pinned to exit 3 with its message,
 *   apart from the violations' exit 1, and exit 3 is pinned to win over exit 1 with both printed,
 *   so a scan that read nothing never renders as a plan with every item closed. The record's shape
 *   is pinned too: a nested entry, and a line shaped like an item that no item list reads (at the
 *   top level, after a line that ended its list, inside a note, on a label's line), fail closed,
 *   while the continuation of an entry and the contents of a code span are left alone; a fenced
 *   block is read neither as the chain table nor as an item, and a fence nothing closes fails
 *   closed, in the record that opens it or in its file.
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
  runGate: (input: { root: string; now?: Date }) => Outcome;
};

const REPO_ROOT = findMonorepoRoot(path.dirname(fileURLToPath(import.meta.url)));
const GATE_SCRIPT = path.join(REPO_ROOT, "scripts/testing/plan-closure-gate.mjs");
const { PLAN, RECORDS, runGate } = (await import(GATE_SCRIPT)) as GateModule;
const CHAIN = "docs/product/plan/chain.md";
const AREAS = "docs/product/plan/areas.md";
const GRAMMAR_HINT =
  'start its text with "Closed by #<n>" or "Closed by decision of the <Product Owner|Maintainer> ' +
  'on <YYYY-MM-DD>: <the decision>", or set the feature back to "in progress"';

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
  `**${id}** (SMELL-11): Closed by #${String(pr)}. The start needed a file a clean checkout lacks.`;
const openItem = (id: string): string =>
  `**${id}** (SMELL-12): The health probe reads every account. Where: \`src/health.ts:4\`. Done: one row.`;
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
    "| #    | Feature          | Today | Items attached    | State       | Closed by |",
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
  "- **DEF-9** (SMELL-607): An open row of an area, which no feature of the chain holds.",
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

/**
 * Writes a plan tree whose one closed feature, F-01, has the given body lines as its record. The
 * record's heading is line 5 of the chain, so body line `k` (from 0) is line `7 + k`.
 */
const plantBody = (body: readonly string[]): void => {
  write(PLAN, renderPlan([{ id: "F-01", state: "closed" }]));
  write(
    CHAIN,
    [
      "# The chain: features",
      "",
      "## Platform and operation",
      "",
      "### F-01 The feature F-01",
      "",
      ...body,
      "",
      "## Decisions",
      "",
    ].join("\n")
  );
  write(AREAS, AREAS_TEXT);
};

/** The fail-closed line for a line shaped like an item that no item list reads. */
const unlisted = (line: number, text: string): string =>
  `plan-closure-gate: ${CHAIN}:${String(line)}, in the record of F-01, reads "${text}", which is ` +
  'shaped like an item ("**<id>**: ") and is not an entry of an "Attached (<n>)" or "Findings" ' +
  'list, so whether it is open cannot be read; write it as "  - **<id>**: <text>" under one of them';

const scan = (now?: Date): Outcome => runGate(now === undefined ? { root } : { root, now });

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
          attached: [
            closedByDecision("K8S-1"),
            closedByDecision("IMAGE-1", "Maintainer"),
            "**SEED-1**: Closed by decision of the Maintainer on 2026-11-20: Not now.",
          ],
          findings: [closedByPullRequest("DB-UP", 916)],
        },
      ]
    );

    const outcome = scan();

    expect(outcome.stderr).toEqual([]);
    expect(outcome.exitCode).toBe(0);
    expect(outcome.stdout).toEqual([
      "plan-closure-gate: 1 feature in the chain table, 1 closed; 4 items under the records of the closed features, every one closed",
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
    [
      "anything after its colon",
      "**K8S-1**: Closed by decision of the Product Owner on 2026-11-20:",
    ],
    [
      "a word in its decision",
      "**K8S-1**: Closed by decision of the Product Owner on 2026-11-20: .",
    ],
    [
      "a word of three letters in its decision",
      "**K8S-1**: Closed by decision of the Product Owner on 2026-11-20: a.",
    ],
    [
      "a date that has come",
      "**K8S-1**: Closed by decision of the Maintainer on 2999-01-01: it waits for production.",
    ],
    ["the pull request's number", "**K8S-1**: Closed by pull request 916. The start passes."],
    ["a pull request number from 1", "**K8S-1**: Closed by #0. The start passes."],
    ["a number with no leading zero", "**K8S-1**: Closed by #01. The start passes."],
    ["a number that ends its word", "**K8S-1**: Closed by #916abc The start passes."],
    ["the case of its words", "**K8S-1**: closed by #916. The start passes."],
  ])("refuses a closure that lacks %s, as an open item that names both forms", (_lack, entry) => {
    plant([{ id: "F-01", state: "closed" }], [{ id: "F-01", attached: [entry] }]);

    const outcome = scan();

    expect(outcome.exitCode).toBe(1);
    expect(outcome.stderr).toEqual([
      `plan-closure-gate: F-01 is closed (${PLAN}:11) and its record holds an item that starts "Closed by" in neither form, so it is open: K8S-1 (${CHAIN}:12, in "Attached (1)"); ${GRAMMAR_HINT}`,
      "plan-closure-gate: 1 open item under 1 closed feature",
    ]);
  });

  it("takes a decision dated up to the day the check runs, in UTC, and none dated after it", () => {
    plant(
      [{ id: "F-01", state: "closed" }],
      [
        {
          id: "F-01",
          attached: [
            closedByDecision("TODAY", "Product Owner", "2026-11-20"),
            closedByDecision("TOMORROW", "Product Owner", "2026-11-21"),
          ],
        },
      ]
    );

    const outcome = scan(new Date("2026-11-20T23:59:59Z"));

    expect(outcome.exitCode).toBe(1);
    expect(outcome.stderr).toEqual([
      `plan-closure-gate: F-01 is closed (${PLAN}:11) and its record holds an item that starts "Closed by" in neither form, so it is open: TOMORROW (${CHAIN}:13, in "Attached (2)"); ${GRAMMAR_HINT}`,
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

const failure = (outcome: Outcome): { exitCode: number; stderr: string[] } => ({
  exitCode: outcome.exitCode,
  stderr: outcome.stderr,
});

describe("the shape of a closed feature's record", () => {
  it.each([
    ["an item", "    - **DEF-2**: The endpoint still answers 404."],
    ["a bullet of prose", "    - see the log of the run."],
    ["an ordered entry", "    1. **DEF-2**: The endpoint still answers 404."],
  ])("exits 3 on a nested list entry under an entry, %s or not", (_kind, nested) => {
    plantBody(["- **Attached (1):**", "  - **DEF-1**: Closed by #916. Fixed.", nested]);

    expect(failure(scan())).toEqual({
      exitCode: 3,
      stderr: [
        `plan-closure-gate: ${CHAIN}:9, in "Attached (1)" of F-01, reads "${nested}", a nested list entry: an item list holds no nested list, so an item written there cannot be told from prose; write each item as its own entry ("  - **<id>**: <text>")`,
      ],
    });
  });

  it.each([
    ["three spaces", "   - **DEF-2**: The endpoint still answers 404."],
    ["a tab", "\t- **DEF-2**: The endpoint still answers 404."],
  ])("exits 3 on an entry indented by %s, which is neither an entry nor its text", (_by, entry) => {
    plantBody(["- **Attached (2):**", "  - **DEF-1**: Closed by #916. Fixed.", entry]);

    expect(failure(scan())).toEqual({
      exitCode: 3,
      stderr: [
        `plan-closure-gate: ${CHAIN}:9, in "Attached (2)" of F-01, reads "${entry}", which is neither an item ("  - **<id>**: <text>", with an optional "(<reference>)" after the id) nor a note ("  - Note: <text>")`,
      ],
    });
  });

  it("reads a line indented four spaces with no list marker as the text of the entry above", () => {
    plantBody([
      "- **Attached (1):**",
      "  - **DEF-1**: Closed by #916. The start needed a file",
      "    that a clean checkout lacks.",
    ]);

    const outcome = scan();

    expect(outcome.stderr).toEqual([]);
    expect(outcome.exitCode).toBe(0);
    expect(outcome.stdout).toEqual([
      "plan-closure-gate: 1 feature in the chain table, 1 closed; 1 item under the records of the closed features, every one closed",
    ]);
  });

  it.each([
    [
      "after a line that ended its findings list",
      [
        "- **Attached (0):**",
        "- **Findings since the feature opened:**",
        "  - **A**: Closed by #916. Fixed.",
        "Two more were found later:",
        "  - **B**: The endpoint answers 404.",
      ],
      11,
    ],
    [
      "after a line that ended its attached list, the count left as it was",
      [
        "- **Attached (1):**",
        "  - **A**: Closed by #916. Fixed.",
        "Found later:",
        "  - **B**: The endpoint answers 404.",
      ],
      10,
    ],
    [
      "under a label whose colon is outside the bold",
      [
        "- **Attached (0):**",
        "- **Findings since the feature opened**:",
        "  - **B**: The endpoint answers 404.",
      ],
      9,
    ],
    [
      "at the top level, under a sub-heading",
      ["- **Attached (0):**", "", "#### Findings", "", "- **B**: The endpoint answers 404."],
      11,
    ],
    [
      "at the top level of the record",
      ["- **Attached (0):**", "- **B** (SMELL-1): The page answers 404."],
      8,
    ],
    [
      "inside a note",
      [
        "- **Attached (0):**",
        "- **Findings since the feature opened:**",
        "  - Note: **B**: The endpoint answers 404.",
      ],
      9,
    ],
    [
      "on the line of a label",
      [
        "- **Attached (0):**",
        "- **Findings since the feature opened:** **B**: The endpoint answers 404.",
      ],
      8,
    ],
    [
      "in a prose list",
      ["- **Wrong as read:**", "  - **B**: The endpoint answers 404.", "- **Attached (0):**"],
      8,
    ],
    [
      "beside a code span, outside it",
      ["- **Attached (0):**", "- **B**: The page answers `404` to every request."],
      8,
    ],
    [
      "indented four spaces under a label that opens no item list",
      ["- **Who:** the operator.", "    **B**: The endpoint answers 404.", "- **Attached (0):**"],
      8,
    ],
  ])("exits 3 on a line shaped like an item %s", (_where, body, line) => {
    plantBody(body);

    expect(failure(scan())).toEqual({
      exitCode: 3,
      stderr: [unlisted(line, body[line - 7] ?? "")],
    });
  });

  it.each([
    ["an item", "    **DEF-2**: The endpoint still answers 404."],
    ["an item with its reference", "    **DEF-2** (SMELL-12): The endpoint still answers 404."],
  ])("exits 3 on the continuation of a closed entry that starts like %s", (_what, continuation) => {
    plantBody(["- **Attached (1):**", "  - **DEF-1**: Closed by #916. Fixed.", continuation]);

    expect(failure(scan())).toEqual({
      exitCode: 3,
      stderr: [
        `plan-closure-gate: ${CHAIN}:9, in "Attached (1)" of F-01, reads "${continuation}", the continuation of an entry that starts like an item: an item written as another entry's text cannot be told from that text; write it as its own entry ("  - **<id>**: <text>")`,
      ],
    });
  });

  it("exits 3 on a line whose backticks do not pair, scanning it whole", () => {
    const line = "- **Today:** the `x and **B**: The endpoint answers 404, see `` y.";
    plantBody([line, "- **Attached (0):**"]);

    expect(failure(scan())).toEqual({ exitCode: 3, stderr: [unlisted(7, line)] });
  });

  it.each([
    [
      "a continuation that mentions another item in bold inside its sentence",
      [
        "- **Attached (1):**",
        "  - **DEF-1**: Closed by #916. The start read the same file",
        "    as **DEF-2**: the generated environment file.",
      ],
    ],
    [
      "a code span that quotes the grammar",
      [
        "- **Today:** an item reads `  - **<id>**: <text>` and closes with `Closed by #<n>`.",
        "- **Attached (1):**",
        "  - **DEF-1**: Closed by #916. Fixed.",
      ],
    ],
    [
      "a double-backtick span that holds a single backtick around an item-shaped text",
      [
        "- **Today:** the grammar is quoted as ``**B**: a ` mark`` in a span.",
        "- **Attached (1):**",
        "  - **DEF-1**: Closed by #916. Fixed.",
      ],
    ],
    [
      "a continuation that starts with a bold label, its colon inside the bold",
      [
        "- **Attached (1):**",
        "  - **DEF-1**: Closed by #916. The start read the same file.",
        "    **Who:** the operator who ran it.",
      ],
    ],
  ])("leaves alone %s", (_what, body) => {
    plantBody(body);

    const outcome = scan();

    expect(outcome.stderr).toEqual([]);
    expect(outcome.exitCode).toBe(0);
    expect(outcome.stdout).toEqual([
      "plan-closure-gate: 1 feature in the chain table, 1 closed; 1 item under the records of the closed features, every one closed",
    ]);
  });
});

describe("fenced code blocks", () => {
  it("never reads a fenced table as the chain table", () => {
    write(
      PLAN,
      [
        "# The plan",
        "",
        "## The chain",
        "",
        "```markdown",
        "| #    | State |",
        "| ---- | ----- |",
        "| F-09 | open  |",
        "```",
        "",
        "| #    | State  |",
        "| ---- | ------ |",
        "| F-01 | closed |",
        "",
      ].join("\n")
    );
    write(CHAIN, renderChain([{ id: "F-01", attached: [openItem("DEF-29")] }]));
    write(AREAS, AREAS_TEXT);

    expect(failure(scan())).toEqual({
      exitCode: 1,
      stderr: [
        `plan-closure-gate: F-01 is closed (${PLAN}:13) and its record holds an open item: DEF-29 (${CHAIN}:12, in "Attached (1)"); ${GRAMMAR_HINT}`,
        "plan-closure-gate: 1 open item under 1 closed feature",
      ],
    });
  });

  it("never reads a line of a fenced example in a record as an item", () => {
    plantBody([
      "- **Attached (1):**",
      "  - **A**: Closed by #916. Fixed.",
      "",
      "```markdown",
      "  - **B**: The endpoint answers 404.",
      "- **C**: An example at the top level.",
      "```",
    ]);

    const outcome = scan();

    expect(outcome.stderr).toEqual([]);
    expect(outcome.exitCode).toBe(0);
    expect(outcome.stdout).toEqual([
      "plan-closure-gate: 1 feature in the chain table, 1 closed; 1 item under the records of the closed features, every one closed",
    ]);
  });

  it("exits 3 on a fence a closed feature's record opens and nothing closes", () => {
    plantBody([
      "- **Attached (0):**",
      "- **Findings since the feature opened:**",
      "```text",
      "  - **B**: The endpoint answers 404.",
    ]);

    expect(failure(scan())).toEqual({
      exitCode: 3,
      stderr: [
        `plan-closure-gate: the record of F-01 (${CHAIN}:5) opens a fenced code block at line 9 that is still open at the record's end, so no line after it is read; close the block`,
      ],
    });
  });

  it("exits 3 on a fence still open at the end of a file, outside every closed record", () => {
    plant(
      [{ id: "F-01", state: "closed" }],
      [{ id: "F-01", attached: [closedByPullRequest("DEF-1")] }]
    );
    write(AREAS, `${AREAS_TEXT}\`\`\`markdown\n- **DEF-10**: An open row of an area.\n`);

    expect(failure(scan())).toEqual({
      exitCode: 3,
      stderr: [
        `plan-closure-gate: ${AREAS}:6 opens a fenced code block that is still open at the end of the file, so no line after it is read as a heading, a table or an item; close the block`,
      ],
    });
  });

  it("exits 3 on a fence the plan opens before its chain section, which it then cannot find", () => {
    plant([{ id: "F-01", state: "closed" }], [{ id: "F-01", attached: [closedByDecision("A")] }]);
    write(
      PLAN,
      renderPlan([{ id: "F-01", state: "closed" }]).replace("## Rules", "```text\n## Rules")
    );

    expect(failure(scan())).toEqual({
      exitCode: 3,
      stderr: [
        `plan-closure-gate: ${PLAN} has no "## The chain" section, so no feature's state was read`,
        `plan-closure-gate: ${PLAN}:3 opens a fenced code block that is still open at the end of the file, so no line after it is read as a heading, a table or an item; close the block`,
      ],
    });
  });

  it("exits 3 on a fence the plan opens after its chain table, which it still reads", () => {
    plant([{ id: "F-01", state: "closed" }], [{ id: "F-01", attached: [openItem("DEF-29")] }]);
    write(
      PLAN,
      renderPlan([{ id: "F-01", state: "closed" }]).replace(
        "The order of the Platforms",
        "```text\nThe order of the Platforms"
      )
    );

    expect(failure(scan())).toEqual({
      exitCode: 3,
      stderr: [
        `plan-closure-gate: ${PLAN}:13 opens a fenced code block that is still open at the end of the file, so no line after it is read as a heading, a table or an item; close the block`,
        `plan-closure-gate: F-01 is closed (${PLAN}:11) and its record holds an open item: DEF-29 (${CHAIN}:12, in "Attached (1)"); ${GRAMMAR_HINT}`,
      ],
    });
  });

  it("never reads a fenced heading as the opening of a record", () => {
    write(PLAN, renderPlan([{ id: "F-01", state: "closed" }]));
    write(CHAIN, ["# The chain", "", "```markdown", "### F-01 An example", "```", ""].join("\n"));
    write(AREAS, AREAS_TEXT);

    expect(failure(scan())).toEqual({
      exitCode: 3,
      stderr: [
        `plan-closure-gate: F-01 is closed (${PLAN}:11) and no heading of ${CHAIN} or ${AREAS} opens its record, so no item of it was read`,
      ],
    });
  });
});

describe("fail-closed", () => {
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

  it("exits 3 when the plan opens the chain section twice", () => {
    plant([{ id: "F-01", state: "closed" }], [{ id: "F-01", attached: [closedByDecision("A")] }]);
    write(
      PLAN,
      `${renderPlan([{ id: "F-01", state: "closed" }])}\n## The chain\n\n| # | State |\n| --- | --- |\n| F-02 | open |\n`
    );

    expect(failure(scan())).toEqual({
      exitCode: 3,
      stderr: [
        `plan-closure-gate: ${PLAN} opens "## The chain" 2 times (lines 7, 21), so which one holds the chain table is ambiguous`,
      ],
    });
  });

  it("exits 3 when the chain table has no # column", () => {
    plant([{ id: "F-01", state: "closed" }], [{ id: "F-01", attached: [closedByDecision("A")] }]);
    write(PLAN, renderPlan([{ id: "F-01", state: "closed" }]).replace("| #    |", "| Id   |"));

    expect(failure(scan())).toEqual({
      exitCode: 3,
      stderr: [
        `plan-closure-gate: the chain table of ${PLAN}:9 has no "#" column, so no feature's state was read`,
      ],
    });
  });

  it("exits 3 on a row whose cells are not the header's", () => {
    plant(
      [{ id: "F-01", state: "closed | extra" }],
      [{ id: "F-01", attached: [closedByDecision("A")] }]
    );

    expect(failure(scan())).toEqual({
      exitCode: 3,
      stderr: [
        `plan-closure-gate: ${PLAN}:11 holds 7 cells where the chain table's header holds 6, so its state cannot be read`,
      ],
    });
  });

  it("exits 3 on a row with no feature id", () => {
    plant([{ id: "", state: "closed" }], [{ id: "F-01", attached: [openItem("DEF-1")] }]);

    expect(failure(scan())).toEqual({
      exitCode: 3,
      stderr: [`plan-closure-gate: ${PLAN}:11 is a row of the chain table with no feature id`],
    });
  });

  it("exits 3 on a feature the chain table lists twice", () => {
    plant(
      [
        { id: "F-01", state: "closed" },
        { id: "F-01", state: "open" },
      ],
      [{ id: "F-01", attached: [closedByDecision("A")] }]
    );

    expect(failure(scan())).toEqual({
      exitCode: 3,
      stderr: [
        `plan-closure-gate: ${PLAN}:12 lists F-01, which line 11 lists too, so its state is ambiguous`,
      ],
    });
  });

  it("exits 3 over exit 1, printing the unreadable entry and the open item", () => {
    plantBody([
      "- **Attached (2):**",
      "  - **DEF-29**: The endpoint answers 404.",
      "  - DEF-30 (MP:13): No bold id.",
    ]);

    expect(failure(scan())).toEqual({
      exitCode: 3,
      stderr: [
        `plan-closure-gate: ${CHAIN}:9, in "Attached (2)" of F-01, reads "  - DEF-30 (MP:13): No bold id.", which is neither an item ("  - **<id>**: <text>", with an optional "(<reference>)" after the id) nor a note ("  - Note: <text>")`,
        `plan-closure-gate: F-01 is closed (${PLAN}:11) and its record holds an open item: DEF-29 (${CHAIN}:8, in "Attached (2)"); ${GRAMMAR_HINT}`,
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
