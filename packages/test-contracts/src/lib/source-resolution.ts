/**
 * @file source-resolution.ts
 * @description The source-resolution contract: every workspace package a vitest-collected test
 *              imports must resolve to that package's `src/`, through the config that collects
 *              the test. A test that reaches `dist/` instead runs against a build: stale, or
 *              absent until something builds it, which the `^build` dependency of the turbo `test`
 *              task does in CI. For each tracked vitest config it asks vitest itself, with the
 *              node API, which files the config collects and how its vite environments resolve
 *              each bare workspace specifier those files import, so the answer carries the
 *              config's aliases and export conditions exactly as a run applies them.
 *
 *              It reads direct imports only. A workspace package reached through another module
 *              resolves with the same aliases and conditions, but this check does not follow
 *              the import graph. It fails closed below {@link VITEST_CONFIG_FLOOR} configs and
 *              below {@link CHECKED_IMPORT_FLOOR} checked imports: either means it read less of
 *              the tree than the tree holds.
 * @layer infrastructure
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import ts from "typescript";
import { createVitest, type TestProject } from "vitest/node";
import { describeError } from "./registry.js";
import { VITEST_CONFIG, VITEST_CONFIG_FLOOR } from "./vitest-collector.js";

/**
 * The fewest (test file, workspace specifier) pairs a run over this repository may check. It
 * sits below the 850 measured when the check landed (2026-10-10), so adding or removing a test
 * does not trip it; a run below it read the wrong directory or no import at all.
 */
const CHECKED_IMPORT_FLOOR = 800;

/** A workspace package: its manifest name and its repository-relative directory. */
export interface WorkspacePackage {
  readonly name: string;
  readonly dir: string;
}

/** One import that does not resolve to its package's `src/`. */
interface SourceViolation {
  readonly config: string;
  readonly file: string;
  readonly specifier: string;
  /** The resolved id, repository-relative when inside the root, or `null` when nothing resolved. */
  readonly resolved: string | null;
}

/** The outcome of one check. */
export interface SourceResolutionReport {
  readonly configs: number;
  readonly checked: number;
  readonly violations: readonly SourceViolation[];
  readonly errors: readonly string[];
}

/** Overrides for the self-tests: smaller floors for a planted tree. */
export interface SourceResolutionOptions {
  readonly configFloor?: number;
  readonly importFloor?: number;
}

/** The `vi` calls whose first argument vitest resolves as a module specifier. */
const VI_MODULE_CALLS = new Set([
  "mock",
  "doMock",
  "unmock",
  "doUnmock",
  "importActual",
  "importMock",
]);

/**
 * Lists the workspace packages from the tracked manifests below the repository root.
 *
 * @param root - Absolute repository root.
 * @param tracked - Every tracked file, repository-relative.
 * @returns Each package's name and directory; a manifest with no name is skipped.
 */
function workspacePackages(root: string, tracked: readonly string[]): WorkspacePackage[] {
  const packages: WorkspacePackage[] = [];
  for (const file of tracked) {
    if (!file.endsWith("/package.json") || file.includes("node_modules/")) continue;
    const manifest = JSON.parse(readFileSync(path.join(root, file), "utf8")) as { name?: unknown };
    if (typeof manifest.name === "string") {
      packages.push({ name: manifest.name, dir: path.dirname(file) });
    }
  }
  return packages;
}

/**
 * Reads the specifiers a module resolves at run time: value imports and re-exports, `import()`,
 * `require()` and the `vi` module calls. Type-only imports are erased before a run, and text in
 * comments or strings is not an import, so neither is returned.
 *
 * @param source - The module's text.
 * @param fileName - Its name, which selects the TypeScript or TSX grammar.
 * @returns The specifiers, in source order.
 */
export function runtimeSpecifiers(source: string, fileName: string): string[] {
  const found: string[] = [];
  const firstStringArgument = (call: ts.CallExpression): void => {
    const [argument] = call.arguments;
    if (argument !== undefined && ts.isStringLiteralLike(argument)) found.push(argument.text);
  };
  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node) && node.importClause?.isTypeOnly !== true) {
      if (ts.isStringLiteral(node.moduleSpecifier)) found.push(node.moduleSpecifier.text);
    } else if (ts.isExportDeclaration(node) && !node.isTypeOnly && node.moduleSpecifier) {
      if (ts.isStringLiteral(node.moduleSpecifier)) found.push(node.moduleSpecifier.text);
    } else if (ts.isCallExpression(node)) {
      const callee = node.expression;
      if (callee.kind === ts.SyntaxKind.ImportKeyword) firstStringArgument(node);
      else if (ts.isIdentifier(callee) && callee.text === "require") firstStringArgument(node);
      else if (
        ts.isPropertyAccessExpression(callee) &&
        ts.isIdentifier(callee.expression) &&
        callee.expression.text === "vi" &&
        VI_MODULE_CALLS.has(callee.name.text)
      ) {
        firstStringArgument(node);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, false, scriptKind(fileName)));
  return found;
}

