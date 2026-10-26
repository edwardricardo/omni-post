/**
 * @file dependencySites.test.ts
 * @description Pins the site reader of the dependency-usage ledger,
 *   `scripts/testing/lib/dependency-sites.mjs`: the package a module specifier names, the target a
 *   `@types/*` package types, the path class of a file, the kind of every site a module's syntax
 *   tree holds, and how those sites are attributed to the declared names. Every source is inline
 *   and every path a literal, so the suite reads no file of the tree but the reader itself and
 *   the twin list of `vi` module calls in `packages/test-contracts`.
 * @layer infrastructure
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { findMonorepoRoot } from "@packages/vitest-shared";
import { describe, expect, it } from "vitest";

type SiteKind = "runtime-import" | "type-only" | "test-mock" | "config-string" | "css" | "binary";
type PathClass = "production" | "test" | "config";

/** One candidate site the reader found in a module, before it is matched to a declared name. */
interface Specifier {
  readonly specifier: string;
  readonly kind: SiteKind;
  readonly reference?: true;
}

/** One site of a declared name in one file. */
interface Site {
  readonly name: string;
  readonly kind: SiteKind;
  readonly file: string;
}

/** The reader's surface; a literal import of an untyped `.mjs` would be an implicit any. */
type SitesModule = {
  SOURCE_EXTENSIONS: readonly string[];
  SITE_KINDS: Readonly<Record<string, SiteKind>>;
  PATH_CLASSES: Readonly<Record<string, PathClass>>;
  BUILTINS_TARGET: string;
  VI_MODULE_CALLS: readonly string[];
  packageOf: (specifier: string) => string | null;
  typedTargetOf: (name: string) => string | null;
  pathClassOf: (file: string, workspaceDirs: readonly string[]) => PathClass;
  readSpecifiers: (file: string, text: string) => Specifier[];
  attributeSites: (
    file: string,
    specifiers: readonly Specifier[],
    declared: ReadonlySet<string>,
    typesRows: ReadonlyMap<string, string>
  ) => Site[];
};

const REPO_ROOT = findMonorepoRoot(path.dirname(fileURLToPath(import.meta.url)));
const SITES_LIB = path.join(REPO_ROOT, "scripts/testing/lib/dependency-sites.mjs");
const TWIN = path.join(REPO_ROOT, "packages/test-contracts/src/lib/source-resolution.ts");
const sites = (await import(SITES_LIB)) as SitesModule;

const RUNTIME = "runtime-import";
const TYPE = "type-only";
const MOCK = "test-mock";
const CONFIG = "config-string";
const BUILTINS = "node:builtins";

/** The directories of the workspace manifests the path-class cases read, the root among them. */
const WORKSPACES = [
  ".",
  "apps/api",
  "apps/admin",
  "apps/client",
  "infra/prisma",
  "packages/core",
  "packages/core/x",
];

/** The `@types/*` rows of a declared set, keyed by the target each one types. */
const typesRowsOf = (declared: ReadonlySet<string>): Map<string, string> =>
  new Map(
    [...declared].flatMap((name): Array<[string, string]> => {
      const target = sites.typedTargetOf(name);
      return target === null ? [] : [[target, name]];
    })
  );

/** The sites one inline module holds of the declared names. */
const sitesOf = (file: string, source: string, names: readonly string[]): Site[] => {
  const declared = new Set(names);
  return sites.attributeSites(
    file,
    sites.readSpecifiers(file, source),
    declared,
    typesRowsOf(declared)
  );
};

describe("the constants", () => {
  it("returns the six site kinds, the three path classes and the eight source extensions", () => {
    expect(Object.values(sites.SITE_KINDS)).toEqual([
      "runtime-import",
      "type-only",
      "test-mock",
      "config-string",
      "css",
      "binary",
    ]);
    expect(Object.values(sites.PATH_CLASSES)).toEqual(["production", "test", "config"]);
    expect(sites.SOURCE_EXTENSIONS).toEqual([
      ".ts",
      ".tsx",
      ".mts",
      ".cts",
      ".js",
      ".jsx",
      ".mjs",
      ".cjs",
    ]);
    expect(sites.BUILTINS_TARGET).toBe(BUILTINS);
  });

  it("returns the six vi module calls, equal to their twin in the source-resolution contract", () => {
    const twin = /const VI_MODULE_CALLS = new Set\(\[([^\]]*)\]\);/.exec(
      readFileSync(TWIN, "utf8")
    );
    const twinNames = [...(twin?.[1] ?? "").matchAll(/"([^"]+)"/g)].map((match) => match[1]);

    expect(sites.VI_MODULE_CALLS).toEqual([
      "mock",
      "doMock",
      "unmock",
      "doUnmock",
      "importActual",
      "importMock",
    ]);
    expect(twinNames).toEqual([...sites.VI_MODULE_CALLS]);
  });
});

