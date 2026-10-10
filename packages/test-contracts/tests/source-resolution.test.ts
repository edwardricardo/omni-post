/**
 * @file source-resolution.test.ts
 * @description The import reader of the source-resolution contract: what it reads as a run-time
 *              import, and which workspace package a specifier names.
 * @layer infrastructure
 */
import { describe, expect, it } from "vitest";
import { owningPackage, runtimeSpecifiers } from "../src/lib/source-resolution.js";

describe("source resolution", () => {
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
});
