/**
 * @file clientErrors.test.ts
 * @description A connection whose parser fails is answered with the API's one error body, on the
 *   server `createServer` builds, over a real socket, since an inject goes past Node's parser. With
 *   no request in flight: a request line the parser refuses answers `REQUEST_LINE_NOT_PARSABLE`, a
 *   header `REQUEST_HEADERS_NOT_PARSABLE`, both Transfer-Encoding and Content-Length
 *   `TRANSFER_ENCODING_CONFLICTS_WITH_CONTENT_LENGTH`, headers over Node's limit
 *   `REQUEST_HEADERS_TOO_LARGE`, a client too slow `REQUEST_TIMEOUT`, and a parser code the table
 *   does not name `REQUEST_REFUSED`; each is one whole HTTP response that closes the connection,
 *   with one line whose method and url are null and whose cause carries Node's code and none of the
 *   bytes the client sent. With a request in flight, the answer is that request's, under its own
 *   id, method and url, and its body's later failure writes no second line: a chunked framing that
 *   breaks, a body that does not arrive in time, data after a complete request; when its answer
 *   has started, no byte is written and the line says so. A connection that can no longer be
 *   written gets the line and no bytes, one the client reset gets neither, and an upload the client
 *   resets logs `REQUEST_BODY_ABORTED` under its request's id. An `Expect` header other than
 *   `100-continue` answers `EXPECTATION_UNSUPPORTED` at 417, and `100-continue` still answers
 *   `100 Continue`. A QUERY request with no content type, which the inject's types do not take,
 *   answers `CONTENT_TYPE_MISSING` at 400. The server's logger is held at `warn` and its two
 *   failure levels are recorded.
 * @layer infrastructure
 */
import { once } from "node:events";
import type { IncomingMessage } from "node:http";
import { connect, type AddressInfo, type Socket } from "node:net";
import { PassThrough } from "node:stream";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FastifyInstance } from "fastify";
import { HTTP_ERRORS } from "@shared/types";
import { FIXED_CLOCK_ISO, fixedClock, until } from "@packages/vitest-shared/determinism";
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

/** A request the server routed, as a case reads it: its id and its raw message. */
interface RoutedRequest {
  readonly id: string;
  readonly raw: IncomingMessage;
}

/** The requests the current case's server routed, in order. */
const routed: RoutedRequest[] = [];

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
  app.post("/echo", async (request) => ({ body: request.body }));
  app.get("/stream", (_request, reply) => {
    const stream = new PassThrough();
    stream.write("first chunk");
    return reply.send(stream);
  });
  app.addHook("onRequest", (request, _reply, done) => {
    routed.push({ id: request.id, raw: request.raw });
    done();
  });
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
      ipSource: "peer",
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

/**
 * @description Waits until a routed request's own message has closed, so that whatever its stream's
 *   failure leads to has run.
 * @param request - The routed request.
 */
async function closed(request: RoutedRequest | undefined): Promise<void> {
  if (request === undefined) throw new Error("no request was routed");
  const { raw } = request;
  // Not `once`, which rejects on the message's own `error`, the failure the case waits past.
  if (!raw.closed) await new Promise<void>((resolve) => raw.once("close", () => resolve()));
}

/**
 * @description The one line of a failure of a request the server routed: its own id, method, url
 *   and address.
 * @param fields - The code logged, the code answered, the source, the request and the failure.
 * @param message - The line's message.
 * @returns The line's fields and message.
 */
function requestLine(
  fields: {
    code: string;
    definition: HttpCode;
    source: string;
    correlationId: unknown;
    method: string;
    url: string;
    error: unknown;
  },
  message = "Request failed"
) {
  return [
    {
      code: fields.code,
      wireCode: fields.definition.code,
      status: fields.definition.status,
      source: fields.source,
      correlationId: fields.correlationId,
      method: fields.method,
      url: fields.url,
      ip: HOST,
      ipSource: "peer",
      error: fields.error,
    },
    message,
  ];
}

/**
 * @description What the line says of a registered error raised for a connection's failure, its
 *   cause Node's error.
 * @param definition - The code raised.
 * @param cause - Node's error: its message and its code.
 * @returns The projection.
 */
