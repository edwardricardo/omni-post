/**
 * @file boundariesPolicies.test.ts
 * @description Pins the hexagonal layer policies of the root `eslint.config.ts`
 *   (`boundaries/dependencies`, eslint-plugin-boundaries). The policies are only as strong as the
 *   classification behind them, and both fail silently: a mistyped category, a dropped
 *   `boundaries/files` entry or an element pattern that stops matching does not make `pnpm lint`
 *   red, it makes it see less. Nothing else in the repository would notice, so this suite lints
 *   import statements against the real config and asserts, per import, the exact verdict: refused
 *   (with the importing and imported kinds named in the message, so an inverted policy fails and
 *   not only a changed count) or allowed.
 *
 *   How it lints. Source text is linted in memory with `ESLint#lintText` and a virtual `filePath`;
 *   nothing is written to the tree. Import targets, by contrast, must exist: with no import
 *   resolver configured, the plugin classifies a local import only when Node resolution finds the
 *   file, and an import it cannot classify is skipped. So every local target below is a real,
 *   stable repository file, and each case first asserts its target exists, naming the file, so a
 *   moved file fails loudly instead of turning a refusal into a pass. The run is restricted to
 *   `boundaries/dependencies` with the documented `ruleFilter`, and one parser option is
 *   overridden, which is not a policy: `parserOptions.projectService` is turned off for the two
 *   virtual files under `apps/api/src/infrastructure/`, because that directory is type-aware in
 *   the root config and the project service refuses a file that is not on disk. The
 *   `boundaries/*` rule needs no type information.
 *   Every `boundaries/*` setting and every policy comes from the real config, which the suite
 *   asserts is the file ESLint loaded.
 *
 *   Where it runs matters, and that is part of what it pins. The plugin anchors its patterns at
 *   `boundaries/root-path` and, without that setting, at `process.cwd()`. vitest runs this file
 *   with `apps/api` as its working directory, where an unanchored config matches no pattern and
 *   allows every import (measured). The refusals below therefore hold only while the root config
 *   anchors itself; they fail if `boundaries/root-path` is removed from it.
 *
 *   What it does NOT cover:
 *   - Imports the plugin cannot classify. No import resolver is configured, so a workspace alias
 *     such as `@ports/core` reads as an npm package (origin `external`, allowed for every element),
 *     and an import written with a `.js` extension that has only a `.ts` source resolves to nothing
 *     and is skipped. A violation spelled either way passes the lint and this suite alike.
 *   - The `domain` and `application` elements. They name `apps/api/src/domain/**` and
 *     `apps/api/src/application/**`, directories that no longer exist (backlog SMELL-183): no real
 *     file can be an import target of either, so their policies, and a routes file importing
 *     domain, cannot be pinned with real targets.
 * @layer infrastructure
 */
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ESLint, type Linter } from "eslint";
import { findMonorepoRoot } from "@packages/vitest-shared";
import { beforeAll, describe, it } from "vitest";

// `eslint` is a dependency of the repository root, not of `apps/api`; it resolves here through
// Node's lookup of the ancestor `node_modules`, the same installation `pnpm lint` runs.
const REPO_ROOT = findMonorepoRoot(path.dirname(fileURLToPath(import.meta.url)));
const RULE_ID = "boundaries/dependencies";

/** Real files used as import targets, one per kind the policies distinguish. */
const TARGET = {
  /** The `infrastructure` element. */
  container: "apps/api/src/infrastructure/container/Container.ts",
  /** A `*Routes.ts` file outside every element: only the `routes` file category knows it. */
  routes: "apps/api/src/auth/authRoutes.ts",
  /** The `ports` element. */
  port: "packages/ports/src/CachePort.ts",
  /** The `shared` element. */
  shared: "packages/shared/src/csv.ts",
  /** The `adapters` element. */
  adapter: "packages/adapters/cache-redis/src/constants.ts",
} as const;

/** How the plugin names what an import comes from or goes to, as its messages spell it. */
const elementOfType = (type: string): string => `elements of type "${type}"`;
const ROUTES_CATEGORY = 'file of category "routes"';
const ROUTES_INSIDE_INFRASTRUCTURE = `${ROUTES_CATEGORY} belonging to ${elementOfType("infrastructure")}`;

type ImportTarget = { readonly file: string } | { readonly module: string };

type Verdict =
  | { readonly kind: "allowed" }
  /** No policy allows the dependency, so `default: "disallow"` refuses it. */
  | { readonly kind: "refused"; readonly from: string; readonly to: string }
  /** An explicit framework denial narrows the allowance every element has for npm packages. */
  | { readonly kind: "module-denied"; readonly source: string; readonly from: string };

interface ImportCase {
  readonly name: string;
  readonly target: ImportTarget;
  readonly verdict: Verdict;
}

interface ProbeFile {
  readonly layer: string;
  /** Repository-relative path of the virtual importing file; it is never written to disk. */
  readonly filePath: string;
  readonly imports: readonly ImportCase[];
}

