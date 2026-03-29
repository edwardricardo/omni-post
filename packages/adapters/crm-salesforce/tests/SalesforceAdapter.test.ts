/**
 * @file SalesforceAdapter.test.ts
 * @description Unit tests for Salesforce CRM adapter.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { SalesforceAdapter } from "../src/SalesforceAdapter.js";

const config = {
  clientId: "sf-client-id",
  clientSecret: "sf-client-secret",
  redirectUri: "http://localhost:3000/api/crm/salesforce/callback",
};

describe("SalesforceAdapter", () => {
  let adapter: SalesforceAdapter;

  beforeEach(() => {
    vi.clearAllMocks();
    adapter = new SalesforceAdapter(config);
  });

  describe("platform", () => {
    it("is SALESFORCE", () => {
      expect(adapter.platform).toBe("SALESFORCE");
    });
  });

  describe("getAuthorizationUrl()", () => {
    it("uses login.salesforce.com for production", () => {
      const url = adapter.getAuthorizationUrl(config.redirectUri, "s");
      expect(url).toContain("login.salesforce.com");
    });

    it("uses test.salesforce.com for sandbox", () => {
      const sandbox = new SalesforceAdapter({ ...config, sandbox: true });
      const url = sandbox.getAuthorizationUrl(config.redirectUri, "s");
      expect(url).toContain("test.salesforce.com");
    });

    it("includes client_id", () => {
      const url = adapter.getAuthorizationUrl(config.redirectUri, "s");
      expect(url).toContain("client_id=sf-client-id");
    });

    it("includes state parameter", () => {
      const url = adapter.getAuthorizationUrl(config.redirectUri, "state-xyz");
      expect(url).toContain("state=state-xyz");
    });

    it("includes api+refresh_token scope", () => {
      const url = adapter.getAuthorizationUrl(config.redirectUri, "s");
      expect(url).toContain("scope=api+refresh_token");
    });
  });

  describe("exchangeCodeForTokens()", () => {
    it("returns tokens with instanceUrl", async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue({
          ok: true,
          json: async () => ({
            access_token: "sf-access",
            refresh_token: "sf-refresh",
            instance_url: "https://na1.salesforce.com",
          }),
        })
      );

      const tokens = await adapter.exchangeCodeForTokens("code-123", config.redirectUri);
      expect(tokens.accessToken).toBe("sf-access");
      expect(tokens.refreshToken).toBe("sf-refresh");
      expect(tokens.instanceUrl).toBe("https://na1.salesforce.com");
      expect(tokens.expiresAt).toBeInstanceOf(Date);

      vi.unstubAllGlobals();
    });

    it("throws on failed exchange", async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue({
          ok: false,
          status: 400,
          text: async () => "Bad Request",
        })
      );

      await expect(adapter.exchangeCodeForTokens("bad", config.redirectUri)).rejects.toThrow(
        "token exchange failed"
      );

      vi.unstubAllGlobals();
    });
  });

  describe("fetchContacts()", () => {
    it("maps Salesforce SOQL response to CrmContact[]", async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue({
          ok: true,
          json: async () => ({
            records: [
              {
                Id: "003xx001",
                Email: "jane@corp.com",
                FirstName: "Jane",
                LastName: "Smith",
                Account: { Name: "Corp Inc" },
                Title: "CTO",
                Phone: "+1999888",
              },
            ],
            done: true,
          }),
        })
      );

      const result = await adapter.fetchContacts("tok");
      expect(result.contacts).toHaveLength(1);
      expect(result.contacts[0].externalId).toBe("003xx001");
      expect(result.contacts[0].email).toBe("jane@corp.com");
      expect(result.contacts[0].company).toBe("Corp Inc");
      expect(result.hasMore).toBe(false);

      vi.unstubAllGlobals();
    });

    it("uses nextRecordsUrl for pagination", async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ records: [], done: true }),
      });
      vi.stubGlobal("fetch", mockFetch);

      await adapter.fetchContacts("tok", "https://na1.salesforce.com/next-page");
      expect(mockFetch.mock.calls[0][0]).toBe("https://na1.salesforce.com/next-page");

      vi.unstubAllGlobals();
    });
  });

  describe("logActivity()", () => {
    it("creates Task record in Salesforce", async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ id: "00Txx001" }),
      });
      vi.stubGlobal("fetch", mockFetch);

      const result = await adapter.logActivity("tok", "https://na1.salesforce.com", {
        type: "POST_PUBLISHED",
        title: "Post published on Instagram",
        description: "Content about new product",
        occurredAt: new Date("2026-03-29T12:00:00Z"),
      });

      expect(result.externalId).toBe("00Txx001");
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining("/sobjects/Task"),
        expect.objectContaining({ method: "POST" })
      );

      vi.unstubAllGlobals();
    });

    it("uses instanceUrl for API endpoint", async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ id: "00T1" }),
      });
      vi.stubGlobal("fetch", mockFetch);

      await adapter.logActivity("tok", "https://eu5.salesforce.com", {
        type: "POST_PUBLISHED",
        title: "Test",
        occurredAt: new Date(),
      });

      expect(mockFetch.mock.calls[0][0]).toContain("eu5.salesforce.com");

      vi.unstubAllGlobals();
    });
  });
});
