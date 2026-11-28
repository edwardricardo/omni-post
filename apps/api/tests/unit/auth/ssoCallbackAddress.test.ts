/**
 * @file ssoCallbackAddress.test.ts
 * @description The callback addresses single sign-on hands an identity provider are built on
 *   `APP_BASE_URL` and the account in the path, never on a host the request names: the OIDC
 *   `redirect_uri` given to the library at login and used again for the token exchange, and the
 *   SAML ACS URL published in the service provider's metadata and sent in an AuthnRequest. The
 *   route plugins run in Fastify under the real environment module and the real tenant pre-handler,
 *   over a container of doubles; `openid-client` is a double that echoes what it is given, and the
 *   SAML library is the real one.
 * @layer infrastructure
 */
import { inflateRawSync } from "node:zlib";
import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  OidcConfigurationData,
  OidcConfigurationRepository,
} from "@core/domain/repositories/OidcConfigurationRepository.js";
import type {
  SamlConfigurationData,
  SamlConfigurationRepository,
} from "@core/domain/repositories/SamlConfigurationRepository.js";
import { makeApiEnv, makePublicAddressEnv, withEnvironment } from "../helpers/publicAddressEnv.js";

// `env.ts` calls `process.loadEnvFile()` on import, which would add an env file's variables to the
// fixture; vi.hoisted installs the spy before any import of this file can load env.ts.
vi.hoisted(() => vi.spyOn(process, "loadEnvFile").mockImplementation(() => undefined));

vi.mock("openid-client", () => ({
  discovery: vi.fn(async () => ({ issuer: "https://idp.example.test" })),
  randomPKCECodeVerifier: vi.fn(() => "verifier-1"),
  calculatePKCECodeChallenge: vi.fn(async () => "challenge-1"),
  buildAuthorizationUrl: vi.fn(
    (_configuration: unknown, parameters: Record<string, string>) =>
      new URL(`https://idp.example.test/authorize?${new URLSearchParams(parameters).toString()}`)
  ),
  authorizationCodeGrant: vi.fn(async () => ({
    access_token: "access-1",
    claims: () => ({ sub: "subject-1" }),
  })),
  fetchUserInfo: vi.fn(async () => ({ sub: "subject-1", email: "member@example.test" })),
  skipSubjectCheck: Symbol("skipSubjectCheck"),
}));

const ACCOUNT_ID = "3f2b8c1e-6a4d-4e7f-9b0a-5c1d2e3f4a5b";
const FOREIGN_ORIGIN = "https://elsewhere.example.test";
const FOREIGN_HOST = new URL(FOREIGN_ORIGIN).host;

/** Request headers that name a host other than the API's. */
const FOREIGN_HEADERS = {
  host: FOREIGN_HOST,
  "x-forwarded-host": FOREIGN_HOST,
  origin: FOREIGN_ORIGIN,
};

/** The callback address a protocol's routes must build for the account. */
function callbackOn(protocol: "oidc" | "saml"): string {
  return `${makePublicAddressEnv().APP_BASE_URL}/auth/${protocol}/${ACCOUNT_ID}/callback`;
}

/** An active OIDC configuration of the account. */
function makeOidcConfiguration(
  overrides: Partial<OidcConfigurationData> = {}
): OidcConfigurationData {
  return {
    id: "oidc-configuration-1",
    accountId: ACCOUNT_ID,
    issuerUrl: "https://idp.example.test",
    clientId: "client-1",
    clientSecret: "client-secret-1",
    scopes: ["openid", "email"],
    attributeMapping: { email: "email" },
    isActive: true,
    createdAt: new Date(0),
    updatedAt: new Date(0),
    ...overrides,
  };
}

/** An active SAML configuration of the account; the library parses no certificate it is not asked to sign with. */
function makeSamlConfiguration(
  overrides: Partial<SamlConfigurationData> = {}
): SamlConfigurationData {
  return {
    id: "saml-configuration-1",
    accountId: ACCOUNT_ID,
    entityId: `https://sp.example.test/saml/${ACCOUNT_ID}`,
    idpEntityId: "https://idp.example.test/entity",
    idpSsoUrl: "https://idp.example.test/sso",
    idpCertificate: "IDP-CERTIFICATE-FOR-TESTS",
    attributeMapping: { email: "email" },
    isActive: true,
    createdAt: new Date(0),
    updatedAt: new Date(0),
    ...overrides,
  };
}

let app: FastifyInstance | undefined;

/**
 * Both SSO plugins over a container of doubles, loaded under an environment the schema accepts: the
 * configuration repositories answer the account's configurations, and the sign-in finds no member,
 * so a callback ends in the provisioning answer.
 */
