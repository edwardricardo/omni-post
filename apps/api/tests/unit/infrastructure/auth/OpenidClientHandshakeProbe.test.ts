/**
 * @file OpenidClientHandshakeProbe.test.ts
 * @description Tests for the openid-client-backed handshake probe. Per canon
 *              `oidc-client-secret-validation-clientcredentialsgrant`, the
 *              probe chains discovery + clientCredentialsGrant. Mocks both
 *              openid-client functions to verify wiring + the
 *              strict/partial/error result mapping.
 * @layer infrastructure
 */

import { describe, it, vi, beforeEach } from "vitest";
import assert from "node:assert/strict";

const { discoveryMock, clientCredentialsGrantMock } = vi.hoisted(() => ({
  discoveryMock: vi.fn(),
  clientCredentialsGrantMock: vi.fn(),
}));

vi.mock("openid-client", () => ({
  discovery: discoveryMock,
  clientCredentialsGrant: clientCredentialsGrantMock,
}));

import { OpenidClientHandshakeProbe } from "../../../../src/infrastructure/auth/OpenidClientHandshakeProbe.js";

const FAKE_CONFIG = { metadata: { issuer: "x" } };

describe("OpenidClientHandshakeProbe", () => {
  beforeEach(() => {
    discoveryMock.mockReset();
    clientCredentialsGrantMock.mockReset();
  });

  it("calls openidClient.discovery with URL + clientId + clientSecret", async () => {
    discoveryMock.mockResolvedValue(FAKE_CONFIG);
    clientCredentialsGrantMock.mockResolvedValue({ access_token: "ignored" });
    const probe = new OpenidClientHandshakeProbe();
    await probe.discover({
      issuerUrl: "https://accounts.example.com",
      clientId: "client-abc",
      clientSecret: "secret-123",
    });
    const args = discoveryMock.mock.calls[0];
    assert.ok(args);
    assert.equal((args[0] as URL).toString(), "https://accounts.example.com/");
    assert.equal(args[1], "client-abc");
    assert.equal(args[2], "secret-123");
  });

  it("returns { validated: 'strict' } when both discovery + clientCredentialsGrant succeed", async () => {
    discoveryMock.mockResolvedValue(FAKE_CONFIG);
    clientCredentialsGrantMock.mockResolvedValue({ access_token: "ignored" });
    const probe = new OpenidClientHandshakeProbe();
    const result = await probe.discover({
      issuerUrl: "https://accounts.example.com",
      clientId: "client-abc",
      clientSecret: "secret-123",
    });
    assert.deepEqual(result, { validated: "strict" });
    // clientCredentialsGrant is called AFTER discovery (token-endpoint auth)
    assert.equal(clientCredentialsGrantMock.mock.calls.length, 1);
    assert.equal(clientCredentialsGrantMock.mock.calls[0]?.[0], FAKE_CONFIG);
  });

  it("returns { validated: 'partial', reason } when IdP rejects client_credentials with unsupported_grant_type", async () => {
    discoveryMock.mockResolvedValue(FAKE_CONFIG);
    const idpError = Object.assign(new Error("token endpoint rejected"), {
      error: "unsupported_grant_type",
    });
    clientCredentialsGrantMock.mockRejectedValue(idpError);
    const probe = new OpenidClientHandshakeProbe();
    const result = await probe.discover({
      issuerUrl: "https://accounts.example.com",
      clientId: "client-abc",
      clientSecret: "secret-123",
    });
    assert.deepEqual(result, { validated: "partial", reason: "unsupported_grant_type" });
  });

  it("propagates invalid_client error from token endpoint (use case maps to VALIDATION_FAILED)", async () => {
    discoveryMock.mockResolvedValue(FAKE_CONFIG);
    const invalidClientErr = Object.assign(new Error("client authentication failed"), {
      error: "invalid_client",
    });
    clientCredentialsGrantMock.mockRejectedValue(invalidClientErr);
    const probe = new OpenidClientHandshakeProbe();
    await assert.rejects(
      probe.discover({
        issuerUrl: "https://accounts.example.com",
        clientId: "client-abc",
        clientSecret: "wrong",
      }),
      /client authentication failed/
    );
  });

  it("propagates errors from openidClient.discovery (network / malformed metadata)", async () => {
    discoveryMock.mockRejectedValue(new Error("issuer not found"));
    const probe = new OpenidClientHandshakeProbe();
    await assert.rejects(
      probe.discover({
        issuerUrl: "https://accounts.example.com",
        clientId: "client-abc",
        clientSecret: "x",
      }),
      /issuer not found/
    );
    assert.equal(clientCredentialsGrantMock.mock.calls.length, 0);
  });
});
