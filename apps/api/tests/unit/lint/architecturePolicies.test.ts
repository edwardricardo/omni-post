/**
 * @file architecturePolicies.test.ts
 * @description Pins the POLICY of the architecture gate, `.dependency-cruiser.cjs`: the exact rule
 *   set, each rule's severity and anchors (`from`, `to`, `pathNot`, `dependencyTypesNot`), and the
 *   `options.exclude` scope. The baseline cannot hold any of it: a weakened rule leaves a stale
 *   entry only where it has entries, so a rule with none (`workers-no-api`,
 *   `shared-depends-only-on-shared`, the domain and ports rules) could be deleted or widened while
 *   `pnpm check:architecture` still exits 0. Each rule is stated once below, in the config's own
 *   shape, so a policy change is a change to this table. A table pins strings only: a pattern
 *   narrowed in the config and in the table together still passes it, so the test-code rule's own
 *   patterns, read from the loaded config, are also run on sample paths the way dependency-cruiser
 *   runs them.
 * @layer infrastructure
 */
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { findMonorepoRoot } from "@packages/vitest-shared";
import { describe, expect, it } from "vitest";

type Pattern = string | string[];
type Condition = { path?: Pattern; pathNot?: Pattern };
type Rule = { name: string; severity: string; from: Condition; to: Condition };
type Config = { forbidden: Rule[]; options: { exclude: { path: string[] } } };

const REPO_ROOT = findMonorepoRoot(path.dirname(fileURLToPath(import.meta.url)));
const CONFIG = createRequire(import.meta.url)(
  path.join(REPO_ROOT, ".dependency-cruiser.cjs")
) as Config;

// The five constants the config itself names, mirrored so each rule below reads like the config.
const FRAMEWORKS =
  "(^|/)node_modules/(prisma|@prisma/[^/]+|fastify|@fastify/[^/]+|ioredis|redis|@redis/[^/]+|bullmq|next)/";
const WORKSPACE_PACKAGES = "^(packages|infra)/";
const ROUTE_MODULES = {
  path: "^apps/api/src/.*([Rr]outes|Handlers)\\.ts$",
  pathNot: "\\.test\\.ts$",
};
const TEST_FILE = "\\.(test|spec)\\.[cm]?[jt]sx?$";
const TESTS_BESIDE_SOURCE = "^(apps/[^/]+|packages/[^/]+|packages/[^/]+/[^/]+)/tests/";

/** Each rule: its severity, `from` and `to`; `null` pins the severity alone. */
const POLICY: Record<string, [string, object | null, object | null]> = {
  "no-circular": ["error", {}, { circular: true }],
  "not-to-unresolvable": ["error", {}, { couldNotResolve: true }],
  "no-orphans": ["warn", null, null],
  "no-deprecated-core": ["warn", null, null],
  "shared-root-no-node-core": [
    "error",
    {
      path: "^packages/shared/src/",
      pathNot: [
        "^packages/shared/src/channelCredentialsCrypto\\.ts$",
        "\\.(test|spec)\\.[cm]?[jt]sx?$",
      ],
    },
    { dependencyTypes: ["core"] },
  ],
  "core-no-apps": ["error", { path: "^packages/core/" }, { path: "^apps/" }],
  "core-domain-no-application": [
    "error",
    { path: "^packages/core/domain/src/" },
    { path: "^packages/core/(?!domain/)" },
  ],
  "core-domain-no-framework": [
    "error",
    { path: "^packages/core/domain/src/" },
    {
      path: [FRAMEWORKS, WORKSPACE_PACKAGES],
      pathNot: ["^packages/core/", "^packages/shared/"],
    },
  ],
  "core-application-no-infrastructure": [
    "error",
    { path: "^packages/core/(?!domain/)[^/]+/src/" },
    {
      path: [FRAMEWORKS, WORKSPACE_PACKAGES],
      pathNot: ["^packages/core/", "^packages/ports/", "^packages/shared/"],
    },
  ],
  "no-cross-bounded-context": [
    "error",
    { path: "^packages/core/(?!domain|embeddings|application)([^/]+)/src/" },
    {
      path: "^packages/core/(?!domain|embeddings|application)([^/]+)/src/",
      pathNot: "^packages/core/$1/src/",
    },
  ],
  "ports-depend-only-on-domain-and-shared": [
    "error",
    { path: "^packages/ports/src/" },
    {
      path: [FRAMEWORKS, WORKSPACE_PACKAGES, "^apps/"],
      pathNot: [
        "^packages/ports/",
        "^packages/shared/",
        "^packages/core/domain/",
        "^packages/core/application/src/UseCase\\.ts$",
      ],
    },
  ],
  "shared-no-core": ["error", { path: "^packages/shared/" }, { path: "^packages/core/" }],
  "shared-no-apps": ["error", { path: "^packages/shared/" }, { path: "^apps/" }],
  "shared-depends-only-on-shared": [
    "error",
    { path: "^packages/shared/" },
    {
      path: [FRAMEWORKS, WORKSPACE_PACKAGES],
      pathNot: ["^packages/shared/", "^packages/core/"],
    },
  ],
  "adapters-no-apps": ["error", { path: "^packages/adapters/" }, { path: "^apps/" }],
  "providers-no-apps": ["error", { path: "^packages/providers/" }, { path: "^apps/" }],
  "routes-no-prisma": [
    "error",
    ROUTE_MODULES,
    {
      path: [
        "^infra/prisma/",
        "^packages/adapters/db-prisma/",
        "(^|/)node_modules/(prisma|@prisma/[^/]+)/",
      ],
    },
  ],
  "routes-no-adapters-or-providers": [
    "error",
    ROUTE_MODULES,
    {
      path: ["^packages/adapters/", "^packages/providers/"],
      pathNot: "^packages/adapters/db-prisma/",
    },
  ],
  "routes-no-repositories": [
    "error",
    ROUTE_MODULES,
    {
      path: [
        "^packages/core/domain/src/repositories/",
        "^apps/api/src/infrastructure/repositories/",
      ],
      pathNot: "^packages/core/domain/src/repositories/ReadModelDtos\\.ts$",
    },
  ],
  "routes-no-container": [
    "error",
    ROUTE_MODULES,
    { path: "^apps/api/src/infrastructure/container/" },
  ],
  "routes-domain-types-only": [
    "error",
    ROUTE_MODULES,
    {
      path: "^packages/core/domain/",
      pathNot: [
        "^packages/core/domain/src/auth/Permission\\.ts$",
        "^packages/core/domain/src/value-objects/NotificationType\\.ts$",
        "^packages/core/domain/src/repositories/(?!ReadModelDtos\\.ts$)",
      ],
      dependencyTypesNot: ["type-only", "type-import"],
    },
  ],
  "workers-no-api": ["error", { path: "^apps/workers/src/" }, { path: "^apps/api/" }],
  "api-no-workers": ["error", { path: "^apps/api/" }, { path: "^apps/workers/" }],
  "production-imports-no-test-code": [
    "error",
    { path: "(^|/)src/", pathNot: TEST_FILE },
    { path: [TEST_FILE, TESTS_BESIDE_SOURCE] },
  ],
};

