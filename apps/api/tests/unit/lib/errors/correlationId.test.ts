/**
 * @file correlationId.test.ts
 * @description Every request on a server `createServer` builds is named by an id of its own, a
 *   random UUID the server generates, which a failure's body and line carry as its correlation id:
 *   two servers, as two boots or two instances, never hand out the same one, and no header a client
 *   sends chooses it.
 * @layer infrastructure
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FastifyInstance } from "fastify";
import { createServer } from "../../../../src/index.js";
import {
  createErrorHandler,
  createNotFoundHandler,
} from "../../../../src/lib/errors/errorHandler.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

/**
 * @description Builds the server as `createApp` does up to its routes, with a route that answers
 *   the id the server gave its request, and its logger held at `warn`.
 * @returns The server, ready.
 */
async function serverAsTheAppBuildsIt(): Promise<FastifyInstance> {
  const app = createServer();
  app.log.level = "warn";
  app.setErrorHandler(createErrorHandler(app.log));
  app.setNotFoundHandler(createNotFoundHandler(app.log));
  app.get("/id", async (request) => ({ id: request.id }));
  await app.ready();
  return app;
}

describe("the id of a request on the server createServer builds", () => {
  const servers: FastifyInstance[] = [];

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(async () => {
    await Promise.all(servers.splice(0).map((server) => server.close()));
  });

  it("is a UUID of its own on every request of every server, and is the correlation id of its failure's body and line", async () => {
    servers.push(await serverAsTheAppBuildsIt(), await serverAsTheAppBuildsIt());
    const warnings = servers.map((server) =>
      vi.spyOn(server.log, "warn").mockImplementation(() => undefined)
    );

    const answers: Array<Readonly<Record<string, unknown>>> = [];
    for (const server of servers) {
      for (const url of ["/id", "/id", "/nowhere"]) {
        answers.push((await server.inject({ method: "GET", url })).json());
      }
    }
    const ids = answers.map((answer) => answer["id"] ?? answer["correlationId"]);

    expect(ids).toEqual(ids.map(() => expect.stringMatching(UUID)));
    expect(new Set(ids).size).toBe(ids.length);
    expect(warnings.map((warning) => warning.mock.calls.map(([fields]) => fields))).toEqual([
      [expect.objectContaining({ code: "ROUTE_NOT_FOUND", correlationId: ids[2] })],
      [expect.objectContaining({ code: "ROUTE_NOT_FOUND", correlationId: ids[5] })],
    ]);
  });

  it("reads no id from a header the client sends", async () => {
    servers.push(await serverAsTheAppBuildsIt());
    const chosen = "chosen-by-the-client";

    const answer = await servers[0]?.inject({
      method: "GET",
      url: "/id",
      headers: { "request-id": chosen, "x-request-id": chosen, "x-correlation-id": chosen },
    });

    expect(answer?.json()).toEqual({ id: expect.stringMatching(UUID) });
  });
});