const ALLOWED: Verdict = { kind: "allowed" };
const refused = (from: string, to: string): Verdict => ({ kind: "refused", from, to });
const moduleDenied = (source: string, from: string): Verdict => ({
  kind: "module-denied",
  source,
  from,
});
const file = (name: string, target: string, verdict: Verdict): ImportCase => ({
  name,
  target: { file: target },
  verdict,
});
const npm = (name: string, module: string, verdict: Verdict): ImportCase => ({
  name,
  target: { module },
  verdict,
});

const INFRASTRUCTURE = elementOfType("infrastructure");
const PORTS = elementOfType("ports");
const SHARED = elementOfType("shared");
const ADAPTERS = elementOfType("adapters");

const PROBES: readonly ProbeFile[] = [
  {
    layer: "infrastructure",
    filePath: "apps/api/src/infrastructure/boundariesPolicyProbe.ts",
    imports: [
      file("a routes file", TARGET.routes, refused(INFRASTRUCTURE, ROUTES_CATEGORY)),
      file("another infrastructure file", TARGET.container, ALLOWED),
      file("a port", TARGET.port, ALLOWED),
      file("an adapter", TARGET.adapter, ALLOWED),
      file("a shared file", TARGET.shared, ALLOWED),
      npm("an npm package", "fastify", ALLOWED),
      npm("a Node.js built-in", "node:crypto", ALLOWED),
    ],
  },
  {
    layer: "routes (a *Routes.ts file outside every element)",
    filePath: "apps/api/src/auth/boundariesPolicyProbeRoutes.ts",
    imports: [
      file("an infrastructure file", TARGET.container, refused(ROUTES_CATEGORY, INFRASTRUCTURE)),
      file("an adapter", TARGET.adapter, refused(ROUTES_CATEGORY, ADAPTERS)),
      file("another routes file", TARGET.routes, refused(ROUTES_CATEGORY, ROUTES_CATEGORY)),
      file("a port", TARGET.port, ALLOWED),
      file("a shared file", TARGET.shared, ALLOWED),
      npm("an npm package", "fastify", ALLOWED),
      npm("a Node.js built-in", "node:path", ALLOWED),
    ],
  },
  {
    layer: "a *Routes.ts file inside apps/api/src/infrastructure/",
    filePath: "apps/api/src/infrastructure/boundariesPolicyProbeRoutes.ts",
    imports: [
      file("an adapter", TARGET.adapter, ALLOWED),
      file("the dependency container", TARGET.container, ALLOWED),
      file("a port", TARGET.port, ALLOWED),
      npm("the web framework", "fastify", ALLOWED),
      file("a shared file", TARGET.shared, ALLOWED),
      file(
        "another routes file",
        TARGET.routes,
        refused(ROUTES_INSIDE_INFRASTRUCTURE, ROUTES_CATEGORY)
      ),
    ],
  },
  {
    layer: "ports",
    filePath: "packages/ports/src/boundariesPolicyProbe.ts",
    imports: [
      file("an infrastructure file", TARGET.container, refused(PORTS, INFRASTRUCTURE)),
      file("an adapter", TARGET.adapter, refused(PORTS, ADAPTERS)),
      file("a routes file", TARGET.routes, refused(PORTS, ROUTES_CATEGORY)),
      npm("fastify", "fastify", moduleDenied("fastify", PORTS)),
      npm("a @fastify/* package", "@fastify/cors", moduleDenied("@fastify/cors", PORTS)),
      npm("@prisma/client", "@prisma/client", moduleDenied("@prisma/client", PORTS)),
      npm(
        "a @prisma/client subpath",
        "@prisma/client/runtime/library",
        moduleDenied("@prisma/client", PORTS)
      ),
      npm("prisma", "prisma", moduleDenied("prisma", PORTS)),
      npm("redis", "redis", moduleDenied("redis", PORTS)),
      npm("ioredis", "ioredis", moduleDenied("ioredis", PORTS)),
      npm("bullmq", "bullmq", moduleDenied("bullmq", PORTS)),
      file("another port", TARGET.port, ALLOWED),
      file("a shared file", TARGET.shared, ALLOWED),
      npm("an npm package outside the denied frameworks", "zod", ALLOWED),
      npm("a Node.js built-in", "node:crypto", ALLOWED),
    ],
  },
  {
    layer: "shared",
    filePath: "packages/shared/src/boundariesPolicyProbe.ts",
    imports: [
      file("a port", TARGET.port, refused(SHARED, PORTS)),
      file("an infrastructure file", TARGET.container, refused(SHARED, INFRASTRUCTURE)),
      file("an adapter", TARGET.adapter, refused(SHARED, ADAPTERS)),
      file("another shared file", TARGET.shared, ALLOWED),
      npm("an npm package", "fastify", ALLOWED),
      npm("a Node.js built-in", "node:path", ALLOWED),
    ],
  },
  {
    layer: "adapters",
    filePath: "packages/adapters/storage-s3/src/boundariesPolicyProbe.ts",
    imports: [
      file("an infrastructure file", TARGET.container, refused(ADAPTERS, INFRASTRUCTURE)),
      file("a routes file", TARGET.routes, refused(ADAPTERS, ROUTES_CATEGORY)),
      file("a port", TARGET.port, ALLOWED),
      file("a shared file", TARGET.shared, ALLOWED),
      file("another adapter package", TARGET.adapter, ALLOWED),
      npm("an npm package", "fastify", ALLOWED),
      npm("a Node.js built-in", "node:crypto", ALLOWED),
    ],
  },
];