describe("the policy of the architecture gate (.dependency-cruiser.cjs)", () => {
  it("declares exactly the rules the policy table names", () => {
    expect(CONFIG.forbidden.map((rule) => rule.name).sort()).toEqual(Object.keys(POLICY).sort());
  });

  it.each(Object.entries(POLICY))("keeps %s at its severity and anchors", (name, expected) => {
    const rule = CONFIG.forbidden.find((candidate) => candidate.name === name);
    const [severity, from, to] = expected;
    expect(rule, `${name} is missing from the config`).toBeDefined();
    expect(rule?.severity, `${name}: severity`).toBe(severity);
    if (from !== null) expect(rule?.from, `${name}: from`).toEqual(from);
    if (to !== null) expect(rule?.to, `${name}: to`).toEqual(to);
  });

  it("names no path of the deleted apps/api/src/{domain,application} layers", () => {
    expect(JSON.stringify(CONFIG.forbidden)).not.toMatch(/apps\/api\/src\/(domain|application)\//);
  });

  it("excludes the mutation reports but never a source tree named reports", () => {
    const excluded = (file: string): boolean =>
      CONFIG.options.exclude.path.some((pattern) => new RegExp(pattern).test(file));
    expect(CONFIG.options.exclude.path).toContain("(^|/)reports/mutation/");
    expect(excluded("apps/api/src/reports/reportRoutes.ts")).toBe(false);
    expect(excluded("packages/core/reports/src/index.ts")).toBe(false);
  });
});

/** A pattern as dependency-cruiser compiles it: a list is one alternation, with no flags. */
const compile = (pattern: Pattern): RegExp =>
  new RegExp(Array.isArray(pattern) ? pattern.join("|") : pattern);

/** Whether a path, relative to the root, meets a rule's `from` or `to` on `path` and `pathNot`. */
const meets = (condition: Condition, file: string): boolean =>
  (condition.path === undefined || compile(condition.path).test(file)) &&
  (condition.pathNot === undefined || !compile(condition.pathNot).test(file));

describe("production-imports-no-test-code, run on sample paths with the config's own patterns", () => {
  const rule = CONFIG.forbidden.find(
    (candidate) => candidate.name === "production-imports-no-test-code"
  );

  it.each([
    [
      "a source module importing an app's tests directory",
      "apps/api/src/a.ts",
      "apps/x/tests/y.ts",
    ],
    ["a source module importing a test file", "apps/api/src/a.ts", "apps/api/src/a.test.ts"],
    ["a source module importing a spec file", "packages/ui/src/a.ts", "packages/ui/src/a.spec.mts"],
    ["a source module importing a package's tests", "apps/api/src/a.ts", "packages/a/tests/y.ts"],
    [
      "a source module importing a grouped package's tests",
      "apps/api/src/a.ts",
      "packages/a/b/tests/y.ts",
    ],
    [
      "a package's source importing its own tests",
      "packages/core/auth/src/a.ts",
      "packages/core/auth/tests/y.ts",
    ],
  ])("flags %s", (_case, from, to) => {
    expect(rule, "production-imports-no-test-code is missing from the config").toBeDefined();
    expect(rule !== undefined && meets(rule.from, from) && meets(rule.to, to)).toBe(true);
  });

  it.each([
    ["a test file inside a source tree as the origin", "apps/x/src/a.test.ts", "apps/x/tests/y.ts"],
    [
      "a module outside a source tree as the origin",
      "apps/api/scripts/a.ts",
      "apps/api/tests/y.ts",
    ],
    [
      "a tests directory deeper than a grouped package",
      "apps/api/src/a.ts",
      "packages/a/b/c/tests/y.ts",
    ],
    ["a source module importing another source module", "apps/api/src/a.ts", "apps/api/src/b.ts"],
  ])("does not flag %s", (_case, from, to) => {
    expect(rule, "production-imports-no-test-code is missing from the config").toBeDefined();
    expect(rule !== undefined && meets(rule.from, from) && meets(rule.to, to)).toBe(false);
  });
});
