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
 *   spread that resolves to no module and a page that cannot be read each fail the case.
 * @layer infrastructure
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { findMonorepoRoot } from "@packages/vitest-shared";
import { describe, expect, it } from "vitest";

const ROOT = findMonorepoRoot(path.dirname(fileURLToPath(import.meta.url)));
const PAGE = "docs/deployment/ENVIRONMENT_VARIABLES.md";
const SCHEMAS = [
  { file: "apps/api/src/config/env.ts", scope: "required" },
  { file: "apps/workers/src/config/env.ts", scope: "required" },
  { file: "apps/admin/lib/env.ts", scope: "declared" },
  { file: "apps/client/lib/env.ts", scope: "declared" },
] as const;

/** Every key a schema module declares, mapped to whether it is required; spreads are followed. */
function schemaKeys(file: string): Map<string, boolean> {
  const text = readFileSync(path.join(ROOT, file), "utf8").replace(
    /\/\*[\s\S]*?\*\/|^\s*\/\/.*$/gm,
    ""
  );
  const keys = new Map<string, boolean>();
  // An entry runs to the next entry, spread or the end, so a chain over several lines is read whole.
  const entry = /^\s+([A-Z][A-Z0-9_]*):([\s\S]*?)(?=^\s+(?:[A-Z][A-Z0-9_]*:|\.\.\.)|(?![\s\S]))/gm;
  for (const [, key = "", body = ""] of text.matchAll(entry)) {
    if (!body.trim().startsWith("process.env")) keys.set(key, !/\.(optional|default)\(/.test(body));
  }
  for (const [, name = ""] of text.matchAll(/^\s+\.\.\.(\w+)\(/gm)) {
    const specifier = new RegExp(`\\b${name}\\b[^;]*from "([^"]+)"`).exec(text)?.[1] ?? "";
    const { paths } = (
      JSON.parse(readFileSync(path.join(ROOT, "tsconfig.base.json"), "utf8")) as {
        compilerOptions: { paths: Record<string, string[]> };
      }
    ).compilerOptions;
    const alias = Object.keys(paths).find(
      (a) => a.endsWith("/*") && specifier.startsWith(a.slice(0, -1))
    );
    const target = alias === undefined ? undefined : paths[alias]?.[0];
    if (alias === undefined || target === undefined)
      throw new Error(`${file}: ${name} resolves to no module`);
    const module = target.replace("*", specifier.slice(alias.length - 1)).replace(/\.js$/, ".ts");
    for (const [key, required] of schemaKeys(module)) keys.set(key, required);
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
