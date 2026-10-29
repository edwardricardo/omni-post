/**
 * @file coverageFloorGate.test.ts
 * @description Pins `scripts/testing/coverage-floor-gate.mjs`, fitness check #37: the four global
 *   coverage floors of `apps/api/vitest.config.ts` never descend against the pull request's base,
 *   except under a canon-exception marker of their own, and a `decorative-demolition` marker names
 *   a slice that this pull request deletes, as head's `ledger.json` records it.
 *
 *   The gate is driven through `main(argv, seams)`. The head's files are written to a fresh
 *   directory under `tmpdir()`, handed in as the root, and git is replaced by a double that answers
 *   only the calls the gate plans (the base ref, then each file at the base commit) and refuses any
 *   other by name, so nothing spawns and the suite never reads this repository's own config or
 *   ledger. The first group pins what the gate did before the slice-membership check existed: the
 *   global block, the fail-closed cases and the marker scenarios. The second pins the membership
 *   check, one case per refusal, the accepting case, and the ledger reads that fail closed.
 * @layer infrastructure
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { findMonorepoRoot } from "@packages/vitest-shared";
import { afterEach, describe, expect, it } from "vitest";

type Metric = "lines" | "functions" | "branches" | "statements";
type GitResult = { readonly value: string } | { readonly error: string };

/** What the command prints and the code it exits with. */
interface GateRun {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
}

/** What the suite replaces; the command passes none. */
interface GateSeams {
  readonly root?: string;
  readonly env?: Readonly<Record<string, string | undefined>>;
  readonly git?: (args: readonly string[]) => GitResult;
}

/**
 * The module's surface as the suite uses it, loaded by a computed path because a literal import of
 * an untyped `.mjs` would leave the tests' typecheck scope an implicit-any module.
 */
interface CoverageFloorGateModule {
  readonly main: (argv: readonly string[], seams?: GateSeams) => GateRun;
}

/** One side of the comparison: the config and the ledger, `null` for a file that is absent. */
interface Side {
  readonly config: string | null;
  readonly ledger: string | null;
}

/** A run of the gate, with every git call it made. */
interface Observed extends GateRun {
  readonly calls: readonly string[];
}

/** A coverage floor a deleted slice lowered, as the ledger records it. */
interface Floor {
  readonly from: number;
  readonly to: number;
}

const REPO_ROOT = findMonorepoRoot(path.dirname(fileURLToPath(import.meta.url)));
const GATE_SCRIPT = path.join(REPO_ROOT, "scripts", "testing", "coverage-floor-gate.mjs");
const gate = (await import(GATE_SCRIPT)) as CoverageFloorGateModule;

const CONFIG_FILE = "apps/api/vitest.config.ts";
const LEDGER_FILE = "ledger.json";
const BASE_REF = "fixture-base";
const BASE_COMMIT = "b".repeat(40);
const METRICS: readonly Metric[] = ["lines", "functions", "branches", "statements"];
const FLOORS: Readonly<Record<Metric, string>> = {
  lines: "56.8",
  functions: "57.3",
  branches: "47.8",
  statements: "56.2",
};
const SLICE = "2.6a";
const DEMOLITION = `// canon-exception: decorative-demolition:${SLICE}`;

/** What a config fixture changes from the four floors above. */
interface ConfigFixture {
  /** Literals replacing the four floors, by metric. */
  readonly floors?: Partial<Record<Metric, string>>;
  /** A comment line written directly above a metric's literal. */
  readonly above?: Partial<Record<Metric, string>>;
  /** A comment written after a metric's literal, on its own line. */
  readonly after?: Partial<Record<Metric, string>>;
  /** Metrics whose literal is left out. */
  readonly omit?: readonly Metric[];
  /** Lines written inside the global block, after the four literals. */
  readonly inside?: readonly string[];
}

