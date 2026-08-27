/**
 * @file coverageThresholds.test.ts
 * @description Pins the coverage gate BEHAVIOURALLY: every assertion below loads the
 *              resolved `vitest.config.ts` and reads the values the gate actually runs
 *              on, in both `VITEST_SHARDED` states. The previous version of this file
 *              asserted the config's SOURCE TEXT instead, and three mutations killed
 *              the gate with all of its assertions still green: wrapping the live
 *              `thresholds` block in a block comment (bytes unchanged, object gone),
 *              hard-coding `const sharded = true` (the trailing override then zeroes
 *              all four floors and disables autoUpdate in every environment), and
 *              renaming the key to `thresholdsDISABLED` (literals alive, gate dead).
 *              Loading the resolved object closes all three, because a floor that is
 *              not applied is a floor that is not there.
 *
 *              One textual assertion survives, scoped to the single property the
 *              resolved object cannot show: the two consumers that read the FILE
 *              (vitest's autoUpdate AST rewrite and fitness #37's diff guard) need one
 *              literal number per metric, alone on its own line, at the TOP LEVEL of
 *              the global `thresholds` block. It mirrors #37's extraction instead of
 *              scanning the whole file, so a per-scope threshold block — which #37
 *              ignores by design — does not read as ambiguity here either.
 *
 *              Honest limit: this pins the config as authored. A bypass injected from
 *              OUTSIDE the file — a `--coverage.thresholds.*` CLI override in a
 *              workflow, or a job that never enables coverage at all — is invisible
 *              here and belongs to that workflow's own review.
 * @layer infrastructure
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { shardedThresholdOverride } from "../../../vitest.coverage-thresholds.js";

const THRESHOLD_KEYS = ["lines", "functions", "branches", "statements"] as const;

type ThresholdKey = (typeof THRESHOLD_KEYS)[number];

/**
 * The floor each metric gates on in a merged/local run, pinned EXACTLY. A raise is a
 * deliberate act (run the suite with coverage locally, let `autoUpdate` rewrite
 * vitest.config.ts, commit the rewrite), so it costs one edit here in the same commit
 * and puts the new number in front of a reviewer. Every known way to disable the gate
 * drives these to 0 or removes them, which this cannot pass.
 */
const MEASURED_FLOOR: Record<ThresholdKey, number> = {
  lines: 56.9,
  functions: 57.3,
  branches: 47.9,
  statements: 56.3,
};

/**
 * The DENOMINATOR the floor is measured over, pinned next to it. Without this the
 * ratchet is one-sided: one more line in `exclude` shrinks the measured scope, the
 * percentage rises for free, `autoUpdate` writes the higher number and fitness #37
 * reads a legal ascent — a stricter-looking gate permanently measuring less code. A
 * legitimate scope change edits the config and this pin in the same diff. (A measured
 * file COUNT was the alternative and is worse: it would fire on every new source file,
 * which is ordinary work, instead of on a change to what gets measured.)
 */
const COVERAGE_INCLUDE = ["src/**/*.ts"];
const COVERAGE_EXCLUDE = [
  "src/**/*.test.ts",
  "src/**/*.spec.ts",
  "src/**/index.ts",
  "src/index.ts",
];

interface CoverageGate {
  include?: string[];
  exclude?: string[];
  thresholds?: {
    perFile?: boolean;
    lines?: number;
    functions?: number;
    branches?: number;
    statements?: number;
    autoUpdate?: unknown;
  };
}

interface ConfigShape {
  test?: { coverage?: CoverageGate };
}

/**
 * Loads `vitest.config.ts` through module evaluation, as vitest itself does, under an
 * explicit `VITEST_SHARDED` value. The variable is set rather than read: this suite
 * runs with `VITEST_SHARDED=true` in the CI shard jobs, so inheriting the ambient value
 * would silently drop the gating assertions in the environment where they run most.
 *
 * @param shardedEnv - Value for `VITEST_SHARDED`, or `undefined` to unset it.
 * @returns The resolved coverage options of a run started under that value.
 */
