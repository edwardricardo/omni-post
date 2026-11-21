/**
 * @file clientAddressSource.test.ts
 * @description Under `trusted-ranges`, with the loopback as the trusted proxy, every failure line
 *   says where its address comes from, beside the address, on the server `createServer` builds: a
 *   request the proxy forwards names the client the proxy reports as `forwarded`; one it forwards
 *   nobody for names the proxy as `peer`; and a connection whose request line never parsed names
 *   the proxy itself as `peer`, since no forwarded address was ever read. The model is read from the
 *   environment when the server's modules load, so they are loaded once, after it is set; the
 *   `socket-only` model has its own file, `clientAddressSourceSocketOnly.test.ts`.
 * @layer infrastructure
 */
import { once } from "node:events";
import { connect, type AddressInfo } from "node:net";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { FastifyInstance } from "fastify";

vi.mock("../../../../src/observability/sentryInit.js", () => ({ captureError: vi.fn() }));

const LOOPBACK = "127.0.0.1";
const CLIENT = "198.51.100.7";

describe("the address a failure line names, and its source, under trusted-ranges", () => {
  let app: FastifyInstance;
  let port: number;
  const warnings: unknown[] = [];

  beforeAll(async () => {
    vi.stubEnv("TRUSTED_PROXY_MODE", "trusted-ranges");
    vi.stubEnv("TRUSTED_PROXY_RANGES", LOOPBACK);
    const { createServer } = await import("../../../../src/index.js");
    const { createErrorHandler, createNotFoundHandler } =
      await import("../../../../src/lib/errors/errorHandler.js");
    app = createServer();
    app.log.level = "warn";
    app.setErrorHandler(createErrorHandler(app.log));
    app.setNotFoundHandler(createNotFoundHandler(app.log));
    vi.spyOn(app.log, "warn").mockImplementation((fields: unknown) => {
      warnings.push(fields);
    });
    await app.listen({ host: LOOPBACK, port: 0 });
    port = (app.server.address() as AddressInfo).port;
  });

  afterAll(async () => {
    await app.close();
    vi.unstubAllEnvs();
  });

  beforeEach(() => {
    warnings.splice(0);
  });

  /** Each recorded line's address and its source. */
  function addresses() {
    return warnings.map((fields) => {
      const { ip, ipSource } = fields as { ip: unknown; ipSource: unknown };
      return { ip, ipSource };
    });
  }

  it("names the client a trusted proxy forwards as forwarded, and the proxy itself as peer when it forwards nobody", async () => {
    await app.inject({
      method: "GET",
      url: "/nowhere",
      remoteAddress: LOOPBACK,
      headers: { "x-forwarded-for": CLIENT },
    });
    await app.inject({ method: "GET", url: "/nowhere", remoteAddress: LOOPBACK });

    expect(addresses()).toEqual([
      { ip: CLIENT, ipSource: "forwarded" },
      { ip: LOOPBACK, ipSource: "peer" },
    ]);
  });

  it("names the proxy as peer on a connection whose request line never parsed", async () => {
    const socket = connect({ host: LOOPBACK, port });
    socket.on("data", () => undefined);
    socket.on("error", () => undefined);

    socket.write(`TELL /things HTTP/1.1\r\nHost: localhost\r\nX-Forwarded-For: ${CLIENT}\r\n\r\n`);
    await once(socket, "close");

    expect(addresses()).toEqual([{ ip: LOOPBACK, ipSource: "peer" }]);
  });
});
