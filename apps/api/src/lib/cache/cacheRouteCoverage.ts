/**
 * @file cacheRouteCoverage.ts
 * @description Structural guard over `cacheConfig.ts`: proves every cache rule key is
 *              spelled the way a route is actually REGISTERED. A rule keyed to a pattern
 *              no route registers is silently inert — `getInvalidationTags` returns `[]`,
 *              nothing invalidates, and the tree, the tests and the review all read as if
 *              the rule were doing its job.
 * @layer infrastructure
 */

import { CACHE_CONFIG, CACHE_INVALIDATION_RULES } from "./cacheConfig.js";

/** A route as Fastify registered it: the method plus the prefixed path pattern. */
export interface RegisteredRoute {
  readonly method: string;
  readonly url: string;
}

/** Which of the two cache maps a key belongs to (named in the failure message). */
export type CacheRuleMapName = "CACHE_CONFIG" | "CACHE_INVALIDATION_RULES";

/**
 * A rule key that does not describe a live route, or a baseline entry that no
 * longer describes a defect.
 *
 * - `param-rename` — a route of the SAME method and path shape is registered
 *   under different parameter names (`/projects/:id` vs `/projects/:projectId`).
 *   The colliding route is the proof, so this is decidable on any app.
 * - `orphan` — nothing of that shape is registered at all. Only decidable
 *   against the complete route surface.
 * - `stale-baseline` — an exemption whose defect is gone (the key is registered
 *   now) or that names a key no map declares. An exemption list that keeps
 *   entries after their reason expires silently excuses the NEXT defect written
 *   under the same name.
 */
export type CacheRouteViolation =
  | {
      readonly kind: "param-rename";
      readonly map: CacheRuleMapName;
      readonly key: string;
      readonly registered: readonly string[];
    }
  | { readonly kind: "orphan"; readonly map: CacheRuleMapName; readonly key: string }
  | {
      readonly kind: "stale-baseline";
      readonly map: CacheRuleMapName | "BASELINE";
      readonly key: string;
    };

/** The keys of one cache map, tagged with the map they came from. */
export interface CacheRuleKeySet {
  readonly map: CacheRuleMapName;
  readonly keys: readonly string[];
}

export interface CacheRouteCoverageInput {
  readonly registered: Iterable<RegisteredRoute>;
  readonly keysByMap: readonly CacheRuleKeySet[];
  readonly baseline: ReadonlySet<string>;
  /**
   * Whether the caller's route surface is COMPLETE. Only a complete surface can
   * tell "this rule is dead" from "this app simply does not mount that route",
   * so orphan and stale-baseline checking is opt-in. The composition root
   * (`createApp`) opts in; partial test apps do not. The `param-rename` check
   * runs either way — it needs a colliding route to fire, so it cannot produce
   * a false positive on a partial app.
   */
  readonly checkOrphans: boolean;
}

/**
 * Rule keys that match no registered route TODAY, each one a live gap where a
 * mutation leaves a cached response stale (or, in `CACHE_CONFIG`, a response
 * that is simply never cached). A shrink-only ratchet in the shape of fitness
 * #36's quarantine: entries may be removed as they are fixed and MUST NOT be
 * added — a new dead key fails the boot instead of joining this list.
 *
 * They are not fixed here because each one needs a decision this slice cannot
 * make. The `POST:/posts` family has no plain create-post route to rekey to
 * (the registered posts mutations are `/posts/batch/duplicate`,
 * `/posts/:postId/...`, `PATCH:/posts/:id`), so choosing a target is route
 * archaeology, not a rename. The `GET:` entries are a SECURITY precondition,
 * not a rename: `GET:/projects/:id` and `GET:/channels/:id` carry
 * `varyBy: ["id"]` with NO `header:authorization`, so rekeying them to the
 * registered `:projectId` / `:channelId` would ACTIVATE an account-agnostic
 * cache on a tenant-scoped resource — the CWE-639 leak documented at
 * `cacheConfig.ts` above `GET:/posts`. Reviving any of them means adding the
 * authorization discriminator FIRST.
 */
export const KNOWN_UNREGISTERED_CACHE_KEYS: ReadonlySet<string> = new Set([
  // Post mutations — no plain `POST:/posts` or `PUT:/posts/:id` route exists.
  "POST:/posts",
  "PUT:/posts/:id",
  // Template mutations — templates are project-scoped
  // (`/projects/:projectId/templates/...`); these flat keys match nothing.
  "POST:/templates",
  "PUT:/templates/:id",
  "DELETE:/templates/:id",
  // User mutations — no flat `/users` mutation routes are registered.
  "PUT:/users/:id",
  "DELETE:/users/:id",
  // RBAC mutations — no `/rbac/roles` or `/rbac/permissions` routes registered.
  "POST:/rbac/roles",
  "PUT:/rbac/roles/:id",
  "DELETE:/rbac/roles/:id",
  "POST:/rbac/permissions",
  "PUT:/rbac/permissions/:id",
  "DELETE:/rbac/permissions/:id",
  // MFA + analytics mutations — no route registered under these paths.
  "POST:/mfa/enable",
  "POST:/mfa/disable",
  "POST:/analytics/refresh",
  // GET configs that cache nothing today. The two `:id` entries additionally
  // carry the authorization-discriminator precondition described above.
  "GET:/templates",
  "GET:/templates/:id",
  "GET:/analytics/posts/:postId",
  "GET:/analytics/realtime",
  "GET:/users/me",
  "GET:/users/:id",
  "GET:/projects",
  "GET:/projects/:id",
  "GET:/channels",
  "GET:/channels/:id",
  "GET:/audit/logs",
  "GET:/mfa/status",
  "GET:/rbac/roles",
  "GET:/rbac/permissions",
]);