/** A vitest config shaped like the api's: the global block nested under `test.coverage`. */
const renderConfig = (fixture: ConfigFixture = {}): string => {
  const literals = METRICS.filter((metric) => !(fixture.omit ?? []).includes(metric)).flatMap(
    (metric) => {
      const value = fixture.floors?.[metric] ?? FLOORS[metric];
      const above = fixture.above?.[metric];
      const after = fixture.after?.[metric];
      const literal = `        ${metric}: ${value},${after === undefined ? "" : ` ${after}`}`;
      return above === undefined ? [literal] : [`        ${above}`, literal];
    }
  );
  return [
    'import { defineConfig } from "vitest/config";',
    "",
    "export default defineConfig({",
    "  test: {",
    "    coverage: {",
    '      provider: "v8",',
    "      thresholds: {",
    "        perFile: false,",
    ...literals,
    ...(fixture.inside ?? []),
    "      },",
    "    },",
    "  },",
    "});",
    "",
  ].join("\n");
};

/** A slice whose pull request deleted its tests and lowered the given floors. */
const deletedSlice = (
  floors: Readonly<Partial<Record<Metric, Floor>>>
): Record<string, unknown> => ({
  files: ["apps/api/tests/unit/decorative.test.ts"],
  deleted: { files: 1, blocks: 4 },
  floors,
});

/** A slice whose files are still rows. */
const LIVE_SLICE: Readonly<Record<string, unknown>> = {
  files: ["apps/api/tests/unit/decorative.test.ts"],
  expectedDrop: { files: 1, blocks: 4 },
};

/** A ledger with the given slices, shaped like the committed one. */
const renderLedger = (slices: Readonly<Record<string, unknown>>): string =>
  `${JSON.stringify({ version: 1, summary: {}, slices, files: [] }, null, 2)}\n`;

const BASE: Side = { config: renderConfig(), ledger: renderLedger({ [SLICE]: LIVE_SLICE }) };

const scratchDirs: string[] = [];

afterEach(() => {
  while (scratchDirs.length > 0) {
    const dir = scratchDirs.pop();
    if (dir !== undefined) rmSync(dir, { recursive: true, force: true });
  }
});

/** A root holding the head's files, `null` ones left out. */
const plantHead = (head: Side): string => {
  const root = mkdtempSync(path.join(tmpdir(), "coverage-floor-gate-"));
  scratchDirs.push(root);
  if (head.config !== null) {
    mkdirSync(path.join(root, path.dirname(CONFIG_FILE)), { recursive: true });
    writeFileSync(path.join(root, CONFIG_FILE), head.config);
  }
  if (head.ledger !== null) writeFileSync(path.join(root, LEDGER_FILE), head.ledger);
  return root;
};

/**
 * A git double that answers the calls the gate plans: the base ref, and each file at the base
 * commit, listed by `ls-tree` and read by `show`. Every other call is refused by name.
 */
const gitDouble =
  (base: Side, calls: string[], resolves = true) =>
  (args: readonly string[]): GitResult => {
    const call = args.join(" ");
    calls.push(call);
    if (call === `rev-parse --verify --quiet ${BASE_REF}^{commit}`) {
      return resolves ? { value: `${BASE_COMMIT}\n` } : { error: "exit 1" };
    }
    const files: readonly (readonly [string, string | null])[] = [
      [CONFIG_FILE, base.config],
      [LEDGER_FILE, base.ledger],
    ];
    for (const [file, text] of files) {
      if (call === `ls-tree --name-only ${BASE_COMMIT} -- ${file}`) {
        return { value: text === null ? "" : `${file}\n` };
      }
      if (call === `show ${BASE_COMMIT}:${file}` && text !== null) return { value: text };
    }
    return { error: `unplanned git call: git ${call}` };
  };

