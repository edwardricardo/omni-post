/**
 * @file cacheRouteCoverage.ts
 * @description Structural guards over `cacheConfig.ts`, run at boot. The first proves
 *              every cache rule key is spelled the way a route is actually REGISTERED. A
 *              rule keyed to a pattern no route registers is silently inert —
 *              `getInvalidationTags` returns `[]`, nothing invalidates, and the tree, the
 *              tests and the review all read as if the rule were doing its job. The second
 *              proves every cached GET response is keyed by its caller unless its route is
 *              public: a HIT is sent after the route's hooks but before its handler, so a
 *              key that leaves the caller out serves one caller's response to every other
 *              caller the hooks admit, another tenant included, and the handler's
 *              ownership check never sees them (CWE-639).
 * @layer infrastructure
 */

import {
  CACHE_CONFIG,
  CACHE_INVALIDATION_RULES,
  PRINCIPAL_VARY_PARAM,
  type RouteCacheOptions,
} from "./cacheConfig.js";

/**
 * A route as Fastify registered it: the method plus the prefixed path pattern, and
 * whether one of its own hooks authenticates the caller.
 */
export interface RegisteredRoute {
  readonly method: string;
  readonly url: string;
  /**
   * True when a route-level `onRequest`, `preParsing`, `preValidation` or
   * `preHandler` hook of this route is one of the API's authenticating hooks.
   * A hook added to an encapsulated plugin with `addHook` is not visible here,
   * which is why a cached rule without the caller in its key must also declare
   * itself public: the declaration is checked against what is visible, and the
   * absence of a declaration fails closed. A false declaration on a route that
   * authenticates through such a hook is caught by the anonymous-call case of
   * `apps/api/tests/integration/cacheHitBeforeAuth.integration.test.ts`, which
   * sends every public rule's route without credentials through the real app and
   * fails on a 401 or 403.
   */
  readonly authenticated: boolean;
}

/** Which of the two cache maps a key belongs to (named in the failure message). */
type CacheRuleMapName = "CACHE_CONFIG" | "CACHE_INVALIDATION_RULES";

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
 * cache on a tenant-scoped resource — the CWE-639 leak documented above
 * `CACHE_CONFIG`. Reviving any of them means adding the authorization
 * discriminator FIRST, and `assertCachedResponsesVaryByPrincipal` below refuses
 * the boot of an app that registers one of them without it.
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

/**
 * @method cacheRuleKeysByMap
 * @description Lists the keys of the real cache maps, each tagged with its map, for the
 *   boot-time route-coverage assertion.
 * @returns The keys of `CACHE_CONFIG` and of `CACHE_INVALIDATION_RULES`
 */
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
function formatCacheRouteViolations(violations: readonly CacheRouteViolation[]): string {
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

/**
 * A cached GET rule whose response can reach a caller its route would refuse.
 *
 * - `unvaried-authenticated` — the route carries an authenticating hook and the
 *   rule's key does not name the caller. `declaredPublic` says whether the rule
 *   also claims the route is public, a claim the hook refutes.
 * - `undeclared-public` — the rule's key does not name the caller and the rule
 *   does not declare its route public. The route may authenticate through a hook
 *   this guard cannot see, so silence is refused rather than read as public.
 */
export type CachePrincipalViolation =
  | {
      readonly kind: "unvaried-authenticated";
      readonly key: string;
      readonly declaredPublic: boolean;
    }
  | { readonly kind: "undeclared-public"; readonly key: string };

/** Input of the principal guard: the routes this app registered and the rule table. */
export interface CachePrincipalInput {
  readonly registered: Iterable<RegisteredRoute>;
  readonly rules: Readonly<Record<string, RouteCacheOptions>>;
}

/**
 * @method findCachePrincipalViolations
 * @description Checks every enabled GET rule whose route this app registers: its key
 *   must name the caller through `PRINCIPAL_VARY_PARAM`, or the rule must declare its
 *   route public and the route must carry no authenticating hook. A rule whose route
 *   is not registered caches nothing here, and the route-coverage guard owns it.
 * @param input - The registered routes, each with its authentication flag, and the rule table
 * @returns Every violation found, in rule-table order (empty when every cached response is keyed safely)
 */
export function findCachePrincipalViolations(
  input: CachePrincipalInput
): CachePrincipalViolation[] {
  const authenticatedByKey = new Map<string, boolean>();
  for (const route of input.registered) {
    const key = `${route.method.toUpperCase()}:${route.url}`;
    authenticatedByKey.set(key, (authenticatedByKey.get(key) ?? false) || route.authenticated);
  }

  const violations: CachePrincipalViolation[] = [];

  for (const [key, rule] of Object.entries(input.rules)) {
    const parts = splitKey(key);
    if (!parts || parts.method.toUpperCase() !== "GET" || rule.enabled !== true) {
      continue;
    }

    const authenticated = authenticatedByKey.get(`GET:${parts.path}`);
    if (authenticated === undefined) {
      continue;
    }

    if (rule.varyBy?.includes(PRINCIPAL_VARY_PARAM) === true) {
      continue;
    }

    const declaredPublic = rule.public === true;
    if (authenticated) {
      violations.push({ kind: "unvaried-authenticated", key, declaredPublic });
    } else if (!declaredPublic) {
      violations.push({ kind: "undeclared-public", key });
    }
  }

  return violations;
}

/** Render principal violations into a failure message that names the fix. */
function formatCachePrincipalViolations(violations: readonly CachePrincipalViolation[]): string {
  const lines = violations.map((violation) => {
    switch (violation.kind) {
      case "unvaried-authenticated":
        return (
          `  [unvaried-authenticated] CACHE_CONFIG key "${violation.key}" caches a route that ` +
          `carries an authenticating hook${violation.declaredPublic ? ", though it declares `public: true`," : ""} ` +
          `and its varyBy has no "${PRINCIPAL_VARY_PARAM}". A HIT is sent before the route's ` +
          `handler runs, so one caller's response reaches every other caller the route admits ` +
          `(CWE-639): add "${PRINCIPAL_VARY_PARAM}" to its varyBy.`
        );
      case "undeclared-public":
        return (
          `  [undeclared-public] CACHE_CONFIG key "${violation.key}" caches a route without ` +
          `"${PRINCIPAL_VARY_PARAM}" in its varyBy and does not declare \`public: true\`. Add ` +
          `"${PRINCIPAL_VARY_PARAM}", or declare the route public once it serves the same ` +
          `response to every caller.`
        );
    }
  });

  return (
    `Cached GET responses are not keyed by their caller (${violations.length}):\n` +
    `${lines.join("\n")}\n` +
    `See apps/api/src/lib/cache/cacheRouteCoverage.ts.`
  );
}

/**
 * @method assertCachedResponsesVaryByPrincipal
 * @description Throws when a cached GET response of a registered route could be served
 *   to a caller the route would refuse.
 * @param input - Same shape as `findCachePrincipalViolations`
 * @returns Nothing; throws with every violation named when a cached response is not keyed by its caller
 */
export function assertCachedResponsesVaryByPrincipal(input: CachePrincipalInput): void {
  const violations = findCachePrincipalViolations(input);
  if (violations.length > 0) {
    throw new Error(formatCachePrincipalViolations(violations));
  }
}
