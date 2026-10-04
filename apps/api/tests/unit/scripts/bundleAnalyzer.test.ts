/**
 * @file bundleAnalyzer.test.ts
 * @description Pins how `quality/scripts/bundle-analyzer.ts` reads knip's JSON report, and what it
 *   does when that read fails. A failed measurement must never read as "no unused dependencies":
 *   the parser rejects output it cannot read, the analysis rejects when knip cannot run or its
 *   output cannot be read, and the CLI entry point turns that rejection into exit code 1 with a
 *   message naming the failure. The external tools are replaced through the analyzer's command
 *   runner, so the suite never runs knip or pnpm; the project root is a scratch directory.
 * @layer infrastructure
 */
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  BundleAnalyzer,
  parseKnipUnusedDependencies,
  resolveAnalysisType,
  runBundleAnalysisCli,
  type CommandRunner,
} from "../../../../../quality/scripts/bundle-analyzer";

const NO_REPORT = "knip printed no JSON report, so unused dependencies were not measured";
const UNPARSABLE = "knip's JSON report does not parse, so unused dependencies were not measured";
const WRONG_SHAPE =
  "knip's JSON report does not have the expected shape, so unused dependencies were not measured";

/** A dotenv banner as it precedes knip's report on stdout, carrying a brace of its own. */
const BANNER =
  "[dotenv@17.2.2] injecting env (0) from .env -- tip: override existing env vars with { override: true }\n";

const KNIP_COMMAND_PREFIX = "pnpm exec knip";

/** One manifest's issues as knip's JSON reporter prints them, line and column included. */
const makeManifestIssues = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
  file: "apps/workers/package.json",
  dependencies: [{ name: "@sentry/node", line: 12, col: 6, pos: 301 }],
  devDependencies: [{ name: "vitest", line: 40, col: 6, pos: 990 }],
  exports: [],
  ...overrides,
});

const makeReport = (
  issues: readonly unknown[] = [makeManifestIssues()]
): { issues: unknown[] } => ({
  issues: [...issues],
});

const EXPECTED_ENTRIES = [
  "apps/workers/package.json: @sentry/node",
  "apps/workers/package.json: vitest",
];

/** A command runner that answers knip with `knip()` and refuses every other command. */
const makeKnipRunner =
  (knip: () => string): CommandRunner =>
  (command) => {
    if (command.startsWith(KNIP_COMMAND_PREFIX)) return knip();
    throw new Error(`unexpected command in this suite: ${command}`);
  };

const knipCannotRun = (): string => {
  throw new Error(`Command failed: ${KNIP_COMMAND_PREFIX} --include dependencies (exit status 1)`);
};

describe("parseKnipUnusedDependencies", () => {
  it("lists every unused dependency and devDependency of a pretty-printed report after a banner holding a brace", () => {
    const stdout = BANNER + JSON.stringify(makeReport(), null, 2) + "\n";

    const entries = parseKnipUnusedDependencies(stdout);

    expect(entries).toEqual(EXPECTED_ENTRIES);
  });

  it("lists the same entries from a report printed on one line", () => {
    const stdout = BANNER + JSON.stringify(makeReport());

    const entries = parseKnipUnusedDependencies(stdout);

    expect(entries).toEqual(EXPECTED_ENTRIES);
  });

  it("returns an empty list when knip reports no issues", () => {
    const stdout = JSON.stringify(makeReport([]));

    const entries = parseKnipUnusedDependencies(stdout);

    expect(entries).toEqual([]);
  });

  it("rejects output that opens an object but does not parse", () => {
    const stdout = BANNER + "{ this is not json\n";

    const parse = (): string[] => parseKnipUnusedDependencies(stdout);

    expect(parse).toThrow(new Error(UNPARSABLE));
  });

  it("rejects a banner with no report after it", () => {
    const parse = (): string[] => parseKnipUnusedDependencies(BANNER);

    expect(parse).toThrow(new Error(NO_REPORT));
  });

  it("rejects a report whose dependencies list is null", () => {
    const stdout = JSON.stringify(makeReport([makeManifestIssues({ dependencies: null })]));

    const parse = (): string[] => parseKnipUnusedDependencies(stdout);

    expect(parse).toThrow(new Error(WRONG_SHAPE));
  });

  it("rejects a report with a dependency entry that carries no name", () => {
    const stdout = JSON.stringify(
      makeReport([makeManifestIssues({ devDependencies: [{ line: 3 }] })])
    );

    const parse = (): string[] => parseKnipUnusedDependencies(stdout);

    expect(parse).toThrow(new Error(WRONG_SHAPE));
  });
});