describe("packageOf", () => {
  it.each<[string, string | null]>([
    ["pkg-a", "pkg-a"],
    ["pkg-a/sub/path.js", "pkg-a"],
    ["@scope/name", "@scope/name"],
    ["@scope/name/sub", "@scope/name"],
    ["node:fs", BUILTINS],
    ["node:test", BUILTINS],
    ["fs", BUILTINS],
    ["fs/promises", BUILTINS],
    ["test", "test"],
    ["process/browser", "process"],
    ["./a", null],
    ["../a", null],
    [".", null],
    ["/abs/a", null],
    ["#internal", null],
    ["data:text/javascript,export default 1", null],
    ["https://esm.sh/pkg-a", null],
    ["virtual:pkg-a", null],
    ["@scope", null],
    ["@/components/a", null],
    ["", null],
  ])("returns the package of %j as %j", (specifier, expected) => {
    expect(sites.packageOf(specifier)).toBe(expected);
  });
});

describe("typedTargetOf", () => {
  it.each<[string, string | null]>([
    ["@types/babel__core", "@babel/core"],
    ["@types/node", BUILTINS],
    ["@types/react-dom", "react-dom"],
    ["@types/jsonwebtoken", "jsonwebtoken"],
    ["react", null],
    ["@types/", null],
    ["@typesx/a", null],
  ])("returns the target %j types as %j", (name, expected) => {
    expect(sites.typedTargetOf(name)).toBe(expected);
  });
});

describe("pathClassOf", () => {
  it.each<[string, PathClass]>([
    ["apps/client/app/x.ts", "production"],
    ["apps/api/src/types/fastify.d.ts", "production"],
    ["infra/prisma/src/x.ts", "production"],
    ["packages/core/x/src/y.ts", "production"],
    ["apps/client/scripts/x.mjs", "config"],
    ["apps/client/.storybook/main.ts", "config"],
    ["apps/client/public/sw.js", "config"],
    ["apps/client/stories/foundation/helpers.ts", "config"],
    ["infra/prisma/seed.ts", "config"],
    ["apps/api/vitest.config.ts", "config"],
    ["scripts/testing/x.mjs", "config"],
    ["eslint.config.ts", "config"],
    ["packages/unlisted/src/a.ts", "config"],
    ["packages/core/x/scripts/y.ts", "config"],
    ["packages/core/x/vitest.config.ts", "config"],
    ["apps/client/stories/foundation/Colors.stories.tsx", "test"],
    ["apps/api/tests/unit/x.test.ts", "test"],
    ["apps/api/src/x.test.ts", "test"],
    ["apps/client/components/Card.spec.tsx", "test"],
    ["apps/client/e2e/login.ts", "test"],
    ["packages/core/x/src/__tests__/y.ts", "test"],
    ["packages/core/x/test/y.ts", "test"],
    ["packages/providers/shared/src/test-utils/msw-helpers.ts", "test"],
    ["security/tests/x.test.ts", "test"],
    ["security/scanners/headers.ts", "test"],
    ["performance/k6/scenarios/x.k6.js", "test"],
  ])("returns the path class of %s as %s", (file, expected) => {
    expect(sites.pathClassOf(file, WORKSPACES)).toBe(expected);
  });

  it("returns the class of the longest workspace match whatever the order of the directories", () => {
    const file = "packages/core/x/scripts/y.ts";

    const classes = [
      sites.pathClassOf(file, ["packages/core", "packages/core/x"]),
      sites.pathClassOf(file, ["packages/core/x", "packages/core"]),
      sites.pathClassOf(file, ["packages/core"]),
    ];

    expect(classes).toEqual(["config", "config", "production"]);
  });
});