function registeredOver(definition: HttpCode, cause: { message: string; code: string }) {
  return {
    name: "RegisteredError",
    message: definition.message,
    code: definition.code,
    stack: expect.any(String),
    cause: { name: "Error", ...cause, stack: expect.any(String) },
  };
}

beforeEach(() => {
  routed.splice(0);
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

  it("answers REQUEST_LINE_NOT_PARSABLE at 400 to a request line the parser refuses, in one response that closes the connection, with one warn line", async () => {
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
    expect(body).toEqual(
      problemOf(HTTP_ERRORS.REQUEST_LINE_NOT_PARSABLE, "Request line not parsable")
    );
    expect(lines.warn.mock.calls).toEqual([
      connectionLine(HTTP_ERRORS.REQUEST_LINE_NOT_PARSABLE, body.correlationId, {
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
        HTTP_ERRORS.REQUEST_LINE_NOT_PARSABLE,
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
          ipSource: "peer",
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

  it("answers REQUEST_HEADERS_NOT_PARSABLE at 400 to a header the parser refuses, with one warn line", async () => {
    const lines = recordFailureLines(app);

    const response = responseOf(
      await exchange(port, "GET /things HTTP/1.1\r\nHost: localhost\r\nBad Header: v\r\n\r\n")
    );
    const body = JSON.parse(response.body);

    expect([response.statusLine, response.headers["content-type"]]).toEqual([
      "HTTP/1.1 400 Bad Request",
      PROBLEM_JSON,
    ]);
    expect(body).toEqual(
      problemOf(HTTP_ERRORS.REQUEST_HEADERS_NOT_PARSABLE, "Request headers not parsable")
    );
    expect(lines.warn.mock.calls).toEqual([
      connectionLine(HTTP_ERRORS.REQUEST_HEADERS_NOT_PARSABLE, body.correlationId, {
        name: "Error",
        message: "Parse Error: Invalid header token",
        code: "HPE_INVALID_HEADER_TOKEN",
      }),
    ]);
    expect([lines.error.mock.calls, routed]).toEqual([[], []]);
  });

  it("answers TRANSFER_ENCODING_CONFLICTS_WITH_CONTENT_LENGTH at 400 to a request that sends both, with one warn line", async () => {
    const lines = recordFailureLines(app);

    const response = responseOf(
      await exchange(
        port,
        "POST /echo HTTP/1.1\r\nHost: localhost\r\nContent-Type: application/json\r\nContent-Length: 2\r\nTransfer-Encoding: chunked\r\n\r\n0\r\n\r\n"
      )
    );
    const body = JSON.parse(response.body);

    expect([response.statusLine, response.headers["content-type"]]).toEqual([
      "HTTP/1.1 400 Bad Request",
      PROBLEM_JSON,
    ]);
    expect(body).toEqual(
      problemOf(
        HTTP_ERRORS.TRANSFER_ENCODING_CONFLICTS_WITH_CONTENT_LENGTH,
        "Transfer encoding conflicts with content length"
      )
    );
    expect(lines.warn.mock.calls).toEqual([
      connectionLine(
        HTTP_ERRORS.TRANSFER_ENCODING_CONFLICTS_WITH_CONTENT_LENGTH,
        body.correlationId,
        {
          name: "Error",
          message: "Parse Error: Transfer-Encoding can't be present with Content-Length",
          code: "HPE_INVALID_TRANSFER_ENCODING",
        }
      ),
    ]);
    expect([lines.error.mock.calls, routed]).toEqual([[], []]);
  });

  it("answers a request whose chunked framing breaks after its headers were read once, under its own id, method and url, with no line for its body's failure", async () => {
    const lines = recordFailureLines(app);

    const response = responseOf(
      await exchange(
        port,
        "POST /echo HTTP/1.1\r\nHost: localhost\r\nContent-Type: application/json\r\nTransfer-Encoding: chunked\r\n\r\nzz\r\n"
      )
    );
    await closed(routed[0]);
    const body = JSON.parse(response.body);

    expect(response.statusLine).toBe("HTTP/1.1 400 Bad Request");
    expect(response.headers).toEqual({
      "content-type": PROBLEM_JSON,
      "content-length": String(Buffer.byteLength(response.body)),
      connection: "close",
    });
    expect(body).toEqual({
      ...problemOf(
        HTTP_ERRORS.REQUEST_BODY_FRAMING_NOT_PARSABLE,
        "Request body framing not parsable"
      ),
      correlationId: routed[0]?.id,
    });
    expect(lines.warn.mock.calls).toEqual([
      requestLine({
        code: "REQUEST_BODY_FRAMING_NOT_PARSABLE",
        definition: HTTP_ERRORS.REQUEST_BODY_FRAMING_NOT_PARSABLE,
        source: "registered",
        correlationId: routed[0]?.id,
        method: "POST",
        url: "/echo",
        error: registeredOver(HTTP_ERRORS.REQUEST_BODY_FRAMING_NOT_PARSABLE, {
          message: "Parse Error: Invalid character in chunk size",
          code: "HPE_INVALID_CHUNK_SIZE",
        }),
      }),
    ]);
    expect([lines.error.mock.calls, vi.mocked(captureError).mock.calls]).toEqual([[], []]);
  });

  it("answers a complete request followed by data that is not a request once, under its own id, with DATA_AFTER_REQUEST_UNEXPECTED and no answer of its route", async () => {
    const lines = recordFailureLines(app);

    const response = responseOf(
      await exchange(
        port,
        "POST /echo HTTP/1.1\r\nHost: localhost\r\nContent-Type: application/json\r\nContent-Length: 2\r\nConnection: close\r\n\r\n{}x"
      )
    );
    await closed(routed[0]);
    const body = JSON.parse(response.body);

    expect([response.statusLine, response.headers["content-type"]]).toEqual([
      "HTTP/1.1 400 Bad Request",
      PROBLEM_JSON,
    ]);
    expect(body).toEqual({
      ...problemOf(HTTP_ERRORS.DATA_AFTER_REQUEST_UNEXPECTED, "Data after request unexpected"),
      correlationId: routed[0]?.id,
    });
    expect(lines.warn.mock.calls).toEqual([
      requestLine({
        code: "DATA_AFTER_REQUEST_UNEXPECTED",
        definition: HTTP_ERRORS.DATA_AFTER_REQUEST_UNEXPECTED,
        source: "registered",
        correlationId: routed[0]?.id,
        method: "POST",
        url: "/echo",
        error: registeredOver(HTTP_ERRORS.DATA_AFTER_REQUEST_UNEXPECTED, {
          message: "Parse Error: Data after `Connection: close`",
          code: "HPE_CLOSED_CONNECTION",
        }),
      }),
    ]);
    expect(lines.error.mock.calls).toEqual([]);
  });

  it("writes no byte to a connection whose answer has started, and one line saying the failure came after it", async () => {
    const lines = recordFailureLines(app);
    const socket = connect({ host: HOST, port });
    const received: Buffer[] = [];
    socket.on("data", (chunk: Buffer) => received.push(chunk));
    socket.on("error", () => undefined);
    socket.write("GET /stream HTTP/1.1\r\nHost: localhost\r\n\r\n");
    await until(() => Buffer.concat(received).toString("utf8").includes("first chunk"), {
      description: "the streamed answer's first chunk",
      timeoutMs: 2_000,
    });

    socket.write("TELL /things HTTP/1.1\r\nHost: localhost\r\n\r\n");
    await once(socket, "close");
    const raw = Buffer.concat(received).toString("utf8");

    expect(raw.startsWith("HTTP/1.1 200 OK\r\n")).toBe(true);
    expect([
      raw.includes("first chunk"),
      raw.includes("problem+json"),
      raw.includes("400"),
    ]).toEqual([true, false, false]);
    expect(lines.warn.mock.calls).toEqual([
      requestLine(
        {
          code: "DATA_AFTER_REQUEST_UNEXPECTED",
          definition: HTTP_ERRORS.DATA_AFTER_REQUEST_UNEXPECTED,
          source: "registered",
          correlationId: routed[0]?.id,
          method: "GET",
          url: "/stream",
          error: registeredOver(HTTP_ERRORS.DATA_AFTER_REQUEST_UNEXPECTED, {
            message: "Parse Error: Invalid method encountered",
            code: "HPE_INVALID_METHOD",
          }),
        },
        "Request failed after its answer was sent"
      ),
    ]);
    expect(lines.error.mock.calls).toEqual([]);
  });

  it("answers EXPECTATION_UNSUPPORTED at 417 to an Expect header other than 100-continue, with one warn line under the request's id", async () => {
    const lines = recordFailureLines(app);

    const response = responseOf(
      await exchange(
        port,
        "GET /things HTTP/1.1\r\nHost: localhost\r\nExpect: something-else\r\nConnection: close\r\n\r\n"
      )
    );
    const body = JSON.parse(response.body);

    expect(response.statusLine).toBe("HTTP/1.1 417 Expectation Failed");
    expect(response.headers).toEqual(
      expect.objectContaining({ "content-type": PROBLEM_JSON, connection: "close" })
    );
    expect(body).toEqual(problemOf(HTTP_ERRORS.EXPECTATION_UNSUPPORTED, "Expectation unsupported"));
    expect(lines.warn.mock.calls).toEqual([
      requestLine({
        code: "EXPECTATION_UNSUPPORTED",
        definition: HTTP_ERRORS.EXPECTATION_UNSUPPORTED,
        source: "registered",
        correlationId: body.correlationId,
        method: "GET",
        url: "/things",
        error: {
          name: "RegisteredError",
          message: HTTP_ERRORS.EXPECTATION_UNSUPPORTED.message,
          code: "EXPECTATION_UNSUPPORTED",
          stack: expect.any(String),
        },
      }),
    ]);
    expect([lines.error.mock.calls, routed]).toEqual([[], []]);
  });

  it("answers a parser code its table does not name with REQUEST_REFUSED at 400 and one error line under Node's code", async () => {
    const lines = recordFailureLines(app);
    const accepted = once(app.server, "connection");
    const socket = connect({ host: HOST, port });
    const received: Buffer[] = [];
    socket.on("data", (chunk: Buffer) => received.push(chunk));
    socket.on("error", () => undefined);
    const [serverSide] = (await accepted) as [Socket];

    // No request makes the installed Node raise a code the table does not name: the case hands the
    // handler one through the server's own event, as a later Node could raise it.
    app.server.emit(
      "clientError",
      Object.assign(new Error("Parse Error: Something new"), {
        code: "HPE_SOMETHING_NEW",
        reason: "Something new",
      }),
      serverSide
    );
    await once(socket, "close");
    const response = responseOf(Buffer.concat(received).toString("utf8"));
    const body = JSON.parse(response.body);

    expect([response.statusLine, response.headers["content-type"]]).toEqual([
      "HTTP/1.1 400 Bad Request",
      PROBLEM_JSON,
    ]);
    expect(body).toEqual(problemOf(HTTP_ERRORS.REQUEST_REFUSED, "Request refused"));
    expect(lines.error.mock.calls).toEqual([
      [
        {
          code: "HPE_SOMETHING_NEW",
          wireCode: "REQUEST_REFUSED",
          status: 400,
          source: "status-carrier",
          correlationId: body.correlationId,
          method: null,
          url: null,
          ip: HOST,
          ipSource: "peer",
          error: {
            name: "Error",
            message: "Parse Error: Something new",
            code: "HPE_SOMETHING_NEW",
            stack: expect.any(String),
          },
        },
        "Request failed",
      ],
    ]);
    expect(lines.warn.mock.calls).toEqual([]);
    expect(vi.mocked(captureError).mock.calls).toEqual([
      [
        expect.objectContaining({ code: "HPE_SOMETHING_NEW" }),
        {
          requestId: body.correlationId,
          correlationId: body.correlationId,
          code: "HPE_SOMETHING_NEW",
          method: null,
          url: null,
          ip: HOST,
          ipSource: "peer",
        },
      ],
    ]);
  });

  it("still answers 100 Continue to Expect: 100-continue, then the route, with no failure line", async () => {
    const lines = recordFailureLines(app);
    const socket = connect({ host: HOST, port });
    const received: Buffer[] = [];
    socket.on("data", (chunk: Buffer) => received.push(chunk));
    socket.write(
      "POST /echo HTTP/1.1\r\nHost: localhost\r\nContent-Type: application/json\r\nContent-Length: 2\r\nExpect: 100-continue\r\nConnection: close\r\n\r\n"
    );
    await until(() => Buffer.concat(received).toString("utf8").includes("100 Continue"), {
      description: "the server's 100 Continue",
      timeoutMs: 2_000,
    });

    socket.write("{}");
    await once(socket, "close");
    const raw = Buffer.concat(received).toString("utf8");

    expect(raw.startsWith("HTTP/1.1 100 Continue\r\n\r\nHTTP/1.1 200 OK\r\n")).toBe(true);
    expect(raw.endsWith('{"body":{}}')).toBe(true);
    expect([lines.warn.mock.calls, lines.error.mock.calls]).toEqual([[], []]);
  });

  it("logs REQUEST_BODY_ABORTED at warn under the request's id, saying nothing could be sent, when the client resets its upload", async () => {
    const lines = recordFailureLines(app);
    const socket = connect({ host: HOST, port });
    await once(socket, "connect");
    socket.write(
      'POST /echo HTTP/1.1\r\nHost: localhost\r\nContent-Type: application/json\r\nContent-Length: 100\r\n\r\n{"a":'
    );
    await until(() => routed.length === 1, { description: "the upload routed", timeoutMs: 2_000 });

    socket.resetAndDestroy();
    await closed(routed[0]);

    expect(lines.warn.mock.calls).toEqual([
      requestLine(
        {
          code: "ECONNRESET",
          definition: HTTP_ERRORS.REQUEST_BODY_ABORTED,
          source: "framework",
          correlationId: routed[0]?.id,
          method: "POST",
          url: "/echo",
          error: {
            name: "Error",
            message: "aborted",
            code: "ECONNRESET",
            stack: expect.any(String),
          },
        },
        "Request failed on a connection that can no longer be written"
      ),
    ]);
    expect([lines.error.mock.calls, vi.mocked(captureError).mock.calls]).toEqual([[], []]);
  });
});

describe("a client too slow to send its request, on the server createServer builds", () => {
  let app: FastifyInstance;
  let port: number;

  beforeEach(async () => {
    app = serverAsTheAppBuildsIt();
    // A request timeout far below the server's 30 seconds yet long enough for a client's first
    // bytes to arrive before it, checked every millisecond rather than every 30 seconds, Node's
    // default: Node reads the interval when the server starts to listen, so a client that sends
    // half a request is timed out within the case.
    app.server.requestTimeout = 300;
    // A body that stops arriving is timed out by the headers' timeout in Node, not the request's.
    app.server.headersTimeout = 300;
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

  it("answers a request whose body does not arrive in time once, under its own id, method and url, with no line for its body's failure", async () => {
    const lines = recordFailureLines(app);

    const response = responseOf(
      await exchange(
        port,
        "POST /echo HTTP/1.1\r\nHost: localhost\r\nContent-Type: application/json\r\nContent-Length: 10\r\n\r\n{}"
      )
    );
    await closed(routed[0]);
    const body = JSON.parse(response.body);

    expect([response.statusLine, response.headers["content-type"]]).toEqual([
      "HTTP/1.1 408 Request Timeout",
      PROBLEM_JSON,
    ]);
    expect(body).toEqual({
      ...problemOf(HTTP_ERRORS.REQUEST_TIMEOUT, "Request timeout"),
      correlationId: routed[0]?.id,
    });
    expect(lines.warn.mock.calls).toEqual([
      requestLine({
        code: "REQUEST_TIMEOUT",
        definition: HTTP_ERRORS.REQUEST_TIMEOUT,
        source: "registered",
        correlationId: routed[0]?.id,
        method: "POST",
        url: "/echo",
        error: registeredOver(HTTP_ERRORS.REQUEST_TIMEOUT, {
          message: "Request timeout",
          code: "ERR_HTTP_REQUEST_TIMEOUT",
        }),
      }),
    ]);
    expect([lines.error.mock.calls, vi.mocked(captureError).mock.calls]).toEqual([[], []]);
  });
});
