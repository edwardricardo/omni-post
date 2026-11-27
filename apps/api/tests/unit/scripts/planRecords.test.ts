/**
 * @file planRecords.test.ts
 * @description Pins `scripts/plan/plan-records.mjs`, the reader that turns the plan's six files
 *   into records: each chain feature of `chain.md` with the state of the chain table of
 *   `PLAN.md`, each feature row of the area tables of `areas.md` with its id as written and its
 *   canonical `A-<AREA>-<n>` id, and each item (the entries of a chain record's item lists, an
 *   area's attached items and findings, the bullets of `cross-cutting.md`, `off-the-map.md` and
 *   `parking.md`) with its owner, state, done condition, evidence paths and tags. It also pins
 *   completeness: every line outside fenced code gets a kind, and a line that fits no shape is
 *   returned as unclassified with its file and line, never skipped. Every case builds its own
 *   plan text from factories, so the suite measures the grammar and never this repository's plan.
 * @layer infrastructure
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { findMonorepoRoot } from "@packages/vitest-shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

interface PlanSource {
  readonly file: string;
  readonly text: string;
}

interface PlanRecord {
  readonly kind: string;
  readonly id: string | null;
  readonly writtenId: string | null;
  readonly file: string;
  readonly line: number;
  readonly title: string;
  readonly owner: string | null;
  readonly list: string | null;
  readonly who: string | null;
  readonly today: string | null;
  readonly need: string | null;
  readonly dependsOn: string | null;
  readonly state: string | null;
  readonly closedBy: string | null;
  readonly where: readonly string[];
  readonly done: string | null;
  readonly doneState: string;
  readonly tags: readonly string[];
  readonly mentions: readonly string[];
  readonly text: string;
}

interface ClassifiedLine {
  readonly file: string;
  readonly line: number;
  readonly kind: string;
  readonly reason?: string;
}

interface ParsedPlan {
  readonly records: readonly PlanRecord[];
  readonly lines: readonly ClassifiedLine[];
  readonly unclassified: readonly ClassifiedLine[];
  readonly failures: readonly string[];
}

/** The module's surface; a literal import of an untyped `.mjs` would be an implicit any. */
interface RecordsModule {
  parsePlan: (sources: readonly PlanSource[], options?: { now?: Date }) => ParsedPlan;
  filterRecords: (
    records: readonly PlanRecord[],
    filters: readonly { field: string; value: string }[]
  ) => PlanRecord[];
  findRecords: (records: readonly PlanRecord[], key: string) => PlanRecord[];
  readSources: (root: string) => { sources: PlanSource[]; failures: string[] };
  FILTER_FIELDS: Readonly<Record<string, { key: string; match: string }>>;
  NO_ID_TEXT: string;
}

const REPO_ROOT = findMonorepoRoot(path.dirname(fileURLToPath(import.meta.url)));
const { parsePlan, filterRecords, findRecords, readSources, FILTER_FIELDS, NO_ID_TEXT } =
  (await import(path.join(REPO_ROOT, "scripts/plan/plan-records.mjs"))) as RecordsModule;

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

interface ItemFixture {
  readonly id: string;
  readonly reference: string | null;
  readonly text: string;
}

const makeItem = (overrides: Partial<ItemFixture> = {}): ItemFixture => ({
  id: "DEF-29",
  reference: "MP:636",
  text:
    "The workers cannot decrypt the channel credentials. Where: " +
    "`apps/api/src/security/EncryptionService.ts:99-101`, `apps/workers/src/crypto.ts`. " +
    "Done: the workers read what the API writes.",
  ...overrides,
});

const itemLine = (item: ItemFixture): string =>
  `**${item.id}**${item.reference === null ? "" : ` (${item.reference})`}: ${item.text}`;

interface ChainFeatureFixture {
  readonly id: string;
  readonly title: string;
  readonly who: string;
  readonly dependsOn: string;
  readonly today: string;
  readonly proofOfDone: string;
  readonly proofBase: string;
  readonly attached: readonly string[];
  readonly findings: readonly string[];
  /** Lines written between the proof base and the attached list. */
  readonly extra: readonly string[];
}

const makeChainFeature = (overrides: Partial<ChainFeatureFixture> = {}): ChainFeatureFixture => ({
  id: "F-01",
  title: "The platform starts from an empty database",
  who: "the operator.",
  dependsOn: "nothing.",
  today: "WORKS, as read against the code.",
  proofOfDone: "a clean checkout reaches a healthy API, in CI.",
  proofBase: "4b.1 `test-env.sh env` (not started); 6.E2 the publish proof (not started).",
  attached: [itemLine(makeItem())],
  findings: [],
  extra: [],
  ...overrides,
});

/** An entry that starts with a space is written as it stands: a continuation or a nested entry. */
const entryLine = (entry: string): string => (entry.startsWith(" ") ? entry : `  - ${entry}`);