describe("readSpecifiers", () => {
  it("returns every value import, re-export, import-equals, import() and require() as a runtime import", () => {
    const source = [
      'import a from "pkg-a";',
      'import "pkg-b";',
      'import * as c from "pkg-c";',
      'import d, { type D } from "pkg-d";',
      'import { e, type E } from "pkg-e";',
      'export * from "pkg-f";',
      'export { g } from "pkg-g";',
      'export * as h from "pkg-h";',
      'import i = require("pkg-i");',
      'const j = await import("pkg-j");',
      'const k = require("pkg-k");',
      "const l = import(`pkg-l`);",
    ].join("\n");

    const found = sites.readSpecifiers("apps/api/src/a.ts", source);

    expect(found).toEqual(
      ["a", "b", "c", "d", "e", "f", "g", "h", "i", "j", "k", "l"].map((letter) => ({
        specifier: `pkg-${letter}`,
        kind: RUNTIME,
      }))
    );
  });

  it("returns type imports, type re-exports, import types, module declarations and type references as type-only", () => {
    const source = [
      '/// <reference types="pkg-r" />',
      'import type A from "pkg-a";',
      'import type * as B from "pkg-b";',
      'import { type C, type D } from "pkg-c";',
      'export type { E } from "pkg-e";',
      'export type * from "pkg-f";',
      'export { type G } from "pkg-g";',
      'import type H = require("pkg-h");',
      'type I = import("pkg-i").I;',
      'type J = typeof import("pkg-j");',
      'declare module "pkg-k" {}',
    ].join("\n");

    const found = sites.readSpecifiers("apps/api/src/a.ts", source);

    expect(found).toEqual([
      { specifier: "pkg-r", kind: TYPE, reference: true },
      ...["a", "b", "c", "e", "f", "g", "h", "i", "j", "k"].map((letter) => ({
        specifier: `pkg-${letter}`,
        kind: TYPE,
      })),
    ]);
  });

  it("returns the first argument of each vi module call as a test mock and nothing else", () => {
    const source = [
      'vi.mock("pkg-a");',
      'vi.doMock("pkg-b");',
      'vi.unmock("pkg-c");',
      'vi.doUnmock("pkg-d");',
      'await vi.importActual("pkg-e");',
      'await vi.importMock("pkg-f");',
      'vi.mock("pkg-g", () => ({ value: "pkg-h" }));',
      "vi.mock(name);",
      'other.mock("pkg-i");',
    ].join("\n");

    const found = sites.readSpecifiers("apps/api/tests/unit/a.test.ts", source);

    expect(found).toEqual([
      ...["a", "b", "c", "d", "e", "f", "g"].map((letter) => ({
        specifier: `pkg-${letter}`,
        kind: MOCK,
      })),
      { specifier: "pkg-h", kind: CONFIG },
      { specifier: "pkg-i", kind: CONFIG },
    ]);
  });

  it("returns the import() a vi module call wraps as a test mock, never as a runtime import", () => {
    const source = [
      'vi.mock(import("pkg-a"), () => ({ value: 1 }));',
      "vi.doMock(import(`pkg-b`));",
      "vi.mock(import(name));",
      'const c = await import("pkg-c");',
    ].join("\n");

    const found = sites.readSpecifiers("apps/api/tests/unit/a.test.ts", source);

    expect(found).toEqual([
      { specifier: "pkg-a", kind: MOCK },
      { specifier: "pkg-b", kind: MOCK },
      { specifier: "pkg-c", kind: RUNTIME },
    ]);
  });

  it("returns every other string literal and plain template, in JSX and CommonJS too, as a config string", () => {
    const tsx = [
      'import { Badge } from "pkg-a";',
      "export const config = {",
      '  environment: "pkg-b",',
      '  plugins: ["pkg-c/plugin"],',
      "  preset: `pkg-d`,",
      "  label: `pkg-${suffix}`,",
      "};",
      'export const view = <Badge variant="pkg-e" />;',
    ].join("\n");
    const cjs = 'const f = require("pkg-f");\nmodule.exports = { preset: "pkg-g" };\n';

    const fromTsx = sites.readSpecifiers("apps/client/components/A.tsx", tsx);
    const fromCjs = sites.readSpecifiers("apps/client/postcss.config.cjs", cjs);

    expect(fromTsx).toEqual([
      { specifier: "pkg-a", kind: RUNTIME },
      { specifier: "pkg-b", kind: CONFIG },
      { specifier: "pkg-c/plugin", kind: CONFIG },
      { specifier: "pkg-d", kind: CONFIG },
      { specifier: "pkg-e", kind: CONFIG },
    ]);
    expect(fromCjs).toEqual([
      { specifier: "pkg-f", kind: RUNTIME },
      { specifier: "pkg-g", kind: CONFIG },
    ]);
  });

  it("returns no css or binary kind: a module's @import text and a command line are config strings", () => {
    const source =
      'export const css = "@import \\"pkg-a\\";";\nexport const run = "pkg-b generate";\n';

    const kinds = sites.readSpecifiers("scripts/a.mjs", source).map((found) => found.kind);

    expect(kinds).toEqual([CONFIG, CONFIG]);
  });

  it("returns every import of a declaration file as type-only", () => {
    const source = [
      'import a from "pkg-a";',
      'export * from "pkg-b";',
      'import c = require("pkg-c");',
      'export { d } from "pkg-d";',
    ].join("\n");

    const found = sites.readSpecifiers("apps/api/src/types/a.d.ts", source);

    expect(found).toEqual(
      ["a", "b", "c", "d"].map((letter) => ({ specifier: `pkg-${letter}`, kind: TYPE }))
    );
  });

  it("returns a module declaration as type-only and never also as a config string", () => {
    const source =
      'declare module "isomorphic-dompurify" {\n  export const sanitize: () => string;\n}\n';

    const found = sites.readSpecifiers("apps/api/src/types/dompurify.ts", source);

    expect(found).toEqual([{ specifier: "isomorphic-dompurify", kind: TYPE }]);
  });

  it("returns an import with a value binding as runtime and one with only type bindings as type-only", () => {
    const source = [
      'import x, { type Y } from "pkg-a";',
      'import { type A, type B } from "pkg-b";',
      'import "pkg-c";',
    ].join("\n");

    const found = sites.readSpecifiers("apps/api/src/a.ts", source);

    expect(found).toEqual([
      { specifier: "pkg-a", kind: RUNTIME },
      { specifier: "pkg-b", kind: TYPE },
      { specifier: "pkg-c", kind: RUNTIME },
    ]);
  });
});

