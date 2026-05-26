/**
 * @file oauthFlow.ts
 * @description Generic, provider-agnostic OAuth 2.1 authorization-code flow
 *              primitives: build the authorization URL (state + PKCE,
 *              persisted cross-pod), enforce exact-match redirect URIs, and
 *              single-use-consume the flow record on callback. Provider
 *              specifics (token/user-info endpoints) stay in the per-provider
 *              config; this module owns the canon-mandated mechanics.
 * @layer infrastructure
 */
import { randomBytes } from "crypto";
import type { OAuthFlowRecord, OAuthFlowStorePort } from "@ports/core";
import { AppError } from "../../lib/errors/AppError.js";
import { createPkcePair } from "./pkce.js";

/** OAuth 2.1 authorization flow lifetime: 10 minutes (typical consent window). */
export const OAUTH_FLOW_TTL_SECONDS = 600;

/**
 * @function redirectsMatchExactly
 * @description OAuth 2.1 redirect-URI comparison: byte-for-byte string
 *   equality. No normalization (trailing slash, case, default port) — any
 *   normalization is exactly the loosening the spec forbids.
 * @param a - First URI.
 * @param b - Second URI.
 * @returns True only if the two strings are identical.
 */
export function redirectsMatchExactly(a: string, b: string): boolean {
  return a === b;
}

/**
 * @function assertRegisteredRedirect
 * @description Validates a configured redirect URI is a non-empty absolute
 *   http(s) URL usable for exact-match. Rejects empty/relative/malformed
 *   values so a misconfigured provider can never start a flow with a
 *   loose or attacker-influencable redirect.
 * @param redirectUri - The provider's configured redirect URI.
 * @returns The same URI when valid.
 */
export function assertRegisteredRedirect(redirectUri: string): string {
  if (!redirectUri) {
    throw AppError.badRequest("OAuth redirect URI is not configured");
  }
  let parsed: URL;
  try {
    parsed = new URL(redirectUri);
  } catch {
    throw AppError.badRequest("OAuth redirect URI is not a valid absolute URL");
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw AppError.badRequest("OAuth redirect URI must use http(s)");
  }
  return redirectUri;
}

/** Inputs to build a provider authorization URL. */
export interface BuildAuthorizationUrlArgs {
  readonly authUrl: string;
  readonly clientId: string;
  readonly redirectUri: string;
  readonly scopes: readonly string[];
  readonly providerId: string;
  readonly accountId: string;
  readonly projectId: string;
  readonly store: OAuthFlowStorePort;
  /**
   * When true the S256 `code_challenge` is added to the authorization
   * request. The verifier is always generated and stored; sending the
   * challenge is what activates server-side PKCE verification.
   */
  readonly sendChallenge: boolean;
}

/**
 * @function buildAuthorizationUrl
 * @description Generates `state`, a PKCE pair, persists the flow record
 *   cross-pod (TTL), and returns the provider authorization URL. The
 *   verifier never leaves the server; only `code_challenge` (when
 *   `sendChallenge`) is put on the wire.
 * @param args - Provider endpoint/config + flow context + store.
 * @returns The fully-qualified authorization URL to redirect the user to.
 */
export async function buildAuthorizationUrl(args: BuildAuthorizationUrlArgs): Promise<string> {
  const redirectUri = assertRegisteredRedirect(args.redirectUri);
  const state = randomBytes(32).toString("hex");
  const pkce = createPkcePair();

  const record: OAuthFlowRecord = {
    providerId: args.providerId,
    accountId: args.accountId,
    projectId: args.projectId,
    codeVerifier: pkce.codeVerifier,
    createdAt: new Date().toISOString(),
  };
  await args.store.put(state, record, OAUTH_FLOW_TTL_SECONDS);

  const params = new URLSearchParams({
    client_id: args.clientId,
    redirect_uri: redirectUri,
    scope: args.scopes.join(" "),
    state,
    response_type: "code",
  });
  if (args.sendChallenge) {
    params.set("code_challenge", pkce.codeChallenge);
    params.set("code_challenge_method", pkce.codeChallengeMethod);
  }
  return `${args.authUrl}?${params.toString()}`;
}

/**
 * @function consumeOAuthFlow
 * @description Single-use-consumes the flow record on callback and binds it
 *   to the expected provider. A missing/expired/replayed `state`, or a
 *   provider mismatch, is an unauthorized callback.
 * @param store - The flow store.
 * @param expectedProviderId - Provider from the callback route.
 * @param state - The `state` returned by the provider.
 * @returns The bound flow record (incl. PKCE verifier).
 */
export async function consumeOAuthFlow(
  store: OAuthFlowStorePort,
  expectedProviderId: string,
  state: string
): Promise<OAuthFlowRecord> {
  const record = await store.consume(state);
  if (!record || record.providerId !== expectedProviderId) {
    throw AppError.unauthorized("OAuth state validation failed");
  }
  return record;
}
