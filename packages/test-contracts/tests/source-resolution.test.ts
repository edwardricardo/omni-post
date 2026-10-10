/**
 * @file source-resolution.test.ts
 * @description The source-resolution contract: what it reads as an import, which package a
 *              specifier names, its verdict over planted trees, its two floors, and the gate
 *              itself, the command line over this repository in both vite modes: in this
 *              process for the run's own mode, and in a child process with `NODE_ENV=production`,
 *              because vite reads `NODE_ENV` when a config is resolved and a test must not change
 *              its own process's environment.
 * @layer infrastructure
 */
import { spawnSync } from "node:child_process";
import { realpathSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  checkSourceResolution,
  owningPackage,
  runtimeSpecifiers,
} from "../src/lib/source-resolution.js";
import { main } from "../src/source-resolution.js";
import {
  configCollecting,
  plantTree,
  removeTree,
  TEST_BODY,
  type PlantedTree,
} from "./fixtures/tree.js";

/** A planted run spawns real vitest instances; 5.4 s was measured for one on a busy CI runner. */
const VITEST_TIMEOUT_MS = 60_000;

/** The real-tree run lists and resolves every tracked config: about 3 s alone per mode. */
const GATE_TIMEOUT_MS = 180_000;

const planted: PlantedTree[] = [];

/**
 * Plants a tree holding one workspace package, `@x/pkg`, with a `src/` and a `dist/` entry, and a
 * config that collects `app/a.test.ts` and aliases the package to the given entry.
 *
 * @param entry - The package entry the alias points at, relative to the package directory.
 * @returns The planted tree.
 */
function plantAliasedTo(entry: string): PlantedTree {
  const tree = plantTree({
    "pkg/package.json": JSON.stringify({ name: "@x/pkg" }),
    "pkg/src/index.ts": "export const x = 1;\n",
    "pkg/dist/index.js": "export const x = 1;\n",
    "app/vitest.config.mjs":
      'export default { resolve: { alias: { "@x/pkg": ' +
      `new URL("../pkg/${entry}", import.meta.url).pathname } }, test: { include: ["*.test.ts"] } };\n`,
    "app/a.test.ts": `import { x } from "@x/pkg";\n${TEST_BODY}`,
  });
  planted.push(tree);
  return tree;
}

describe("source resolution", () => {
  afterEach(() => {
    for (const tree of planted.splice(0)) removeTree(tree);
  });

  describe("runtimeSpecifiers", () => {
    it("returns value imports, re-exports, import(), require() and the vi module calls", () => {
      const source = [
        'import { a } from "@x/a";',
        'import "@x/side";',
        'export { b } from "@x/b";',
        'const c = await import("@x/c");',
        'const d = require("@x/d");',
        'vi.mock("@x/e", () => ({}));',
        'const f = await vi.importActual("@x/f");',
      ].join("\n");

      expect(runtimeSpecifiers(source, "a.test.ts")).toEqual([
        "@x/a",
        "@x/side",
        "@x/b",
        "@x/c",
        "@x/d",
        "@x/e",
        "@x/f",
      ]);
    });

    it("returns nothing for type-only imports, comments and strings", () => {
      const source = [
        'import type { A } from "@x/a";',
        'export type { B } from "@x/b";',
        '// import { c } from "@x/c";',
        '/** @example import { d } from "@x/d"; */',
        'const e = "import { e } from \\"@x/e\\"";',
      ].join("\n");

      expect(runtimeSpecifiers(source, "a.test.ts")).toEqual([]);
    });
  });

  describe("owningPackage", () => {
    const packages = [
      { name: "@x/a", dir: "packages/a" },
      { name: "@x/ab", dir: "packages/ab" },
    ];

    it("returns the package a bare specifier or one of its subpaths names", () => {
      expect(owningPackage("@x/a", packages)?.dir).toBe("packages/a");
      expect(owningPackage("@x/a/deep/file.js", packages)?.dir).toBe("packages/a");
      expect(owningPackage("@x/ab", packages)?.dir).toBe("packages/ab");
    });

    it("returns undefined for a specifier no workspace package names", () => {
      expect(owningPackage("@x/abc", packages)).toBeUndefined();
      expect(owningPackage("vitest", packages)).toBeUndefined();
    });
  });

  describe("checkSourceResolution", () => {
    it(
      "returns no violation when every workspace import resolves under its package's src/",
      async () => {
        const tree = plantAliasedTo("src/index.ts");

        const report = await checkSourceResolution(realpathSync(tree.root), tree.tracked, {
          configFloor: 1,
          importFloor: 1,
        });

        expect(report).toEqual({ configs: 1, checked: 1, violations: [], errors: [] });
      },
      VITEST_TIMEOUT_MS
    );

    it(
      "returns a violation naming the config, the file, the package and its dist target",
      async () => {
        const tree = plantAliasedTo("dist/index.js");

        const report = await checkSourceResolution(realpathSync(tree.root), tree.tracked, {
          configFloor: 1,
          importFloor: 1,
        });

        expect(report.violations).toEqual([
          {
            config: "app/vitest.config.mjs",
            file: "app/a.test.ts",
            specifier: "@x/pkg",
            resolved: "pkg/dist/index.js",
          },
        ]);
      },
      VITEST_TIMEOUT_MS
    );

    it("returns an error and checks nothing when fewer configs are tracked than the floor", async () => {
      const tree = plantAliasedTo("src/index.ts");

      const report = await checkSourceResolution(realpathSync(tree.root), tree.tracked);

      expect(report.checked).toBe(0);
      expect(report.errors).toEqual(["1 tracked vitest configs, below the floor of 80"]);
    });

    it(
      "returns an error when fewer workspace imports are checked than the floor",
      async () => {
        const tree = plantTree({
          "app/vitest.config.mjs": configCollecting(["*.test.ts"]),
          "app/a.test.ts": TEST_BODY,
        });
        planted.push(tree);

        const report = await checkSourceResolution(realpathSync(tree.root), tree.tracked, {
          configFloor: 1,
          importFloor: 1,
        });

        expect(report.errors).toEqual(["0 workspace imports checked, below the floor of 1"]);
      },
      VITEST_TIMEOUT_MS
    );
  });

  describe("this repository", () => {
    it(
      "resolves every workspace package a collected test imports to its src/ in this run's mode",
      async () => {
        const { code, report } = await main([]);

        expect(report).toMatchObject({ violations: [], errors: [] });
        expect(code).toBe(0);
      },
      GATE_TIMEOUT_MS
    );

    it(
      "resolves them to src/ under NODE_ENV=production, where vite's own default names production",
      () => {
        const run = spawnSync(
          process.execPath,
          ["--conditions", "development", "--import", "tsx", "src/source-resolution.ts"],
          {
            cwd: path.resolve(import.meta.dirname, ".."),
            env: { ...process.env, NODE_ENV: "production" },
            encoding: "utf8",
            timeout: GATE_TIMEOUT_MS,
            maxBuffer: 64 * 1024 * 1024,
          }
        );

        // A run that printed no report failed before it could write one; its stderr is the reason.
        const report: unknown =
          run.stdout.trim() === "" ? { stderr: run.stderr } : JSON.parse(run.stdout);
        expect(report).toMatchObject({ violations: [], errors: [] });
        expect(run.status).toBe(0);
      },
      GATE_TIMEOUT_MS
    );
  });
});