describe("attributeSites", () => {
  it("returns a TypeScript file's import as the package's site and as its @types row's type-only site", () => {
    const file = "apps/api/src/auth.ts";
    const source =
      'import jwt from "jsonwebtoken";\nimport { readFile } from "node:fs/promises";\n';

    const found = sitesOf(file, source, ["jsonwebtoken", "@types/jsonwebtoken", "@types/node"]);

    expect(found).toEqual([
      { name: "@types/jsonwebtoken", kind: TYPE, file },
      { name: "@types/node", kind: TYPE, file },
      { name: "jsonwebtoken", kind: RUNTIME, file },
    ]);
  });

  it("returns no @types site for an import in a JavaScript file", () => {
    const file = "scripts/auth.mjs";
    const source =
      'import jwt from "jsonwebtoken";\nimport { readFile } from "node:fs/promises";\n';

    const found = sitesOf(file, source, ["jsonwebtoken", "@types/jsonwebtoken", "@types/node"]);

    expect(found).toEqual([{ name: "jsonwebtoken", kind: RUNTIME, file }]);
  });

  it("returns a vi.mock of a typed package as a test-mock site and nothing else", () => {
    const file = "apps/api/tests/unit/auth.test.ts";

    const found = sitesOf(file, 'vi.mock("jsonwebtoken");\n', [
      "jsonwebtoken",
      "@types/jsonwebtoken",
    ]);

    expect(found).toEqual([{ name: "jsonwebtoken", kind: MOCK, file }]);
  });

  it("returns a declared name or its subpath in a string as a config-string site and an undeclared one as nothing", () => {
    const file = "apps/client/postcss.config.mjs";
    const source = [
      'export const plugins = ["@tailwindcss/postcss"];',
      'export const hook = "stripe/webhooks";',
      'export const other = "not-declared";',
      'export const spaced = "stripe webhooks";',
    ].join("\n");

    const found = sitesOf(file, source, ["@tailwindcss/postcss", "stripe"]);

    expect(found).toEqual([
      { name: "@tailwindcss/postcss", kind: CONFIG, file },
      { name: "stripe", kind: CONFIG, file },
    ]);
  });

  it("returns a node type reference as a type-only site of @types/node", () => {
    const file = "apps/api/src/env.d.ts";

    const found = sitesOf(file, '/// <reference types="node" />\n', ["@types/node"]);

    expect(found).toEqual([{ name: "@types/node", kind: TYPE, file }]);
  });

  it("returns a type reference to a package that ships its own types as that package's type-only site", () => {
    const file = "apps/client/next-env.d.ts";
    const source = '/// <reference types="next" />\n/// <reference types="vite/client" />\n';

    const found = sitesOf(file, source, ["next", "vite"]);

    expect(found).toEqual([
      { name: "next", kind: TYPE, file },
      { name: "vite", kind: TYPE, file },
    ]);
  });

  it("returns nothing for a relative, absolute, subpath-import or data specifier", () => {
    const source = [
      'import a from "./a";',
      'import b from "#b";',
      'import c from "data:text/javascript,export default 1";',
      'import d from "/abs/d";',
    ].join("\n");

    const found = sitesOf("apps/api/src/a.ts", source, ["a", "b", "data", "abs", "d"]);

    expect(found).toEqual([]);
  });

  it("returns one site per name and kind for a file that uses a package several times", () => {
    const file = "apps/api/src/a.ts";
    const source = [
      'import a from "pkg-a";',
      'import { b } from "pkg-a/sub";',
      'export * from "pkg-a";',
      'import type T from "pkg-a";',
      'export const preset = "pkg-a";',
    ].join("\n");

    const found = sitesOf(file, source, ["pkg-a"]);

    expect(found).toEqual([
      { name: "pkg-a", kind: RUNTIME, file },
      { name: "pkg-a", kind: TYPE, file },
      { name: "pkg-a", kind: CONFIG, file },
    ]);
  });
});
