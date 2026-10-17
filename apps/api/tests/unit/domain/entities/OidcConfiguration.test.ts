/**
 * @file OidcConfiguration.test.ts
 * @description Tests for the OIDC configuration domain entity, focused on
 *              the replaceClientSecret mutation invariants.
 * @layer infrastructure
 */

import { afterEach, describe, it, vi } from "vitest";
import assert from "node:assert/strict";
import { fixedClock } from "@packages/vitest-shared/determinism";
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
    createdAt: fixedClock(),
    updatedAt: fixedClock(),
  });
}

describe("OidcConfiguration.replaceClientSecret", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("replaces the secret + bumps updatedAt", () => {
    const entity = makeEntity();
    // The replacement happens 5 ms after the stored stamp on a pinned clock, so the bump is
    // the exact instant the clock reads rather than whatever the real clock had reached.
    const replacedAt = new Date(fixedClock().getTime() + 5);
    vi.useFakeTimers({ now: replacedAt, toFake: ["Date"] });
    const result = entity.replaceClientSecret("brand-new-secret");
    assert.ok(result.ok);
    assert.equal(entity.clientSecret, "brand-new-secret");
    assert.deepEqual(entity.updatedAt, replacedAt);
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
