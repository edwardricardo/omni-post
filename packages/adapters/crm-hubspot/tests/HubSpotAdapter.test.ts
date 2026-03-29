/**
 * @file HubSpotAdapter.test.ts
 * @description Unit tests for HubSpot CRM adapter.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { HubSpotAdapter } from "../src/HubSpotAdapter.js";

const config = {
  clientId: "test-client-id",
  clientSecret: "test-client-secret",
  redirectUri: "http://localhost:3000/api/crm/hubspot/callback",
  timelineTemplateId: "tmpl-123",
};

describe("HubSpotAdapter", () => {
  let adapter: HubSpotAdapter;

  beforeEach(() => {
    vi.clearAllMocks();
    adapter = new HubSpotAdapter(config);
  });

  describe("platform", () => {
    it("is HUBSPOT", () => {
      expect(adapter.platform).toBe("HUBSPOT");
    });
  });

  describe("getAuthorizationUrl()", () => {
    it("returns URL with correct client_id", () => {
      const url = adapter.getAuthorizationUrl(config.redirectUri, "state-123");
      expect(url).toContain("client_id=test-client-id");
    });

    it("includes state parameter", () => {
      const url = adapter.getAuthorizationUrl(config.redirectUri, "state-abc");
      expect(url).toContain("state=state-abc");
    });

    it("includes required scopes", () => {
      const url = adapter.getAuthorizationUrl(config.redirectUri, "s");
      expect(url).toContain("crm.objects.contacts.read");
      expect(url).toContain("timeline");
    });

    it("encodes redirect_uri", () => {
      const url = adapter.getAuthorizationUrl("https://example.com/callback", "s");
      expect(url).toContain(encodeURIComponent("https://example.com/callback"));
    });

    it("starts with HubSpot OAuth URL", () => {
      const url = adapter.getAuthorizationUrl(config.redirectUri, "s");
      expect(url).toMatch(/^https:\/\/app\.hubspot\.com\/oauth\/authorize/);
    });
  });

  describe("exchangeCodeForTokens()", () => {
    it("returns tokens on success", async () => {
      const mockResponse = {
        ok: true,
        json: async () => ({
          access_token: "hs-access-tok",
          refresh_token: "hs-refresh-tok",
          expires_in: 3600,
        }),
      };
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(mockResponse));

      const tokens = await adapter.exchangeCodeForTokens("auth-code", config.redirectUri);
      expect(tokens.accessToken).toBe("hs-access-tok");
      expect(tokens.refreshToken).toBe("hs-refresh-tok");
      expect(tokens.expiresAt).toBeInstanceOf(Date);

      vi.unstubAllGlobals();
    });

    it("throws on failed exchange", async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue({ ok: false, status: 401, text: async () => "Unauthorized" })
      );

      await expect(adapter.exchangeCodeForTokens("bad-code", config.redirectUri)).rejects.toThrow(
        "token exchange failed"
      );

      vi.unstubAllGlobals();
    });
  });

  describe("fetchContacts()", () => {
    it("maps HubSpot response to CrmContact[]", async () => {
      const mockResponse = {
        ok: true,
        json: async () => ({
          results: [
            {
              id: "hs-1",
              properties: {
                email: "john@example.com",
                firstname: "John",
                lastname: "Doe",
                company: "Acme",
                jobtitle: "CEO",
                phone: "+1234567890",
              },
            },
          ],
          paging: { next: { after: "cursor-2" } },
        }),
      };
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(mockResponse));

      const result = await adapter.fetchContacts("tok-123");
      expect(result.contacts).toHaveLength(1);
      expect(result.contacts[0].externalId).toBe("hs-1");
      expect(result.contacts[0].email).toBe("john@example.com");
      expect(result.contacts[0].firstName).toBe("John");
      expect(result.hasMore).toBe(true);
      expect(result.nextCursor).toBe("cursor-2");

      vi.unstubAllGlobals();
    });

    it("returns hasMore=false on last page", async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue({
          ok: true,
          json: async () => ({ results: [], paging: undefined }),
        })
      );

      const result = await adapter.fetchContacts("tok-123");
      expect(result.contacts).toHaveLength(0);
      expect(result.hasMore).toBe(false);

      vi.unstubAllGlobals();
    });

    it("passes cursor as after param", async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ results: [] }),
      });
      vi.stubGlobal("fetch", mockFetch);

      await adapter.fetchContacts("tok", "cursor-5");
      const calledUrl = mockFetch.mock.calls[0][0] as string;
      expect(calledUrl).toContain("after=cursor-5");

      vi.unstubAllGlobals();
    });
  });

  describe("logActivity()", () => {
    it("posts to timeline events endpoint", async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ id: "event-1" }),
      });
      vi.stubGlobal("fetch", mockFetch);

      const result = await adapter.logActivity("tok", undefined, {
        type: "POST_PUBLISHED",
        title: "Post published",
        occurredAt: new Date("2026-03-29T12:00:00Z"),
        contactEmail: "john@example.com",
      });

      expect(result.externalId).toBe("event-1");
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining("/crm/v3/timeline/events"),
        expect.objectContaining({ method: "POST" })
      );

      vi.unstubAllGlobals();
    });

    it("throws on API error", async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue({ ok: false, status: 403, text: async () => "Forbidden" })
      );

      await expect(
        adapter.logActivity("tok", undefined, {
          type: "POST_PUBLISHED",
          title: "Test",
          occurredAt: new Date(),
        })
      ).rejects.toThrow("logActivity failed");

      vi.unstubAllGlobals();
    });
  });
});
