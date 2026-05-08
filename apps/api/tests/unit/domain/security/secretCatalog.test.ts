/**
 * @file secretCatalog.test.ts
 * @description Tests for the secret catalog: completeness, category mapping,
 *              and uniqueness invariants.
 * @layer infrastructure
 */

import { describe, it } from "vitest";
import assert from "node:assert/strict";
import {
  SECRET_CATEGORIES,
  SECRET_CATEGORY_VALUES,
  SECRETS_CATALOG,
  type SecretCategory,
} from "../../../../src/domain/security/secretCatalog.js";

describe("SECRETS_CATALOG", () => {
  it("contains 29 entries (every secret listed in SECRETS.md §3-§5)", () => {
    assert.equal(SECRETS_CATALOG.length, 29);
  });

  it("has unique secret names — no duplicates", () => {
    const names = SECRETS_CATALOG.map((e) => e.name);
    const unique = new Set(names);
    assert.equal(unique.size, names.length, "duplicate secret name detected in catalog");
  });

  it("every entry maps to a known SecretCategory", () => {
    const known = new Set<SecretCategory>(SECRET_CATEGORY_VALUES);
    for (const entry of SECRETS_CATALOG) {
      assert.ok(known.has(entry.category), `unknown category for ${entry.name}: ${entry.category}`);
    }
  });

  it("every entry has a non-empty description", () => {
    for (const entry of SECRETS_CATALOG) {
      assert.ok(entry.description.length > 0, `empty description for ${entry.name}`);
    }
  });

  it("includes both master keys (KEKs)", () => {
    const keks = SECRETS_CATALOG.filter((e) => e.category === "KEK").map((e) => e.name);
    assert.deepEqual(keks.sort(), ["OAUTH_ENCRYPTION_KEY", "PLATFORM_ENCRYPTION_KEY"]);
  });

  it("includes all 8 OAuth provider client secrets", () => {
    const oauth = SECRETS_CATALOG.filter((e) => e.category === "OAUTH_PROVIDER");
    assert.equal(oauth.length, 8);
  });

  it("includes all 6 JWT/cookie signing secrets", () => {
    const jwt = SECRETS_CATALOG.filter((e) => e.category === "JWT");
    assert.equal(jwt.length, 6);
  });
});

describe("SECRET_CATEGORIES", () => {
  it("defines a rule for every category value", () => {
    for (const cat of SECRET_CATEGORY_VALUES) {
      assert.ok(SECRET_CATEGORIES[cat], `missing rule for category ${cat}`);
    }
  });

  it("every category has cadenceDays > 0", () => {
    for (const cat of SECRET_CATEGORY_VALUES) {
      assert.ok(SECRET_CATEGORIES[cat].cadenceDays > 0, `non-positive cadence for ${cat}`);
    }
  });

  it("JWT cadence is 90 days (NIST)", () => {
    assert.equal(SECRET_CATEGORIES.JWT.cadenceDays, 90);
  });

  it("KEK cadence is 365 days (NIST)", () => {
    assert.equal(SECRET_CATEGORIES.KEK.cadenceDays, 365);
  });

  it("every category has a non-empty description", () => {
    for (const cat of SECRET_CATEGORY_VALUES) {
      assert.ok(SECRET_CATEGORIES[cat].description.length > 0);
    }
  });
});