/** Runs the gate over a planted head and a base answered by the git double. */
const runGate = (
  head: Partial<Side>,
  base: Side = BASE,
  options: { readonly argv?: readonly string[]; readonly resolves?: boolean } = {}
): Observed => {
  const root = plantHead({ config: head.config ?? renderConfig(), ledger: head.ledger ?? null });
  const calls: string[] = [];
  const run = gate.main(options.argv ?? [], {
    root,
    env: { FITNESS_BASE_REF: BASE_REF },
    git: gitDouble(base, calls, options.resolves ?? true),
  });
  return { ...run, calls };
};

/** The head of a demolition slice's pull request: `lines` lowered under its marker. */
const demolitionHead = (ledger: string | null, to = "56.6"): Partial<Side> => ({
  config: renderConfig({ floors: { lines: to }, above: { lines: DEMOLITION } }),
  ledger,
});

const LOWERED = "coverage.thresholds.lines lowered: 56.8 (base) -> 56.6 (head)";

describe("coverage floor gate (#37)", () => {
  describe("the comparison it held before the slice-membership check", () => {
    it("exits 0 and names the base commit when no floor moved", () => {
      const run = runGate({});

      expect(run.code).toBe(0);
      expect(run.stdout).toBe(
        `coverage-floor-gate: 4 floors of ${CONFIG_FILE} compared with ${BASE_REF} ` +
          `(${BASE_COMMIT}): 0 lowered with no honoured marker\n`
      );
      expect(run.stderr).toBe("");
    });

    it("exits 0 when a floor rises", () => {
      const run = runGate({ config: renderConfig({ floors: { branches: "48.1" } }) });

      expect(run.code).toBe(0);
      expect(run.stderr).toBe("");
    });

    it("exits 1 and names the metric when a floor is lowered with no marker", () => {
      const run = runGate({ config: renderConfig({ floors: { lines: "56.6" } }) });

      expect(run.code).toBe(1);
      expect(run.stdout).toContain(`${LOWERED}\n`);
      expect(run.stdout).toContain("1 lowered with no honoured marker");
    });

    it("accepts a descent under a listed scenario's marker on the line above, and logs it", () => {
      const run = runGate({
        config: renderConfig({
          floors: { lines: "56.6" },
          above: { lines: "// canon-exception: hotfix:INC-1" },
        }),
      });

      expect(run.code).toBe(0);
      expect(run.stderr).toContain(
        "coverage.thresholds.lines lowered 56.8 -> 56.6, ACCEPTED under the 'canon-exception: hotfix:INC-1' marker"
      );
    });

    it("accepts a descent under a marker on the literal's own line", () => {
      const run = runGate({
        config: renderConfig({
          floors: { statements: "56.0" },
          after: { statements: "// canon-exception: test-fixture" },
        }),
      });

      expect(run.code).toBe(0);
      expect(run.stderr).toContain("ACCEPTED under the 'canon-exception: test-fixture' marker");
    });

    it("refuses a marker whose scenario is not on the allowed list", () => {
      const run = runGate({
        config: renderConfig({
          floors: { lines: "56.6" },
          above: { lines: "// canon-exception: bogus-scenario" },
        }),
      });

      expect(run.code).toBe(1);
      expect(run.stderr).toContain(
        "carries 'canon-exception: bogus-scenario', which is not a scenario from the CLAUDE.md §Pragmatic Exceptions allowed list"
      );
      expect(run.stdout).toContain(LOWERED);
    });

    it.each(["decorative-demolition", "decorative-demolition:slice-one"])(
      "refuses %s, whose subject is missing or outside the slice grammar",
      (marker) => {
        const run = runGate({
          config: renderConfig({
            floors: { lines: "56.6" },
            above: { lines: `// canon-exception: ${marker}` },
          }),
        });

        expect(run.code).toBe(1);
        expect(run.stderr).toContain(
          `carries 'canon-exception: ${marker}', whose subject after the colon is missing or outside its scenario's grammar`
        );
      }
    );

    it("refuses a marker the base already carries on that metric", () => {
      const marker = "// canon-exception: hotfix:INC-1";
      const base: Side = {
        config: renderConfig({ floors: { statements: "56.1" }, above: { statements: marker } }),
        ledger: null,
      };
      const run = runGate(
        { config: renderConfig({ floors: { statements: "56.0" }, above: { statements: marker } }) },
        base
      );

      expect(run.code).toBe(1);
      expect(run.stderr).toContain(
        "carries 'canon-exception: hotfix:INC-1', which the base already carries on that metric"
      );
      expect(run.stdout).toContain(
        "coverage.thresholds.statements lowered: 56.1 (base) -> 56.0 (head)"
      );
    });

    it("passes a metric the base does not declare, which has no comparable floor", () => {
      const base: Side = { config: renderConfig({ omit: ["lines"] }), ledger: null };
      const run = runGate({ config: renderConfig({ floors: { lines: "10.0" } }) }, base);

      expect(run.code).toBe(0);
    });

    it("passes every metric when the base does not hold the config", () => {
      const run = runGate(
        { config: renderConfig({ floors: { lines: "10.0" } }) },
        {
          config: null,
          ledger: null,
        }
      );

      expect(run.code).toBe(0);
      expect(run.calls).toContain(`ls-tree --name-only ${BASE_COMMIT} -- ${CONFIG_FILE}`);
    });

    it.each([
      ["no thresholds block", renderConfig().replace("thresholds: {", "limits: {")],
      [
        "a commented-out thresholds block",
        renderConfig()
          .replace("thresholds: {", "/* thresholds: {")
          .replace("      },\n    },", "      }, */\n    },"),
      ],
    ])("fails closed when the head holds %s", (_label, config) => {
      const run = runGate({ config });

      expect(run.code).toBe(1);
      expect(run.stderr).toContain(`no global 'thresholds: {' block found in ${CONFIG_FILE}`);
    });

    it("fails closed when the head's global block declares a metric twice", () => {
      const run = runGate({ config: renderConfig({ inside: ["        lines: 56.9,"] }) });

      expect(run.code).toBe(1);
      expect(run.stderr).toContain("expected exactly one literal 'lines:'");
      expect(run.stderr).toContain("found 2");
    });

    it("fails closed when the head's global block lacks a metric", () => {
      const run = runGate({ config: renderConfig({ omit: ["functions"] }) });

      expect(run.code).toBe(1);
      expect(run.stderr).toContain("expected exactly one literal 'functions:'");
      expect(run.stderr).toContain("found 0");
    });

    it("reads a per-scope block nested deeper as no second literal", () => {
      const run = runGate({
        config: renderConfig({
          inside: ['        "src/domain/**": {', "          lines: 90,", "        },"],
        }),
      });

      expect(run.code).toBe(0);
    });

    it("fails closed when the base declares a metric twice", () => {
      const base: Side = { config: renderConfig({ inside: ["        lines: 90,"] }), ledger: null };
      const run = runGate({ config: renderConfig({ floors: { lines: "56.9" } }) }, base);

      expect(run.code).toBe(1);
      expect(run.stderr).toContain("the base declares 'lines:' 2 times");
    });

    it("fails closed when the base ref does not resolve to a commit", () => {
      const run = runGate({}, BASE, { resolves: false });

      expect(run.code).toBe(1);
      expect(run.stderr).toContain(`base ref ${BASE_REF} does not resolve to a commit`);
    });

    it("fails closed when the head holds no config", () => {
      const root = plantHead({ config: null, ledger: null });
      const run = gate.main([], {
        root,
        env: { FITNESS_BASE_REF: BASE_REF },
        git: gitDouble(BASE, []),
      });

      expect(run.code).toBe(1);
      expect(run.stderr).toContain(`${CONFIG_FILE} could not be read, failing closed`);
    });

    it("exits 2 on any argument, a usage error", () => {
      const run = runGate({}, BASE, { argv: ["--base", "main"] });

      expect(run.code).toBe(2);
      expect(run.stderr).toContain("usage: node scripts/testing/coverage-floor-gate.mjs");
      expect(run.calls).toEqual([]);
    });

    it("never reads a ledger for a marker of another scenario", () => {
      const run = runGate(
        {
          config: renderConfig({
            floors: { lines: "56.6" },
            above: { lines: "// canon-exception: hotfix:INC-1" },
          }),
          ledger: null,
        },
        { config: renderConfig(), ledger: null }
      );

      expect(run.code).toBe(0);
      expect(run.calls.some((call) => call.includes(LEDGER_FILE))).toBe(false);
    });
  });

  describe("a decorative-demolition marker's slice, checked against the ledger", () => {
    it("refuses a slice id that head's ledger.json does not list", () => {
      const run = runGate(demolitionHead(renderLedger({ "2.6b": deletedSlice({}) })));

      expect(run.code).toBe(1);
      expect(run.stderr).toContain(
        `coverage.thresholds.lines carries 'canon-exception: decorative-demolition:${SLICE}', but head's ledger.json lists no slice '${SLICE}' — not honoured.`
      );
      expect(run.stdout).toContain(LOWERED);
    });

    it("refuses a slice that head's ledger.json does not record as deleted", () => {
      const run = runGate(demolitionHead(renderLedger({ [SLICE]: LIVE_SLICE })));

      expect(run.code).toBe(1);
      expect(run.stderr).toContain(
        `coverage.thresholds.lines carries 'canon-exception: decorative-demolition:${SLICE}', but head's ledger.json does not record slice '${SLICE}' as deleted`
      );
      expect(run.stdout).toContain(LOWERED);
    });

    it("refuses a slice that the base's ledger.json already records as deleted", () => {
      const recorded = renderLedger({ [SLICE]: deletedSlice({ lines: { from: 56.8, to: 56.6 } }) });
      const run = runGate(demolitionHead(recorded), { config: renderConfig(), ledger: recorded });

      expect(run.code).toBe(1);
      expect(run.stderr).toContain(
        `coverage.thresholds.lines carries 'canon-exception: decorative-demolition:${SLICE}', but the base's ledger.json already records slice '${SLICE}' as deleted`
      );
      expect(run.stdout).toContain(LOWERED);
    });

    it("refuses a slice whose deletion records no descent of that metric", () => {
      const ledger = renderLedger({
        [SLICE]: deletedSlice({ branches: { from: 47.8, to: 47.5 } }),
      });
      const run = runGate(demolitionHead(ledger));

      expect(run.code).toBe(1);
      expect(run.stderr).toContain(
        `coverage.thresholds.lines carries 'canon-exception: decorative-demolition:${SLICE}', but slice '${SLICE}' records no lines descent in head's ledger.json`
      );
      expect(run.stdout).toContain(LOWERED);
    });

    it("refuses a slice whose recorded descent ends somewhere other than the head literal", () => {
      const ledger = renderLedger({ [SLICE]: deletedSlice({ lines: { from: 56.8, to: 56.7 } }) });
      const run = runGate(demolitionHead(ledger));

      expect(run.code).toBe(1);
      expect(run.stderr).toContain(
        `coverage.thresholds.lines carries 'canon-exception: decorative-demolition:${SLICE}', but slice '${SLICE}' records lines 56.8 -> 56.7 in head's ledger.json, while this pull request lowers it 56.8 -> 56.6`
      );
      expect(run.stdout).toContain(LOWERED);
    });

    it("refuses a slice whose recorded descent starts somewhere other than the base literal", () => {
      const ledger = renderLedger({ [SLICE]: deletedSlice({ lines: { from: 57.1, to: 56.6 } }) });
      const run = runGate(demolitionHead(ledger));

      expect(run.code).toBe(1);
      expect(run.stderr).toContain(
        `coverage.thresholds.lines carries 'canon-exception: decorative-demolition:${SLICE}', but slice '${SLICE}' records lines 57.1 -> 56.6 in head's ledger.json, while this pull request lowers it 56.8 -> 56.6`
      );
      expect(run.stdout).toContain(LOWERED);
    });

    it("accepts a listed slice deleted in this pull request whose recorded descent matches", () => {
      const ledger = renderLedger({ [SLICE]: deletedSlice({ lines: { from: 56.8, to: 56.6 } }) });
      const run = runGate(demolitionHead(ledger));

      expect(run.code).toBe(0);
      expect(run.stderr).toContain(
        `coverage.thresholds.lines lowered 56.8 -> 56.6, ACCEPTED under the 'canon-exception: decorative-demolition:${SLICE}' marker`
      );
      expect(run.stderr).toContain(
        `ledger.json records slice '${SLICE}' deleted in this pull request, lines 56.8 -> 56.6`
      );
      expect(run.calls).toContain(`show ${BASE_COMMIT}:${LEDGER_FILE}`);
    });

    it("accepts a slice the base's ledger.json does not list yet", () => {
      const ledger = renderLedger({ [SLICE]: deletedSlice({ lines: { from: 56.8, to: 56.6 } }) });
      const run = runGate(demolitionHead(ledger), {
        config: renderConfig(),
        ledger: renderLedger({}),
      });

      expect(run.code).toBe(0);
      expect(run.stderr).toContain(
        `ledger.json records slice '${SLICE}' deleted in this pull request`
      );
    });

    it.each([
      ["absent", null],
      ["not JSON", "{ slices: "],
      ["without a slices object", renderLedger({}).replace('"slices": {}', '"slices": []')],
    ])("fails closed when head's ledger.json is %s", (_label, ledger) => {
      const run = runGate(demolitionHead(ledger));

      expect(run.code).toBe(1);
      expect(run.stderr).toContain(
        `coverage.thresholds.lines carries 'canon-exception: decorative-demolition:${SLICE}', and head's ledger.json could not be read`
      );
    });

    it("fails closed when a slice of head's ledger.json is not an object", () => {
      const run = runGate(demolitionHead(renderLedger({ [SLICE]: "deleted" })));

      expect(run.code).toBe(1);
      expect(run.stderr).toContain(
        `coverage.thresholds.lines carries 'canon-exception: decorative-demolition:${SLICE}', and head's ledger.json could not be read`
      );
      expect(run.stderr).toContain("no `slices` object whose every slice is an object");
    });

    it("reads the base's ledger.json once, however many descents a demolition marker answers for", () => {
      const ledger = renderLedger({
        [SLICE]: deletedSlice({
          lines: { from: 56.8, to: 56.6 },
          statements: { from: 56.2, to: 56.0 },
        }),
      });
      const run = runGate({
        config: renderConfig({
          floors: { lines: "56.6", statements: "56.0" },
          above: { lines: DEMOLITION, statements: DEMOLITION },
        }),
        ledger,
      });

      expect(run.code).toBe(0);
      expect(run.stderr.match(/ACCEPTED under/g)).toHaveLength(2);
      expect(run.calls.filter((call) => call.endsWith(LEDGER_FILE))).toEqual([
        `ls-tree --name-only ${BASE_COMMIT} -- ${LEDGER_FILE}`,
        `show ${BASE_COMMIT}:${LEDGER_FILE}`,
      ]);
    });

    it("fails closed when the base holds no ledger.json", () => {
      const ledger = renderLedger({ [SLICE]: deletedSlice({ lines: { from: 56.8, to: 56.6 } }) });
      const run = runGate(demolitionHead(ledger), { config: renderConfig(), ledger: null });

      expect(run.code).toBe(1);
      expect(run.stderr).toContain("and the base's ledger.json could not be read");
    });
  });
});
