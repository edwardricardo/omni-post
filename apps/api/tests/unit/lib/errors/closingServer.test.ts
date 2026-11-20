/**
 * @file closingServer.test.ts
 * @description A request that reaches the server `createServer` builds while it closes is refused
 *   with the API's one error body: `SERVER_CLOSING` at 503, with `Connection: close` so the client
 *   sends it again on a new connection, its route never run, and one error line reported to Sentry.
 *   A request that arrived before the server began to close is answered by its route. Read over a
 *   real keep-alive connection, since a closing server takes no new one: the second request is sent
 *   on it once the server has stopped listening, while the first is still in its route.
 * @layer infrastructure
 */
import { once } from "node:events";
import { connect, type AddressInfo } from "node:net";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FastifyInstance } from "fastify";
import { HTTP_ERRORS, RegisteredError } from "@shared/types";
import { createDeferred, until, type Deferred } from "@packages/vitest-shared/determinism";
import { captureError } from "../../../../src/observability/sentryInit.js";
import { createServer } from "../../../../src/index.js";
import {
  createErrorHandler,
  createNotFoundHandler,
} from "../../../../src/lib/errors/errorHandler.js";

vi.mock("../../../../src/observability/sentryInit.js", () => ({ captureError: vi.fn() }));

const HOST = "127.0.0.1";
const PROBLEM_JSON = "application/problem+json; charset=utf-8";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
/** The clock runs: the waits below read it to end, so the instant is any ISO one. */
const ISO_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

/** One HTTP response read off the connection. */
interface RawResponse {
  readonly statusLine: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: string;
}

/**
 * @description Reads the responses a connection carried, one after the other, each by its
 *   `Content-Length`.
 * @param raw - What the server sent.
 * @returns The responses, in order.
 */
function responsesOf(raw: string): RawResponse[] {
  const responses: RawResponse[] = [];
  let rest = raw;
  while (rest !== "") {
    const end = rest.indexOf("\r\n\r\n");
    const [statusLine = "", ...headerLines] = rest.slice(0, end).split("\r\n");
    const headers = Object.fromEntries(
      headerLines.map((line) => {
        const colon = line.indexOf(":");
        return [line.slice(0, colon).toLowerCase(), line.slice(colon + 1).trim()];
      })
    );
    const length = Number(headers["content-length"]);
    responses.push({ statusLine, headers, body: rest.slice(end + 4, end + 4 + length) });
    rest = rest.slice(end + 4 + length);
  }
  return responses;
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("a request that reaches the server createServer builds while it closes", () => {
  let app: FastifyInstance;
  let release: Deferred<void>;
  let closed: Promise<undefined> | undefined;

  beforeEach(() => {
    app = createServer();
    release = createDeferred<void>();
    closed = undefined;
  });

  afterEach(async () => {
    release.resolve();
    await (closed ?? app.close());
  });

  it("answers SERVER_CLOSING at 503 with Connection: close, never runs its route, and writes one error line reported to Sentry", async () => {
    app.log.level = "warn";
    app.setErrorHandler(createErrorHandler(app.log));
    app.setNotFoundHandler(createNotFoundHandler(app.log));
    const reached: string[] = [];
    app.get("/slow", async () => {
      reached.push("/slow");
      await release.promise;
      return { done: true };
    });
    app.get("/things", async () => {
      reached.push("/things");
      return {};
    });
    const lines = {
      warn: vi.spyOn(app.log, "warn").mockImplementation(() => undefined),
      error: vi.spyOn(app.log, "error").mockImplementation(() => undefined),
    };
    await app.listen({ host: HOST, port: 0 });
    const socket = connect({ host: HOST, port: (app.server.address() as AddressInfo).port });
    const received: Buffer[] = [];
    socket.on("data", (chunk: Buffer) => received.push(chunk));
    socket.write("GET /slow HTTP/1.1\r\nHost: localhost\r\n\r\n");
    await until(() => reached.length === 1, { description: "the first request in its route" });

    closed = app.close();
    await until(() => !app.server.listening, { description: "the server to stop listening" });
    socket.write("GET /things HTTP/1.1\r\nHost: localhost\r\n\r\n");
    // A deadline below the case's own, so a missing line fails as this wait rather than as the case.
    await until(() => lines.error.mock.calls.length === 1, {
      description: "the second request's line",
      timeoutMs: 2_000,
    });
    release.resolve();
    await once(socket, "close");
    await closed;
    const [first, second] = responsesOf(Buffer.concat(received).toString("utf8"));
    const body = JSON.parse(second?.body ?? "");

    expect([first?.statusLine, first?.body]).toEqual(["HTTP/1.1 200 OK", '{"done":true}']);
    expect(second?.statusLine).toBe("HTTP/1.1 503 Service Unavailable");
    expect(second?.headers).toEqual(
      expect.objectContaining({ "content-type": PROBLEM_JSON, connection: "close" })
    );
    expect(body).toEqual({
      type: "https://omnipost.app/problems/SERVER_CLOSING",
      title: "Server closing",
      status: 503,
      detail: HTTP_ERRORS.SERVER_CLOSING.message,
      code: "SERVER_CLOSING",
      correlationId: expect.stringMatching(UUID),
      timestamp: expect.stringMatching(ISO_INSTANT),
    });
    expect(reached).toEqual(["/slow"]);
    expect(lines.error.mock.calls).toEqual([
      [
        {
          code: "SERVER_CLOSING",
          wireCode: "SERVER_CLOSING",
          status: 503,
          source: "registered",
          correlationId: body.correlationId,
          method: "GET",
          url: "/things",
          ip: HOST,
          error: {
            name: "RegisteredError",
            message: HTTP_ERRORS.SERVER_CLOSING.message,
            code: "SERVER_CLOSING",
            stack: expect.any(String),
          },
        },
        "Request failed",
      ],
    ]);
    expect(lines.warn.mock.calls).toEqual([]);
    expect(vi.mocked(captureError).mock.calls).toEqual([
      [
        expect.any(RegisteredError),
        {
          requestId: body.correlationId,
          correlationId: body.correlationId,
          code: "SERVER_CLOSING",
          method: "GET",
          url: "/things",
          ip: HOST,
        },
      ],
    ]);
  });
});