/** Split `"DELETE:/projects/:projectId"` into its method and path halves. */
function splitKey(key: string): { method: string; path: string } | null {
  const separator = key.indexOf(":");
  if (separator <= 0) {
    return null;
  }
  return { method: key.slice(0, separator), path: key.slice(separator + 1) };
}

/**
 * Collapse parameter NAMES out of a route key so two spellings of the same
 * endpoint compare equal: `DELETE:/projects/:id` and
 * `DELETE:/projects/:projectId` both become `DELETE:/projects/:*`.
 */
function shapeOf(method: string, path: string): string {
  return `${method.toUpperCase()}:${path.replace(/:[^/]+/g, ":*")}`;
}

/** The real cache maps, tagged for the boot-time assertion. */
export function cacheRuleKeysByMap(): readonly CacheRuleKeySet[] {
  return [
    { map: "CACHE_CONFIG", keys: Object.keys(CACHE_CONFIG) },
    { map: "CACHE_INVALIDATION_RULES", keys: Object.keys(CACHE_INVALIDATION_RULES) },
  ];
}

/**
 * @method findCacheRouteViolations
 * @description Compares every cache rule key against the routes actually registered.
 * @param input - Registered routes, the rule keys per map, the baseline, and whether the surface is complete
 * @returns Every violation found, in map-then-key order (empty when the config is sound)
 */
export function findCacheRouteViolations(input: CacheRouteCoverageInput): CacheRouteViolation[] {
  const exact = new Set<string>();
  const byShape = new Map<string, string[]>();

  for (const route of input.registered) {
    const key = `${route.method.toUpperCase()}:${route.url}`;
    exact.add(key);
    const shape = shapeOf(route.method, route.url);
    const bucket = byShape.get(shape);
    if (bucket) {
      bucket.push(key);
    } else {
      byShape.set(shape, [key]);
    }
  }

  const violations: CacheRouteViolation[] = [];
  const declared = new Set<string>();

  for (const { map, keys } of input.keysByMap) {
    for (const key of keys) {
      declared.add(key);
      const parts = splitKey(key);
      if (!parts) {
        continue;
      }

      const isRegistered = exact.has(`${parts.method.toUpperCase()}:${parts.path}`);

      if (isRegistered) {
        // A baselined key that is live again means the exemption outlived the
        // defect it excused; leaving it would silently cover the next one.
        if (input.checkOrphans && input.baseline.has(key)) {
          violations.push({ kind: "stale-baseline", map, key });
        }
        continue;
      }

      if (input.baseline.has(key)) {
        continue;
      }

      const collisions = byShape.get(shapeOf(parts.method, parts.path));
      if (collisions && collisions.length > 0) {
        violations.push({ kind: "param-rename", map, key, registered: [...collisions] });
      } else if (input.checkOrphans) {
        violations.push({ kind: "orphan", map, key });
      }
    }
  }

  if (input.checkOrphans) {
    for (const key of input.baseline) {
      if (!declared.has(key)) {
        violations.push({ kind: "stale-baseline", map: "BASELINE", key });
      }
    }
  }

  return violations;
}

/** Render violations into a failure message that names the fix, not just the fault. */
export function formatCacheRouteViolations(violations: readonly CacheRouteViolation[]): string {
  const lines = violations.map((violation) => {
    switch (violation.kind) {
      case "param-rename":
        return (
          `  [param-rename] ${violation.map} key "${violation.key}" matches no route, but ` +
          `${violation.registered.join(", ")} is registered with the same shape. The rule is ` +
          `INERT: rekey it to the registered spelling.`
        );
      case "orphan":
        return (
          `  [orphan] ${violation.map} key "${violation.key}" matches no registered route under ` +
          `any spelling. The rule is INERT: point it at a real route or delete it.`
        );
      case "stale-baseline":
        return (
          `  [stale-baseline] "${violation.key}" is exempted by KNOWN_UNREGISTERED_CACHE_KEYS but ` +
          `is no longer dead (or is no longer declared). Remove it from the baseline — a stale ` +
          `exemption silently covers the next defect written under the same key.`
        );
    }
  });

  return (
    `Cache rule keys do not match the registered routes (${violations.length}):\n` +
    `${lines.join("\n")}\n` +
    `See apps/api/src/lib/cache/cacheRouteCoverage.ts.`
  );
}

/**
 * @method assertCacheRoutesCovered
 * @description Throws when any cache rule key fails to describe a registered route.
 * @param input - Same shape as `findCacheRouteViolations`
 * @returns Nothing; throws with every violation named when the config is unsound
 */
export function assertCacheRoutesCovered(input: CacheRouteCoverageInput): void {
  const violations = findCacheRouteViolations(input);
  if (violations.length > 0) {
    throw new Error(formatCacheRouteViolations(violations));
  }
}
