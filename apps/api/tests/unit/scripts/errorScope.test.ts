/**
 * @file errorScope.test.ts
 * @description Pins `scripts/testing/lib/error-scope.mjs`, the one home of the scope of the
 *   `errors/` rules: the extensions a source file may have, the named list of exclusions per rule
 *   with each entry's kind and reason, the options each rule is held to, and the glob matcher every
 *   gate reads the list with. A file under a `src` directory stays in scope whatever its name: only
 *   a test suffix, a declaration file or a whole excluded root takes it out, and an entry of kind
 *   "outside src" never does, whatever its glob matches.
 * @layer infrastructure
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { findMonorepoRoot } from "@packages/vitest-shared";
import { describe, expect, it } from "vitest";

type ExclusionKind = "test-suffix" | "declaration" | "outside-src" | "whole-root";
interface Exclusion {
  readonly glob: string;
  readonly kind: ExclusionKind;
  readonly reason: string;
}
/** The module's surface; a literal import of an untyped `.mjs` would be an implicit any. */
type ScopeModule = {
  ERROR_SCOPE_FILES: readonly string[];
  ERROR_SCOPE_EXCLUSIONS: Readonly<Record<string, readonly Exclusion[]>>;
  ERROR_RULE_OPTIONS: Readonly<Record<string, readonly unknown[]>>;
  ERROR_PLUGIN_BUILTINS: readonly string[];
  EXCLUSION_KIND: Readonly<Record<string, ExclusionKind>>;
  matchesGlob: (file: string, glob: string) => boolean;
  isUnderSource: (file: string) => boolean;
  exclusionOf: (file: string, list: readonly Exclusion[]) => Exclusion | undefined;
  isInErrorScope: (file: string, list: readonly Exclusion[]) => boolean;
};

const REPO_ROOT = findMonorepoRoot(path.dirname(fileURLToPath(import.meta.url)));
const SCOPE_MODULE = path.join(REPO_ROOT, "scripts/testing/lib/error-scope.mjs");
const {
  ERROR_SCOPE_FILES,
  ERROR_SCOPE_EXCLUSIONS,
  ERROR_RULE_OPTIONS,
  ERROR_PLUGIN_BUILTINS,
  EXCLUSION_KIND,
  matchesGlob,
  isUnderSource,
  exclusionOf,
  isInErrorScope,
} = (await import(SCOPE_MODULE)) as ScopeModule;

const RULE = "errors/no-inline-error";
const LIST = ERROR_SCOPE_EXCLUSIONS[RULE] ?? [];
const inScope = (file: string): boolean => isInErrorScope(file, LIST);

describe("the files of the scope", () => {
  it("names the four TypeScript extensions, so no source file leaves the scope by its extension", () => {
    expect(ERROR_SCOPE_FILES).toEqual(["**/*.ts", "**/*.tsx", "**/*.mts", "**/*.cts"]);
  });

  it("holds a source file of each extension and no JavaScript file", () => {
    expect(inScope("apps/api/src/admin/adminRoutes.ts")).toBe(true);
    expect(inScope("packages/core/auth/src/view.tsx")).toBe(true);
    expect(inScope("apps/api/src/cli/run.mts")).toBe(true);
    expect(inScope("packages/shared/src/legacy.cts")).toBe(true);
    expect(inScope("apps/api/src/legacy.js")).toBe(false);
    expect(inScope("apps/api/src/legacy.mjs")).toBe(false);
  });
});