/** The record's heading is line 5 of the chain, its attached label line `14 + extra`. */
const renderChainFeature = (feature: ChainFeatureFixture): string[] => [
  `### ${feature.id} ${feature.title}`,
  "",
  `- **Who:** ${feature.who}`,
  `- **Depends on:** ${feature.dependsOn}`,
  `- **Today:** ${feature.today}`,
  "- **Wrong as read:**",
  "  - The gate reads one cookie only, and this sentence is prose.",
  `- **Proof of done:** ${feature.proofOfDone}`,
  `- **Proof base:** ${feature.proofBase}`,
  ...feature.extra,
  `- **Attached (${String(feature.attached.length)}):**`,
  ...feature.attached.map(entryLine),
  ...(feature.findings.length === 0
    ? []
    : ["- **Findings since the feature opened:**", ...feature.findings.map(entryLine)]),
  "",
];

const renderChain = (features: readonly ChainFeatureFixture[]): string =>
  [
    "# The chain: features",
    "",
    "## Platform and operation",
    "",
    ...features.flatMap(renderChainFeature),
    "## Decisions",
    "",
    "| #   | Decision | Result      |",
    "| --- | -------- | ----------- |",
    "| 1   | How      | One command |",
    "",
  ].join("\n");

interface ChainRowFixture {
  readonly id: string;
  readonly state: string;
  readonly closedBy: string;
}

const makeChainRow = (overrides: Partial<ChainRowFixture> = {}): ChainRowFixture => ({
  id: "F-01",
  state: "in progress",
  closedBy: "—",
  ...overrides,
});

const renderPlan = (rows: readonly ChainRowFixture[]): string =>
  [
    "# The plan",
    "",
    "One plan for the whole product.",
    "",
    "## The chain",
    "",
    "| #    | Feature   | Today | Items attached    | State | Closed by |",
    "| ---- | --------- | ----- | ----------------- | ----- | --------- |",
    ...rows.map((row) => `| ${row.id} | A feature | WORKS | 1 | ${row.state} | ${row.closedBy} |`),
    "",
    "## Areas outside the chain",
    "",
    "| Area   | Features |",
    "| ------ | -------- |",
    "| A-TEAM | 1        |",
    "",
  ].join("\n");

interface AreaFixture {
  readonly code: string;
  readonly title: string;
  readonly header: readonly string[];
  readonly rows: readonly (readonly string[])[];
  readonly attached: readonly string[];
  readonly mainFindings: readonly string[];
}

const makeArea = (overrides: Partial<AreaFixture> = {}): AreaFixture => ({
  code: "TEAM",
  title: "Members, roles and access",
  header: ["Feature", "Who", "Today", "Depends on"],
  rows: [["A-TEAM-01 A Member sees who is in the Organization", "any Member", "PARTIAL", "F-10"]],
  attached: [
    itemLine(
      makeItem({
        id: "DEF-9",
        reference: "MP:607",
        text: "The OIDC state is kept in a module map. Where: `apps/api/src/auth/oidcRoutes.ts:63`. Done: not stated.",
      })
    ),
  ],
  mainFindings: ["Single sign-on cannot work for Members as the code is written."],
  ...overrides,
});

const tableLine = (cells: readonly string[]): string => `| ${cells.join(" | ")} |`;

const renderArea = (area: AreaFixture): string[] => [
  `## A-${area.code} ${area.title}`,
  "",
  "1 feature as read: PARTIAL 1.",
  "",
  "Main findings:",
  "",
  ...area.mainFindings.map((finding) => `- ${finding}`),
  "",
  tableLine(area.header),
  tableLine(area.header.map(() => "---")),
  ...area.rows.map(tableLine),
  "",
  `Items attached to this area (${String(area.attached.length)}):`,
  "",
  ...area.attached.map((row) => `- ${row}`),
  "",
];

const renderAreas = (areas: readonly AreaFixture[]): string =>
  ["# Areas outside the chain", "", ...areas.flatMap(renderArea)].join("\n");

const CROSS_CUTTING = [
  "# Cross-cutting work",
  "",
  "## Work by subject (1)",
  "",
  "### Architecture / quality",
  "",
  "- **SAGA-UNIT-TESTS** (MP:355): The saga suites tolerate a failed saga. Where: `packages/core/saga.ts`. Done: not stated.",
  "",
  "## Testing refoundation units (1)",
  "",
  "- **6.E2**: The publish proof of one Channel. Done: the proof passes in CI.",
  "",
  "## Security slice",
  "",
  "- `GET /activity-feed`: any signed-in Member reads audit rows of others. Not verified.",
  "",
].join("\n");

const OFF_THE_MAP = [
  "# Off the map",
  "",
  "## Off the map: deletion candidates (1 old rows)",
  "",
  "- **STOR-1** (MP:525): Delete the package. Where: `packages/adapters/storage-cloudinary`. Done: not stated.",
  "",
].join("\n");

