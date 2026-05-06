/**
 * @file OpenidClientHandshakeProbe.ts
 * @description Production adapter for the OIDC handshake probe port. Delegates
 *              to `openid-client`'s discovery flow which validates the issuer +
 *              clientId + clientSecret combination against the IdP's well-known
 *              endpoint. Throws on any handshake failure (use case maps to
 *              VALIDATION_FAILED).
 * @layer infrastructure
 */

import * as openidClient from "openid-client";
import type { OidcHandshakeProbe } from "../../application/auth/ReplaceOidcClientSecretUseCase.js";

export class OpenidClientHandshakeProbe implements OidcHandshakeProbe {
  async discover(input: {
    issuerUrl: string;
    clientId: string;
    clientSecret: string;
  }): Promise<void> {
    await openidClient.discovery(new URL(input.issuerUrl), input.clientId, input.clientSecret);
  }
}
