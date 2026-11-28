/**
 * @file providerOAuthCallbackAddress.test.ts
 * @description Where a provider's OAuth callback sends the browser back: the client portal's
 *   connections page, on the origin `CLIENT_URL` names, after a connection that succeeded and after
 *   one that failed. A request's host headers and query parameters do not move it. The env module is
 *   replaced by a mutable object and the handler is re-imported per case, because the provider
 *   configurations read env when they load; the provider's token and user endpoints are a `fetch`
 *   double.
 * @layer infrastructure
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FastifyReply, FastifyRequest } from "fastify";
import type { OAuthFlowRecord, OAuthFlowStorePort } from "@ports/core";
import type { ChannelRepository } from "@core/domain/repositories/ChannelRepository.js";
import type { ProjectRepositoryPort } from "@core/domain/repositories/ProjectRepository.js";
import { makePublicAddressEnv } from "../helpers/publicAddressEnv.js";

const { mockEnv } = vi.hoisted(() => ({
  mockEnv: {} as Record<string, string | undefined>,
}));

vi.mock("../../../src/config/env.js", () => ({ env: mockEnv }));

const ACCOUNT_ID = "6f1c2a1e-1d7b-4c3e-9a51-2b8f0f7d4a10";
const PROJECT_ID = "0b6c9a0e-5e2f-4f7a-8d3c-7c1e9b2a6f42";
const FOREIGN_ORIGIN = "https://elsewhere.example.test";

/** The X application's credentials, which let the callback exchange its code. */
const X_PAIR = { X_CLIENT_ID: "x-client-id", X_CLIENT_SECRET: "x-client-secret" };

const fetchSpy = vi.fn<typeof fetch>();

/**
 * A handler over doubles, loaded under an environment that holds the public addresses and the
 * variables a case adds; the channel double finds no channel and saves the new one.
 */
async function loadHandler(variables: Record<string, string> = {}) {
  for (const key of Object.keys(mockEnv)) delete mockEnv[key];
  Object.assign(
    mockEnv,
    { NODE_ENV: "test", LOG_LEVEL: "silent" },
    makePublicAddressEnv(),
    variables
  );
  vi.resetModules();
  const { ProviderOAuthHandler } = await import("../../../src/auth/providerOAuthFlow.js");
  const record: OAuthFlowRecord = {
    providerId: "x",
    accountId: ACCOUNT_ID,
    projectId: PROJECT_ID,
    codeVerifier: "verifier-1",
    createdAt: new Date().toISOString(),
  };
  const store = { put: vi.fn(async () => undefined), consume: vi.fn(async () => record) };
  const channels = {
    findByProjectProviderAccount: vi.fn(async () => null),
    save: vi.fn(async () => ({ ok: true, value: undefined })),
  };
  const handler = new ProviderOAuthHandler(
    store satisfies OAuthFlowStorePort,
    channels as unknown as ChannelRepository,
    { findById: vi.fn(async () => ({ ok: true, value: {} })) } as unknown as ProjectRepositoryPort
  );
  return { handler, channels };
}

/** A callback request to `/auth/callback/x`, with the query and headers a case gives it. */
function makeCallbackRequest(
  query: Record<string, string>,
  headers: Record<string, string> = {}
): FastifyRequest {
  return {
    method: "GET",
    url: "/auth/callback/x",
    params: { provider: "x" },
    query,
    headers,
  } as unknown as FastifyRequest;
}

/** A reply that records where it redirected. */
function makeReply() {
  const sent: { location?: string } = {};
  const reply = {
    redirect(location: string) {
      sent.location = location;
      return reply;
    },
  };
  return { reply: reply as unknown as FastifyReply, sent };
}

/** The redirect's origin and path, and its query parameters. */
function landing(location: string | undefined) {
  const url = new URL(location ?? "");
  return { at: `${url.origin}${url.pathname}`, query: Object.fromEntries(url.searchParams) };
}

const CONNECTIONS = `${makePublicAddressEnv().CLIENT_URL}/dashboard/connections`;

describe("the OAuth callback's redirect", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fetchSpy.mockResolvedValue(new Response("{}", { status: 500 }));
    vi.stubGlobal("fetch", fetchSpy);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("lands on the client portal's connections page when the callback's parameters are invalid", async () => {
    const { handler } = await loadHandler();
    const { reply, sent } = makeReply();

    await handler.handleCallback(makeCallbackRequest({ state: "state-1" }), reply);

    expect(landing(sent.location)).toEqual({
      at: CONNECTIONS,
      query: { error: "Invalid OAuth callback parameters" },
    });
  });

  it("lands on the client portal's connections page when the provider refused the consent", async () => {
    const { handler } = await loadHandler();
    const { reply, sent } = makeReply();

    await handler.handleCallback(
      makeCallbackRequest({ code: "auth-code-1", state: "state-1", error: "access_denied" }),
      reply
    );

    expect(landing(sent.location)).toEqual({
      at: CONNECTIONS,
      query: { error: "OAuth error: access_denied" },
    });
  });

  it("lands on the client portal's connections page after a connection that succeeded, whatever host headers and redirect parameters the request carries", async () => {
    const { handler, channels } = await loadHandler(X_PAIR);
    fetchSpy
      .mockResolvedValueOnce(Response.json({ access_token: "tw-access", expires_in: 7200 }))
      .mockResolvedValueOnce(Response.json({ data: { id: "u-1", name: "Test User" } }));
    const { reply, sent } = makeReply();
    const foreignHost = new URL(FOREIGN_ORIGIN).host;

    await handler.handleCallback(
      makeCallbackRequest(
        {
          code: "auth-code-1",
          state: "state-1",
          redirect_uri: FOREIGN_ORIGIN,
          next: FOREIGN_ORIGIN,
        },
        {
          host: foreignHost,
          "x-forwarded-host": foreignHost,
          origin: FOREIGN_ORIGIN,
          referer: FOREIGN_ORIGIN,
        }
      ),
      reply
    );

    expect(landing(sent.location)).toEqual({
      at: CONNECTIONS,
      query: { provider: "x", status: "connected" },
    });
    expect(channels.save).toHaveBeenCalledTimes(1);
  });
});
