/**
 * @file connectionFailure.test.ts
 * @description `connectionFailure` names the part of the message a connection's error finds wrong,
 *   one code per part. With no request in flight, Node's parser code names it: the request line,
 *   the headers, the body's framing, or data after a message; the conflict of Transfer-Encoding
 *   with Content-Length, which llhttp raises under either header's code, is told by its reason. A
 *   request in flight names it by its position: its body's framing while its message is incomplete,
 *   data after it once complete. The request timeout and an oversized header keep their own codes
 *   anywhere. A code the table does not name, with no request in flight, is handed on as Node's
 *   error, at 400, under its own code.
 * @layer infrastructure
 */
import { IncomingMessage } from "node:http";
import { Socket } from "node:net";
import { describe, expect, it } from "vitest";
import type { ConnectionError } from "fastify";
import { connectionFailure } from "../../../../src/lib/errors/errorHandler.js";

/**
 * @description Builds the error Node's HTTP server emits with `clientError`.
 * @param code - Node's code.
 * @param reason - llhttp's reason, as Node sets it.
 * @returns The error.
 */
function nodeError(code: string, reason = "a reason"): ConnectionError {
  return Object.assign(new Error(`Parse Error: ${reason}`), {
    code,
    reason,
    bytesParsed: 0,
    rawPacket: { type: "Buffer", data: [] },
  });
}

/**
 * @description A request in flight on the connection, its message received whole or not.
 * @param complete - Whether its whole message was received.
 * @returns The request's message.
 */
function inFlight(complete: boolean): IncomingMessage {
  const message = new IncomingMessage(new Socket());
  message.complete = complete;
  return message;
}

const LINE = "REQUEST_LINE_NOT_PARSABLE";
const HEADERS = "REQUEST_HEADERS_NOT_PARSABLE";
const FRAMING = "REQUEST_BODY_FRAMING_NOT_PARSABLE";
const AFTER = "DATA_AFTER_REQUEST_UNEXPECTED";
const CONFLICT = "TRANSFER_ENCODING_CONFLICTS_WITH_CONTENT_LENGTH";

describe("connectionFailure", () => {
  it.each([
    ["HPE_INVALID_METHOD", undefined, LINE],
    ["HPE_INVALID_URL", undefined, LINE],
    ["HPE_INVALID_VERSION", undefined, LINE],
    ["HPE_INVALID_CONSTANT", undefined, LINE],
    ["HPE_UNEXPECTED_SPACE", undefined, LINE],
    ["HPE_PAUSED_H2_UPGRADE", undefined, LINE],
    ["HPE_STRICT", "Expected CRLF after version", LINE],
    ["HPE_INVALID_HEADER_TOKEN", undefined, HEADERS],
    ["HPE_LF_EXPECTED", undefined, HEADERS],
    ["HPE_CR_EXPECTED", undefined, HEADERS],
    ["HPE_STRICT", "Expected LF after headers", HEADERS],
    ["HPE_UNEXPECTED_CONTENT_LENGTH", undefined, HEADERS],
    ["HPE_INVALID_CONTENT_LENGTH", "Invalid character in Content-Length", HEADERS],
    ["HPE_INVALID_TRANSFER_ENCODING", "Invalid `Transfer-Encoding` header value", HEADERS],
    [
      "HPE_INVALID_CONTENT_LENGTH",
      "Content-Length can't be present with Transfer-Encoding",
      CONFLICT,
    ],
    [
      "HPE_INVALID_TRANSFER_ENCODING",
      "Transfer-Encoding can't be present with Content-Length",
      CONFLICT,
    ],
    ["HPE_INVALID_CHUNK_SIZE", undefined, FRAMING],
    ["HPE_CHUNK_EXTENSIONS_OVERFLOW", undefined, FRAMING],
    ["HPE_INVALID_EOF_STATE", undefined, FRAMING],
    ["HPE_CLOSED_CONNECTION", undefined, AFTER],
    ["HPE_HEADER_OVERFLOW", undefined, "REQUEST_HEADERS_TOO_LARGE"],
    ["ERR_HTTP_REQUEST_TIMEOUT", undefined, "REQUEST_TIMEOUT"],
  ])("with no request in flight, names %s (%s) %s", (code, reason, expected) => {
    const failure = connectionFailure(nodeError(code, reason), undefined);

    expect([failure.code, failure.cause]).toEqual([expected, expect.objectContaining({ code })]);
  });

  it.each([
    ["HPE_STRICT", "Invalid character in chunk extensions", false, FRAMING],
    ["HPE_CR_EXPECTED", "Missing expected CR after chunk data", false, FRAMING],
    ["HPE_INVALID_EOF_STATE", "Invalid EOF state", false, FRAMING],
    ["HPE_NOT_YET_KNOWN", "a reason", false, FRAMING],
    ["ERR_HTTP_REQUEST_TIMEOUT", "a reason", false, "REQUEST_TIMEOUT"],
    ["HPE_INVALID_METHOD", "Invalid method encountered", true, AFTER],
    ["HPE_CLOSED_CONNECTION", "Data after `Connection: close`", true, AFTER],
  ])(
    "with a request in flight, names %s (%s) by its position, complete %s: %s",
    (code, reason, complete, expected) => {
      const failure = connectionFailure(nodeError(code, reason), inFlight(complete));

      expect([failure.code, failure.cause]).toEqual([expected, expect.objectContaining({ code })]);
    }
  );

  it("hands on a parser code the table does not name, with no request in flight, as Node's error at 400", () => {
    const error = nodeError("HPE_NOT_YET_KNOWN");

    const failure = connectionFailure(error, undefined);

    expect(failure).toBe(error);
    expect([failure.code, "statusCode" in failure && failure.statusCode]).toEqual([
      "HPE_NOT_YET_KNOWN",
      400,
    ]);
  });
});
