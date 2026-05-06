/**
 * @file OpenidClientHandshakeProbe.test.ts
 * @description Smoke contract test for the openid-client-backed handshake
 *              probe. Mocks the openid-client.discovery export to verify the
 *              adapter wires URL + clientId + clientSecret into the underlying
 *              call and surfaces errors as plain rejections (use case maps
 *              them to VALIDATION_FAILED).
 * @layer infrastructure
 */

import { describe, it, vi, beforeEach } from "vitest";
import assert from "node:assert/strict";

const { discoveryMock } = vi.hoisted(() => ({ discoveryMock: vi.fn() }));

vi.mock("openid-client", () => ({
  discovery: discoveryMock,
}));

import { OpenidClientHandshakeProbe } from "../../../../src/infrastructure/auth/OpenidClientHandshakeProbe.js";

describe("OpenidClientHandshakeProbe", () => {
  beforeEach(() => {
    discoveryMock.mockReset();
  });

  it("calls openidClient.discovery with URL + clientId + clientSecret", async () => {
    discoveryMock.mockResolvedValue({} as unknown);
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

  it("propagates errors from openidClient.discovery (use case maps to VALIDATION_FAILED)", async () => {
    discoveryMock.mockRejectedValue(new Error("invalid_client"));
    const probe = new OpenidClientHandshakeProbe();
    await assert.rejects(
      probe.discover({
        issuerUrl: "https://accounts.example.com",
        clientId: "client-abc",
        clientSecret: "wrong",
      }),
      /invalid_client/
    );
  });
});