async function makeSsoApp() {
  const loaded = await withEnvironment(makeApiEnv(), async () => ({
    oidc: await import("../../../src/auth/oidcRoutes.js"),
    saml: await import("../../../src/auth/samlRoutes.js"),
    container: await import("../../../src/infrastructure/container/Container.js"),
    tokens: await import("../../../src/infrastructure/container/types.js"),
    library: await import("openid-client"),
  }));
  const { TOKENS } = loaded.tokens;
  const container = new loaded.container.Container();
  for (const token of [
    TOKENS.ConfigureOidcUseCase,
    TOKENS.EnableOidcSsoUseCase,
    TOKENS.DisableOidcSsoUseCase,
    TOKENS.GetOidcConfigurationQuery,
    TOKENS.ConfigureSamlUseCase,
    TOKENS.EnableSsoUseCase,
    TOKENS.DisableSsoUseCase,
    TOKENS.GetSamlConfigurationQuery,
  ]) {
    container.registerInstance(token, {});
  }
  const oidcRepository: Pick<OidcConfigurationRepository, "findByAccountId"> = {
    findByAccountId: vi.fn(async () => makeOidcConfiguration()),
  };
  const samlRepository: Pick<SamlConfigurationRepository, "findByAccountId"> = {
    findByAccountId: vi.fn(async () => makeSamlConfiguration()),
  };
  container.registerInstance(TOKENS.OidcConfigurationRepository, oidcRepository);
  container.registerInstance(TOKENS.SamlConfigurationRepository, samlRepository);
  container.registerInstance(TOKENS.AuthService, {
    login: vi.fn(async () => ({ ok: false, error: new Error("no member") })),
  });
  app = Fastify({ logger: false });
  app.decorate("container", container);
  await app.register(loaded.oidc.oidcRoutes);
  await app.register(loaded.saml.samlRoutes);
  await app.ready();
  return { app, library: loaded.library };
}

describe("the callback addresses single sign-on hands an identity provider", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(async () => {
    await app?.close();
    app = undefined;
  });

  it("gives the OIDC library a redirect_uri on APP_BASE_URL at login, whatever host the request names", async () => {
    const { app, library } = await makeSsoApp();

    const response = await app.inject({
      method: "GET",
      url: `/auth/oidc/${ACCOUNT_ID}/login`,
      headers: FOREIGN_HEADERS,
    });

    const handed = new URLSearchParams(vi.mocked(library.buildAuthorizationUrl).mock.calls[0]?.[1]);
    expect(response.statusCode).toBe(302);
    expect(vi.mocked(library.buildAuthorizationUrl)).toHaveBeenCalledTimes(1);
    expect(handed.get("redirect_uri")).toBe(callbackOn("oidc"));
    expect(new URL(response.headers.location ?? "").searchParams.get("redirect_uri")).toBe(
      callbackOn("oidc")
    );
  });

  it("exchanges the OIDC code against the same redirect_uri, whatever host the request names", async () => {
    const { app, library } = await makeSsoApp();
    await app.inject({ method: "GET", url: `/auth/oidc/${ACCOUNT_ID}/login` });
    const state =
      new URLSearchParams(vi.mocked(library.buildAuthorizationUrl).mock.calls[0]?.[1]).get(
        "state"
      ) ?? "";

    const response = await app.inject({
      method: "GET",
      url: `/auth/oidc/${ACCOUNT_ID}/callback?code=code-1&state=${state}`,
      headers: FOREIGN_HEADERS,
    });

    const exchanged = vi.mocked(library.authorizationCodeGrant).mock.calls[0]?.[1];
    const current = exchanged instanceof URL ? exchanged : new URL("https://unset.example.test");
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ ssoAuthenticated: true, requiresProvisioning: true });
    expect(vi.mocked(library.authorizationCodeGrant)).toHaveBeenCalledTimes(1);
    expect({
      at: `${current.origin}${current.pathname}`,
      code: current.searchParams.get("code"),
      state: current.searchParams.get("state"),
    }).toEqual({ at: callbackOn("oidc"), code: "code-1", state });
  });

  it("publishes the SAML ACS URL on APP_BASE_URL in the metadata, whatever host the request names", async () => {
    const { app } = await makeSsoApp();

    const response = await app.inject({
      method: "GET",
      url: `/auth/saml/${ACCOUNT_ID}/metadata`,
      headers: FOREIGN_HEADERS,
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers["content-type"]).toContain("application/xml");
    expect(response.body).toContain(`Location="${callbackOn("saml")}"`);
    expect(response.body).not.toContain(FOREIGN_HOST);
  });

  it("sends the SAML ACS URL on APP_BASE_URL in the AuthnRequest, whatever host the request names", async () => {
    const { app } = await makeSsoApp();

    const response = await app.inject({
      method: "GET",
      url: `/auth/saml/${ACCOUNT_ID}/login`,
      headers: FOREIGN_HEADERS,
    });

    const location = new URL(response.headers.location ?? "");
    const request = inflateRawSync(
      Buffer.from(location.searchParams.get("SAMLRequest") ?? "", "base64")
    ).toString("utf8");
    expect(response.statusCode).toBe(302);
    expect(`${location.origin}${location.pathname}`).toBe(makeSamlConfiguration().idpSsoUrl);
    expect(request).toContain(`AssertionConsumerServiceURL="${callbackOn("saml")}"`);
    expect(request).not.toContain(FOREIGN_HOST);
  });
});