async function loadCoverageGate(shardedEnv: string | undefined): Promise<CoverageGate> {
  const original = process.env.VITEST_SHARDED;

  if (shardedEnv === undefined) {
    delete process.env.VITEST_SHARDED;
  } else {
    process.env.VITEST_SHARDED = shardedEnv;
  }

  try {
    vi.resetModules();
    const configModule = (await import("../../../vitest.config.js")) as { default: ConfigShape };
    const coverage = configModule.default.test?.coverage;

    expect(coverage, "vitest.config.ts must export test.coverage").toBeDefined();
    return coverage as CoverageGate;
  } finally {
    if (original === undefined) {
      delete process.env.VITEST_SHARDED;
    } else {
      process.env.VITEST_SHARDED = original;
    }
  }
}

afterEach(() => {
  vi.resetModules();
});

describe("resolved coverage gate — merged / local run", () => {
  it("applies the measured floor to every metric", async () => {
    const { thresholds } = await loadCoverageGate(undefined);

    expect(thresholds, "test.coverage.thresholds is absent — the run gates nothing").toBeDefined();

    for (const key of THRESHOLD_KEYS) {
      expect(
        thresholds?.[key],
        `${key} floor moved — if a coverage run raised it, update MEASURED_FLOOR in the same commit`
      ).toBe(MEASURED_FLOOR[key]);
    }
  });

  it("keeps autoUpdate as the flooring function so a raise is one decimal, never a jump", async () => {
    const { thresholds } = await loadCoverageGate(undefined);
    const autoUpdate = thresholds?.autoUpdate;

    expect(typeof autoUpdate).toBe("function");

    const floorToOneDecimal = autoUpdate as (measured: number) => number;

    expect(floorToOneDecimal(57.402645)).toBe(57.4);
    expect(floorToOneDecimal(100)).toBe(100);
  });

  it("measures the floor over the pinned scope, so the percentage cannot rise by shrinking it", async () => {
    const gate = await loadCoverageGate(undefined);

    expect(gate.include).toEqual(COVERAGE_INCLUDE);
    expect(gate.exclude).toEqual(COVERAGE_EXCLUDE);
  });
});

describe("resolved coverage gate — sharded run", () => {
  it("zeroes every metric so partial per-shard coverage cannot fail the run", async () => {
    const { thresholds } = await loadCoverageGate("true");

    for (const key of THRESHOLD_KEYS) {
      expect(thresholds?.[key]).toBe(0);
    }
  });

  it("disables autoUpdate so a shard never ratchets the floor from partial data", async () => {
    const { thresholds } = await loadCoverageGate("true");

    expect(thresholds?.autoUpdate).toBe(false);
  });
});

describe("shardedThresholdOverride", () => {
  it("returns no override for the merged / local run", () => {
    expect(shardedThresholdOverride(false)).toEqual({});
  });

  it("returns the neutralising override for a shard", () => {
    expect(shardedThresholdOverride(true)).toEqual({
      lines: 0,
      functions: 0,
      branches: 0,
      statements: 0,
      autoUpdate: false,
    });
  });
});

/**
 * Splits a source file into per-line CODE halves the way fitness #37's scanner does:
 * block-comment bytes are dropped (a commented-out block must not keep answering for a
 * floor that no longer exists), string literals are kept verbatim (a glob key holds the
 * exact byte pairs a naive comment strip eats), and line comments are removed. Newlines
 * inside a block comment still end a line, so the array stays aligned with the file.
 *
 * #37 also keeps each line's comment half, for the `canon-exception` markers it honours
 * on a descent. Nothing here reads a marker, so only the code half is reproduced.
 *
 * @param source - Raw file text.
 * @returns One entry per line of `source`, holding that line's code bytes only.
 */
