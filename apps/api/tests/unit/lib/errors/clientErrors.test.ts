/**
 * @file clientErrors.test.ts
 * @description A connection whose request Node's HTTP parser cannot finish is answered with the
 *   API's one error body, on the server `createServer` builds, over a real socket, since no request
 *   exists for an inject: a request line the parser refuses answers `REQUEST_NOT_PARSABLE` at 400,
 *   headers over Node's limit `REQUEST_HEADERS_TOO_LARGE` at 431, and a client too slow to send its
 *   request `REQUEST_TIMEOUT` at 408. Each is one whole HTTP response that closes the connection,
 *   with one warn line whose method and url are null, since no request line was read, and whose
 *   cause carries Node's code and none of the bytes the client sent. A connection that can no longer
 *   be written gets the line and no bytes, and one the client reset gets neither. Beside them, a
 *   QUERY request with no content type, which the framework refuses once it has routed it and the
 *   inject's types do not take, answers `CONTENT_TYPE_MISSING` at 400. The server's logger is
 *   held at `warn` and its two failure levels are recorded.
 * @layer infrastructure
 */
import { once } from "node:events";
import { connect, type AddressInfo, type Socket } from "node:net";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FastifyInstance } from "fastify";
import { HTTP_ERRORS } from "@shared/types";
import { FIXED_CLOCK_ISO, fixedClock } from "@packages/vitest-shared/determinism";
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
/** A value the client sends in its headers, which must reach neither the line nor the answer. */
const PLANTED = "Bearer planted-token-5be1";

/** One HTTP response read off the socket. */
interface RawResponse {
  readonly statusLine: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: string;
}

/**
 * @description Builds the server as `createApp` does up to its routes, with its logger held at
 *   `warn` so only failures are written.
 * @returns The server, not yet listening.
 */
function serverAsTheAppBuildsIt(): FastifyInstance {
  const app = createServer();
  app.log.level = "warn";
  app.setErrorHandler(createErrorHandler(app.log));
  app.setNotFoundHandler(createNotFoundHandler(app.log));
  app.get("/things", async () => ({}));
  return app;
}

/**
 * @description Records the server logger's two failure levels instead of writing them.
 * @param app - The server whose logger the answer is written to.
 * @returns The two spies, whose calls are the failure lines.
 */
function recordFailureLines(app: FastifyInstance) {
  return {
    warn: vi.spyOn(app.log, "warn").mockImplementation(() => undefined),
    error: vi.spyOn(app.log, "error").mockImplementation(() => undefined),
  };
}

/**
 * @description Listens on an ephemeral port of the loopback.
 * @param app - The server.
 * @returns The port it listens on.
 */
async function listen(app: FastifyInstance): Promise<number> {
  await app.listen({ host: HOST, port: 0 });
  return (app.server.address() as AddressInfo).port;
}

/**
 * @description Opens a connection, writes the bytes, and reads everything the server sends until
 *   the connection closes.
 * @param port - The server's port.
 * @param bytes - What the client sends.
 * @returns What the server sent.
 */
async function exchange(port: number, bytes: string): Promise<string> {
  const socket = connect({ host: HOST, port });
  const received: Buffer[] = [];
  socket.on("data", (chunk: Buffer) => received.push(chunk));
  // A reset that follows the answer, when the server closes with bytes of the request it never
  // read, is the transport's; what is asserted is what the server sent before it.
  socket.on("error", () => undefined);
  socket.write(bytes);
  await once(socket, "close");
  return Buffer.concat(received).toString("utf8");
}

/**
 * @description Reads the one response of an exchange: its status line, its headers by lower-case
 *   name, and its body.
 * @param raw - What the server sent.
 * @returns The response.
 */
function responseOf(raw: string): RawResponse {
  const end = raw.indexOf("\r\n\r\n");
  const [statusLine = "", ...headerLines] = raw.slice(0, end).split("\r\n");
  const headers = Object.fromEntries(
    headerLines.map((line) => {
      const colon = line.indexOf(":");
      return [line.slice(0, colon).toLowerCase(), line.slice(colon + 1).trim()];
    })
  );
  return { statusLine, headers, body: raw.slice(end + 4) };
}

/** What a case reads of an `http` code's definition. */
interface HttpCode {
  readonly code: string;
  readonly status: number;
  readonly message: string;
}

/**
 * @description The problem of an `http` code as the answer carries it, its id generated.
 * @param definition - The code's definition.
 * @param title - The code in words.
 * @returns The body every member of which the answer must hold.
 */
function problemOf(definition: HttpCode, title: string) {
  return {
    type: `https://omnipost.app/problems/${definition.code}`,
    title,
    status: definition.status,
    detail: definition.message,
    code: definition.code,
    correlationId: expect.stringMatching(UUID),
    timestamp: FIXED_CLOCK_ISO,
  };
}