describe("a file under a src directory", () => {
  it("stays in scope with a configuration or a generated name: the two such files the tree holds", () => {
    expect(inScope("apps/api/src/analytics/engagementPredictor.config.ts")).toBe(true);
    expect(inScope("apps/api/src/security/nameDigest/unicodeData.generated.ts")).toBe(true);
  });

  it("stays in scope inside a tests directory, at any depth of a package", () => {
    expect(inScope("apps/api/src/tests/helper.ts")).toBe(true);
    expect(inScope("packages/shared/src/tests/helper.ts")).toBe(true);
    expect(inScope("packages/core/auth/src/tests/helper.ts")).toBe(true);
  });

  it("stays in scope under a name an outside-src entry matches, while the same name beside the source tree is excluded", () => {
    expect(inScope("packages/shared/src/vitest.config.ts")).toBe(true);
    expect(inScope("apps/api/src/scripts/seed.ts")).toBe(true);
    expect(inScope("packages/core/auth/vitest.config.ts")).toBe(false);
    expect(inScope("apps/api/scripts/dump-openapi-spec.ts")).toBe(false);
  });

  it("leaves the scope by a test suffix of any of the four extensions", () => {
    expect(inScope("apps/api/src/admin/adminRoutes.test.ts")).toBe(false);
    expect(inScope("packages/core/auth/src/view.spec.tsx")).toBe(false);
    expect(inScope("apps/api/src/cli/run.test.mts")).toBe(false);
    expect(inScope("packages/shared/src/legacy.spec.cts")).toBe(false);
  });

  it("leaves the scope as a declaration file of any of the three declaration extensions", () => {
    expect(inScope("apps/api/src/types/fastify.d.ts")).toBe(false);
    expect(inScope("apps/api/src/types/module.d.mts")).toBe(false);
    expect(inScope("apps/api/src/types/module.d.cts")).toBe(false);
  });

  it("leaves the scope when its whole root is excluded", () => {
    expect(inScope("packages/ui/src/components/Button.tsx")).toBe(false);
    expect(inScope("packages/observability/browser-logger/src/index.ts")).toBe(false);
  });
});

describe("an entry of kind outside src", () => {
  it("never excludes a file under a src directory, whatever its glob matches", () => {
    const list: readonly Exclusion[] = [
      { glob: "packages/**", kind: "outside-src", reason: "a glob wider than its kind allows" },
    ];

    expect(exclusionOf("packages/shared/src/index.ts", list)).toBeUndefined();
    expect(isInErrorScope("packages/shared/src/index.ts", list)).toBe(true);
    expect(exclusionOf("packages/shared/vitest.config.ts", list)).toEqual(list[0]);
    expect(isInErrorScope("packages/shared/vitest.config.ts", list)).toBe(false);
  });

  it("reads a src directory at any depth, and never a file merely named src", () => {
    expect(isUnderSource("apps/api/src/index.ts")).toBe(true);
    expect(isUnderSource("packages/core/auth/src/a/b.ts")).toBe(true);
    expect(isUnderSource("apps/api/scripts/src.ts")).toBe(false);
    expect(isUnderSource("apps/api/srcs/index.ts")).toBe(false);
  });
});

describe("the list of errors/no-inline-error", () => {
  it("is the only rule, and holds frozen entries, each with a known kind and a reason", () => {
    expect(Object.keys(ERROR_SCOPE_EXCLUSIONS)).toEqual([RULE]);
    expect(Object.isFrozen(ERROR_SCOPE_EXCLUSIONS)).toBe(true);
    expect(Object.isFrozen(LIST)).toBe(true);
    const kinds = new Set(Object.values(EXCLUSION_KIND));
    for (const entry of LIST) {
      expect(Object.isFrozen(entry)).toBe(true);
      expect(kinds.has(entry.kind)).toBe(true);
      expect(entry.reason.length).toBeGreaterThan(10);
    }
  });

  it("excludes no file for being generated and no e2e directory by its name", () => {
    const globs = LIST.map((entry) => entry.glob);

    expect(globs.filter((glob) => glob.includes("generated"))).toEqual([]);
    expect(globs.filter((glob) => glob.includes("e2e"))).toEqual([]);
    expect(inScope("packages/shared/src/api-generated/index.ts")).toBe(true);
  });

  it("excludes the test code, the tooling and the fronts beside the source trees", () => {
    expect(inScope("apps/api/tests/unit/x.ts")).toBe(false);
    expect(inScope("packages/core/auth/tests/unit/x.ts")).toBe(false);
    expect(inScope("packages/providers/x/tests/x.ts")).toBe(false);
    expect(inScope("eslint.config.ts")).toBe(false);
    expect(inScope("apps/workers/vitest.config.ts")).toBe(false);
    expect(inScope("packages/adapters/cache-redis/vitest.config.ts")).toBe(false);
    expect(inScope("security/tests/headers.ts")).toBe(false);
    expect(inScope("scripts/generate-api-types.ts")).toBe(false);
    expect(inScope("apps/client/app/page.tsx")).toBe(false);
    expect(inScope("apps/admin/.storybook/main.ts")).toBe(false);
  });
});

