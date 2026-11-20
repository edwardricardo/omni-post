/**
 * @file clientErrors.test.ts
 * @description A connection whose parser fails is answered with the API's one error body, on the
 *   server `createServer` builds, over a real socket, since an inject goes past Node's parser. With
 *   no request in flight: a request line the parser refuses answers `REQUEST_LINE_NOT_PARSABLE`, a
 *   header `REQUEST_HEADERS_NOT_PARSABLE`, both Transfer-Encoding and Content-Length
 *   `TRANSFER_ENCODING_CONFLICTS_WITH_CONTENT_LENGTH` in either order, a Content-Length sent twice
 *   `CONTENT_LENGTH_REPEATED`, headers over Node's limit `REQUEST_HEADERS_TOO_LARGE`, a client too
 *   slow `REQUEST_TIMEOUT`, and a parser code the table does not name `REQUEST_REFUSED`; each is one
 *   whole HTTP response that closes the connection, with one line whose method and url are null and
 *   whose cause carries Node's code and none of the bytes the client sent. llhttp's reasons that
 *   decide a code are pinned on real sockets. With a request in flight whose own message fails, the
 *   answer is that request's, under its own id, method and url, and its body's later failure writes
 *   no second line: a chunked framing that breaks, a body that does not arrive in time, a body that
 *   breaks after an early answer; when its answer has started, no byte is written and the line says
 *   so. A message that fails after a complete request in flight is its own event: the request is
 *   answered by its route, then the failure under its own id with the request in flight named on
 *   its line, in that order, and the connection closes. A connection that can no longer be written
 *   gets the line and no bytes, one the client reset gets neither, and an upload the client resets
 *   logs `REQUEST_BODY_ABORTED` under its request's id. An `Expect` header other than
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
import {
  FIXED_CLOCK_ISO,
  createDeferred,
  fixedClock,
  until,
  type Deferred,
} from "@packages/vitest-shared/determinism";
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
/** The message of the line a request read on a connection already refused writes. */
const NOT_TAKEN = "Request not taken: its connection was already refused";
/** A value the client sends in its headers, which must reach neither the line nor the answer. */
const PLANTED = "Bearer planted-token-5be1";

/** A request the server routed, as a case reads it: its id and its raw message. */
interface RoutedRequest {
  readonly id: string;
  readonly raw: IncomingMessage;
}

/** The requests the current case's server routed, in order. */
const routed: RoutedRequest[] = [];
/** The streams the current case's streamed answers write, for the case to end. */
const openStreams: PassThrough[] = [];
/** What the route `/slow` waits on before it answers. */
let slowRelease: Deferred<void> = createDeferred<void>();
/** What the route `/slow2` waits on before it answers. */
let slow2Release: Deferred<void> = createDeferred<void>();
/** The ids of the requests whose answers the current case's server has sent, in order. */
const answered: string[] = [];

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
    openStreams.push(stream);
    return reply.send(stream);
  });
  app.get("/slow", async () => {
    await slowRelease.promise;
    return { slow: true };
  });
  app.get("/slow2", async () => {
    await slow2Release.promise;
    return { slow: 2 };
  });
  // Never answers, so a case holds a request in flight for as long as the case lasts.
  app.get("/hang", async () => new Promise<never>(() => undefined));
  app.post(
    "/stream-early",
    {
      // Answers before the body is read, so the answer has started while the body still arrives.
      onRequest: (_request, reply) => {
        const stream = new PassThrough();
        stream.write("first chunk");
        openStreams.push(stream);
        reply.send(stream);
      },
    },
    async () => ({})
  );
  app.post(
    "/answer-early",
    {
      // Answers whole before the body is read, so the body still arrives once the answer is sent.
      onRequest: (_request, reply) => {
        reply.send({ early: true });
      },
    },
    async () => ({})
  );
  app.addHook("onRequest", (request, _reply, done) => {
    routed.push({ id: request.id, raw: request.raw });
    done();
  });
  app.addHook("onResponse", (request, _reply, done) => {
    answered.push(request.id);
    done();
  });
  return app;
}

/**
 * @description The connections the server holds, as Node counts them.
 * @param app - The server.
 * @returns How many there are.
 */