/** The virtual files the root config would hand to the project service, which reads from disk. */
const TYPE_AWARE_PROBES = PROBES.map((probe) => probe.filePath).filter((filePath) =>
  filePath.startsWith("apps/api/src/infrastructure/")
);

/**
 * Builds the specifier a probe file uses to reach a target: a relative path for a repository
 * file, the bare name for a package or built-in.
 */
function specifierFor(fromFile: string, target: ImportTarget): string {
  if ("module" in target) {
    return target.module;
  }
  const relative = path.posix.relative(path.posix.dirname(fromFile), target.file);
  return relative.startsWith("../") ? relative : `./${relative}`;
}

/** One `import` per line, in case order, so line N of the result answers case N. */
function sourceOf(probe: ProbeFile): string {
  return probe.imports
    .map((importCase) => `import "${specifierFor(probe.filePath, importCase.target)}";`)
    .join("\n");
}

function describeVerdict(verdict: Verdict): string {
  switch (verdict.kind) {
    case "allowed":
      return "allows";
    case "refused":
      return "refuses";
    case "module-denied":
      return "denies";
  }
}

function assertVerdict(importCase: ImportCase, messages: readonly Linter.LintMessage[]): void {
  const { verdict } = importCase;
  if (verdict.kind === "allowed") {
    assert.deepEqual(
      messages.map((message) => message.message),
      [],
      `expected the import of ${importCase.name} to be allowed`
    );
    return;
  }
  assert.equal(messages.length, 1, `expected exactly one report for ${importCase.name}`);
  const [report] = messages;
  assert.ok(report, `expected a report for ${importCase.name}`);
  assert.equal(report.ruleId, RULE_ID);
  assert.equal(report.severity, 2, "a boundary violation must be an error, not a warning");
  if (verdict.kind === "refused") {
    assert.equal(
      report.message,
      `There is no policy allowing dependencies from ${verdict.from} to ${verdict.to}`
    );
    return;
  }
  assert.match(
    report.message,
    new RegExp(
      `^Dependencies with module source "${escapeRegExp(verdict.source)}" to entities of module ` +
        `with origin "external" are not allowed in ${escapeRegExp(verdict.from)}\\. ` +
        "Denied by policy at index \\d+$"
    )
  );
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

describe("root eslint.config.ts hexagonal layer policies (boundaries/dependencies)", () => {
  let eslint: ESLint;
  const results = new Map<string, Promise<ESLint.LintResult>>();

  /** Lints each probe file once; every case of that file reads the same result. */
  const lintProbe = (probe: ProbeFile): Promise<ESLint.LintResult> => {
    const cached = results.get(probe.filePath);
    if (cached) {
      return cached;
    }
    const pending = eslint
      .lintText(sourceOf(probe), { filePath: path.join(REPO_ROOT, probe.filePath) })
      .then(([result]) => {
        assert.ok(result, `ESLint returned no result for ${probe.filePath}`);
        return result;
      });
    results.set(probe.filePath, pending);
    return pending;
  };

  beforeAll(() => {
    eslint = new ESLint({
      cwd: REPO_ROOT,
      ruleFilter: ({ ruleId }) => ruleId === RULE_ID,
      overrideConfig: [
        {
          files: TYPE_AWARE_PROBES,
          languageOptions: { parserOptions: { projectService: false } },
        },
      ],
    });
  });

  it("loads the repository root eslint.config.ts as the subject", async () => {
    const configFile = await eslint.findConfigFile();

    assert.equal(configFile, path.join(REPO_ROOT, "eslint.config.ts"));
  });

  for (const probe of PROBES) {
    describe(`from ${probe.layer} (${probe.filePath})`, () => {
      it("lints the file without a parse error and reports nothing but boundaries/dependencies", async () => {
        const result = await lintProbe(probe);

        assert.deepEqual(
          result.messages.filter((message) => message.fatal === true || message.ruleId !== RULE_ID),
          []
        );
        const caseLines = probe.imports.length;
        assert.deepEqual(
          result.messages.filter((message) => message.line < 1 || message.line > caseLines),
          [],
          "every report must belong to one import case"
        );
      });

      probe.imports.forEach((importCase, index) => {
        it(`${describeVerdict(importCase.verdict)} an import of ${importCase.name}`, async () => {
          if ("file" in importCase.target) {
            const targetPath = path.join(REPO_ROOT, importCase.target.file);
            assert.ok(
              existsSync(targetPath),
              `import target ${importCase.target.file} does not exist; this case cannot classify ` +
                "it, so pick another real file of the same kind"
            );
          }

          const result = await lintProbe(probe);
          const line = index + 1;

          assertVerdict(
            importCase,
            result.messages.filter((message) => message.line === line)
          );
        });
      });
    });
  }
});
