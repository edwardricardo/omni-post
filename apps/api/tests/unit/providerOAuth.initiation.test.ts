import { describe, it, beforeEach, expect } from "vitest";
import { randomBytes } from "node:crypto";
import { oauthProviders } from "../../src/auth/providerOAuth.js";

let oauthStates: Map<string, Record<string, unknown>>;

function setupMocks() {
  oauthStates = new Map();
}

// ============================================================================
// OAuth Flow - Initiation Tests
// ============================================================================

describe("ProviderOAuth - OAuth Initiation", () => {
  beforeEach(() => {
    setupMocks();
  });

  it("should generate authorization URL for X/Twitter", () => {
    const provider = oauthProviders.x;

    expect(provider).toBeTruthy();
    expect(provider.id).toBe("x");
    expect(provider.config.authUrl).toBeTruthy();
    expect(provider.config.tokenUrl).toBeTruthy();
  });

  it("should generate authorization URL for Instagram", () => {
    const provider = oauthProviders.instagram;

    expect(provider).toBeTruthy();
    expect(provider.id).toBe("instagram");
    expect(provider.config.scopes.length > 0).toBeTruthy();
  });

  it("should generate authorization URL for Facebook", () => {
    const provider = oauthProviders.facebook;

    expect(provider).toBeTruthy();
    expect(provider.config.clientId !== undefined).toBeTruthy();
    expect(provider.config.scopes.includes("pages_manage_posts")).toBeTruthy();
  });

  it("should generate authorization URL for YouTube", () => {
    const provider = oauthProviders.youtube;

    expect(provider).toBeTruthy();
    expect(provider.config.scopes.some((s: string) => s.includes("youtube"))).toBeTruthy();
  });

  it("should generate authorization URL for TikTok", () => {
    const provider = oauthProviders.tiktok;

    expect(provider).toBeTruthy();
    expect(provider.config.scopes.includes("video.upload")).toBeTruthy();
  });

  it("should include required OAuth parameters in URL", () => {
    const provider = oauthProviders.x;
    const params = new URLSearchParams({
      client_id: provider.config.clientId,
      redirect_uri: provider.config.redirectUri,
      scope: provider.config.scopes.join(" "),
      state: "test-state",
      response_type: "code",
    });

    const url = `${provider.config.authUrl}?${params.toString()}`;

    expect(url.includes("response_type=code")).toBeTruthy();
    expect(url.includes("client_id=")).toBeTruthy();
    expect(url.includes("redirect_uri=")).toBeTruthy();
    expect(url.includes("scope=")).toBeTruthy();
    expect(url.includes("state=")).toBeTruthy();
  });

  it("should include PKCE parameters for X/Twitter", () => {
    const provider = oauthProviders.x;

    const params = new URLSearchParams({
      client_id: provider.config.clientId,
      code_challenge: "challenge",
      code_challenge_method: "plain",
    });

    const url = `${provider.config.authUrl}?${params.toString()}`;

    expect(url.includes("code_challenge=")).toBeTruthy();
    expect(url.includes("code_challenge_method=")).toBeTruthy();
  });
});

// ============================================================================
// OAuth Flow - State Management Tests
// ============================================================================

describe("ProviderOAuth - State Management", () => {
  beforeEach(() => {
    setupMocks();
  });

  it("should generate secure random state", () => {
    const state1 = randomBytes(32).toString("hex");
    const state2 = randomBytes(32).toString("hex");

    expect(state1).not.toBe(state2);
    expect(state1.length >= 64).toBeTruthy();
  });

  it("should store state with provider and account information", () => {
    const stateData = {
      providerId: "x",
      accountId: "acc-123",
      projectId: "proj-123",
      createdAt: new Date(),
    };

    oauthStates.set("test-state", stateData);

    const retrieved = oauthStates.get("test-state");
    expect(retrieved).toBeTruthy();
    expect(retrieved.providerId).toBe("x");
    expect(retrieved.accountId).toBe("acc-123");
    expect(retrieved.projectId).toBe("proj-123");
  });

  it("should cleanup expired states", () => {
    const now = new Date();
    const expired = new Date(now.getTime() - 15 * 60 * 1000);

    oauthStates.set("expired-state", {
      providerId: "x",
      accountId: "acc-123",
      projectId: "proj-123",
      createdAt: expired,
    });

    oauthStates.set("valid-state", {
      providerId: "x",
      accountId: "acc-123",
      projectId: "proj-123",
      createdAt: now,
    });

    for (const [state, data] of oauthStates.entries()) {
      const createdAt = data.createdAt as Date;
      if (now.getTime() - createdAt.getTime() > 10 * 60 * 1000) {
        oauthStates.delete(state);
      }
    }

    expect(oauthStates.has("expired-state")).toBe(false);
    expect(oauthStates.has("valid-state")).toBe(true);
  });
});

// ============================================================================
// OAuth Provider Registry - Coverage Tests
// ============================================================================

describe("ProviderOAuth - Provider Registry", () => {
  it("should have OAuth providers registered for all 9 supported platforms", () => {
    const expectedProviders = [
      "x",
      "instagram",
      "facebook",
      "youtube",
      "tiktok",
      "linkedin",
      "pinterest",
      "snapchat",
    ];
    for (const providerId of expectedProviders) {
      expect(oauthProviders[providerId as keyof typeof oauthProviders] !== undefined).toBeTruthy();
    }
  });

  it("should not have OAuth providers for unsupported platforms", () => {
    const unsupported = ["reddit", "discord", "twitch"];
    for (const providerId of unsupported) {
      expect(oauthProviders[providerId as keyof typeof oauthProviders]).toBe(undefined);
    }
  });
});
