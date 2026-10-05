/**
 * @file architecturePolicies.test.ts
 * @description Pins the POLICY of the architecture gate, `.dependency-cruiser.cjs`: the exact rule
 *   set, each rule's severity and anchors (`from`, `to`, `pathNot`, `dependencyTypesNot`), and the
 *   `options.exclude` scope. The baseline cannot hold any of it: a weakened rule leaves a stale
 *   entry only where it has entries, so a rule with none (`workers-no-api`,
 *   `shared-depends-only-on-shared`, the domain and ports rules) could be deleted or widened while
 *   `pnpm check:architecture` still exits 0. Each rule is stated once below, in the config's own
 *   shape, so a policy change is a change to this table.
 * @layer infrastructure
 */
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { findMonorepoRoot } from "@packages/vitest-shared";
import { describe, expect, it } from "vitest";

type Rule = { name: string; severity: string; from: object; to: object };
type Config = { forbidden: Rule[]; options: { exclude: { path: string[] } } };

const REPO_ROOT = findMonorepoRoot(path.dirname(fileURLToPath(import.meta.url)));
const CONFIG = createRequire(import.meta.url)(
  path.join(REPO_ROOT, ".dependency-cruiser.cjs")
) as Config;

// The three constants the config itself names, mirrored so each rule below reads like the config.
const FRAMEWORKS =
  "(^|/)node_modules/(prisma|@prisma/[^/]+|fastify|@fastify/[^/]+|ioredis|redis|@redis/[^/]+|bullmq|next)/";
const WORKSPACE_PACKAGES = "^(packages|infra)/";
const ROUTE_MODULES = {
  path: "^apps/api/src/.*([Rr]outes|Handlers)\\.ts$",
  pathNot: "\\.test\\.ts$",
};

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
      pathNot: ["^packages/shared/src/channelCredentialsCrypto\\.ts$", "\\.test\\.ts$"],
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