/**
 * @param fileName - A module's file name.
 * @returns The grammar TypeScript parses it with.
 */
function scriptKind(fileName: string): ts.ScriptKind {
  return fileName.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
}

/**
 * @param specifier - A bare module specifier.
 * @param packages - The workspace packages.
 * @returns The package the specifier names, itself or one of its subpaths, or `undefined`.
 */
export function owningPackage(
  specifier: string,
  packages: readonly WorkspacePackage[]
): WorkspacePackage | undefined {
  return packages.find((pkg) => specifier === pkg.name || specifier.startsWith(`${pkg.name}/`));
}

/**
 * The vite environment a file of a project is transformed in: `client` for a DOM environment,
 * `ssr` otherwise, as vitest 4.1.11 maps them. A `@vitest-environment` docblock overrides the
 * project's environment, as it does in a run.
 *
 * @param project - The project collecting the file.
 * @param source - The file's text.
 * @returns The environment's name.
 */
function environmentOf(project: TestProject, source: string): "client" | "ssr" {
  const environment =
    /@vitest-environment\s+([\w-]+)/.exec(source)?.[1] ?? project.config.environment;
  return environment === "jsdom" || environment === "happy-dom" ? "client" : "ssr";
}

/**
 * Checks one config: every workspace specifier each collected file imports, resolved through the
 * file's environment, must land under the package's `src/`.
 *
 * @param root - Absolute repository root, a real path.
 * @param config - Repository-relative config path.
 * @param packages - The workspace packages.
 * @param report - Where the checked count and the violations are added.
 */
async function checkConfig(
  root: string,
  config: string,
  packages: readonly WorkspacePackage[],
  report: { checked: number; violations: SourceViolation[] }
): Promise<void> {
  const absolute = path.join(root, config);
  const vitest = await createVitest(
    "test",
    { root: path.dirname(absolute), config: absolute, watch: false },
    { logLevel: "silent" }
  );
  try {
    for (const spec of await vitest.globTestSpecifications()) {
      const source = readFileSync(spec.moduleId, "utf8");
      const environment = spec.project.vite.environments[environmentOf(spec.project, source)];
      for (const specifier of runtimeSpecifiers(source, spec.moduleId)) {
        const pkg = owningPackage(specifier, packages);
        if (pkg === undefined || environment === undefined) continue;
        report.checked += 1;
        const resolved = await environment.pluginContainer.resolveId(specifier, spec.moduleId);
        const id = resolved?.id.split("?")[0] ?? null;
        if (id !== null && id.startsWith(path.join(root, pkg.dir, "src") + path.sep)) continue;
        report.violations.push({
          config,
          file: path.relative(root, spec.moduleId),
          specifier,
          resolved: id === null ? null : path.relative(root, id),
        });
      }
    }
  } finally {
    await vitest.close();
  }
}

/**
 * Runs the contract over every tracked vitest config.
 *
 * @param root - Absolute repository root, a real path.
 * @param tracked - Every tracked file, repository-relative.
 * @param options - Smaller floors, for the self-tests only.
 * @returns The report; nothing is thrown.
 */
export async function checkSourceResolution(
  root: string,
  tracked: readonly string[],
  options: SourceResolutionOptions = {}
): Promise<SourceResolutionReport> {
  const configs = tracked.filter((file) => VITEST_CONFIG.test(file));
  const errors: string[] = [];
  const report = { checked: 0, violations: [] as SourceViolation[] };
  const configFloor = options.configFloor ?? VITEST_CONFIG_FLOOR;
  if (configs.length < configFloor) {
    errors.push(
      `${String(configs.length)} tracked vitest configs, below the floor of ${String(configFloor)}`
    );
    return { configs: configs.length, checked: 0, violations: [], errors };
  }
  const packages = workspacePackages(root, tracked);
  for (const config of configs) {
    try {
      await checkConfig(root, config, packages, report);
    } catch (error: unknown) {
      errors.push(`${config}: ${describeError(error)}`);
    }
  }
  const importFloor = options.importFloor ?? CHECKED_IMPORT_FLOOR;
  if (report.checked < importFloor) {
    errors.push(
      `${String(report.checked)} workspace imports checked, below the floor of ${String(importFloor)}`
    );
  }
  return { configs: configs.length, ...report, errors };
}
