/**
 * @file entities.samlConfiguration.test.ts
 * @description Unit tests for the SamlConfiguration domain entity.
 *              Covers factory validation, reconstitute, and toJSON serialization.
 * @layer infrastructure
 */

import { describe, it, beforeEach, vi } from "vitest";
import assert from "node:assert/strict";
import {
  SamlConfiguration,
  type CreateSamlConfigurationInput,
} from "@core/domain/entities/SamlConfiguration.js";

function makeValidInput(
  overrides: Partial<CreateSamlConfigurationInput> = {}
): CreateSamlConfigurationInput {
  return {
    id: "saml-config-001",
    accountId: "account-001",
    entityId: "https://omnipost.app/saml/account-001",
    idpEntityId: "https://idp.example.com/entity",
    idpSsoUrl: "https://idp.example.com/sso/login",
    idpCertificate: "MIICmTCCAgKgAwIBAgIBADANBgkqhkiG9w0BAQsFADB9example-cert-data-long-enough",
    attributeMapping: {
      email: "http://schemas.xmlsoap.org/ws/2005/05/identity/claims/emailaddress",
      firstName: "http://schemas.xmlsoap.org/ws/2005/05/identity/claims/givenname",
    },
    ...overrides,
  };
}

describe("SamlConfiguration entity", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("create", () => {
    it("creates a valid SamlConfiguration with all required fields", () => {
      const result = SamlConfiguration.create(makeValidInput());
      assert.ok(result.ok, "should succeed");
      assert.equal(result.value.id, "saml-config-001");
      assert.equal(result.value.accountId, "account-001");
      assert.equal(result.value.entityId, "https://omnipost.app/saml/account-001");
      assert.equal(result.value.idpEntityId, "https://idp.example.com/entity");
      assert.equal(result.value.idpSsoUrl, "https://idp.example.com/sso/login");
      assert.equal(result.value.isActive, true);
    });

    it("rejects idpSsoUrl that does not start with https://", () => {
      const result = SamlConfiguration.create(
        makeValidInput({ idpSsoUrl: "http://idp.example.com/sso" })
      );
      assert.ok(!result.ok, "should fail");
      assert.ok(result.error.message.includes("https://"));
    });

    it("rejects empty idpSsoUrl", () => {
      const result = SamlConfiguration.create(makeValidInput({ idpSsoUrl: "" }));
      assert.ok(!result.ok, "should fail for empty URL");
    });

    it("rejects empty idpCertificate", () => {
      const result = SamlConfiguration.create(makeValidInput({ idpCertificate: "" }));
      assert.ok(!result.ok, "should fail for empty certificate");
      assert.ok(result.error.message.includes("certificate"));
    });

    it("rejects whitespace-only idpCertificate", () => {
      const result = SamlConfiguration.create(makeValidInput({ idpCertificate: "   " }));
      assert.ok(!result.ok, "should fail for whitespace-only certificate");
    });

    it("rejects attributeMapping without email key", () => {
      const result = SamlConfiguration.create(
        makeValidInput({
          attributeMapping: { firstName: "givenname" } as unknown as { email: string },
        })
      );
      assert.ok(!result.ok, "should fail without email in mapping");
      assert.ok(result.error.message.includes("email"));
    });

    it("rejects attributeMapping with empty email value", () => {
      const result = SamlConfiguration.create(
        makeValidInput({
          attributeMapping: { email: "" },
        })
      );
      assert.ok(!result.ok, "should fail with empty email mapping value");
    });

    it("rejects null attributeMapping", () => {
      const result = SamlConfiguration.create(
        makeValidInput({
          attributeMapping: null as unknown as { email: string },
        })
      );
      assert.ok(!result.ok, "should fail with null mapping");
    });

    it("sets createdAt and updatedAt", () => {
      const before = new Date();
      const result = SamlConfiguration.create(makeValidInput());
      assert.ok(result.ok);
      assert.ok(result.value.createdAt >= before);
      assert.ok(result.value.updatedAt >= before);
    });
  });

  describe("reconstitute", () => {
    it("recreates entity from persisted props without validation", () => {
      const now = new Date();
      const entity = SamlConfiguration.reconstitute({
        id: "existing-id",
        accountId: "acct-999",
        entityId: "https://omnipost.app/saml/acct-999",
        idpEntityId: "https://idp.corp.com",
        idpSsoUrl: "https://idp.corp.com/sso",
        idpCertificate: "CERT_DATA",
        attributeMapping: { email: "mail" },
        isActive: false,
        createdAt: now,
        updatedAt: now,
      });

      assert.equal(entity.id, "existing-id");
      assert.equal(entity.accountId, "acct-999");
      assert.equal(entity.isActive, false);
    });
  });

  describe("toJSON", () => {
    it("returns correct shape with truncated certificate", () => {
      const result = SamlConfiguration.create(makeValidInput());
      assert.ok(result.ok);

      const json = result.value.toJSON();
      assert.equal(json.id, "saml-config-001");
      assert.equal(json.accountId, "account-001");
      assert.equal(json.idpEntityId, "https://idp.example.com/entity");
      assert.equal(json.isActive, true);
      assert.ok(typeof json.createdAt === "string");
      assert.ok(typeof json.updatedAt === "string");

      // Certificate should be truncated
      const cert = json.idpCertificate as string;
      assert.ok(cert.endsWith("...[TRUNCATED]"), "certificate should be truncated");
      assert.ok(cert.length < result.value.idpCertificate.length + 20);
    });

    it("includes attributeMapping in output", () => {
      const result = SamlConfiguration.create(makeValidInput());
      assert.ok(result.ok);

      const json = result.value.toJSON();
      const mapping = json.attributeMapping as Record<string, string>;
      assert.ok(mapping.email, "should have email in mapping");
    });
  });

  describe("getters return defensive copies", () => {
    it("createdAt returns a new Date instance", () => {
      const result = SamlConfiguration.create(makeValidInput());
      assert.ok(result.ok);
      const d1 = result.value.createdAt;
      const d2 = result.value.createdAt;
      assert.notEqual(d1, d2, "should return different Date instances");
      assert.equal(d1.getTime(), d2.getTime(), "but same time value");
    });

    it("attributeMapping returns a copy", () => {
      const result = SamlConfiguration.create(makeValidInput());
      assert.ok(result.ok);
      const m1 = result.value.attributeMapping;
      const m2 = result.value.attributeMapping;
      assert.notEqual(m1, m2, "should return different object instances");
      assert.deepEqual(m1, m2, "but same values");
    });
  });
});
