#!/usr/bin/env tsx
/**
 * @file cacheConfig.tenant-isolation.test.ts
 * @description RED→GREEN tests for CACHE-XTENANT-HTTP (CWE-639). Proves the
 *   response cache key for a tenant-scoped route includes the VERIFIED tenant
 *   (accountId) so tenant B can never collide on tenant A's cached body, and
 *   that genuinely tenant-neutral routes (provider/RBAC catalogs) stay shared.
 * @layer infrastructure
 */

import { describe, it, expect } from "vitest";
import {
  generateApiCacheKey,
  isTenantScopedRoute,
  CACHE_CONFIG,
} from "../../src/lib/cache/cacheConfig.js";

describe("CACHE-XTENANT-HTTP — tenant-scoped cache key composition", () => {
  it("includes the verified accountId in the key for a tenant-scoped route", () => {
    const key = generateApiCacheKey(
      "GET",
      "/posts",
      {},
      { projectId: "proj-1" },
      {},
      undefined,
      "acct-A"
    );
    expect(key.includes("acct=acct-A")).toBe(true);
  });

  it("produces DIFFERENT keys for two tenants on identical route+params", () => {
    const keyA = generateApiCacheKey(
      "GET",
      "/posts",
      {},
      { projectId: "proj-1", status: "published" },
      {},
      undefined,
      "acct-A"
    );
    const keyB = generateApiCacheKey(
      "GET",
      "/posts",
      {},
      { projectId: "proj-1", status: "published" },
      {},
      undefined,
      "acct-B"
    );
    expect(keyA).not.toBe(keyB);
  });

  it("produces the SAME key for the same tenant on identical route+params", () => {
    const key1 = generateApiCacheKey(
      "GET",
      "/posts/:id",
      { id: "p-9" },
      {},
      {},
      undefined,
      "acct-A"
    );
    const key2 = generateApiCacheKey(
      "GET",
      "/posts/:id",
      { id: "p-9" },
      {},
      {},
      undefined,
      "acct-A"
    );
    expect(key1).toBe(key2);
  });

  it("isolates GET /posts/:id across tenants even with identical :id", () => {
    const keyA = generateApiCacheKey(
      "GET",
      "/posts/:id",
      { id: "p-9" },
      {},
      {},
      undefined,
      "acct-A"
    );
    const keyB = generateApiCacheKey(
      "GET",
      "/posts/:id",
      { id: "p-9" },
      {},
      {},
      undefined,
      "acct-B"
    );
    expect(keyA).not.toBe(keyB);
  });

  it("isolates GET /analytics/dashboard across tenants with identical query", () => {
    const keyA = generateApiCacheKey(
      "GET",
      "/analytics/dashboard",
      {},
      { projectId: "proj-1", timeRange: "7d" },
      {},
      undefined,
      "acct-A"
    );
    const keyB = generateApiCacheKey(
      "GET",
      "/analytics/dashboard",
      {},
      { projectId: "proj-1", timeRange: "7d" },
      {},
      undefined,
      "acct-B"
    );
    expect(keyA).not.toBe(keyB);
  });

  it("does NOT inject an acct= segment when accountId is absent (fail-safe key)", () => {
    const key = generateApiCacheKey("GET", "/posts", {}, { projectId: "proj-1" }, {});
    expect(key.includes("acct=")).toBe(false);
  });
});

describe("CACHE-XTENANT-HTTP — tenant scoping classification", () => {
  it("treats data routes as tenant-scoped by default", () => {
    expect(isTenantScopedRoute("GET", "/posts")).toBe(true);
    expect(isTenantScopedRoute("GET", "/posts/:id")).toBe(true);
    expect(isTenantScopedRoute("GET", "/analytics/dashboard")).toBe(true);
    expect(isTenantScopedRoute("GET", "/templates")).toBe(true);
    expect(isTenantScopedRoute("GET", "/channels")).toBe(true);
    expect(isTenantScopedRoute("GET", "/projects")).toBe(true);
  });

  it("treats the provider catalog as tenant-neutral (shared, global data)", () => {
    expect(isTenantScopedRoute("GET", "/providers")).toBe(false);
    expect(isTenantScopedRoute("GET", "/providers/:id")).toBe(false);
    expect(isTenantScopedRoute("GET", "/providers/health/all")).toBe(false);
  });

  it("treats the RBAC catalog as tenant-neutral (shared, global data)", () => {
    expect(isTenantScopedRoute("GET", "/rbac/roles")).toBe(false);
    expect(isTenantScopedRoute("GET", "/rbac/permissions")).toBe(false);
  });

  it("marks every tenant-neutral config entry explicitly (no accidental defaults)", () => {
    const neutral = Object.entries(CACHE_CONFIG).filter(([, c]) => c.tenantScoped === false);
    // Provider catalog (5) + RBAC catalog (2) = 7 explicitly-neutral entries.
    expect(neutral.length).toBe(7);
  });
});