const PARKING = [
  "# Parking",
  "",
  "Ideas with no slice.",
  "",
  "- Creation of an Organization by an administrator.",
  "- **CACHE-STAMPEDE-PROTECTION**: Single-flight for the cache adapter.",
  "",
].join("\n");

const makeSources = (overrides: Partial<Record<FileKey, string>> = {}): PlanSource[] => {
  const texts: Record<FileKey, string> = {
    plan: renderPlan([makeChainRow()]),
    chain: renderChain([makeChainFeature()]),
    areas: renderAreas([makeArea()]),
    crossCutting: CROSS_CUTTING,
    offTheMap: OFF_THE_MAP,
    parking: PARKING,
    ...overrides,
  };
  return (Object.keys(FILES) as FileKey[]).map((key) => ({ file: FILES[key], text: texts[key] }));
};

const parse = (overrides: Partial<Record<FileKey, string>> = {}): ParsedPlan =>
  parsePlan(makeSources(overrides), { now: NOW });

const recordOf = (parsed: ParsedPlan, id: string): PlanRecord | undefined =>
  parsed.records.find((record) => record.id === id);

const unclassifiedOf = (parsed: ParsedPlan): string[] =>
  parsed.unclassified.map((line) => `${line.file}:${String(line.line)}`);

/** A record as the queries receive it, for the cases that need no plan text. */
const makeRecord = (overrides: Partial<PlanRecord> = {}): PlanRecord => ({
  kind: "item",
  id: "DEF-29",
  writtenId: "DEF-29",
  file: FILES.chain,
  line: 15,
  title: "The workers cannot decrypt the channel credentials.",
  owner: "Platform and operation",
  list: "Attached (1)",
  who: null,
  today: null,
  need: null,
  dependsOn: null,
  state: "open",
  closedBy: null,
  where: ["apps/api/src/security/EncryptionService.ts:99-101"],
  done: "the workers read what the API writes.",
  doneState: "stated",
  tags: ["MP:636"],
  mentions: [],
  text: "The workers cannot decrypt the channel credentials.",
  ...overrides,
});

const titlesOf = (records: readonly PlanRecord[]): string[] => records.map((r) => r.title);

