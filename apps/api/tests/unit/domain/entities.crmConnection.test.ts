/**
 * @file entities.crmConnection.test.ts
 * @description Unit tests for CrmConnection domain entity.
 * @layer domain
 */

import { describe, it, expect } from "vitest";
import {
  CrmConnection,
  type CreateCrmConnectionInput,
} from "../../../src/domain/entities/CrmConnection.js";

const validInput: CreateCrmConnectionInput = {
  accountId: "acc-001",
  platform: "HUBSPOT",
  accessToken: "hs-token-abc123",
  refreshToken: "hs-refresh-xyz",
  tokenExpiresAt: new Date(Date.now() + 3600_000),
  portalId: "12345678",
};

describe("CrmConnection", () => {
  describe("create()", () => {
    it("creates with valid HUBSPOT input", () => {
      const result = CrmConnection.create(validInput);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.platform).toBe("HUBSPOT");
        expect(result.value.isActive).toBe(true);
        expect(result.value.syncContacts).toBe(true);
        expect(result.value.syncActivities).toBe(true);
        expect(result.value.accessToken).toBe("hs-token-abc123");
      }
    });

    it("creates with valid SALESFORCE input", () => {
      const result = CrmConnection.create({
        ...validInput,
        platform: "SALESFORCE",
        instanceUrl: "https://na1.salesforce.com",
      });
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.platform).toBe("SALESFORCE");
        expect(result.value.instanceUrl).toBe("https://na1.salesforce.com");
      }
    });

    it("rejects unsupported platform", () => {
      const result = CrmConnection.create({ ...validInput, platform: "PIPEDRIVE" });
      expect(result.ok).toBe(false);
    });

    it("rejects empty accountId", () => {
      const result = CrmConnection.create({ ...validInput, accountId: "" });
      expect(result.ok).toBe(false);
    });

    it("rejects empty accessToken", () => {
      const result = CrmConnection.create({ ...validInput, accessToken: "" });
      expect(result.ok).toBe(false);
    });

    it("rejects whitespace-only accessToken", () => {
      const result = CrmConnection.create({ ...validInput, accessToken: "   " });
      expect(result.ok).toBe(false);
    });

    it("defaults sandboxMode to false", () => {
      const result = CrmConnection.create(validInput);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.sandboxMode).toBe(false);
      }
    });

    it("accepts sandboxMode true", () => {
      const result = CrmConnection.create({ ...validInput, sandboxMode: true });
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.sandboxMode).toBe(true);
      }
    });
  });

  describe("reconstitute()", () => {
    it("creates from persisted props without validation", () => {
      const now = new Date();
      const conn = CrmConnection.reconstitute({
        id: "conn-1",
        accountId: "acc-1",
        platform: "HUBSPOT",
        isActive: true,
        accessToken: "tok",
        sandboxMode: false,
        syncContacts: true,
        syncActivities: true,
        createdAt: now,
        updatedAt: now,
      });
      expect(conn.id).toBe("conn-1");
      expect(conn.platform).toBe("HUBSPOT");
    });
  });

  describe("isTokenExpired()", () => {
    it("returns false when no tokenExpiresAt", () => {
      const result = CrmConnection.create(validInput);
      if (!result.ok) throw new Error("expected ok");
      const _conn = CrmConnection.reconstitute({
        ...result.value.toJSON(),
        id: "c1",
        accessToken: "tok",
      } as Parameters<typeof CrmConnection.reconstitute>[0]);
      // No tokenExpiresAt set → not expired
      const noExpiry = CrmConnection.reconstitute({
        id: "c2",
        accountId: "a1",
        platform: "HUBSPOT",
        isActive: true,
        accessToken: "tok",
        sandboxMode: false,
        syncContacts: true,
        syncActivities: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      expect(noExpiry.isTokenExpired()).toBe(false);
    });

    it("returns false when token not yet expired", () => {
      const conn = CrmConnection.reconstitute({
        id: "c1",
        accountId: "a1",
        platform: "HUBSPOT",
        isActive: true,
        accessToken: "tok",
        tokenExpiresAt: new Date(Date.now() + 3600_000),
        sandboxMode: false,
        syncContacts: true,
        syncActivities: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      expect(conn.isTokenExpired()).toBe(false);
    });

    it("returns true when token expired", () => {
      const conn = CrmConnection.reconstitute({
        id: "c1",
        accountId: "a1",
        platform: "HUBSPOT",
        isActive: true,
        accessToken: "tok",
        tokenExpiresAt: new Date(Date.now() - 1000),
        sandboxMode: false,
        syncContacts: true,
        syncActivities: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      expect(conn.isTokenExpired()).toBe(true);
    });
  });

  describe("updateTokens()", () => {
    it("returns new connection with updated tokens", () => {
      const result = CrmConnection.create(validInput);
      if (!result.ok) throw new Error("expected ok");
      const updated = result.value.updateTokens({
        accessToken: "new-token",
        refreshToken: "new-refresh",
        tokenExpiresAt: new Date(Date.now() + 7200_000),
      });
      expect(updated.accessToken).toBe("new-token");
      expect(updated.refreshToken).toBe("new-refresh");
      expect(updated.accountId).toBe(result.value.accountId);
    });
  });

  describe("markSynced()", () => {
    it("returns new connection with lastSyncAt set", () => {
      const result = CrmConnection.create(validInput);
      if (!result.ok) throw new Error("expected ok");
      const synced = result.value.markSynced();
      expect(synced.lastSyncAt).toBeDefined();
    });
  });

  describe("deactivate()", () => {
    it("returns new connection with isActive false", () => {
      const result = CrmConnection.create(validInput);
      if (!result.ok) throw new Error("expected ok");
      const deactivated = result.value.deactivate();
      expect(deactivated.isActive).toBe(false);
      expect(deactivated.accountId).toBe(result.value.accountId);
    });
  });

  describe("toJSON()", () => {
    it("masks accessToken and refreshToken", () => {
      const result = CrmConnection.create(validInput);
      if (!result.ok) throw new Error("expected ok");
      const json = result.value.toJSON();
      expect(json.accessToken).toBe("***MASKED***");
      expect(json.refreshToken).toBe("***MASKED***");
      expect(json.platform).toBe("HUBSPOT");
    });
  });
});
