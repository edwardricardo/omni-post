/**
 * @file environmentVariablesPage.test.ts
 * @description Holds `docs/deployment/ENVIRONMENT_VARIABLES.md` to the four environment schemas: the
 *   page names, in backticks, every key the API's and the workers' schemas require, and every key a
 *   portal's schema declares, since a portal requires none and its `API_URL` and `SENTRY_DSN` are
 *   what an operator sets. A key is required when its entry holds neither `.optional()` nor
 *   `.default()`, the rule `DEPLOYMENT_CHECKLIST.md` states.
 *
 *   The schemas are read as text, as the legal inventories read their sources: the workers' and the
 *   portals' modules export only the parsed `env`, and importing one validates this process's
 *   environment and loads the checkout's environment file. A spread fragment is read from the module
 *   its import names, through the paths of `tsconfig.base.json`. A schema that yields no key, a
 *   spread that resolves to no module or that loops, and a page that cannot be read each fail the case.
 *
 *   The reader assumes the shape the four schemas have today: one entry per key, the key in capitals
 *   at the start of a line. It would misread an entry that nests an object keyed in capitals, a
 *   `.optional(` written inside a string, or a comment that opens inside a string; a change of
 *   shape in a schema belongs in this reader in the same change.
 * @layer infrastructure
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { findMonorepoRoot } from "@packages/vitest-shared";
import { describe, expect, it } from "vitest";

const ROOT = findMonorepoRoot(path.dirname(fileURLToPath(import.meta.url)));
const PAGE = "docs/deployment/ENVIRONMENT_VARIABLES.md";

/**
 * What a schema is held to on the page: `required` names the keys it requires, and `declared` names
 * every key it declares, for a schema that requires none (a portal's).
 */
type Scope = "required" | "declared";
const SCHEMAS: ReadonlyArray<{ file: string; scope: Scope }> = [
  { file: "apps/api/src/config/env.ts", scope: "required" },
  { file: "apps/workers/src/config/env.ts", scope: "required" },
  { file: "apps/admin/lib/env.ts", scope: "declared" },
  { file: "apps/client/lib/env.ts", scope: "declared" },
];

const KEY = "[A-Z][A-Z0-9_]*";
// An entry runs to the next entry or spread at the start of a line, or to the end of the text, so a
// chain over several lines is read whole. JavaScript has no `\z`: `(?![\s\S])` matches only where no
// character, not even a newline, follows.
const ENTRY_END = `(?=^\\s+(?:${KEY}:|\\.\\.\\.)|(?![\\s\\S]))`;
const ENTRY = new RegExp(`^\\s+(${KEY}):([\\s\\S]*?)${ENTRY_END}`, "gm");

/** `KEY: process.env.KEY`, a portal's `runtimeEnv` mapping, repeats a key and is not a schema entry. */
function isRuntimeEnvMapping(body: string): boolean {
  return body.trim().startsWith("process.env");
}

let pathAliases: Record<string, string[]> | undefined;

/** The `paths` of `tsconfig.base.json`, read once. */
function tsconfigPaths(): Record<string, string[]> {
  pathAliases ??= (
    JSON.parse(readFileSync(path.join(ROOT, "tsconfig.base.json"), "utf8")) as {
      compilerOptions: { paths: Record<string, string[]> };
    }
  ).compilerOptions.paths;
  return pathAliases;
}

/**
 * The module a spread fragment comes from. `paths` maps a wildcard alias such as `@shared/*` to a
 * wildcard target such as `packages/shared/src/*`: what the import specifier holds after the alias's
 * prefix (`@shared/`) replaces the target's `*`.
 */
function spreadModule(file: string, name: string, text: string): string {
  const specifier = new RegExp(`\\b${name}\\b[^;]*from "([^"]+)"`).exec(text)?.[1] ?? "";
  const paths = tsconfigPaths();
  const alias = Object.keys(paths).find(
    (a) => a.endsWith("/*") && specifier.startsWith(a.slice(0, -1))
  );
  const target = alias === undefined ? undefined : paths[alias]?.[0];
  if (alias === undefined || target === undefined) {
    throw new Error(`${file}: ${name} resolves to no module`);
  }
  // TypeScript allows one `*` in a path target, so the target is the text before it and after it.
  const halves = target.split("*");
  if (halves.length !== 2) {
    throw new Error(
      `${file}: the path target "${target}" of ${alias} does not hold exactly one "*"`
    );
  }
  const [before = "", after = ""] = halves;
  const rest = specifier.slice(alias.length - 1);
  return `${before}${rest}${after}`.replace(/\.js$/, ".ts");
}

/**
 * Every key a schema module declares, mapped to whether it is required; spreads are followed.
 * `ancestors` holds the modules being read, so a spread that loops fails instead of recursing.
 */
function schemaKeys(file: string, ancestors: readonly string[] = []): Map<string, boolean> {
  if (ancestors.includes(file)) throw new Error(`${file}: a spread loops back to it`);
  const text = readFileSync(path.join(ROOT, file), "utf8").replace(
    /\/\*[\s\S]*?\*\/|^\s*\/\/.*$/gm,
    ""
  );
  const keys = new Map<string, boolean>();
  for (const [, key = "", body = ""] of text.matchAll(ENTRY)) {
    if (!isRuntimeEnvMapping(body)) keys.set(key, !/\.(optional|default)\(/.test(body));
  }
  for (const [, name = ""] of text.matchAll(/^\s+\.\.\.(\w+)\(/gm)) {
    const fragment = schemaKeys(spreadModule(file, name, text), [...ancestors, file]);
    for (const [key, required] of fragment) keys.set(key, required);
  }
  return keys;
}

describe("ENVIRONMENT_VARIABLES.md", () => {
  it("names every key the API's and the workers' schemas require and every key a portal declares", () => {
    const page = readFileSync(path.join(ROOT, PAGE), "utf8");
    const problems = SCHEMAS.flatMap(({ file, scope }) => {
      const keys = [...schemaKeys(file)].filter(([, required]) => scope === "declared" || required);
      if (keys.length === 0) return [`${file}: yields no ${scope} key`];
      return keys.filter(([key]) => !page.includes(`\`${key}\``)).map(([key]) => `${file}: ${key}`);
    });
    expect(problems).toEqual([]);
  });
});