describe("plan-records", () => {
  let parsed: ParsedPlan;

  beforeEach(() => {
    parsed = parse();
  });

  describe("features", () => {
    it("returns a chain feature with its title, who, today, depends on and proof of done", () => {
      const feature = recordOf(parsed, "F-01");

      expect(feature).toMatchObject({
        kind: "feature",
        writtenId: "F-01",
        file: FILES.chain,
        line: 5,
        title: "The platform starts from an empty database",
        owner: "Platform and operation",
        who: "the operator.",
        today: "WORKS, as read against the code.",
        dependsOn: "nothing.",
        done: "a clean checkout reaches a healthy API, in CI.",
        doneState: "stated",
        need: null,
      });
    });

    it("returns the state and closed-by of the chain table on a chain feature", () => {
      const closed = parse({
        plan: renderPlan([makeChainRow({ state: "closed", closedBy: "#980" })]),
      });

      expect(recordOf(closed, "F-01")).toMatchObject({ state: "closed", closedBy: "#980" });
    });

    it("returns the units of the proof base as a feature's tags and the ids its prose names as mentions", () => {
      const feature = recordOf(
        parse({
          chain: renderChain([
            makeChainFeature({
              who: "the operator (MP:131), as DEF-163 says.",
              extra: [
                "- **Cut (confirmed by the Product Owner on 2026-11-16):** DEF-85 and DEF-97.",
              ],
            }),
          ]),
        }),
        "F-01"
      );

      expect({ tags: feature?.tags, mentions: feature?.mentions }).toEqual({
        tags: ["4b.1", "6.E2"],
        mentions: ["MP:131", "DEF-163", "DEF-85", "DEF-97"],
      });
    });

    it("returns the done state of a chain feature by its proof of done", () => {
      const feature = recordOf(
        parse({
          chain: renderChain([
            makeChainFeature({ proofOfDone: "Not stated (the slice decides)." }),
          ]),
        }),
        "F-01"
      );

      expect(feature).toMatchObject({
        done: "Not stated (the slice decides).",
        doneState: "not-stated",
      });
    });

    it.each([
      ["TEAM", "A-TEAM-03 A Member is invited", "A-TEAM-03", "A-TEAM-03"],
      ["CONTENT", "C-07 A Member keeps templates", "C-07", "A-CONTENT-07"],
      ["BILLING", "11. A Member reads the invoices", "11.", "A-BILLING-11"],
      [
        "ANALYTICS",
        "A-ANALYTICS-04. The platform collects metrics",
        "A-ANALYTICS-04.",
        "A-ANALYTICS-04",
      ],
      ["ADMIN-OPS", "3. An administrator reads the dashboard", "3.", "A-ADMIN-OPS-03"],
      ["PLATFORMS", "AP-33 A Member connects", "AP-33", "A-PLATFORMS-33"],
    ])("returns the canonical id when the %s row writes %s", (code, cell, writtenId, canonical) => {
      const areas = renderAreas([
        makeArea({ code, rows: [[cell, "any Member", "PARTIAL", "F-10"]] }),
      ]);

      const feature = recordOf(parse({ areas }), canonical);

      expect(feature).toMatchObject({ kind: "feature", writtenId, owner: `A-${code}` });
    });

    it("returns the canonical id by table position when the row writes no id", () => {
      const areas = renderAreas([
        makeArea({
          code: "SCHEDULING",
          rows: [
            ["A Member uploads a CSV", "Member", "PARTIAL", "F-14"],
            ["A Member reads the result of a bulk upload", "Member", "DEAD", "none"],
          ],
        }),
      ]);

      const feature = recordOf(parse({ areas }), "A-SCHEDULING-02");

      expect(feature).toMatchObject({
        writtenId: null,
        title: "A Member reads the result of a bulk upload",
        who: "Member",
        today: "DEAD",
        dependsOn: "none",
      });
    });

    it("returns the need when a feature table carries a Need column", () => {
      const areas = renderAreas([
        makeArea({
          header: ["Feature", "Who", "Today", "Depends on", "Need"],
          rows: [
            ["A-TEAM-01 A Member sees the team", "any Member", "PARTIAL", "F-10", "Necessary"],
          ],
        }),
      ]);

      expect(recordOf(parse({ areas }), "A-TEAM-01")?.need).toBe("Necessary");
    });
  });

  describe("items", () => {
    it("returns an item of a chain record with its owner, list, where paths and done condition", () => {
      const item = recordOf(parsed, "DEF-29");

      expect(item).toMatchObject({
        kind: "item",
        writtenId: "DEF-29",
        file: FILES.chain,
        line: 15,
        title: "The workers cannot decrypt the channel credentials.",
        owner: "F-01",
        list: "Attached (1)",
        state: "open",
        closedBy: null,
        where: ["apps/api/src/security/EncryptionService.ts:99-101", "apps/workers/src/crypto.ts"],
        done: "the workers read what the API writes.",
        doneState: "stated",
      });
    });

    it.each([
      ["open", "The probe reads every account. Done: one row.", "open", null],
      [
        "closed by a pull request",
        "Closed by #916. The start passes.",
        "closed-by-pull-request",
        "#916",
      ],
      [
        "closed by a decision",
        "Closed by decision of the Product Owner on 2026-11-20: it waits for production.",
        "closed-by-decision",
        "decision of the Product Owner on 2026-11-20",
      ],
      ["a lookalike of a closure", "closed by #916. The start passes.", "open", null],
      [
        "closed by a decision dated after the run",
        "Closed by decision of the Product Owner on 2026-12-01: it waits for production.",
        "open",
        null,
      ],
      [
        "closed by a decision whose words are on its continuation",
        "Closed by decision of the Product Owner on 2026-11-20: a.",
        "open",
        null,
      ],
    ])("returns the state when the item is %s", (_case, text, state, closedBy) => {
      const chain = renderChain([
        makeChainFeature({
          attached: [itemLine(makeItem({ text })), "    it waits for production."],
        }),
      ]);

      expect(recordOf(parse({ chain }), "DEF-29")).toMatchObject({ state, closedBy });
    });

    it.each([
      ["a pull request", "Closed by #916. The start passes. Done: one run.", "The start passes."],
      [
        "a decision",
        "Closed by decision of the Maintainer on 2026-11-20: it waits for production.",
        "it waits for production.",
      ],
    ])(
      "returns a title without its closure marker when the item is closed by %s",
      (_case, text, title) => {
        const chain = renderChain([makeChainFeature({ attached: [itemLine(makeItem({ text }))] })]);

        expect(recordOf(parse({ chain }), "DEF-29")?.title).toBe(title);
      }
    );

    it.each([
      ["not stated.", "not-stated"],
      ["Not stated.", "not-stated"],
      ["Not stated (the slice decides).", "not-stated"],
      ["not stated beyond the change itself.", "not-stated"],
      ["Not stated beyond the change: the route answers 200.", "not-stated"],
      ["the route answers 200.", "stated"],
    ])("returns the done state when the done condition reads %s", (done, doneState) => {
      const chain = renderChain([
        makeChainFeature({
          attached: [itemLine(makeItem({ text: `The probe reads every account. Done: ${done}` }))],
        }),
      ]);

      expect(recordOf(parse({ chain }), "DEF-29")).toMatchObject({ done, doneState });
    });

    it("returns not-stated as the done state when the item says its done condition is not stated", () => {
      expect(recordOf(parsed, "STOR-1")).toMatchObject({
        done: "not stated.",
        doneState: "not-stated",
      });
    });

    it("returns only the path-shaped code spans of an item's where as its evidence paths", () => {
      const text =
        "The seed reads the fallback. Where: `evaluateAdminPassword`, `:89`, " +
        "`infra/prisma/seed.ts:89`, `package.json`, `ADMIN_PASSWORD`, `GET /activity feed`. Done: one.";
      const chain = renderChain([makeChainFeature({ attached: [itemLine(makeItem({ text }))] })]);

      expect(recordOf(parse({ chain }), "DEF-29")?.where).toEqual([
        "infra/prisma/seed.ts:89",
        "package.json",
      ]);
    });

    it("returns a bare line span of an item's where joined to the nearest path before it", () => {
      const text =
        "The relay reads the row twice. Where: `apps/api/src/outbox/relay.ts:57-68`, `:89`, " +
        "`apps/workers/src/dispatch.ts`, `:12-14,20`. Done: one read.";
      const chain = renderChain([makeChainFeature({ attached: [itemLine(makeItem({ text }))] })]);

      expect(recordOf(parse({ chain }), "DEF-29")?.where).toEqual([
        "apps/api/src/outbox/relay.ts:57-68",
        "apps/api/src/outbox/relay.ts:89",
        "apps/workers/src/dispatch.ts",
        "apps/workers/src/dispatch.ts:12-14,20",
      ]);
    });

    it("returns a null id and keeps the plan's text as the written id when an item is written **(no id)**", () => {
      const chain = renderChain([
        makeChainFeature({ attached: [itemLine(makeItem({ id: "(no id)", reference: null }))] }),
      ]);

      const item = parse({ chain }).records.find((record) => record.kind === "item");

      expect({ id: item?.id, writtenId: item?.writtenId, constant: NO_ID_TEXT }).toEqual({
        id: null,
        writtenId: "(no id)",
        constant: "(no id)",
      });
    });

    it("returns absent as the done state when the item writes no done condition", () => {
      const chain = renderChain([
        makeChainFeature({
          attached: [itemLine(makeItem({ text: "The health probe reads every account." }))],
        }),
      ]);

      expect(recordOf(parse({ chain }), "DEF-29")).toMatchObject({
        done: null,
        doneState: "absent",
      });
    });

    it("returns its reference and its own id as tags and the ids its text names as mentions", () => {
      const chain = renderChain([
        makeChainFeature({
          attached: [
            itemLine(
              makeItem({
                text: "The change path of DEF-163 (MP:909) and of SMELL-3 and FN-023. Done: one.",
              })
            ),
          ],
        }),
      ]);

      const item = recordOf(parse({ chain }), "DEF-29");

      expect({ tags: item?.tags, mentions: item?.mentions }).toEqual({
        tags: ["MP:636", "DEF-29"],
        mentions: ["MP:909", "DEF-163", "SMELL-3", "FN-023"],
      });
    });

    it("returns the id as a unit tag when the item is under the testing refoundation units", () => {
      expect(recordOf(parsed, "6.E2")).toMatchObject({
        owner: "Testing refoundation units (1)",
        tags: ["6.E2"],
        done: "the proof passes in CI.",
      });
    });

    it("returns the items attached to an area as items owned by that area", () => {
      expect(recordOf(parsed, "DEF-9")).toMatchObject({
        kind: "item",
        file: FILES.areas,
        owner: "A-TEAM",
        list: "Items attached to this area (1)",
        where: ["apps/api/src/auth/oidcRoutes.ts:63"],
        tags: ["MP:607", "DEF-9"],
      });
    });

    it("returns an item of cross-cutting owned by its section and listed under its sub-heading", () => {
      expect(recordOf(parsed, "SAGA-UNIT-TESTS")).toMatchObject({
        owner: "Work by subject (1)",
        list: "Architecture / quality",
        tags: ["MP:355"],
      });
    });

    it("returns a parking idea that writes no id as an item with a null id", () => {
      const idea = parsed.records.find(
        (record) => record.file === FILES.parking && record.line === 5
      );

      expect(idea).toMatchObject({
        kind: "item",
        id: null,
        writtenId: null,
        owner: "Parking",
        title: "Creation of an Organization by an administrator.",
      });
    });

    it("joins a continuation line to the text of the item above it", () => {
      const chain = renderChain([
        makeChainFeature({
          attached: [
            itemLine(makeItem({ text: "The probe reads every account." })),
            "    Done: one row.",
          ],
        }),
      ]);

      expect(recordOf(parse({ chain }), "DEF-29")).toMatchObject({
        text: "The probe reads every account. Done: one row.",
        done: "one row.",
      });
    });

    it("joins a continuation written after a blank line to the item above it, as the gate reads it", () => {
      const chain = renderChain([
        makeChainFeature({
          attached: [
            itemLine(makeItem({ text: "The probe reads every account." })),
            "    Done: one row.",
          ],
        }),
      ])
        .replace("\n    Done: one row.", "\n\n    Done: one row.")
        .replace("- **Attached (2):**", "- **Attached (1):**");

      const read = parse({ chain });

      expect({
        unclassified: unclassifiedOf(read),
        failures: read.failures,
        done: recordOf(read, "DEF-29")?.done,
      }).toEqual({ unclassified: [], failures: [], done: "one row." });
    });

    it("reads no item inside a fenced code block of a chain item list, and counts the items around it", () => {
      const chain = renderChain([
        makeChainFeature({
          attached: [
            itemLine(makeItem()),
            "  ```text",
            "  - **FENCED-1**: an example, not an item.",
            "  ```",
          ],
        }),
      ]).replace("- **Attached (4):**", "- **Attached (1):**");

      const read = parse({ chain });

      expect({
        fenced: recordOf(read, "FENCED-1"),
        items: read.records.filter((record) => record.kind === "item" && record.owner === "F-01")
          .length,
        unclassified: unclassifiedOf(read),
        failures: read.failures,
      }).toEqual({ fenced: undefined, items: 1, unclassified: [], failures: [] });
    });
  });

  describe("completeness", () => {
    it("classifies every line of the plan when every line fits a shape", () => {
      expect(parsed.unclassified).toEqual([]);
    });

    it("gives every line of every file one kind", () => {
      const sources = makeSources();

      const counted = sources.map(
        (source) => parsed.lines.filter((line) => line.file === source.file).length
      );

      expect(counted).toEqual(sources.map((source) => source.text.split("\n").length));
    });

    it.each([
      [
        "a feature of the chain table that no chain record holds",
        { plan: renderPlan([makeChainRow(), makeChainRow({ id: "F-19" })]) },
        "F-19",
      ],
      [
        "a chain record that no row of the chain table lists",
        { chain: renderChain([makeChainFeature(), makeChainFeature({ id: "F-02" })]) },
        "F-02",
      ],
      [
        "a chain record whose attached count is not the items read under it",
        {
          chain: renderChain([makeChainFeature()]).replace(
            "- **Attached (1):**",
            "- **Attached (2):**"
          ),
        },
        `${FILES.chain}:14`,
      ],
      [
        "a chain record with no attached list",
        {
          chain: renderChain([makeChainFeature()]).replace(
            "- **Attached (1):**",
            "- **Findings since the feature opened:**"
          ),
        },
        `${FILES.chain}:5`,
      ],
      [
        "two features that carry one canonical id",
        {
          areas: renderAreas([
            makeArea({
              rows: [
                ["A-TEAM-01 A Member sees the team", "any Member", "PARTIAL", "F-10"],
                ["A-TEAM-01 A Member leaves the team", "any Member", "DEAD", "F-10"],
              ],
            }),
          ]),
        },
        "A-TEAM-01",
      ],
      [
        "an area with no feature table",
        {
          areas: renderAreas([makeArea()]).replace(/\| Feature[^\n]*\n\|[^\n]*\n\|[^\n]*\n/, ""),
        },
        `${FILES.areas}:3`,
      ],
    ])("returns a failure that names it when the plan holds %s", (_case, overrides, named) => {
      const read = parse(overrides);

      expect(read.failures.some((failure) => failure.includes(named))).toBe(true);
    });

    it.each([
      [
        "an item-shaped bullet in a prose list of an area",
        {
          areas: renderAreas([
            makeArea({ mainFindings: ["**DEF-1**: an item written as a finding."] }),
          ]),
        },
        `${FILES.areas}:9`,
      ],
      [
        "a table row whose cells are not the header's",
        {
          areas: renderAreas([
            makeArea({ rows: [["A-TEAM-01 A Member sees", "any Member", "PARTIAL"]] }),
          ]),
        },
        `${FILES.areas}:13`,
      ],
      [
        "a nested entry under an entry of a chain item list",
        {
          chain: renderChain([
            makeChainFeature({ attached: [itemLine(makeItem()), "    - **DEF-2**: nested."] }),
          ]),
        },
        `${FILES.chain}:16`,
      ],
      [
        "an entry of a chain item list that is neither an item nor a note",
        { chain: renderChain([makeChainFeature({ attached: ["DEF-2 has no bold id."] })]) },
        `${FILES.chain}:15`,
      ],
      [
        "an item at the top level of a chain record",
        {
          chain: renderChain([
            makeChainFeature({ extra: ["- **DEF-3**: written outside any list."] }),
          ]),
        },
        `${FILES.chain}:14`,
      ],
      [
        "an indented line after a paragraph",
        { parking: "# Parking\n\nIdeas with no slice.\n   an indented line.\n" },
        `${FILES.parking}:4`,
      ],
      [
        "a fenced code block that nothing closes",
        { parking: "# Parking\n\n```text\n- an idea inside the fence.\n" },
        `${FILES.parking}:3`,
      ],
      [
        "an area table whose header is not the feature header",
        { areas: renderAreas([makeArea({ header: ["Feature", "Who", "Today", "Depends"] })]) },
        `${FILES.areas}:11`,
      ],
      [
        "a second-level heading of the areas that names no area",
        { areas: renderAreas([makeArea()]).replace("## A-TEAM ", "## Team ") },
        `${FILES.areas}:3`,
      ],
      ["a blockquote line", { parking: "# Parking\n\n> A quoted note.\n" }, `${FILES.parking}:3`],
      [
        "a raw HTML line",
        { parking: "# Parking\n\n<li><b>HTML-OPEN</b>: open</li>\n" },
        `${FILES.parking}:3`,
      ],
      [
        "an item-shaped text in the middle of a paragraph",
        { parking: "# Parking\n\nA paragraph that holds **MID-OPEN**: open\n" },
        `${FILES.parking}:3`,
      ],
      [
        "an item-shaped text in the prose of the plan",
        {
          plan: renderPlan([makeChainRow()]).replace(
            "One plan for the whole product.",
            "One plan, see **PLAN-OPEN**: open"
          ),
        },
        `${FILES.plan}:3`,
      ],
      [
        "an item-shaped bullet in a prose list of a chain record",
        {
          chain: renderChain([makeChainFeature()]).replace(
            "  - The gate reads one cookie only, and this sentence is prose.",
            "  - see **PROSE-OPEN**: open"
          ),
        },
        `${FILES.chain}:11`,
      ],
      [
        "a heading inside a chain record that names its feature again",
        {
          chain: renderChain([makeChainFeature()]).replace(
            "## Decisions",
            "#### F-01 More of the record\n\n## Decisions"
          ),
        },
        `${FILES.chain}:17`,
      ],
      [
        "an item-shaped text in the middle of a paragraph of a chain record",
        {
          chain: renderChain([
            makeChainFeature({ extra: ["A paragraph that holds **MID-OPEN**: open"] }),
          ]),
        },
        `${FILES.chain}:14`,
      ],
    ])("reports %s as unclassified with its file and line", (_case, overrides, location) => {
      expect(unclassifiedOf(parse(overrides))).toEqual([location]);
    });

    it("returns a third-level heading as unclassified when its section holds a feature record and it is no record heading", () => {
      const chain = renderChain([makeChainFeature()]).replace(
        "## Decisions\n",
        "### Shared notes of the platform\n\n## Decisions\n"
      );

      const refused = parse({ chain }).unclassified;

      expect(refused.map((line) => [`${line.file}:${String(line.line)}`, line.reason])).toEqual([
        [`${FILES.chain}:17`, expect.stringContaining("in a section that holds feature records")],
      ]);
    });

    it("returns a third-level heading as unclassified when it begins like a feature id and is no record heading", () => {
      const chain = renderChain([makeChainFeature()]).replace(
        "## Decisions\n",
        "## Decisions\n\n### F-19: A typo'd feature\n"
      );

      const refused = parse({ chain }).unclassified;

      expect(refused.map((line) => [`${line.file}:${String(line.line)}`, line.reason])).toEqual([
        [`${FILES.chain}:19`, expect.stringContaining("begins like a feature id")],
      ]);
    });

    it("returns a prose third-level heading as a heading when its section holds no feature record", () => {
      const chain = renderChain([makeChainFeature()]).replace(
        "## Decisions\n",
        "## Decisions\n\n### The customer side\n"
      );

      const read = parse({ chain });

      expect({
        unclassified: read.unclassified,
        kind: read.lines.find((line) => line.file === FILES.chain && line.line === 19)?.kind,
      }).toEqual({ unclassified: [], kind: "heading" });
    });

    it("reads no heading, table or item inside a fenced code block", () => {
      const parking = [
        "# Parking",
        "",
        "```markdown",
        "- **FENCED-IDEA**: an idea quoted as an example.",
        "| a | b |",
        "```",
        "",
      ].join("\n");

      const fenced = parse({ parking });

      expect({
        idea: recordOf(fenced, "FENCED-IDEA"),
        kinds: fenced.lines.filter((l) => l.file === FILES.parking).map((l) => l.kind),
      }).toEqual({
        idea: undefined,
        kinds: ["heading", "blank", "fenced", "fenced", "fenced", "fenced", "blank"],
      });
    });
  });

  describe("queries", () => {
    it("returns only the record that holds a value with regular-expression metacharacters as literal text", () => {
      const records = [
        makeRecord({ title: "Retry (x2) [fast].*" }),
        makeRecord({ title: "Retry xx2 fast" }),
      ];

      const found = filterRecords(records, [{ field: "title", value: "(x2) [fast].*" }]);

      expect(titlesOf(found)).toEqual(["Retry (x2) [fast].*"]);
    });

    it("returns a record when one element of its where contains the value", () => {
      const records = [
        makeRecord({ title: "holds it", where: ["docs/a.md", "apps/api/src/outbox/relay.ts:89"] }),
        makeRecord({ title: "holds another", where: ["apps/api/src/outbox/queue.ts"] }),
      ];

      const found = filterRecords(records, [{ field: "where", value: "outbox/relay.ts" }]);

      expect(titlesOf(found)).toEqual(["holds it"]);
    });

    it("returns a record when one element of its tags equals the value and none when an element only contains it", () => {
      const records = [makeRecord({ title: "tagged", tags: ["SMELL-4", "MP:636"] })];

      const found = {
        whole: titlesOf(filterRecords(records, [{ field: "tag", value: "MP:636" }])),
        part: titlesOf(filterRecords(records, [{ field: "tag", value: "MP:63" }])),
      };

      expect(found).toEqual({ whole: ["tagged"], part: [] });
    });

    it("throws a RangeError that names the field and lists the accepted fields when a filter's field is unknown", () => {
      const act = (): PlanRecord[] =>
        filterRecords([makeRecord()], [{ field: "titel", value: "workers" }]);

      expect(act).toThrow(RangeError);
      expect(act).toThrow(
        `filterRecords: unknown field "titel"; the fields it accepts are ${[
          "kind",
          "file",
          ...Object.keys(FILTER_FIELDS),
        ].join(", ")}`
      );
    });

    it("returns the record whose canonical id or written id is the key", () => {
      const records = [makeRecord({ kind: "feature", id: "A-TEAM-07", writtenId: "C-07" })];

      const found = {
        canonical: findRecords(records, "A-TEAM-07").map((r) => r.writtenId),
        written: findRecords(records, "C-07").map((r) => r.id),
      };

      expect(found).toEqual({ canonical: ["C-07"], written: ["A-TEAM-07"] });
    });

    it.each([
      ["plan", FILES.plan],
      ["chain", FILES.chain],
      ["areas", FILES.areas],
      ["cross-cutting", FILES.crossCutting],
      ["off-the-map", FILES.offTheMap],
      ["parking", FILES.parking],
    ])("returns the record that starts on the line when the key is %s:<line>", (name, file) => {
      const records = Object.values(FILES).flatMap((each) => [
        makeRecord({ file: each, line: 7, title: `${each} at 7` }),
        makeRecord({ file: each, line: 8, title: `${each} at 8` }),
      ]);

      expect(titlesOf(findRecords(records, `${name}:7`))).toEqual([`${file} at 7`]);
    });

    it("returns no record when the name before the colon is no plan file", () => {
      const records = [makeRecord({ file: FILES.chain, line: 7 })];

      expect(findRecords(records, "nowhere:7")).toEqual([]);
    });

    it("freezes the filter fields and each of their rules and offers exactly the fields of the list command", () => {
      expect({
        frozen: Object.isFrozen(FILTER_FIELDS),
        unfrozenRules: Object.entries(FILTER_FIELDS)
          .filter(([, rule]) => !Object.isFrozen(rule))
          .map(([name]) => name),
        fields: Object.keys(FILTER_FIELDS),
      }).toEqual({
        frozen: true,
        unfrozenRules: [],
        fields: [
          "id",
          "written-id",
          "title",
          "owner",
          "list",
          "who",
          "today",
          "need",
          "depends-on",
          "state",
          "closed-by",
          "where",
          "done",
          "done-state",
          "tag",
          "mention",
          "text",
        ],
      });
    });
  });

  describe("readSources", () => {
    let root: string;

    beforeEach(() => {
      root = mkdtempSync(path.join(tmpdir(), "plan-sources-"));
      for (const source of makeSources()) {
        mkdirSync(path.dirname(path.join(root, source.file)), { recursive: true });
        writeFileSync(path.join(root, source.file), source.text);
      }
    });

    afterEach(() => {
      rmSync(root, { recursive: true, force: true });
    });

    it.each([
      ["missing", (file: string): void => rmSync(file)],
      [
        "unreadable",
        (file: string): void => {
          rmSync(file);
          mkdirSync(file);
        },
      ],
    ])("returns a failure that names the file when a plan file is %s", (_case, breakFile) => {
      breakFile(path.join(root, FILES.parking));

      const read = readSources(root);

      expect({
        files: read.sources.map((source) => source.file),
        failures: read.failures,
      }).toEqual({
        files: Object.values(FILES).filter((file) => file !== FILES.parking),
        failures: [expect.stringContaining(`${FILES.parking} could not be read: `)],
      });
    });
  });
});
