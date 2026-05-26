/**
 * @file pkce.ts
 * @description RFC 7636 PKCE (Proof Key for Code Exchange) primitives for the
 *              OAuth 2.1 authorization-code flow. OAuth 2.1 makes PKCE
 *              mandatory for every authorization-code client; S256 is the
 *              mandatory-to-implement transform and is the only method this
 *              helper emits (`plain` is intentionally unsupported).
 * @layer infrastructure
 */
import { createHash, randomBytes } from "crypto";

/** The only challenge method we emit — S256 is MTI per RFC 7636 / OAuth 2.1. */
export const PKCE_METHOD_S256 = "S256" as const;

/**
 * A PKCE pair: the secret `codeVerifier` (kept server-side, sent only at
 * token exchange) and the public `codeChallenge` (sent on the authorization
 * request).
 */
export interface PkcePair {
  readonly codeVerifier: string;
  readonly codeChallenge: string;
  readonly codeChallengeMethod: typeof PKCE_METHOD_S256;
}

/**
 * @function createPkcePair
 * @description Generates an RFC 7636 S256 PKCE pair. 32 random bytes
 *   base64url-encode to a 43-character verifier — within the required
 *   43–128 range and drawn only from the unreserved set
 *   `[A-Za-z0-9-_]` (a subset of the RFC's `[A-Za-z0-9-._~]`).
 * @returns The verifier, its S256 challenge, and the method tag.
 */
export function createPkcePair(): PkcePair {
  const codeVerifier = randomBytes(32).toString("base64url");
  const codeChallenge = createHash("sha256").update(codeVerifier).digest("base64url");
  return { codeVerifier, codeChallenge, codeChallengeMethod: PKCE_METHOD_S256 };
}

/**
 * @function deriveCodeChallenge
 * @description Derives the S256 challenge for a given verifier
 *   (`BASE64URL(SHA256(ASCII(verifier)))`). Exposed for verification and
 *   RFC 7636 Appendix-B test vectors.
 * @param codeVerifier - The PKCE verifier.
 * @returns The base64url S256 challenge.
 */
export function deriveCodeChallenge(codeVerifier: string): string {
  return createHash("sha256").update(codeVerifier).digest("base64url");
}
