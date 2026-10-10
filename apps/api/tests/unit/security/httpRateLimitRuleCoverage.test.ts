/**
 * @file httpRateLimitRuleCoverage.test.ts
 * @description Holds the HTTP rate-limit rule tables to the routes the API
 *              registers: every rule selects at least one registered route
 *              pattern, and no rule loses every pattern it selects to an earlier
 *              rule. A rule that fails either check caps nothing while it reads
 *              as protection.
 *
 *              The route table is the committed OpenAPI projection of
 *              `createApp()` (`packages/shared/src/api-generated/types.gen.ts`),
 *              which the API-types drift gate in CI regenerates from the booted
 *              app and compares with the committed copy. Booting the app here
 *              is not hermetic: building it opens Redis connections and
 *              schedules a database probe. The projection omits the routes the
 *              OpenAPI spec hides (the API reference under `/docs` and the
 *              `OPTIONS *` route), so a rule that names only such a route reads
 *              as dead here, which fails toward red.
 * @layer infrastructure
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";
import { findMonorepoRoot } from "@packages/vitest-shared";
import {
  EXPENSIVE_ENDPOINT_RULES,
  RateLimitConfigs,
  STANDARD_ROUTE_RULES,
  selectHttpRateLimitRule,
  type HttpRateLimitRule,
} from "../../../src/security/httpRateLimitPreHandler.js";

/** The rules in the order `createApp()` hands them to the preHandler. */
const RULES: readonly HttpRateLimitRule[] = [...STANDARD_ROUTE_RULES, ...EXPENSIVE_ENDPOINT_RULES];

const GENERATED_API_TYPES = path.join(
  findMonorepoRoot(path.dirname(fileURLToPath(import.meta.url))),
  "packages/shared/src/api-generated/types.gen.ts"
);

/**
 * @function readUrlDeclarations
 * @description Reads every operation's `url` from the generated API types, and
 *   counts every line that declares a `url` in any shape, so a change in the
 *   generator's output shows up as a parsed count below the declared one rather
 *   than as a shorter route table that makes live rules read as dead.
 * @returns The parsed `url` values and the number of `url` declarations.
 */
function readUrlDeclarations(): { readonly parsed: readonly string[]; readonly declared: number } {
  const source = readFileSync(GENERATED_API_TYPES, "utf8");
  const parsed = [...source.matchAll(/^\s*url: "([^"]+)";$/gm)].map((match) => match[1] ?? "");
  return { parsed, declared: source.match(/^\s*url\b/gm)?.length ?? 0 };
}

const URLS = readUrlDeclarations();

/**
 * Each OpenAPI `{name}` parameter rewritten to the `:name` form Fastify reports in
 * `req.routeOptions.url`, which is the string the rules are matched against.
 */
const ROUTES: readonly string[] = [
  ...new Set(URLS.parsed.map((url) => url.replace(/\{(\w+)\}/g, ":$1"))),
].sort();

function label(rule: HttpRateLimitRule): string {
  const preset = Object.entries(RateLimitConfigs).find(([, config]) => config === rule.config);
  return `#${RULES.indexOf(rule)} ${rule.path} ${preset?.[0] ?? "unnamed preset"}`;
}

function routesSelectedBy(rule: HttpRateLimitRule): readonly string[] {
  return ROUTES.filter((route) => selectHttpRateLimitRule(route, [rule]) === rule);
}

/** The earlier rules that take every route `rule` selects; empty when it governs one, or selects none. */
function rulesShadowing(rule: HttpRateLimitRule): readonly string[] {
  const selected = routesSelectedBy(rule);
  if (selected.some((route) => selectHttpRateLimitRule(route, RULES) === rule)) return [];
  const winners = selected.map((route) => selectHttpRateLimitRule(route, RULES));
  return [...new Set(winners.map((winner) => (winner === undefined ? "none" : label(winner))))];
}

const CASES: ReadonlyArray<[string, HttpRateLimitRule]> = RULES.map((rule) => [label(rule), rule]);

describe("HTTP rate-limit rules against the registered routes", () => {
  it("returns a non-empty table of route patterns from the generated API types", () => {
    expect(URLS.parsed).toHaveLength(URLS.declared);
    expect(ROUTES.length).toBeGreaterThan(0);
    expect(ROUTES.filter((route) => !route.startsWith("/"))).toEqual([]);
  });

  it.each(CASES)("returns at least one registered route selected by rule %s", (_label, rule) => {
    expect(routesSelectedBy(rule)).not.toEqual([]);
  });

  it.each(CASES)(
    "returns no earlier rule taking every route selected by rule %s",
    (_label, rule) => {
      expect(rulesShadowing(rule)).toEqual([]);
    }
  );
});