describe("BundleAnalyzer when knip's measurement fails", () => {
  let projectRoot = "";

  beforeEach(() => {
    vi.restoreAllMocks();
    projectRoot = mkdtempSync(path.join(tmpdir(), "bundle-analyzer-"));
    writeFileSync(
      path.join(projectRoot, "package.json"),
      '{ "name": "fixture", "private": true }\n'
    );
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    vi.spyOn(console, "error").mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    rmSync(projectRoot, { recursive: true, force: true });
  });

  it("rejects the full analysis with the runner's error when knip cannot run", async () => {
    const analyzer = new BundleAnalyzer(projectRoot, makeKnipRunner(knipCannotRun));

    const analysis = analyzer.analyzeBundles("full");

    await expect(analysis).rejects.toThrow(`Command failed: ${KNIP_COMMAND_PREFIX}`);
  });

  it("rejects the full analysis when knip's output cannot be read", async () => {
    const analyzer = new BundleAnalyzer(
      projectRoot,
      makeKnipRunner(() => BANNER + "{ this is not json\n")
    );

    const analysis = analyzer.analyzeBundles("full");

    await expect(analysis).rejects.toThrow(new Error(UNPARSABLE));
  });

  it("exits 1 from the CLI entry point and names the failure when knip cannot run", async () => {
    const analyzer = new BundleAnalyzer(projectRoot, makeKnipRunner(knipCannotRun));

    const exitCode = await runBundleAnalysisCli(analyzer, "full");

    expect(exitCode).toBe(1);
    expect(console.error).toHaveBeenCalledWith(
      "❌ Bundle analysis failed:",
      expect.objectContaining({
        message: expect.stringContaining(`Command failed: ${KNIP_COMMAND_PREFIX}`),
      })
    );
  });

  it("exits 1 from the CLI entry point and names the failure when knip's output cannot be read", async () => {
    const analyzer = new BundleAnalyzer(
      projectRoot,
      makeKnipRunner(() => BANNER)
    );

    const exitCode = await runBundleAnalysisCli(analyzer, "full");

    expect(exitCode).toBe(1);
    expect(console.error).toHaveBeenCalledWith(
      "❌ Bundle analysis failed:",
      expect.objectContaining({ message: NO_REPORT })
    );
  });
});

describe("resolveAnalysisType", () => {
  it("returns full when no analysis type is given", () => {
    expect(resolveAnalysisType(undefined)).toBe("full");
  });

  it("returns the analysis type it is given when that type is known", () => {
    expect(resolveAnalysisType("quick")).toBe("quick");
    expect(resolveAnalysisType("dependencies-only")).toBe("dependencies-only");
  });

  it("returns undefined for an unknown analysis type instead of running full", () => {
    expect(resolveAnalysisType("quik")).toBeUndefined();
  });
});

describe("BundleAnalyzer reading the project's package.json", () => {
  let projectRoot = "";

  beforeEach(() => {
    vi.restoreAllMocks();
    projectRoot = mkdtempSync(path.join(tmpdir(), "bundle-analyzer-manifest-"));
  });

  afterEach(() => {
    rmSync(projectRoot, { recursive: true, force: true });
  });

  const analyzerOver = (manifest: string): (() => BundleAnalyzer) => {
    writeFileSync(path.join(projectRoot, "package.json"), manifest);
    return () => new BundleAnalyzer(projectRoot, makeKnipRunner(knipCannotRun));
  };

  it("refuses a package.json that is not valid JSON, naming the file and keeping the parse error", () => {
    const construct = analyzerOver("{ not json\n");
    expect(construct).toThrow(/package\.json at .+ is not valid JSON/);
    expect(() => construct()).toThrow(expect.objectContaining({ cause: expect.any(SyntaxError) }));
  });

  it.each(["[]", "null"])("refuses a package.json that is %s, not an object", (manifest) => {
    expect(analyzerOver(`${manifest}\n`)).toThrow(
      /package\.json at .+ is not an object of dependency maps/
    );
  });

  it("refuses a package.json whose dependencies field is not a map", () => {
    expect(analyzerOver('{ "dependencies": "react" }\n')).toThrow(
      /package\.json at .+ is not an object of dependency maps/
    );
  });
});
