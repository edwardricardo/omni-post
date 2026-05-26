/**
 * @file OidcConfiguration.test.ts
 * @description Tests for the OIDC configuration domain entity, focused on
 *              the replaceClientSecret mutation invariants.
 * @layer infrastructure
 */

import { describe, it } from "vitest";
import assert from "node:assert/strict";
import { OidcConfiguration } from "@core/domain/entities/OidcConfiguration.js";

function makeEntity(): OidcConfiguration {
  return OidcConfiguration.reconstitute({
    id: "cfg-1",
    accountId: "acct-1",
    issuerUrl: "https://accounts.example.com",
    clientId: "client-abc",
    clientSecret: "old-secret",
    scopes: ["openid", "email", "profile"],
    attributeMapping: { email: "email" },
    isActive: true,
    createdAt: new Date("2026-01-01T00:00:00Z"),
    updatedAt: new Date("2026-01-01T00:00:00Z"),
  });
}

describe("OidcConfiguration.replaceClientSecret", () => {
  it("replaces the secret + bumps updatedAt", async () => {
    const entity = makeEntity();
    const before = entity.updatedAt.getTime();
    await new Promise((r) => setTimeout(r, 5));
    const result = entity.replaceClientSecret("brand-new-secret");
    assert.ok(result.ok);
    assert.equal(entity.clientSecret, "brand-new-secret");
    assert.ok(entity.updatedAt.getTime() > before);
  });

  it("rejects empty secret with InvalidValueError", () => {
    const entity = makeEntity();
    const result = entity.replaceClientSecret("");
    assert.ok(!result.ok);
    assert.equal(entity.clientSecret, "old-secret");
  });

  it("rejects whitespace-only secret with InvalidValueError", () => {
    const entity = makeEntity();
    const result = entity.replaceClientSecret("   ");
    assert.ok(!result.ok);
    assert.equal(entity.clientSecret, "old-secret");
  });

  it("toJSON keeps masking the new secret after replacement", () => {
    const entity = makeEntity();
    entity.replaceClientSecret("super-secret");
    const json = entity.toJSON();
    assert.equal(json.clientSecret, "***MASKED***");
    assert.ok(!JSON.stringify(json).includes("super-secret"));
  });
});
