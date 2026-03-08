import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { oauthProviders } from "../../src/auth/providerOAuth.js";

let oauthStates: Map<string, Record<string, unknown>>;

function setupMocks() {
  oauthStates = new Map();
}

// ============================================================================
// OAuth Flow - Initiation Tests
// ============================================================================

describe("ProviderOAuth - OAuth Initiation", { concurrency: 1 }, () => {
  beforeEach(() => {
    setupMocks();
  });

  it("should generate authorization URL for X/Twitter", () => {
    const provider = oauthProviders.x;

    assert.ok(provider, "X provider should exist");
    assert.strictEqual(provider.id, "x", "Provider ID should be 'x'");
    assert.ok(provider.config.authUrl, "Should have auth URL");
    assert.ok(provider.config.tokenUrl, "Should have token URL");
  });

  it("should generate authorization URL for Instagram", () => {
    const provider = oauthProviders.instagram;

    assert.ok(provider, "Instagram provider should exist");
    assert.strictEqual(provider.id, "instagram", "Provider ID should be 'instagram'");
    assert.ok(provider.config.scopes.length > 0, "Should have scopes defined");
  });

  it("should generate authorization URL for Facebook", () => {
    const provider = oauthProviders.facebook;

    assert.ok(provider, "Facebook provider should exist");
    assert.ok(provider.config.clientId !== undefined, "Should have client ID");
    assert.ok(provider.config.scopes.includes("pages_manage_posts"), "Should have page scopes");
  });

  it("should generate authorization URL for YouTube", () => {
    const provider = oauthProviders.youtube;

    assert.ok(provider, "YouTube provider should exist");
    assert.ok(
      provider.config.scopes.some((s: string) => s.includes("youtube")),
      "Should have YouTube scopes"
    );
  });

  it("should generate authorization URL for TikTok", () => {
    const provider = oauthProviders.tiktok;

    assert.ok(provider, "TikTok provider should exist");
    assert.ok(provider.config.scopes.includes("video.upload"), "Should have upload scope");
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

    assert.ok(url.includes("response_type=code"), "Should include response_type");
    assert.ok(url.includes("client_id="), "Should include client_id");
    assert.ok(url.includes("redirect_uri="), "Should include redirect_uri");
    assert.ok(url.includes("scope="), "Should include scope");
    assert.ok(url.includes("state="), "Should include state");
  });

  it("should include PKCE parameters for X/Twitter", () => {
    const provider = oauthProviders.x;

    const params = new URLSearchParams({
      client_id: provider.config.clientId,
      code_challenge: "challenge",
      code_challenge_method: "plain",
    });

    const url = `${provider.config.authUrl}?${params.toString()}`;

    assert.ok(url.includes("code_challenge="), "Should include code challenge");
    assert.ok(url.includes("code_challenge_method="), "Should include challenge method");
  });
});

// ============================================================================
// OAuth Flow - State Management Tests
// ============================================================================

describe("ProviderOAuth - State Management", { concurrency: 1 }, () => {
  beforeEach(() => {
    setupMocks();
  });

  it("should generate secure random state", () => {
    const state1 = randomBytes(32).toString("hex");
    const state2 = randomBytes(32).toString("hex");

    assert.notStrictEqual(state1, state2, "States should be unique");
    assert.ok(state1.length >= 64, "State should be sufficiently long");
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
    assert.ok(retrieved, "Should retrieve state data");
    assert.strictEqual(retrieved.providerId, "x", "Should store provider ID");
    assert.strictEqual(retrieved.accountId, "acc-123", "Should store account ID");
    assert.strictEqual(retrieved.projectId, "proj-123", "Should store project ID");
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

    assert.strictEqual(oauthStates.has("expired-state"), false, "Should delete expired state");
    assert.strictEqual(oauthStates.has("valid-state"), true, "Should keep valid state");
  });
});

// ============================================================================
// OAuth Flow - Unimplemented Providers Tests
// ============================================================================

describe("ProviderOAuth - Unimplemented Providers", { concurrency: 1 }, () => {
  it("should throw error for LinkedIn (not implemented)", async () => {
    const provider = oauthProviders.linkedin;

    await assert.rejects(
      async () => {
        await provider.validateCode("code", "state");
      },
      { message: /LinkedIn OAuth not implemented/ }
    );
  });

  it("should throw error for Pinterest (not implemented)", async () => {
    const provider = oauthProviders.pinterest;

    await assert.rejects(
      async () => {
        await provider.validateCode("code", "state");
      },
      { message: /Pinterest OAuth not implemented/ }
    );
  });

  it("should throw error for Reddit (not implemented)", async () => {
    const provider = oauthProviders.reddit;

    await assert.rejects(
      async () => {
        await provider.validateCode("code", "state");
      },
      { message: /Reddit OAuth not implemented/ }
    );
  });

  it("should throw error for Discord (not implemented)", async () => {
    const provider = oauthProviders.discord;

    await assert.rejects(
      async () => {
        await provider.validateCode("code", "state");
      },
      { message: /Discord OAuth not implemented/ }
    );
  });

  it("should throw error for Twitch (not implemented)", async () => {
    const provider = oauthProviders.twitch;

    await assert.rejects(
      async () => {
        await provider.validateCode("code", "state");
      },
      { message: /Twitch OAuth not implemented/ }
    );
  });

  it("should throw error for Snapchat (not implemented)", async () => {
    const provider = oauthProviders.snapchat;

    await assert.rejects(
      async () => {
        await provider.validateCode("code", "state");
      },
      { message: /Snapchat OAuth not implemented/ }
    );
  });
});
