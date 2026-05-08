/**
 * @file entities.oidcConfiguration.test.ts
 * @description Unit tests for the OidcConfiguration domain entity.
 *              Covers factory validation, reconstitute, and toJSON serialization.
 * @layer infrastructure
 */

import { describe, it, beforeEach, vi } from "vitest";
import assert from "node:assert/strict";
import {
  OidcConfiguration,
  type CreateOidcConfigurationInput,
} from "../../../src/domain/entities/OidcConfiguration.js";

function makeValidInput(
  overrides: Partial<CreateOidcConfigurationInput> = {}
): CreateOidcConfigurationInput {
  return {
    id: "oidc-config-001",
    accountId: "account-001",
    issuerUrl: "https://accounts.google.com",
    clientId: "client-id-12345",
    clientSecret: "super-secret-value-that-should-be-masked",
    attributeMapping: {
      email: "email",
      firstName: "given_name",
    },
    ...overrides,
  };
}

describe("OidcConfiguration entity", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("create", () => {
    it("creates a valid OidcConfiguration with all required fields", () => {
      const result = OidcConfiguration.create(makeValidInput());
      assert.ok(result.ok, "should succeed");
      assert.equal(result.value.id, "oidc-config-001");
      assert.equal(result.value.accountId, "account-001");
      assert.equal(result.value.issuerUrl, "https://accounts.google.com");
      assert.equal(result.value.clientId, "client-id-12345");
      assert.equal(result.value.clientSecret, "super-secret-value-that-should-be-masked");
      assert.equal(result.value.isActive, true);
    });

    it("sets default scopes when not provided", () => {
      const result = OidcConfiguration.create(makeValidInput());
      assert.ok(result.ok);
      assert.deepEqual(result.value.scopes, ["openid", "email", "profile"]);
    });

    it("uses custom scopes when provided", () => {
      const result = OidcConfiguration.create(makeValidInput({ scopes: ["openid", "email"] }));
      assert.ok(result.ok);
      assert.deepEqual(result.value.scopes, ["openid", "email"]);
    });

    it("rejects issuerUrl that does not start with https://", () => {
      const result = OidcConfiguration.create(
        makeValidInput({ issuerUrl: "http://accounts.google.com" })
      );
      assert.ok(!result.ok, "should fail");
      assert.ok(result.error.message.includes("https://"));
    });

    it("rejects empty issuerUrl", () => {
      const result = OidcConfiguration.create(makeValidInput({ issuerUrl: "" }));
      assert.ok(!result.ok, "should fail for empty URL");
    });

    it("rejects empty clientId", () => {
      const result = OidcConfiguration.create(makeValidInput({ clientId: "" }));
      assert.ok(!result.ok, "should fail for empty clientId");
      assert.ok(result.error.message.includes("Client ID"));
    });

    it("rejects whitespace-only clientId", () => {
      const result = OidcConfiguration.create(makeValidInput({ clientId: "   " }));
      assert.ok(!result.ok, "should fail for whitespace-only clientId");
    });

    it("rejects empty clientSecret", () => {
      const result = OidcConfiguration.create(makeValidInput({ clientSecret: "" }));
      assert.ok(!result.ok, "should fail for empty clientSecret");
      assert.ok(result.error.message.includes("Client secret"));
    });

    it("rejects whitespace-only clientSecret", () => {
      const result = OidcConfiguration.create(makeValidInput({ clientSecret: "   " }));
      assert.ok(!result.ok, "should fail for whitespace-only clientSecret");
    });

    it("rejects attributeMapping without email key", () => {
      const result = OidcConfiguration.create(
        makeValidInput({
          attributeMapping: { firstName: "given_name" } as unknown as { email: string },
        })
      );
      assert.ok(!result.ok, "should fail without email in mapping");
      assert.ok(result.error.message.includes("email"));
    });

    it("rejects attributeMapping with empty email value", () => {
      const result = OidcConfiguration.create(
        makeValidInput({
          attributeMapping: { email: "" },
        })
      );
      assert.ok(!result.ok, "should fail with empty email mapping value");
    });

    it("rejects null attributeMapping", () => {
      const result = OidcConfiguration.create(
        makeValidInput({
          attributeMapping: null as unknown as { email: string },
        })
      );
      assert.ok(!result.ok, "should fail with null mapping");
    });

    it("sets createdAt and updatedAt", () => {
      const before = new Date();
      const result = OidcConfiguration.create(makeValidInput());
      assert.ok(result.ok);
      assert.ok(result.value.createdAt >= before);
      assert.ok(result.value.updatedAt >= before);
    });
  });

  describe("reconstitute", () => {
    it("recreates entity from persisted props without validation", () => {
      const now = new Date();
      const entity = OidcConfiguration.reconstitute({
        id: "existing-id",
        accountId: "acct-999",
        issuerUrl: "https://idp.corp.com",
        clientId: "client-abc",
        clientSecret: "secret-xyz",
        scopes: ["openid"],
        attributeMapping: { email: "mail" },
        isActive: false,
        createdAt: now,
        updatedAt: now,
      });

      assert.equal(entity.id, "existing-id");
      assert.equal(entity.accountId, "acct-999");
      assert.equal(entity.isActive, false);
      assert.equal(entity.clientId, "client-abc");
    });
  });

  describe("toJSON", () => {
    it("returns correct shape with masked clientSecret", () => {
      const result = OidcConfiguration.create(makeValidInput());
      assert.ok(result.ok);

      const json = result.value.toJSON();
      assert.equal(json.id, "oidc-config-001");
      assert.equal(json.accountId, "account-001");
      assert.equal(json.issuerUrl, "https://accounts.google.com");
      assert.equal(json.clientId, "client-id-12345");
      assert.equal(json.clientSecret, "***MASKED***");
      assert.equal(json.isActive, true);
      assert.ok(typeof json.createdAt === "string");
      assert.ok(typeof json.updatedAt === "string");
    });

    it("includes scopes and attributeMapping in output", () => {
      const result = OidcConfiguration.create(makeValidInput());
      assert.ok(result.ok);

      const json = result.value.toJSON();
      const scopes = json.scopes as string[];
      assert.ok(Array.isArray(scopes), "should have scopes array");
      assert.ok(scopes.includes("openid"), "should include openid scope");

      const mapping = json.attributeMapping as Record<string, string>;
      assert.ok(mapping.email, "should have email in mapping");
    });
  });

  describe("getters return defensive copies", () => {
    it("createdAt returns a new Date instance", () => {
      const result = OidcConfiguration.create(makeValidInput());
      assert.ok(result.ok);
      const d1 = result.value.createdAt;
      const d2 = result.value.createdAt;
      assert.notEqual(d1, d2, "should return different Date instances");
      assert.equal(d1.getTime(), d2.getTime(), "but same time value");
    });

    it("updatedAt returns a new Date instance", () => {
      const result = OidcConfiguration.create(makeValidInput());
      assert.ok(result.ok);
      const d1 = result.value.updatedAt;
      const d2 = result.value.updatedAt;
      assert.notEqual(d1, d2, "should return different Date instances");
      assert.equal(d1.getTime(), d2.getTime(), "but same time value");
    });

    it("attributeMapping returns a copy", () => {
      const result = OidcConfiguration.create(makeValidInput());
      assert.ok(result.ok);
      const m1 = result.value.attributeMapping;
      const m2 = result.value.attributeMapping;
      assert.notEqual(m1, m2, "should return different object instances");
      assert.deepEqual(m1, m2, "but same values");
    });

    it("scopes returns a copy", () => {
      const result = OidcConfiguration.create(makeValidInput());
      assert.ok(result.ok);
      const s1 = result.value.scopes;
      const s2 = result.value.scopes;
      assert.notEqual(s1, s2, "should return different array instances");
      assert.deepEqual(s1, s2, "but same values");
    });
  });
});
