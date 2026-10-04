/**
 * @file providerOAuthCredentials.test.ts
 * @description Unit tests for how an OAuth provider reads its client id and secret from the
 *              environment. Neither variable set leaves the provider unconfigured: initiation
 *              never redirects to consent and the callback never sends a token request. Exactly
 *              one set stops the module from loading and names the missing variable. Both set
 *              run the flow with that pair. The env module is replaced by a mutable object and
 *              the provider modules are re-imported per case, because they read env at load.
 * @layer infrastructure
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { FastifyReply, FastifyRequest } from "fastify";
import type { OAuthFlowRecord, OAuthFlowStorePort } from "@ports/core";
import type { ChannelRepository } from "@core/domain/repositories/ChannelRepository.js";
import type { ProjectRepositoryPort } from "@core/domain/repositories/ProjectRepository.js";

const { mockEnv } = vi.hoisted(() => ({
  mockEnv: {} as Record<string, string | undefined>,
}));

vi.mock("../../../src/config/env.js", () => ({ env: mockEnv }));

const PROVIDERS = [
  ["x", "X_CLIENT_ID", "X_CLIENT_SECRET"],
  ["instagram", "INSTAGRAM_CLIENT_ID", "INSTAGRAM_CLIENT_SECRET"],
  ["facebook", "FACEBOOK_CLIENT_ID", "FACEBOOK_CLIENT_SECRET"],
  ["youtube", "YOUTUBE_CLIENT_ID", "YOUTUBE_CLIENT_SECRET"],
  ["tiktok", "TIKTOK_CLIENT_ID", "TIKTOK_CLIENT_SECRET"],
  ["linkedin", "LINKEDIN_CLIENT_ID", "LINKEDIN_CLIENT_SECRET"],
  ["pinterest", "PINTEREST_CLIENT_ID", "PINTEREST_CLIENT_SECRET"],
  ["snapchat", "SNAPCHAT_CLIENT_ID", "SNAPCHAT_CLIENT_SECRET"],
] as const;

const X_PAIR = { X_CLIENT_ID: "x-client-id", X_CLIENT_SECRET: "x-client-secret" };
const ACCOUNT_ID = "6f1c2a1e-1d7b-4c3e-9a51-2b8f0f7d4a10";
const PROJECT_ID = "0b6c9a0e-5e2f-4f7a-8d3c-7c1e9b2a6f42";

const fetchSpy = vi.fn<typeof fetch>();

const loadConfigs = (values: Record<string, string>) => {
  for (const key of Object.keys(mockEnv)) delete mockEnv[key];
  Object.assign(mockEnv, { NODE_ENV: "test", LOG_LEVEL: "silent" }, values);
  vi.resetModules();
  return import("../../../src/auth/providerOAuthConfigs.js");
};

const loadHandler = async (values: Record<string, string>) => {
  await loadConfigs(values);
  const { ProviderOAuthHandler } = await import("../../../src/auth/providerOAuthFlow.js");
  const record: OAuthFlowRecord = {
    providerId: "x",
    accountId: ACCOUNT_ID,
    projectId: PROJECT_ID,
    codeVerifier: "verifier-1",
    createdAt: new Date().toISOString(),
  };
  const store = { put: vi.fn(async () => undefined), consume: vi.fn(async () => record) };
  const projects = { findById: vi.fn(async () => ({ ok: true, value: {} })) };
  const channels = { findByProjectProviderAccount: vi.fn(), save: vi.fn() };
  const handler = new ProviderOAuthHandler(
    store satisfies OAuthFlowStorePort,
    channels as unknown as ChannelRepository,
    projects as unknown as ProjectRepositoryPort
  );
  return { handler, store, channels };
};

interface ReplyDouble {
  code(statusCode: number): ReplyDouble;
  send(body: unknown): ReplyDouble;
  redirect(location: string): ReplyDouble;
}

const makeReply = () => {
  const sent: { statusCode?: number; body?: unknown; location?: string } = {};
  const reply: ReplyDouble = {
    code(statusCode) {
      sent.statusCode = statusCode;
      return reply;
    },
    send(body) {
      sent.body = body;
      return reply;
    },
    redirect(location) {
      sent.location = location;
      return reply;
    },
  };
  return { reply: reply as unknown as FastifyReply, sent };
};

const initiationRequest = () =>
  ({
    method: "GET",
    url: "/auth/x",
    customerUser: { accountId: ACCOUNT_ID },
    params: { provider: "x" },
    query: { projectId: PROJECT_ID },
  }) as unknown as FastifyRequest;

const callbackRequest = () =>
  ({
    method: "GET",
    url: "/auth/callback/x",
    params: { provider: "x" },
    query: { code: "auth-code-1", state: "state-1" },
  }) as unknown as FastifyRequest;

describe("OAuth provider credentials", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fetchSpy.mockResolvedValue(new Response("{}", { status: 500 }));
    vi.stubGlobal("fetch", fetchSpy);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe.each(PROVIDERS)("%s", (provider, idVar, secretVar) => {
    it(`stops the module from loading when only ${idVar} is set, naming ${secretVar}`, async () => {
      await expect(loadConfigs({ [idVar]: "client-id" })).rejects.toThrow(
        `${secretVar} is not set`
      );
    });

    it(`stops the module from loading when only ${secretVar} is set, naming ${idVar}`, async () => {
      await expect(loadConfigs({ [secretVar]: "client-secret" })).rejects.toThrow(
        `${idVar} is not set`
      );
    });

    it("refuses the token exchange before any request when neither variable is set", async () => {
      const { oauthProviders } = await loadConfigs({});

      await expect(
        oauthProviders[provider].validateCode("auth-code-1", "state-1", "verifier-1")
      ).rejects.toThrow(`OAuth is not configured for provider "${provider}"`);
      expect(fetchSpy).not.toHaveBeenCalled();
    });
  });

  it("refuses initiation without redirecting or storing a flow when X has no credentials", async () => {
    const { handler, store } = await loadHandler({});
    const { reply, sent } = makeReply();

    await handler.initiateOAuth(initiationRequest(), reply);

    expect(sent.location).toBeUndefined();
    expect(sent.statusCode).toBe(500);
    expect(store.put).not.toHaveBeenCalled();
  });

  it("refuses the callback without a token request or a channel when X has no credentials", async () => {
    const { handler, channels } = await loadHandler({});
    const { reply, sent } = makeReply();

    await handler.handleCallback(callbackRequest(), reply);

    expect(sent.location).toContain("error=");
    expect(sent.location).not.toContain("status=connected");
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(channels.save).not.toHaveBeenCalled();
  });

  it("redirects to consent with the configured client id when X has both variables", async () => {
    const { handler, store } = await loadHandler(X_PAIR);
    const { reply, sent } = makeReply();

    await handler.initiateOAuth(initiationRequest(), reply);

    const consent = new URL(sent.location ?? "");
    expect(consent.origin + consent.pathname).toBe("https://twitter.com/i/oauth2/authorize");
    expect(consent.searchParams.get("client_id")).toBe("x-client-id");
    expect(store.put).toHaveBeenCalledTimes(1);
  });

  it("authenticates the X token request with the configured pair", async () => {
    const { oauthProviders } = await loadConfigs(X_PAIR);
    fetchSpy
      .mockResolvedValueOnce(Response.json({ access_token: "tw-access", expires_in: 7200 }))
      .mockResolvedValueOnce(Response.json({ data: { id: "u-1", name: "Test User" } }));

    const result = await oauthProviders.x.validateCode("auth-code-1", "state-1", "verifier-1");

    const tokenInit = fetchSpy.mock.calls[0]?.[1];
    const basic = Buffer.from("x-client-id:x-client-secret").toString("base64");
    expect(new Headers(tokenInit?.headers).get("Authorization")).toBe(`Basic ${basic}`);
    expect(result.accessToken).toBe("tw-access");
  });
});