/**
 * @description The one warn line of a connection's failure: no request line was read, so its
 *   method and url are null, and its cause is Node's error.
 * @param definition - The code answered.
 * @param correlationId - The id the body carries.
 * @param cause - What the line says of Node's error.
 * @param message - The line's message.
 * @returns The line's fields and message.
 */
function connectionLine(
  definition: HttpCode,
  correlationId: unknown,
  cause: { name: string; message: string; code: string },
  message = "Request failed"
) {
  return [
    {
      code: definition.code,
      wireCode: definition.code,
      status: definition.status,
      source: "registered",
      correlationId,
      method: null,
      url: null,
      ip: HOST,
      error: {
        name: "RegisteredError",
        message: definition.message,
        code: definition.code,
        stack: expect.any(String),
        cause: { ...cause, stack: expect.any(String) },
      },
    },
    message,
  ];
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(fixedClock());
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("a connection whose request cannot be read, on the server createServer builds", () => {
  let app: FastifyInstance;
  let port: number;

  beforeEach(async () => {
    app = serverAsTheAppBuildsIt();
    port = await listen(app);
  });

  afterEach(async () => {
    await app.close();
  });

  it("answers REQUEST_NOT_PARSABLE at 400 to a request line the parser refuses, in one response that closes the connection, with one warn line", async () => {
    const lines = recordFailureLines(app);

    const response = responseOf(
      await exchange(
        port,
        `TELL /things HTTP/1.1\r\nHost: localhost\r\nAuthorization: ${PLANTED}\r\n\r\n`
      )
    );
    const body = JSON.parse(response.body);

    expect(response).toEqual({
      statusLine: "HTTP/1.1 400 Bad Request",
      headers: {
        "content-type": PROBLEM_JSON,
        "content-length": String(Buffer.byteLength(response.body)),
        connection: "close",
      },
      body: response.body,
    });
    expect(body).toEqual(problemOf(HTTP_ERRORS.REQUEST_NOT_PARSABLE, "Request not parsable"));
    expect(lines.warn.mock.calls).toEqual([
      connectionLine(HTTP_ERRORS.REQUEST_NOT_PARSABLE, body.correlationId, {
        name: "Error",
        message: "Parse Error: Invalid method encountered",
        code: "HPE_INVALID_METHOD",
      }),
    ]);
    expect(JSON.stringify(lines.warn.mock.calls).includes(PLANTED)).toBe(false);
    expect([lines.error.mock.calls, vi.mocked(captureError).mock.calls]).toEqual([[], []]);
  });

  it("answers REQUEST_HEADERS_TOO_LARGE at 431 to headers over Node's limit, and keeps the headers out of the line and the answer", async () => {
    const lines = recordFailureLines(app);
    const oversized = `${PLANTED} ${"a".repeat(17_000)}`;

    const raw = await exchange(
      port,
      `GET /things HTTP/1.1\r\nHost: localhost\r\nAuthorization: ${oversized}\r\n\r\n`
    );
    const response = responseOf(raw);
    const body = JSON.parse(response.body);

    expect(response).toEqual({
      statusLine: "HTTP/1.1 431 Request Header Fields Too Large",
      headers: {
        "content-type": PROBLEM_JSON,
        "content-length": String(Buffer.byteLength(response.body)),
        connection: "close",
      },
      body: response.body,
    });
    expect(body).toEqual(
      problemOf(HTTP_ERRORS.REQUEST_HEADERS_TOO_LARGE, "Request headers too large")
    );
    expect(lines.warn.mock.calls).toEqual([
      connectionLine(HTTP_ERRORS.REQUEST_HEADERS_TOO_LARGE, body.correlationId, {
        name: "Error",
        message: "Parse Error: Header overflow",
        code: "HPE_HEADER_OVERFLOW",
      }),
    ]);
    expect(`${JSON.stringify(lines.warn.mock.calls)}${raw}`.includes(PLANTED)).toBe(false);
    expect([lines.error.mock.calls, vi.mocked(captureError).mock.calls]).toEqual([[], []]);
  });

  it("writes the line and nothing to a connection that can no longer be written", async () => {
    const lines = recordFailureLines(app);
    const accepted = once(app.server, "connection");
    // Half-open, so the connection stays open once the server has ended its side.
    const socket = connect({ host: HOST, port, allowHalfOpen: true });
    const received: Buffer[] = [];
    socket.on("data", (chunk: Buffer) => received.push(chunk));
    socket.on("error", () => undefined);
    const [serverSide] = (await accepted) as [Socket];
    serverSide.end();
    await once(socket, "end");

    // Node emits no `clientError` once a connection's write side has ended, yet the framework's
    // documentation asks a handler to check the socket before it writes, as Node's own handler
    // does: the case hands the handler such a connection through the server's own event, with the
    // error Node raises for a request line it refuses.
    app.server.emit(
      "clientError",
      Object.assign(new Error("Parse Error: Invalid method encountered"), {
        code: "HPE_INVALID_METHOD",
      }),
      serverSide
    );
    socket.end();
    await once(socket, "close");

    expect(received).toEqual([]);
    expect(lines.warn.mock.calls).toEqual([
      connectionLine(
        HTTP_ERRORS.REQUEST_NOT_PARSABLE,
        expect.stringMatching(UUID),
        {
          name: "Error",
          message: "Parse Error: Invalid method encountered",
          code: "HPE_INVALID_METHOD",
        },
        "Request failed on a connection that can no longer be written"
      ),
    ]);
    expect(lines.error.mock.calls).toEqual([]);
  });

  it("answers CONTENT_TYPE_MISSING at 400 to a QUERY request with no content type, read once routed, with one warn line under Fastify's code", async () => {
    const lines = recordFailureLines(app);

    const response = responseOf(
      await exchange(port, "QUERY /things HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n")
    );
    const body = JSON.parse(response.body);

    expect(response.statusLine).toBe("HTTP/1.1 400 Bad Request");
    expect(response.headers).toEqual(
      expect.objectContaining({ "content-type": PROBLEM_JSON, connection: "close" })
    );
    expect(body).toEqual(problemOf(HTTP_ERRORS.CONTENT_TYPE_MISSING, "Content type missing"));
    expect(lines.warn.mock.calls).toEqual([
      [
        {
          code: "FST_ERR_ROUTE_MISSING_CONTENT_TYPE",
          wireCode: "CONTENT_TYPE_MISSING",
          status: 400,
          source: "framework",
          correlationId: body.correlationId,
          method: "QUERY",
          url: "/things",
          ip: HOST,
          error: {
            name: "FastifyError",
            message: "Method 'QUERY' must provide a 'Content-Type' header.",
            code: "FST_ERR_ROUTE_MISSING_CONTENT_TYPE",
            stack: expect.any(String),
          },
        },
        "Request failed",
      ],
    ]);
    expect([lines.error.mock.calls, vi.mocked(captureError).mock.calls]).toEqual([[], []]);
  });

  it("leaves a connection the client reset as it is, and writes no line", async () => {
    const lines = recordFailureLines(app);
    const reported = once(app.server, "clientError");
    const socket = connect({ host: HOST, port });
    await once(socket, "connect");
    socket.write("GET /things HTTP/1.1\r\n");

    socket.resetAndDestroy();
    const [error] = (await reported) as [NodeJS.ErrnoException];

    expect(error.code).toBe("ECONNRESET");
    expect([lines.warn.mock.calls, lines.error.mock.calls]).toEqual([[], []]);
  });
});

describe("a client too slow to send its request, on the server createServer builds", () => {
  let app: FastifyInstance;
  let port: number;

  beforeEach(async () => {
    app = serverAsTheAppBuildsIt();
    // The smallest request timeout that fires (0 turns it off), checked every millisecond rather
    // than every 30 seconds, Node's default: Node reads the interval when the server starts to
    // listen, so a client that sends half a request is timed out within the case.
    app.server.requestTimeout = 1;
    Object.assign(app.server, { connectionsCheckingInterval: 1 });
    port = await listen(app);
  });

  afterEach(async () => {
    await app.close();
  });

  it("answers REQUEST_TIMEOUT at 408, in one response that closes the connection, with one warn line", async () => {
    const lines = recordFailureLines(app);

    const response = responseOf(await exchange(port, "GET /things HTTP/1.1\r\nHost: local"));
    const body = JSON.parse(response.body);

    expect(response).toEqual({
      statusLine: "HTTP/1.1 408 Request Timeout",
      headers: {
        "content-type": PROBLEM_JSON,
        "content-length": String(Buffer.byteLength(response.body)),
        connection: "close",
      },
      body: response.body,
    });
    expect(body).toEqual(problemOf(HTTP_ERRORS.REQUEST_TIMEOUT, "Request timeout"));
    expect(lines.warn.mock.calls).toEqual([
      connectionLine(HTTP_ERRORS.REQUEST_TIMEOUT, body.correlationId, {
        name: "Error",
        message: "Request timeout",
        code: "ERR_HTTP_REQUEST_TIMEOUT",
      }),
    ]);
    expect([lines.error.mock.calls, vi.mocked(captureError).mock.calls]).toEqual([[], []]);
  });
});