async function connectionsOf(app: FastifyInstance): Promise<number> {
  return new Promise((resolve, reject) => {
    app.server.getConnections((error, count) => (error ? reject(error) : resolve(count)));
  });
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
 * @description The one line of a message that failed after a request in flight on its connection:
 *   its own generated id, null method and url, and the request in flight named by its id.
 * @param definition - The code answered.
 * @param cause - Node's error: its message and its code.
 * @param inFlightCorrelationId - The correlation id of the request in flight.
 * @param message - The line's message.
 * @returns The line's fields and message.
 */
function followingLine(
  definition: HttpCode,
  cause: { message: string; code: string },
  inFlightCorrelationId: unknown,
  message = "Request failed"
) {
  return [
    {
      code: definition.code,
      wireCode: definition.code,
      status: definition.status,
      source: "registered",
      correlationId: expect.stringMatching(UUID),
      method: null,
      url: null,
      ip: HOST,
      ipSource: "peer",
      inFlightCorrelationId,
      error: registeredOver(definition, cause),
    },
    message,
  ];
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
  answered.splice(0);
  openStreams.splice(0);
  slowRelease = createDeferred<void>();
  slow2Release = createDeferred<void>();
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

  it("answers a complete request as if nothing followed it, and logs the data after it as its own event, which a connection the request closes can no longer carry", async () => {
    const lines = recordFailureLines(app);

    const response = responseOf(
      await exchange(
        port,
        "POST /echo HTTP/1.1\r\nHost: localhost\r\nContent-Type: application/json\r\nContent-Length: 2\r\nConnection: close\r\n\r\n{}x"
      )
    );
    await until(() => lines.warn.mock.calls.length === 1, {
      description: "the line of the data after the request",
      timeoutMs: 2_000,
    });

    expect([response.statusLine, response.body]).toEqual(["HTTP/1.1 200 OK", '{"body":{}}']);
    expect(lines.warn.mock.calls).toEqual([
      followingLine(
        HTTP_ERRORS.DATA_AFTER_REQUEST_UNEXPECTED,
        { message: "Parse Error: Data after `Connection: close`", code: "HPE_CLOSED_CONNECTION" },
        routed[0]?.id,
        "Request failed on a connection that can no longer be written"
      ),
    ]);
    expect(lines.warn.mock.calls[0]?.[0]).not.toEqual(
      expect.objectContaining({ correlationId: routed[0]?.id })
    );
    expect(lines.error.mock.calls).toEqual([]);
  });

  it("lets a streamed answer finish when the next message fails, then answers that message on its own, in order", async () => {
    const lines = recordFailureLines(app);
    const failed = once(app.server, "clientError");
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
    await failed;
    openStreams[0]?.end("last chunk");
    await once(socket, "close");
    const raw = Buffer.concat(received).toString("utf8");
    const refusal = raw.indexOf("HTTP/1.1 400 Bad Request");

    expect([raw.startsWith("HTTP/1.1 200 OK\r\n"), raw.indexOf("last chunk") < refusal]).toEqual([
      true,
      true,
    ]);
    expect(raw.slice(refusal - 5, refusal)).toBe("0\r\n\r\n");
    expect(JSON.parse(responseOf(raw.slice(refusal)).body)).toEqual(
      problemOf(HTTP_ERRORS.REQUEST_LINE_NOT_PARSABLE, "Request line not parsable")
    );
    expect(lines.warn.mock.calls).toEqual([
      followingLine(
        HTTP_ERRORS.REQUEST_LINE_NOT_PARSABLE,
        { message: "Parse Error: Invalid method encountered", code: "HPE_INVALID_METHOD" },
        routed[0]?.id
      ),
    ]);
    expect(lines.error.mock.calls).toEqual([]);
  });

  it.each([
    [
      "an invalid method",
      "TELL /things HTTP/1.1\r\nHost: localhost\r\n\r\n",
      HTTP_ERRORS.REQUEST_LINE_NOT_PARSABLE,
      "Request line not parsable",
      { message: "Parse Error: Invalid method encountered", code: "HPE_INVALID_METHOD" },
    ],
    [
      "an invalid header",
      "GET /things HTTP/1.1\r\nHost: localhost\r\nBad Header: v\r\n\r\n",
      HTTP_ERRORS.REQUEST_HEADERS_NOT_PARSABLE,
      "Request headers not parsable",
      { message: "Parse Error: Invalid header token", code: "HPE_INVALID_HEADER_TOKEN" },
    ],
    [
      "Transfer-Encoding with Content-Length",
      "POST /echo HTTP/1.1\r\nHost: localhost\r\nContent-Length: 2\r\nTransfer-Encoding: chunked\r\n\r\n",
      HTTP_ERRORS.TRANSFER_ENCODING_CONFLICTS_WITH_CONTENT_LENGTH,
      "Transfer encoding conflicts with content length",
      {
        message: "Parse Error: Transfer-Encoding can't be present with Content-Length",
        code: "HPE_INVALID_TRANSFER_ENCODING",
      },
    ],
    [
      "a repeated Content-Length",
      "POST /echo HTTP/1.1\r\nHost: localhost\r\nContent-Length: 2\r\nContent-Length: 3\r\n\r\n",
      HTTP_ERRORS.CONTENT_LENGTH_REPEATED,
      "Content length repeated",
      { message: "Parse Error: Duplicate Content-Length", code: "HPE_UNEXPECTED_CONTENT_LENGTH" },
    ],
  ])(
    "answers a request in flight as if nothing followed it, then %s after it on its own, in order, and closes",
    async (_name, following, definition, title, cause) => {
      const lines = recordFailureLines(app);
      const failed = once(app.server, "clientError");
      const socket = connect({ host: HOST, port });
      const received: Buffer[] = [];
      socket.on("data", (chunk: Buffer) => received.push(chunk));
      socket.write("GET /slow HTTP/1.1\r\nHost: localhost\r\n\r\n");
      await until(() => routed.length === 1, { description: "the first request routed" });

      socket.write(following);
      await failed;
      slowRelease.resolve();
      await once(socket, "close");
      const raw = Buffer.concat(received).toString("utf8");
      const refusal = raw.indexOf("HTTP/1.1 400 Bad Request");
      const first = responseOf(raw.slice(0, refusal));
      const second = responseOf(raw.slice(refusal));

      expect([first.statusLine, first.body]).toEqual(["HTTP/1.1 200 OK", '{"slow":true}']);
      expect(second.headers).toEqual({
        "content-type": PROBLEM_JSON,
        "content-length": String(Buffer.byteLength(second.body)),
        connection: "close",
      });
      expect(JSON.parse(second.body)).toEqual(problemOf(definition, title));
      expect(JSON.parse(second.body).correlationId).not.toBe(routed[0]?.id);
      expect(lines.warn.mock.calls).toEqual([followingLine(definition, cause, routed[0]?.id)]);
      expect([lines.error.mock.calls, vi.mocked(captureError).mock.calls]).toEqual([[], []]);
    }
  );

  it("ends its side of a connection whose client ends its own in the middle of a message that follows a request still unanswered, and writes nothing, with one line", async () => {
    const lines = recordFailureLines(app);
    const socket = connect({ host: HOST, port });
    const received: Buffer[] = [];
    socket.on("data", (chunk: Buffer) => received.push(chunk));
    socket.on("error", () => undefined);
    socket.write("GET /hang HTTP/1.1\r\nHost: localhost\r\n\r\n");
    await until(() => routed.length === 1, { description: "the first request routed" });

    const failed = once(app.server, "clientError");
    socket.end("GET /things HTTP/1.1\r\nHo");
    await failed;
    await until(async () => (await connectionsOf(app)) === 0, {
      description: "the server's connection closed",
      timeoutMs: 2_000,
    });
    await until(() => lines.warn.mock.calls.length === 1, { description: "the failure's line" });

    expect(received).toEqual([]);
    expect(lines.warn.mock.calls).toEqual([
      followingLine(
        HTTP_ERRORS.REQUEST_INCOMPLETE,
        // Node builds the end of data's error without its reason (`socketOnEnd`).
        { message: "Parse Error", code: "HPE_INVALID_EOF_STATE" },
        routed[0]?.id,
        "Request failed on a connection that can no longer be written"
      ),
    ]);
    expect(lines.error.mock.calls).toEqual([]);
  });

  it("closes a connection whose client ends its side after a following message failed to parse, while the request in flight is unanswered, and writes nothing, with one line", async () => {
    const lines = recordFailureLines(app);
    const socket = connect({ host: HOST, port });
    const received: Buffer[] = [];
    socket.on("data", (chunk: Buffer) => received.push(chunk));
    socket.on("error", () => undefined);
    socket.write("GET /hang HTTP/1.1\r\nHost: localhost\r\n\r\n");
    await until(() => routed.length === 1, { description: "the first request routed" });
    const failed = once(app.server, "clientError");
    socket.write("TELL /things HTTP/1.1\r\n");
    await failed;

    socket.end();
    await until(async () => (await connectionsOf(app)) === 0, {
      description: "the server's connection closed",
      timeoutMs: 2_000,
    });
    await until(() => lines.warn.mock.calls.length === 1, { description: "the failure's line" });

    expect(received).toEqual([]);
    expect(lines.warn.mock.calls).toEqual([
      followingLine(
        HTTP_ERRORS.REQUEST_LINE_NOT_PARSABLE,
        { message: "Parse Error: Invalid method encountered", code: "HPE_INVALID_METHOD" },
        routed[0]?.id,
        "Request failed on a connection that can no longer be written"
      ),
    ]);
    expect(lines.error.mock.calls).toEqual([]);
  });

  it("answers CONNECT_NOT_IMPLEMENTED at 501 to a CONNECT request, in one response that closes the connection, with one error line and its report", async () => {
    const lines = recordFailureLines(app);

    const response = responseOf(
      await exchange(port, "CONNECT example.com:443 HTTP/1.1\r\nHost: example.com:443\r\n\r\n")
    );
    const body = JSON.parse(response.body);

    expect(response).toEqual({
      statusLine: "HTTP/1.1 501 Not Implemented",
      headers: {
        "content-type": PROBLEM_JSON,
        "content-length": String(Buffer.byteLength(response.body)),
        connection: "close",
      },
      body: response.body,
    });
    expect(body).toEqual(problemOf(HTTP_ERRORS.CONNECT_NOT_IMPLEMENTED, "Connect not implemented"));
    expect(lines.error.mock.calls).toEqual([
      [
        {
          code: "CONNECT_NOT_IMPLEMENTED",
          wireCode: "CONNECT_NOT_IMPLEMENTED",
          status: 501,
          source: "registered",
          correlationId: body.correlationId,
          method: "CONNECT",
          url: "example.com:443",
          ip: HOST,
          ipSource: "peer",
          error: {
            name: "RegisteredError",
            message: HTTP_ERRORS.CONNECT_NOT_IMPLEMENTED.message,
            code: "CONNECT_NOT_IMPLEMENTED",
            stack: expect.any(String),
          },
        },
        "Request failed",
      ],
    ]);
    expect(vi.mocked(captureError).mock.calls).toEqual([
      [
        expect.objectContaining({ code: "CONNECT_NOT_IMPLEMENTED" }),
        {
          requestId: body.correlationId,
          correlationId: body.correlationId,
          code: "CONNECT_NOT_IMPLEMENTED",
          method: "CONNECT",
          url: "example.com:443",
          ip: HOST,
          ipSource: "peer",
        },
      ],
    ]);
    expect([lines.warn.mock.calls, routed]).toEqual([[], []]);
  });

  it("answers a CONNECT request behind a request in flight after that request's answer, then closes, with the request it waited for on its line", async () => {
    const lines = recordFailureLines(app);
    const socket = connect({ host: HOST, port });
    const received: Buffer[] = [];
    socket.on("data", (chunk: Buffer) => received.push(chunk));
    socket.write("GET /slow HTTP/1.1\r\nHost: localhost\r\n\r\n");
    await until(() => routed.length === 1, { description: "the first request routed" });
    const tunnel = once(app.server, "connect");
    socket.write("CONNECT example.com:443 HTTP/1.1\r\nHost: example.com:443\r\n\r\n");
    await tunnel;

    slowRelease.resolve();
    await once(socket, "close");
    const raw = Buffer.concat(received).toString("utf8");
    const refusal = raw.indexOf("HTTP/1.1 501 Not Implemented");

    expect(raw.split("HTTP/1.1 ").map((response) => response.slice(0, 3))).toEqual([
      "",
      "200",
      "501",
    ]);
    expect(responseOf(raw.slice(0, refusal)).body).toBe('{"slow":true}');
    expect(lines.error.mock.calls).toEqual([
      [
        expect.objectContaining({
          code: "CONNECT_NOT_IMPLEMENTED",
          correlationId: JSON.parse(responseOf(raw.slice(refusal)).body).correlationId,
          method: "CONNECT",
          url: "example.com:443",
          inFlightCorrelationId: routed[0]?.id,
        }),
        "Request failed",
      ],
    ]);
    expect(lines.warn.mock.calls).toEqual([]);
  });

  it("ends its side of a connection whose client ends its own while a CONNECT waits behind a request still unanswered, and writes nothing, with one line", async () => {
    const lines = recordFailureLines(app);
    const socket = connect({ host: HOST, port });
    const received: Buffer[] = [];
    socket.on("data", (chunk: Buffer) => received.push(chunk));
    socket.on("error", () => undefined);
    socket.write("GET /hang HTTP/1.1\r\nHost: localhost\r\n\r\n");
    await until(() => routed.length === 1, { description: "the first request routed" });
    const tunnel = once(app.server, "connect");
    socket.write("CONNECT example.com:443 HTTP/1.1\r\nHost: example.com:443\r\n\r\n");
    await tunnel;

    // Bytes after the CONNECT's head that arrive in a later chunk wait in the socket's own buffer,
    // ahead of the client's end, until something reads them.
    socket.end("tunnel bytes");
    await until(async () => (await connectionsOf(app)) === 0, {
      description: "the server's connection closed",
    });
    await until(() => lines.error.mock.calls.length === 1, { description: "the failure's line" });

    expect(received).toEqual([]);
    expect(lines.error.mock.calls).toEqual([
      [
        expect.objectContaining({
          code: "CONNECT_NOT_IMPLEMENTED",
          method: "CONNECT",
          url: "example.com:443",
          inFlightCorrelationId: routed[0]?.id,
        }),
        "Request failed on a connection that can no longer be written",
      ],
    ]);
    expect(lines.warn.mock.calls).toEqual([]);
  });

  it("closes a connection whose client resets it while a CONNECT waits behind a request still unanswered, with one line and no error thrown", async () => {
    const lines = recordFailureLines(app);
    const socket = connect({ host: HOST, port });
    socket.on("error", () => undefined);
    socket.write("GET /hang HTTP/1.1\r\nHost: localhost\r\n\r\n");
    await until(() => routed.length === 1, { description: "the first request routed" });
    const tunnel = once(app.server, "connect");
    socket.write("CONNECT example.com:443 HTTP/1.1\r\nHost: example.com:443\r\n\r\n");
    await tunnel;

    // The server's socket fails with the reset; an error nothing listens for would be thrown.
    socket.resetAndDestroy();
    await until(async () => (await connectionsOf(app)) === 0, {
      description: "the server's connection closed",
    });
    await until(() => lines.error.mock.calls.length === 1, { description: "the failure's line" });

    expect(lines.error.mock.calls).toEqual([
      [
        expect.objectContaining({
          code: "CONNECT_NOT_IMPLEMENTED",
          inFlightCorrelationId: routed[0]?.id,
        }),
        "Request failed on a connection that can no longer be written",
      ],
    ]);
  });

  it("ends its side of a connection whose client ends its own in the middle of a body behind a request still unanswered, and writes nothing, with the body's one line", async () => {
    const lines = recordFailureLines(app);
    const socket = connect({ host: HOST, port });
    const received: Buffer[] = [];
    socket.on("data", (chunk: Buffer) => received.push(chunk));
    socket.on("error", () => undefined);
    socket.write(
      "GET /hang HTTP/1.1\r\nHost: localhost\r\n\r\nPOST /echo HTTP/1.1\r\nHost: localhost\r\nContent-Type: application/json\r\nTransfer-Encoding: chunked\r\n\r\n"
    );
    await until(() => routed.length === 2, { description: "both requests routed" });

    const failed = once(app.server, "clientError");
    socket.end();
    await failed;
    await until(async () => (await connectionsOf(app)) === 0, {
      description: "the server's connection closed",
    });
    await until(() => lines.warn.mock.calls.length === 1, { description: "the failure's line" });

    expect(received).toEqual([]);
    expect(lines.warn.mock.calls).toEqual([
      [
        expect.objectContaining({
          code: "REQUEST_INCOMPLETE",
          correlationId: routed[1]?.id,
          method: "POST",
          url: "/echo",
          inFlightCorrelationId: routed[0]?.id,
        }),
        "Request failed on a connection that can no longer be written",
      ],
    ]);
    expect(lines.error.mock.calls).toEqual([]);
  });

  it("answers at once, naming no request ahead, a request whose body breaks after the request before it on the connection was answered", async () => {
    const lines = recordFailureLines(app);
    const socket = connect({ host: HOST, port });
    const received: Buffer[] = [];
    socket.on("data", (chunk: Buffer) => received.push(chunk));
    socket.write("GET /things HTTP/1.1\r\nHost: localhost\r\n\r\n");
    await until(() => answered.length === 1, { description: "the first answer sent" });
    socket.write(
      "POST /echo HTTP/1.1\r\nHost: localhost\r\nContent-Type: application/json\r\nTransfer-Encoding: chunked\r\n\r\n"
    );
    await until(() => routed.length === 2, { description: "the second request routed" });

    socket.write("zz\r\n");
    await once(socket, "close");
    const raw = Buffer.concat(received).toString("utf8");

    expect(raw.split("HTTP/1.1 ").map((response) => response.slice(0, 3))).toEqual([
      "",
      "200",
      "400",
    ]);
    expect(lines.warn.mock.calls).toEqual([
      requestLine({
        code: "REQUEST_BODY_FRAMING_NOT_PARSABLE",
        definition: HTTP_ERRORS.REQUEST_BODY_FRAMING_NOT_PARSABLE,
        source: "registered",
        correlationId: routed[1]?.id,
        method: "POST",
        url: "/echo",
        error: registeredOver(HTTP_ERRORS.REQUEST_BODY_FRAMING_NOT_PARSABLE, {
          message: "Parse Error: Invalid character in chunk size",
          code: "HPE_INVALID_CHUNK_SIZE",
        }),
      }),
    ]);
  });

  it("answers a request whose body breaks behind a request still in flight after that request's answer, under its own id, then closes", async () => {
    const lines = recordFailureLines(app);
    const socket = connect({ host: HOST, port });
    const received: Buffer[] = [];
    socket.on("data", (chunk: Buffer) => received.push(chunk));
    socket.write(
      "GET /slow HTTP/1.1\r\nHost: localhost\r\n\r\nPOST /echo HTTP/1.1\r\nHost: localhost\r\nContent-Type: application/json\r\nTransfer-Encoding: chunked\r\n\r\n"
    );
    await until(() => routed.length === 2, { description: "both requests routed" });
    const failed = once(app.server, "clientError");
    socket.write("zz\r\n");
    await failed;

    slowRelease.resolve();
    await once(socket, "close");
    const raw = Buffer.concat(received).toString("utf8");
    const refusal = raw.indexOf("HTTP/1.1 400 Bad Request");

    expect(raw.split("HTTP/1.1 ").map((response) => response.slice(0, 3))).toEqual([
      "",
      "200",
      "400",
    ]);
    expect(responseOf(raw.slice(0, refusal)).body).toBe('{"slow":true}');
    expect(JSON.parse(responseOf(raw.slice(refusal)).body)).toEqual({
      ...problemOf(
        HTTP_ERRORS.REQUEST_BODY_FRAMING_NOT_PARSABLE,
        "Request body framing not parsable"
      ),
      correlationId: routed[1]?.id,
    });
    const [line] = requestLine({
      code: "REQUEST_BODY_FRAMING_NOT_PARSABLE",
      definition: HTTP_ERRORS.REQUEST_BODY_FRAMING_NOT_PARSABLE,
      source: "registered",
      correlationId: routed[1]?.id,
      method: "POST",
      url: "/echo",
      error: registeredOver(HTTP_ERRORS.REQUEST_BODY_FRAMING_NOT_PARSABLE, {
        message: "Parse Error: Invalid character in chunk size",
        code: "HPE_INVALID_CHUNK_SIZE",
      }),
    });
    expect(lines.warn.mock.calls).toEqual([
      [{ ...(line as object), inFlightCorrelationId: routed[0]?.id }, "Request failed"],
    ]);
    expect(lines.error.mock.calls).toEqual([]);
  });

  it("answers the oldest of three requests, then the failure of the second, and never reads the third, which follows a body the parser refused", async () => {
    const lines = recordFailureLines(app);
    const socket = connect({ host: HOST, port });
    const received: Buffer[] = [];
    socket.on("data", (chunk: Buffer) => received.push(chunk));
    socket.write(
      "GET /slow HTTP/1.1\r\nHost: localhost\r\n\r\nPOST /echo HTTP/1.1\r\nHost: localhost\r\nContent-Type: application/json\r\nTransfer-Encoding: chunked\r\n\r\n"
    );
    await until(() => routed.length === 2, { description: "both requests routed" });
    const failed = once(app.server, "clientError");
    socket.write("zz\r\nGET /things HTTP/1.1\r\nHost: localhost\r\n\r\n");
    await failed;

    slowRelease.resolve();
    await once(socket, "close");
    const raw = Buffer.concat(received).toString("utf8");

    expect(raw.split("HTTP/1.1 ").map((response) => response.slice(0, 3))).toEqual([
      "",
      "200",
      "400",
    ]);
    expect(routed.map(({ raw: message }) => message.url)).toEqual(["/slow", "/echo"]);
    expect(lines.warn.mock.calls).toEqual([
      [
        expect.objectContaining({
          code: "REQUEST_BODY_FRAMING_NOT_PARSABLE",
          correlationId: routed[1]?.id,
          inFlightCorrelationId: routed[0]?.id,
        }),
        "Request failed",
      ],
    ]);
  });

  it("answers a request whose body breaks behind two requests in flight after both answers, waiting for the later one", async () => {
    const lines = recordFailureLines(app);
    const socket = connect({ host: HOST, port });
    const received: Buffer[] = [];
    socket.on("data", (chunk: Buffer) => received.push(chunk));
    socket.write(
      "GET /slow HTTP/1.1\r\nHost: localhost\r\n\r\nGET /slow2 HTTP/1.1\r\nHost: localhost\r\n\r\nPOST /echo HTTP/1.1\r\nHost: localhost\r\nContent-Type: application/json\r\nTransfer-Encoding: chunked\r\n\r\n"
    );
    await until(() => routed.length === 3, { description: "three requests routed" });
    const failed = once(app.server, "clientError");
    socket.write("zz\r\n");
    await failed;

    slowRelease.resolve();
    await until(() => Buffer.concat(received).toString("utf8").includes('{"slow":true}'), {
      description: "the first answer",
    });
    slow2Release.resolve();
    await once(socket, "close");
    const raw = Buffer.concat(received).toString("utf8");

    expect(raw.split("HTTP/1.1 ").map((response) => response.slice(0, 3))).toEqual([
      "",
      "200",
      "200",
      "400",
    ]);
    expect([raw.indexOf('{"slow":true}') < raw.indexOf('{"slow":2}')]).toEqual([true]);
    expect(lines.warn.mock.calls).toEqual([
      [
        expect.objectContaining({
          code: "REQUEST_BODY_FRAMING_NOT_PARSABLE",
          correlationId: routed[2]?.id,
          inFlightCorrelationId: routed[1]?.id,
        }),
        "Request failed",
      ],
    ]);
  });

  it("answers the failure of a following message once, whatever the client sends after it", async () => {
    const lines = recordFailureLines(app);
    const socket = connect({ host: HOST, port });
    const received: Buffer[] = [];
    socket.on("data", (chunk: Buffer) => received.push(chunk));
    socket.write("GET /slow HTTP/1.1\r\nHost: localhost\r\n\r\n");
    await until(() => routed.length === 1, { description: "the first request routed" });

    const failed = once(app.server, "clientError");
    socket.write("TELL /things HTTP/1.1\r\n");
    await failed;
    // The parser stays failed, so Node raises its error again for each chunk that follows.
    const failedAgain = once(app.server, "clientError");
    socket.write("still not a request\r\n");
    await failedAgain;
    slowRelease.resolve();
    await once(socket, "close");
    const raw = Buffer.concat(received).toString("utf8");

    expect(raw.split("HTTP/1.1 ").map((response) => response.slice(0, 3))).toEqual([
      "",
      "200",
      "400",
    ]);
    expect(lines.warn.mock.calls).toEqual([
      followingLine(
        HTTP_ERRORS.REQUEST_LINE_NOT_PARSABLE,
        { message: "Parse Error: Invalid method encountered", code: "HPE_INVALID_METHOD" },
        routed[0]?.id
      ),
    ]);
    expect(lines.error.mock.calls).toEqual([]);
  });

  it("writes no byte to a connection whose answer started before its own body failed, and one line saying the failure came after it", async () => {
    const lines = recordFailureLines(app);
    const socket = connect({ host: HOST, port });
    const received: Buffer[] = [];
    socket.on("data", (chunk: Buffer) => received.push(chunk));
    socket.on("error", () => undefined);
    socket.write(
      "POST /stream-early HTTP/1.1\r\nHost: localhost\r\nContent-Type: application/json\r\nTransfer-Encoding: chunked\r\n\r\n"
    );
    await until(() => Buffer.concat(received).toString("utf8").includes("first chunk"), {
      description: "the streamed answer's first chunk",
      timeoutMs: 2_000,
    });

    socket.write("zz\r\n");
    await once(socket, "close");
    const raw = Buffer.concat(received).toString("utf8");

    expect(raw.startsWith("HTTP/1.1 200 OK\r\n")).toBe(true);
    expect([raw.includes("first chunk"), raw.includes("problem+json")]).toEqual([true, false]);
    expect(lines.warn.mock.calls).toEqual([
      requestLine(
        {
          code: "REQUEST_BODY_FRAMING_NOT_PARSABLE",
          definition: HTTP_ERRORS.REQUEST_BODY_FRAMING_NOT_PARSABLE,
          source: "registered",
          correlationId: routed[0]?.id,
          method: "POST",
          url: "/stream-early",
          error: registeredOver(HTTP_ERRORS.REQUEST_BODY_FRAMING_NOT_PARSABLE, {
            message: "Parse Error: Invalid character in chunk size",
            code: "HPE_INVALID_CHUNK_SIZE",
          }),
        },
        "Request failed after its answer was sent"
      ),
    ]);
    expect(lines.error.mock.calls).toEqual([]);
  });

  it("names the headers, by Node's code, when a Transfer-Encoding the parser refuses is found once the request is in flight", async () => {
    const lines = recordFailureLines(app);

    const response = responseOf(
      await exchange(
        port,
        "POST /echo HTTP/1.1\r\nHost: localhost\r\nContent-Type: application/json\r\nTransfer-Encoding: gzip\r\n\r\n{}"
      )
    );
    await closed(routed[0]);
    const body = JSON.parse(response.body);

    expect(body).toEqual({
      ...problemOf(HTTP_ERRORS.REQUEST_HEADERS_NOT_PARSABLE, "Request headers not parsable"),
      correlationId: routed[0]?.id,
    });
    expect(lines.warn.mock.calls).toEqual([
      requestLine({
        code: "REQUEST_HEADERS_NOT_PARSABLE",
        definition: HTTP_ERRORS.REQUEST_HEADERS_NOT_PARSABLE,
        source: "registered",
        correlationId: routed[0]?.id,
        method: "POST",
        url: "/echo",
        error: registeredOver(HTTP_ERRORS.REQUEST_HEADERS_NOT_PARSABLE, {
          message: "Parse Error: Request has invalid `Transfer-Encoding`",
          code: "HPE_INVALID_TRANSFER_ENCODING",
        }),
      }),
    ]);
    expect(lines.error.mock.calls).toEqual([]);
  });

  it("names the body's framing, by the position, when a body breaks after its request was answered whole, and writes no byte after that answer", async () => {
    const lines = recordFailureLines(app);
    const socket = connect({ host: HOST, port });
    const received: Buffer[] = [];
    socket.on("data", (chunk: Buffer) => received.push(chunk));
    socket.on("error", () => undefined);
    socket.write(
      "POST /answer-early HTTP/1.1\r\nHost: localhost\r\nContent-Type: application/json\r\nTransfer-Encoding: chunked\r\n\r\n"
    );
    await until(() => answered.length === 1, { description: "the early answer sent" });

    socket.write("2;a\x01\r\n");
    await once(socket, "close");
    const raw = Buffer.concat(received).toString("utf8");

    expect([raw.startsWith("HTTP/1.1 200 OK\r\n"), raw.endsWith('{"early":true}')]).toEqual([
      true,
      true,
    ]);
    expect(lines.warn.mock.calls).toEqual([
      requestLine(
        {
          code: "REQUEST_BODY_FRAMING_NOT_PARSABLE",
          definition: HTTP_ERRORS.REQUEST_BODY_FRAMING_NOT_PARSABLE,
          source: "registered",
          correlationId: routed[0]?.id,
          method: "POST",
          url: "/answer-early",
          error: registeredOver(HTTP_ERRORS.REQUEST_BODY_FRAMING_NOT_PARSABLE, {
            message: "Parse Error: Invalid character in chunk extensions name",
            code: "HPE_STRICT",
          }),
        },
        "Request failed after its answer was sent"
      ),
    ]);
    expect(lines.error.mock.calls).toEqual([]);
  });

  it.each([
    ["its request line", "GET /thi"],
    ["its headers", "GET /things HTTP/1.1\r\nHost: loc"],
  ])(
    "answers REQUEST_INCOMPLETE at 400 when the client ends its side in the middle of %s with no request in flight, an answer it can still read",
    async (_name, cut) => {
      const lines = recordFailureLines(app);
      const socket = connect({ host: HOST, port });
      const received: Buffer[] = [];
      socket.on("data", (chunk: Buffer) => received.push(chunk));
      socket.on("error", () => undefined);

      socket.end(cut);
      await once(socket, "close");
      const response = responseOf(Buffer.concat(received).toString("utf8"));
      const body = JSON.parse(response.body);

      expect(response.statusLine).toBe("HTTP/1.1 400 Bad Request");
      expect(body).toEqual(problemOf(HTTP_ERRORS.REQUEST_INCOMPLETE, "Request incomplete"));
      expect(lines.warn.mock.calls).toEqual([
        connectionLine(HTTP_ERRORS.REQUEST_INCOMPLETE, body.correlationId, {
          name: "Error",
          // Node builds the end of data's error without its reason (`socketOnEnd`).
          message: "Parse Error",
          code: "HPE_INVALID_EOF_STATE",
        }),
      ]);
      expect([lines.error.mock.calls, routed]).toEqual([[], []]);
    }
  );

  it.each([
    [
      "a body of a Content-Length",
      'POST /echo HTTP/1.1\r\nHost: localhost\r\nContent-Type: application/json\r\nContent-Length: 10\r\n\r\n{"a"',
    ],
    [
      "a chunk",
      "POST /echo HTTP/1.1\r\nHost: localhost\r\nContent-Type: application/json\r\nTransfer-Encoding: chunked\r\n\r\n5\r\nab",
    ],
  ])(
    "answers REQUEST_INCOMPLETE at 400, under the request's own id, when the client ends its side in the middle of %s",
    async (_name, cut) => {
      const lines = recordFailureLines(app);
      const socket = connect({ host: HOST, port });
      const received: Buffer[] = [];
      socket.on("data", (chunk: Buffer) => received.push(chunk));
      socket.on("error", () => undefined);
      socket.write(cut);
      await until(() => routed.length === 1, { description: "the request routed" });

      socket.end();
      await once(socket, "close");
      await closed(routed[0]);
      const response = responseOf(Buffer.concat(received).toString("utf8"));

      expect(response.statusLine).toBe("HTTP/1.1 400 Bad Request");
      expect(JSON.parse(response.body)).toEqual({
        ...problemOf(HTTP_ERRORS.REQUEST_INCOMPLETE, "Request incomplete"),
        correlationId: routed[0]?.id,
      });
      expect(lines.warn.mock.calls).toEqual([
        requestLine({
          code: "REQUEST_INCOMPLETE",
          definition: HTTP_ERRORS.REQUEST_INCOMPLETE,
          source: "registered",
          correlationId: routed[0]?.id,
          method: "POST",
          url: "/echo",
          error: registeredOver(HTTP_ERRORS.REQUEST_INCOMPLETE, {
            message: "Parse Error",
            code: "HPE_INVALID_EOF_STATE",
          }),
        }),
      ]);
      expect(lines.error.mock.calls).toEqual([]);
    }
  );

  it.each([
    [
      "a repeated Content-Length",
      "POST /echo HTTP/1.1\r\nHost: localhost\r\nContent-Length: 2\r\nContent-Length: 3\r\n\r\n{}",
      HTTP_ERRORS.CONTENT_LENGTH_REPEATED,
      "Content length repeated",
      {
        name: "Error",
        message: "Parse Error: Duplicate Content-Length",
        code: "HPE_UNEXPECTED_CONTENT_LENGTH",
      },
    ],
    [
      "a first header line that starts with a space",
      "GET /things HTTP/1.1\r\n Foo: bar\r\nHost: localhost\r\n\r\n",
      HTTP_ERRORS.REQUEST_HEADERS_NOT_PARSABLE,
      "Request headers not parsable",
      {
        name: "Error",
        message: "Parse Error: Unexpected space after start line",
        code: "HPE_UNEXPECTED_SPACE",
      },
    ],
    [
      "a version followed by a CR alone, the request line told by llhttp's reason",
      "GET /things HTTP/1.1\rX\r\nHost: localhost\r\n\r\n",
      HTTP_ERRORS.REQUEST_LINE_NOT_PARSABLE,
      "Request line not parsable",
      { name: "Error", message: "Parse Error: Expected CRLF after version", code: "HPE_STRICT" },
    ],
    [
      "Transfer-Encoding before Content-Length, the conflict told by llhttp's reason",
      "POST /echo HTTP/1.1\r\nHost: localhost\r\nTransfer-Encoding: chunked\r\nContent-Length: 2\r\n\r\n0\r\n\r\n",
      HTTP_ERRORS.TRANSFER_ENCODING_CONFLICTS_WITH_CONTENT_LENGTH,
      "Transfer encoding conflicts with content length",
      {
        name: "Error",
        message: "Parse Error: Content-Length can't be present with Transfer-Encoding",
        code: "HPE_INVALID_CONTENT_LENGTH",
      },
    ],
    [
      "a Transfer-Encoding the parser refuses before it reads the Content-Length",
      "POST /echo HTTP/1.1\r\nHost: localhost\r\nTransfer-Encoding: chunked, gzip\r\nContent-Length: 2\r\n\r\n{}",
      HTTP_ERRORS.REQUEST_HEADERS_NOT_PARSABLE,
      "Request headers not parsable",
      {
        name: "Error",
        message: "Parse Error: Invalid `Transfer-Encoding` header value",
        code: "HPE_INVALID_TRANSFER_ENCODING",
      },
    ],
  ])(
    "answers %s with the code its cause has, in one response that closes the connection",
    async (_name, bytes, definition, title, cause) => {
      const lines = recordFailureLines(app);

      const response = responseOf(await exchange(port, bytes));
      const body = JSON.parse(response.body);

      expect([response.statusLine, response.headers["content-type"]]).toEqual([
        "HTTP/1.1 400 Bad Request",
        PROBLEM_JSON,
      ]);
      expect(body).toEqual(problemOf(definition, title));
      expect(lines.warn.mock.calls).toEqual([
        connectionLine(definition, body.correlationId, cause),
      ]);
      expect([lines.error.mock.calls, routed]).toEqual([[], []]);
    }
  );

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

  it("ends its side once the client ends its own after the request timeout of a message that follows a request still unanswered, and writes nothing, with one line", async () => {
    const lines = recordFailureLines(app);
    const socket = connect({ host: HOST, port });
    const received: Buffer[] = [];
    socket.on("data", (chunk: Buffer) => received.push(chunk));
    socket.on("error", () => undefined);
    const timedOut = once(app.server, "clientError");
    socket.write("GET /hang HTTP/1.1\r\nHost: localhost\r\n\r\nGET /things HTTP/1.1\r\nHo");
    await timedOut;

    socket.end();
    await until(async () => (await connectionsOf(app)) === 0, {
      description: "the server's connection closed",
      timeoutMs: 2_000,
    });
    await until(() => lines.warn.mock.calls.length === 1, { description: "the failure's line" });

    expect(received).toEqual([]);
    expect(lines.warn.mock.calls).toEqual([
      followingLine(
        HTTP_ERRORS.REQUEST_TIMEOUT,
        { message: "Request timeout", code: "ERR_HTTP_REQUEST_TIMEOUT" },
        routed[0]?.id,
        "Request failed on a connection that can no longer be written"
      ),
    ]);
    expect(lines.error.mock.calls).toEqual([]);
  });

  it.each([
    ["a route's path", "GET /things HTTP/1.1\r\nHo"],
    ["a path that does not decode", "GET /%zz HTTP/1.1\r\nHo"],
  ])(
    "answers the request in flight, then the request timeout of the message after it, and never takes that message when it arrives whole too late, for %s",
    async (_name, timedOutStart) => {
      const lines = recordFailureLines(app);
      const socket = connect({ host: HOST, port });
      const received: Buffer[] = [];
      socket.on("data", (chunk: Buffer) => received.push(chunk));
      const timedOut = once(app.server, "clientError");
      socket.write(`GET /slow HTTP/1.1\r\nHost: localhost\r\n\r\n${timedOutStart}`);
      await timedOut;
      const readLate = once(app.server, "request");
      socket.write("st: localhost\r\n\r\n");
      await readLate;

      slowRelease.resolve();
      await once(socket, "close");
      const raw = Buffer.concat(received).toString("utf8");
      const refusal = raw.indexOf("HTTP/1.1 408 Request Timeout");

      expect(raw.split("HTTP/1.1 ").map((response) => response.slice(0, 3))).toEqual([
        "",
        "200",
        "408",
      ]);
      expect(responseOf(raw.slice(0, refusal)).body).toBe('{"slow":true}');
      expect(JSON.parse(responseOf(raw.slice(refusal)).body)).toEqual(
        problemOf(HTTP_ERRORS.REQUEST_TIMEOUT, "Request timeout")
      );
      expect(routed).toHaveLength(1);
      expect(lines.warn.mock.calls).toEqual([
        followingLine(
          HTTP_ERRORS.REQUEST_TIMEOUT,
          { message: "Request timeout", code: "ERR_HTTP_REQUEST_TIMEOUT" },
          routed[0]?.id
        ),
      ]);
      expect([lines.error.mock.calls, vi.mocked(captureError).mock.calls]).toEqual([[], []]);
    }
  );

  it.each([
    [
      "a route's path, then a request",
      "/things",
      "GET /things?after HTTP/1.1\r\nHost: localhost\r\n\r\n",
      "GET",
      "/things?after",
    ],
    [
      "a path that does not decode, then a request",
      "/%zz",
      "GET /things?after HTTP/1.1\r\nHost: localhost\r\n\r\n",
      "GET",
      "/things?after",
    ],
    [
      "a route's path, then a CONNECT",
      "/things",
      "CONNECT example.com:443 HTTP/1.1\r\nHost: example.com:443\r\n\r\n",
      "CONNECT",
      "example.com:443",
    ],
  ])(
    "writes one line for each request read on a connection already refused, the timed-out message read whole and the one after it, naming the refusal: %s",
    async (_name, timedOutPath, after, afterMethod, afterUrl) => {
      const lines = recordFailureLines(app);
      // The framework's request loggers inherit `info` from the server's, so its own request lines
      // reach the spy too; the case reads the lines of requests not taken.
      const info = vi.spyOn(app.log, "info").mockImplementation(() => undefined);
      const notTaken = () => info.mock.calls.filter(([, message]) => message === NOT_TAKEN);
      const socket = connect({ host: HOST, port });
      const received: Buffer[] = [];
      socket.on("data", (chunk: Buffer) => received.push(chunk));
      const timedOut = once(app.server, "clientError");
      socket.write(
        `GET /slow HTTP/1.1\r\nHost: localhost\r\n\r\nGET ${timedOutPath} HTTP/1.1\r\nHo`
      );
      await timedOut;
      socket.write(`st: localhost\r\n\r\n${after}`);
      await until(() => notTaken().length === 2, { description: "both lines" });

      slowRelease.resolve();
      await once(socket, "close");
      const raw = Buffer.concat(received).toString("utf8");
      const refusal = JSON.parse(
        responseOf(raw.slice(raw.indexOf("HTTP/1.1 408 Request Timeout"))).body
      );
      const line = (method: string, url: string) => [
        {
          correlationId: expect.stringMatching(UUID),
          method,
          url,
          ip: HOST,
          ipSource: "peer",
          refusalCorrelationId: refusal.correlationId,
        },
        NOT_TAKEN,
      ];

      expect(raw.split("HTTP/1.1 ").map((response) => response.slice(0, 3))).toEqual([
        "",
        "200",
        "408",
      ]);
      expect(notTaken()).toEqual([line("GET", timedOutPath), line(afterMethod, afterUrl)]);
      const ids = notTaken().map(([fields]) => (fields as { correlationId: string }).correlationId);
      expect(new Set([...ids, refusal.correlationId]).size).toBe(3);
      expect(routed).toHaveLength(1);
      expect([lines.warn.mock.calls.length, lines.error.mock.calls]).toEqual([1, []]);
    }
  );
});