describe("the options of errors/no-inline-error", () => {
  it("write out every option, the one file that writes the error body included, and are frozen", () => {
    expect(Object.keys(ERROR_RULE_OPTIONS)).toEqual([RULE]);
    expect(ERROR_RULE_OPTIONS[RULE]).toEqual([
      {
        runtimeErrors: [
          "Error",
          "TypeError",
          "RangeError",
          "SyntaxError",
          "ReferenceError",
          "EvalError",
          "URIError",
          "AggregateError",
        ],
        baseClasses: ["DomainError", "UseCaseError", "RegisteredError"],
        replyHelpers: [
          "sendError",
          "handleUnexpectedError",
          "handleOAuthError",
          "sendValidationError",
          "sendMfaLoginError",
          "sendMappedError",
        ],
        bodyWriter: "apps/api/src/lib/errors/sendProblem.ts",
      },
    ]);
    const [options] = ERROR_RULE_OPTIONS[RULE] ?? [];
    expect(Object.isFrozen(ERROR_RULE_OPTIONS[RULE])).toBe(true);
    expect(Object.isFrozen(options)).toBe(true);
    for (const value of Object.values(options ?? {})) expect(Object.isFrozen(value)).toBe(true);
  });
});

describe("the built-ins the rule package may import", () => {
  it("are node:path alone, by its exact specifier, frozen", () => {
    expect(ERROR_PLUGIN_BUILTINS).toEqual(["node:path"]);
    expect(Object.isFrozen(ERROR_PLUGIN_BUILTINS)).toBe(true);
  });
});

describe("the glob matcher", () => {
  it("reads a globstar as zero or more segments, dot segments included", () => {
    expect(matchesGlob("x.d.ts", "**/*.d.ts")).toBe(true);
    expect(matchesGlob("a/.hidden/b/x.d.ts", "**/*.d.ts")).toBe(true);
    expect(matchesGlob("packages/vitest.config.ts", "packages/**/vitest*.config.ts")).toBe(true);
    expect(
      matchesGlob("packages/a/b/vitest.stories.config.ts", "packages/**/vitest*.config.ts")
    ).toBe(true);
    expect(matchesGlob("apps/admin/.storybook/main.ts", "apps/admin/**")).toBe(true);
  });

  it("reads a star as one segment and a brace as its alternatives", () => {
    expect(matchesGlob("apps/api/tests/x.ts", "apps/*/tests/**")).toBe(true);
    expect(matchesGlob("apps/api/src/tests/x.ts", "apps/*/tests/**")).toBe(false);
    expect(matchesGlob("a/b.test.tsx", "**/*.test.{ts,tsx,mts,cts}")).toBe(true);
    expect(matchesGlob("a/b.test.js", "**/*.test.{ts,tsx,mts,cts}")).toBe(false);
    expect(matchesGlob("a/b.test.tsx.bak", "**/*.test.{ts,tsx,mts,cts}")).toBe(false);
  });

  it("refuses a glob in a syntax it does not read, rather than matching it as text", () => {
    expect(() => matchesGlob("a/b.ts", "a/[b].ts")).toThrow(/does not read/);
    expect(() => matchesGlob("a/b.ts", "packages/*/!(src)/**")).toThrow(/does not read/);
    expect(() => matchesGlob("a/b.ts", "a/?.ts")).toThrow(/does not read/);
    expect(() => matchesGlob("a/b.ts", "{a,b/c}/x.ts")).toThrow(/does not read/);
  });
});
