/**
 * @file dependencySites.test.ts
 * @description Pins the mapping helpers of the dependency-usage ledger's site reader,
 *   `scripts/testing/lib/dependency-sites.mjs`: its constants, the package a module specifier
 *   names, the target a `@types/*` package types and the path class of a file. Every path is a
 *   literal, so the suite reads no file of the tree but the reader itself and the twin list of
 *   `vi` module calls in `packages/test-contracts`.
 * @layer infrastructure
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { findMonorepoRoot } from "@packages/vitest-shared";
import { describe, expect, it } from "vitest";

type SiteKind = "runtime-import" | "type-only" | "test-mock" | "config-string" | "css" | "binary";
type PathClass = "production" | "test" | "config";

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
};

const REPO_ROOT = findMonorepoRoot(path.dirname(fileURLToPath(import.meta.url)));
const SITES_LIB = path.join(REPO_ROOT, "scripts/testing/lib/dependency-sites.mjs");
const TWIN = path.join(REPO_ROOT, "packages/test-contracts/src/lib/source-resolution.ts");
const sites = (await import(SITES_LIB)) as SitesModule;

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
    ["apps/client/scripts/i18n-validate.mjs", "config"],
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
