/**
 * @file OpenidClientHandshakeProbe.ts
 * @description Production adapter for the OIDC handshake probe port. Per canon
 *   `oidc-client-secret-validation-clientcredentialsgrant`, real validation
 *   of `clientSecret` requires hitting the token endpoint — `discovery()` only
 *   fetches the public well-known metadata and does NOT authenticate the
 *   client. This adapter chains both:
 *     1. `openidClient.discovery(...)` — validates issuerUrl + builds Configuration
 *     2. `openidClient.clientCredentialsGrant(config)` — authenticates clientSecret
 *        against the IdP's token endpoint per RFC 6749 > 5.2
 *   Returns `{ validated: "strict" }` on full validation; `{ validated: "partial" }`
 *   when the IdP rejects `client_credentials` grant with `unsupported_grant_type`.
 *   Any other error (`invalid_client`, network/timeout, malformed metadata)
 *   propagates as a rejection — the use case maps it to VALIDATION_FAILED.
 *   Token returned by clientCredentialsGrant is intentionally discarded; never
 *   logged or persisted.
 * @layer infrastructure
 */

import * as openidClient from "openid-client";
import type {
  OidcHandshakeProbe,
  OidcHandshakeResult,
} from "@core/auth/ReplaceOidcClientSecretUseCase.js";

export class OpenidClientHandshakeProbe implements OidcHandshakeProbe {
  async discover(input: {
    issuerUrl: string;
    clientId: string;
    clientSecret: string;
  }): Promise<OidcHandshakeResult> {
    const config = await openidClient.discovery(
      new URL(input.issuerUrl),
      input.clientId,
      input.clientSecret
    );
    try {
      // Token returned here is intentionally not assigned to a logger-reachable
      // variable — out of scope after this statement. Discarded by GC.
      await openidClient.clientCredentialsGrant(config);
      return { validated: "strict" };
    } catch (error: unknown) {
      const code = (error as { error?: unknown })?.error;
      if (code === "unsupported_grant_type") {
        // IdP doesn't allow client_credentials (common for SSO-only configs).
        // Validation is partial; caller decides what to do.
        return { validated: "partial", reason: "unsupported_grant_type" };
      }
      throw error;
    }
  }
}
