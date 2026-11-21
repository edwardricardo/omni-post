/**
 * @file clientAddressSourceSocketOnly.test.ts
 * @description Under `socket-only` every failure line names the connection's peer as its address,
 *   with the source `peer`, on the server `createServer` builds, whatever the request says it
 *   forwards: the model ignores every forwarding header. The model is read from the environment
 *   when the server's modules load, so they are loaded once, after it is set; `trusted-ranges` has
 *   its own file, `clientAddressSource.test.ts`.
 * @layer infrastructure
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { FastifyInstance } from "fastify";

vi.mock("../../../../src/observability/sentryInit.js", () => ({ captureError: vi.fn() }));

const LOOPBACK = "127.0.0.1";
const CLIENT = "198.51.100.7";

describe("the address a failure line names, and its source, under socket-only", () => {
  let app: FastifyInstance;
  const warnings: unknown[] = [];

  beforeAll(async () => {
    vi.stubEnv("TRUSTED_PROXY_MODE", "socket-only");
    vi.stubEnv("TRUSTED_PROXY_RANGES", "");
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
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
    vi.unstubAllEnvs();
  });

  it("names the peer, whatever the request says it forwards", async () => {
    await app.inject({
      method: "GET",
      url: "/nowhere",
      remoteAddress: LOOPBACK,
      headers: { "x-forwarded-for": CLIENT },
    });

    expect(
      warnings.map((fields) => {
        const { ip, ipSource } = fields as { ip: unknown; ipSource: unknown };
        return { ip, ipSource };
      })
    ).toEqual([{ ip: LOOPBACK, ipSource: "peer" }]);
  });
});
