/**
 * @file playwright-collector.test.ts
 * @description Self-tests of the Playwright collector: how a `playwright test --list
 *              --reporter=json` report is read, every way the report or the collector fails
 *              closed, and one listing through the real CLI over the admin portal's config, which
 *              pins the report's shape to the Playwright the repository installs.
 * @layer infrastructure
 */
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { err, ok } from "@shared/types";
import {
  createPlaywrightCollector,
  listWithPlaywrightCli,
  parsePlaywrightList,
  PLAYWRIGHT_CONFIG,
} from "../src/lib/playwright-collector.js";
import { REPOSITORY_ROOT } from "./fixtures/metrics.js";
import { plantTree, removeTree, type PlantedTree } from "./fixtures/tree.js";

/**
 * Budget for the case that spawns the real CLI: about 0.6 s alone, measured; a loaded CI runner
 * can take several times that.
 */
const CLI_SPAWN_TIMEOUT_MS = 60_000;

const ROOT_DIR = "/repo/app/tests/e2e";

/** A report in the shape Playwright 1.63.0 prints: nested suites, one spec run by two projects. */
function report(overrides: Record<string, unknown> = {}): string {
  const spec = (file: string) => ({
    file,
    tests: [{ projectName: "chromium" }, { projectName: "firefox" }],
  });
  return JSON.stringify({
    config: { rootDir: ROOT_DIR },
    suites: [
      { file: "a.spec.ts", specs: [], suites: [{ file: "a.spec.ts", specs: [spec("a.spec.ts")] }] },
      { file: "sub/b.spec.ts", specs: [spec("sub/b.spec.ts"), spec("sub/b.spec.ts")] },
    ],
    errors: [],
    stats: { expected: 0 },
    ...overrides,
  });
}

const planted: PlantedTree[] = [];

describe("Playwright report parsing", () => {
  it("returns every spec file once, resolved against the report's rootDir", () => {
    expect(parsePlaywrightList(report())).toEqual(
      ok([`${ROOT_DIR}/a.spec.ts`, `${ROOT_DIR}/sub/b.spec.ts`])
    );
  });

  it.each([
    ["text before the report", `Running…\n${report()}`, "printed no JSON report"],
    ["a report that is not valid JSON", "{ not json", "printed a report that is not valid JSON"],
    ["no rootDir", report({ config: {} }), "no absolute config.rootDir"],
    ["a relative rootDir", report({ config: { rootDir: "tests" } }), "no absolute config.rootDir"],
    ["no errors list", report({ errors: null }), "no errors list"],
    [
      "a load error",
      report({ errors: [{ message: "Error: cannot find module" }] }),
      "reported 1 errors: Error: cannot find module",
    ],
    ["no suites list", report({ suites: {} }), "no suites list"],
    [
      "a spec with no file",
      report({ suites: [{ specs: [{ tests: [] }] }] }),
      "a spec with no file",
    ],
    ["a suite that is not an object", report({ suites: [3] }), "a suite that is not an object"],
  ])("returns a failure for %s", (_label, stdout, expected) => {
    const parsed = parsePlaywrightList(stdout);

    expect(parsed.ok ? "" : parsed.error).toContain(expected);
  });
});

describe("Playwright collector", () => {
  afterEach(() => {
    for (const tree of planted.splice(0)) removeTree(tree);
  });

  it.each([
    ["apps/admin/playwright.config.ts", true],
    ["apps/client/tests/e2e/config/playwright.config.mts", true],
    ["apps/admin/playwright.config.ts.old", false],
    ["apps/admin/my-playwright.config.ts", false],
  ])("matches %s as a tracked config: %s", (file, expected) => {
    expect(PLAYWRIGHT_CONFIG.test(file)).toBe(expected);
  });

  it("returns one collection per config, the files repository-relative", async () => {
    const tree = plantTree({ "app/playwright.config.ts": "", "other.txt": "" });
    planted.push(tree);
    const listing = (config: string) =>
      Promise.resolve(ok([path.join(path.dirname(config), "e2e/x.spec.ts")]));

    const outcome = await createPlaywrightCollector({ listing }).collect(tree);

    expect(outcome).toEqual({
      collections: [
        {
          collector: "playwright",
          source: "app/playwright.config.ts",
          files: ["app/e2e/x.spec.ts"],
        },
      ],
      failures: [],
    });
  });

  it("returns a failure for a config that collects no file and one whose listing fails", async () => {
    const tree = plantTree({ "a/playwright.config.ts": "", "b/playwright.config.ts": "" });
    planted.push(tree);
    const listing = (config: string) =>
      Promise.resolve(config.includes(`${path.sep}a${path.sep}`) ? ok([]) : err("exited 1: boom"));

    const outcome = await createPlaywrightCollector({ listing }).collect(tree);

    expect(outcome).toEqual({
      collections: [],
      failures: [
        {
          collector: "playwright",
          source: "a/playwright.config.ts",
          message: "collects no file; every tracked Playwright config must collect at least one",
        },
        { collector: "playwright", source: "b/playwright.config.ts", message: "exited 1: boom" },
      ],
    });
  });

  it("returns a failure when no Playwright config is tracked", async () => {
    const outcome = await createPlaywrightCollector().collect({ root: "/", tracked: ["x.ts"] });

    expect(outcome.failures).toEqual([
      {
        collector: "playwright",
        source: "(tracked configs)",
        message:
          "0 tracked Playwright configs, below the floor of 1; the listing read less of the tree than it holds",
      },
    ]);
  });

  it("returns a failure when no node_modules above the config installs Playwright", async () => {
    const tree = plantTree({ "app/playwright.config.ts": "export default {};\n" });
    planted.push(tree);

    const listed = await listWithPlaywrightCli(path.join(tree.root, "app/playwright.config.ts"));

    expect(listed).toEqual(
      err(`no node_modules above ${path.join(tree.root, "app")} installs @playwright/test`)
    );
  });

  it(
    "lists the admin portal's specs through the real Playwright CLI",
    async () => {
      const config = path.join(REPOSITORY_ROOT, "apps/admin/playwright.config.ts");

      const listed = await listWithPlaywrightCli(config);

      const files = listed.ok ? listed.value : [];
      expect(listed.ok ? "" : listed.error).toBe("");
      expect(files.length).toBeGreaterThan(0);
      expect(
        files.every((file) => file.startsWith(path.join(REPOSITORY_ROOT, "apps/admin/")))
      ).toBe(true);
      expect(files.every((file) => file.endsWith(".spec.ts"))).toBe(true);
    },
    CLI_SPAWN_TIMEOUT_MS
  );
});
