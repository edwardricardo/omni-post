/**
 * @file planReadersAgree.test.ts
 * @description Holds the plan's two readers to one verdict on the record of a closed feature: the
 *   plan-closure gate (`scripts/testing/plan-closure-gate.mjs`, fitness #56) and the completeness
 *   check of the plan's records (`scripts/plan/plan-query.mjs check`). Both read a chain record
 *   through the one walker of `scripts/plan/plan-text.mjs`, so a line the gate refuses inside the
 *   record fails the check. The agreement runs one way: the records are stricter than the gate,
 *   so every line they read as an item there the gate reads as an item too, and an item line the
 *   gate accepts may still fail the check by a rule of the records' own. Each case writes one
 *   small plan tree, built from the same factory with one line changed, and runs both readers on
 *   it.
 * @layer infrastructure
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
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

/** The gate's surface; a literal import of an untyped `.mjs` would be an implicit any. */
interface GateModule {
  runGate: (input: { root: string; now?: Date }) => Outcome;
}

/** The query command's surface. */
interface QueryModule {
  runQuery: (input: { argv: readonly string[]; root: string; now?: Date }) => Outcome;
}

const REPO_ROOT = findMonorepoRoot(path.dirname(fileURLToPath(import.meta.url)));
const { runGate } = (await import(
  path.join(REPO_ROOT, "scripts/testing/plan-closure-gate.mjs")
)) as GateModule;
const { runQuery } = (await import(
  path.join(REPO_ROOT, "scripts/plan/plan-query.mjs")
)) as QueryModule;

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

interface ClosedRecordFixture {
  /** The bullets of the record's `To build` prose list, each written as it stands. */
  readonly toBuild: readonly string[];
  /** The paragraph written after the record's fields. */
  readonly paragraph: string;
  /** The count the `Attached (<n>)` label states. */
  readonly stated: number;
  /** The lines of the attached list, each written as it stands. */
  readonly attached: readonly string[];
}

const makeClosedRecord = (overrides: Partial<ClosedRecordFixture> = {}): ClosedRecordFixture => ({
  toBuild: ["  - nothing is left to build."],
  paragraph: "The record reads as the operator ran it.",
  stated: 1,
  attached: ["  - **DEF-1** (SMELL-768): Closed by #900. The start passes."],
  ...overrides,
});

/** The record's heading is line 5 of the chain; its attached label is line 13. */
const renderChain = (record: ClosedRecordFixture): string =>
  [
    "# The chain",
    "",
    "## Platform and operation",
    "",
    "### F-01 The platform starts from an empty database",
    "",
    "- **Who:** the operator.",
    "- **Today:** WORKS.",
    "- **To build:**",
    ...record.toBuild,
    "",
    record.paragraph,
    `- **Attached (${String(record.stated)}):**`,
    ...record.attached,
    "",
  ].join("\n");

const TEXTS: Record<Exclude<FileKey, "chain">, string> = {
  plan: [
    "# The plan",
    "",
    "## The chain",
    "",
    "| #    | Feature           | State  | Closed by |",
    "| ---- | ----------------- | ------ | --------- |",
    "| F-01 | The first feature | closed | #980      |",
    "",
  ].join("\n"),
  areas: [
    "# Areas outside the chain",
    "",
    "## A-TEAM Members, roles and access",
    "",
    "| Feature                                  | Who        | Today   | Depends on |",
    "| ---------------------------------------- | ---------- | ------- | ---------- |",
    "| A-TEAM-01 A Member sees the Organization | any Member | PARTIAL | F-01       |",
    "",
  ].join("\n"),
  crossCutting: "# Cross-cutting work\n\n## Findings\n\n- **X-1**: A finding.\n",
  offTheMap: "# Off the map\n\n## Deletion candidates\n\n- **STOR-1** (SMELL-525): Delete it.\n",
  parking: "# Parking\n\nIdeas with no slice.\n\n- An idea with no id.\n",
};

let root = "";

const writeTree = (record: ClosedRecordFixture): void => {
  const texts: Record<FileKey, string> = { ...TEXTS, chain: renderChain(record) };
  for (const key of Object.keys(FILES) as FileKey[]) {
    const full = path.join(root, FILES[key]);
    mkdirSync(path.dirname(full), { recursive: true });
    writeFileSync(full, texts[key]);
  }
};

interface Verdicts {
  readonly gate: number;
  readonly check: number;
  readonly gateNames: boolean;
  readonly checkNames: boolean;
}

/** Both readers' exit codes, and whether each names the location the case expects. */
const verdictsOf = (location: string): Verdicts => {
  const gate = runGate({ root, now: NOW });
  const check = runQuery({ argv: ["check"], root, now: NOW });
  return {
    gate: gate.exitCode,
    check: check.exitCode,
    gateNames: gate.stderr.some((line) => line.includes(location)),
    checkNames: check.stderr.some((line) => line.includes(location)),
  };
};

describe("the plan's readers", () => {
  beforeEach(() => {
    root = mkdtempSync(path.join(tmpdir(), "plan-readers-"));
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it("returns success from both readers when the record of the closed feature fits the grammar", () => {
    writeTree(makeClosedRecord());

    expect(verdictsOf(FILES.chain)).toEqual({
      gate: 0,
      check: 0,
      gateNames: false,
      checkNames: false,
    });
  });

  it("returns success from both readers when a blank line comes before the continuation of an entry", () => {
    writeTree(
      makeClosedRecord({
        attached: [
          "  - **DEF-1** (MP:768): Closed by #900. The start passes.",
          "",
          "    The entry goes on after a blank line.",
        ],
      })
    );

    expect(verdictsOf(`${FILES.chain}:16`)).toEqual({
      gate: 0,
      check: 0,
      gateNames: false,
      checkNames: false,
    });
  });

  it("returns success from the gate and a failure that names the line from the check when a closed record's item writes Found by twice", () => {
    writeTree(
      makeClosedRecord({
        attached: [
          "  - **DEF-1** (SMELL-768): Closed by #900. The start passes. Found by: one review. " +
            "Found by: another review.",
        ],
      })
    );

    expect(verdictsOf(`${FILES.chain}:14`)).toEqual({
      gate: 0,
      check: 1,
      gateNames: false,
      checkNames: true,
    });
  });

  it.each([
    [
      "an item-shaped bullet in the To build prose list",
      makeClosedRecord({ toBuild: ["  - see **PROSE-OPEN**: open"] }),
      `${FILES.chain}:10`,
    ],
    [
      "an item-shaped text in the middle of a paragraph",
      makeClosedRecord({ paragraph: "A paragraph that holds **MID-OPEN**: open" }),
      `${FILES.chain}:12`,
    ],
    [
      "an attached count no item list matches",
      makeClosedRecord({ stated: 2 }),
      `${FILES.chain}:13`,
    ],
  ])(
    "returns a failure from both readers, naming the line, when the record holds %s",
    (_case, record, location) => {
      writeTree(record);

      expect(verdictsOf(location)).toEqual({
        gate: 3,
        check: 1,
        gateNames: true,
        checkNames: true,
      });
    }
  );
});