function codeLines(source: string): string[] {
  const lines: string[] = [];
  let code = "";
  let state: "code" | "line" | "block" = "code";
  let i = 0;

  while (i < source.length) {
    const c = source[i];

    if (c === "\n") {
      lines.push(code);
      code = "";
      if (state === "line") state = "code";
      i += 1;
      continue;
    }
    if (state === "block") {
      if (c === "*" && source[i + 1] === "/") {
        state = "code";
        i += 2;
        continue;
      }
      i += 1;
      continue;
    }
    if (state === "line") {
      i += 1;
      continue;
    }
    if (c === '"' || c === "'" || c === "`") {
      let j = i + 1;
      while (j < source.length && source[j] !== c && source[j] !== "\n") {
        j += source[j] === "\\" ? 2 : 1;
      }
      code += source.slice(i, j + 1);
      i = j + 1;
      continue;
    }
    if (c === "/" && source[i + 1] === "/") {
      state = "line";
      i += 2;
      continue;
    }
    if (c === "/" && source[i + 1] === "*") {
      state = "block";
      i += 2;
      continue;
    }
    code += c;
    i += 1;
  }
  lines.push(code);

  return lines;
}

/**
 * Collects the threshold literals fitness #37 polices, mirroring its extraction: the
 * FIRST global `thresholds: {` block only, metrics accepted only at that block's top
 * level, brace depth counted over code with string contents blanked, and the scan
 * stopped at the block's closing brace. A per-scope block keyed by a glob nests one
 * level deeper, so it coexists here exactly as it does in #37.
 *
 * @param source - Raw `vitest.config.ts` text.
 * @returns The literal text found per metric, or `null` when there is no global block.
 */
function globalThresholdLiterals(source: string): Map<ThresholdKey, string[]> | null {
  const found = new Map<ThresholdKey, string[]>(THRESHOLD_KEYS.map((key) => [key, []]));
  let started = false;
  let depth = 0;

  for (const line of codeLines(source)) {
    const braces = line.replace(/"[^"]*"|'[^']*'|`[^`]*`/g, '""');

    if (!started) {
      if (/(^|[^A-Za-z0-9_$])thresholds\s*:\s*\{/.test(braces)) {
        started = true;
        depth = 1;
      }
      continue;
    }

    if (depth === 1) {
      const match = /^\s*(lines|functions|branches|statements)\s*:\s*(\d+(?:\.\d+)?)\s*,?\s*$/.exec(
        line
      );
      if (match !== null) {
        found.get(match[1] as ThresholdKey)?.push(match[2] as string);
      }
    }

    for (const ch of braces) {
      if (ch === "{") depth += 1;
      else if (ch === "}") depth -= 1;
    }
    if (depth <= 0) break;
  }

  return started ? found : null;
}

describe("vitest.config.ts source text", () => {
  const source = readFileSync(new URL("../../../vitest.config.ts", import.meta.url), "utf8");

  it("keeps one literal line per metric in the global thresholds block, carrying the value the gate resolves to", async () => {
    // The one property the resolved object cannot show. Two consumers read the FILE:
    // vitest's `autoUpdate` rewrites it through an AST parse and throws "Unable to
    // parse thresholds from configuration file" unless each threshold is a literal
    // number node, and fitness #37 compares those literals against the PR base. #37
    // reads the GLOBAL `thresholds: {` block ONLY — block-comment bytes dropped,
    // strings preserved, metrics counted at that block's top level — and fails closed
    // unless it finds exactly one literal per metric there. `globalThresholdLiterals`
    // above reproduces that extraction, so this pin holds the shape #37 needs without
    // rejecting a per-scope threshold block: that block nests one level deeper and #37
    // ignores it on purpose, because CODING_STANDARDS §Coverage Targets asks for one
    // (Domain 90 / Application 85 / Infrastructure 70). Comparing each literal against
    // the resolved value is what ties the two together: it proves the number #37
    // polices is the number the gate runs on.
    // Coupling, stated plainly: this mirror and #37's extraction are one contract in
    // two files. If #37's scope moves again — another block, another depth, different
    // comment handling — this helper moves in the same change.
    const { thresholds } = await loadCoverageGate(undefined);
    const literals = globalThresholdLiterals(source);

    expect(
      literals,
      "no global `thresholds: {` block in vitest.config.ts — fitness #37 fails closed on this"
    ).not.toBeNull();

    for (const key of THRESHOLD_KEYS) {
      const perMetric = literals?.get(key) ?? [];

      expect(
        perMetric,
        `fitness #37 needs exactly one literal '${key}:' at the top level of the global thresholds block`
      ).toHaveLength(1);
      expect(Number(perMetric[0])).toBe(thresholds?.[key]);
    }
  });
});
