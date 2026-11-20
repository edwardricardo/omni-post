/**
 * @file connectionFailure.test.ts
 * @description `connectionFailure` names the part of the message a connection's error finds wrong,
 *   one code per part. Node's parser code names the part whenever it names one: the request line,
 *   the headers, a Content-Length sent more than once, the body's framing, or data after a message.
 *   llhttp raises `HPE_STRICT`, `HPE_CR_EXPECTED` and `HPE_INVALID_EOF_STATE` in more than one
 *   part, so for those alone the position decides: the body's framing while a request's own body is
 *   read, otherwise the headers, or the request line for `HPE_STRICT`'s reason after the version.
 *   The conflict of
 *   Transfer-Encoding with Content-Length, which llhttp raises under either header's code, is told
 *   by its reason. The request timeout and an oversized header keep their own codes anywhere. A
 *   code the table does not name, a parser's or a socket's, is handed on as Node's error at 400,
 *   under its own code, wherever it arrives.
 * @layer infrastructure
 */
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

const LINE = "REQUEST_LINE_NOT_PARSABLE";
const HEADERS = "REQUEST_HEADERS_NOT_PARSABLE";
const REPEATED = "CONTENT_LENGTH_REPEATED";
const FRAMING = "REQUEST_BODY_FRAMING_NOT_PARSABLE";
const AFTER = "DATA_AFTER_REQUEST_UNEXPECTED";
const CONFLICT = "TRANSFER_ENCODING_CONFLICTS_WITH_CONTENT_LENGTH";

describe("connectionFailure", () => {
  it.each([
    ["HPE_INVALID_METHOD", undefined, LINE],
    ["HPE_INVALID_URL", undefined, LINE],
    ["HPE_INVALID_VERSION", undefined, LINE],
    ["HPE_INVALID_CONSTANT", undefined, LINE],
    ["HPE_PAUSED_H2_UPGRADE", undefined, LINE],
    ["HPE_STRICT", "Expected CRLF after version", LINE],
    ["HPE_UNEXPECTED_SPACE", "Unexpected space after start line", HEADERS],
    ["HPE_INVALID_HEADER_TOKEN", undefined, HEADERS],
    ["HPE_LF_EXPECTED", undefined, HEADERS],
    ["HPE_CR_EXPECTED", undefined, HEADERS],
    ["HPE_STRICT", "Expected LF after headers", HEADERS],
    ["HPE_INVALID_CONTENT_LENGTH", "Invalid character in Content-Length", HEADERS],
    ["HPE_INVALID_TRANSFER_ENCODING", "Invalid `Transfer-Encoding` header value", HEADERS],
    ["HPE_UNEXPECTED_CONTENT_LENGTH", "Duplicate Content-Length", REPEATED],
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
    ["HPE_INVALID_EOF_STATE", "Invalid EOF state", HEADERS],
    ["HPE_CLOSED_CONNECTION", undefined, AFTER],
    ["HPE_HEADER_OVERFLOW", undefined, "REQUEST_HEADERS_TOO_LARGE"],
    ["ERR_HTTP_REQUEST_TIMEOUT", undefined, "REQUEST_TIMEOUT"],
  ])("with no request's body being read, names %s (%s) %s", (code, reason, expected) => {
    const failure = connectionFailure(nodeError(code, reason), false);

    expect([failure.code, failure.cause]).toEqual([expected, expect.objectContaining({ code })]);
  });

  it.each([
    ["HPE_STRICT", "Invalid character in chunk extensions", FRAMING],
    ["HPE_CR_EXPECTED", "Missing expected CR after chunk data", FRAMING],
    ["HPE_INVALID_CHUNK_SIZE", "Invalid character in chunk size", FRAMING],
    ["HPE_INVALID_EOF_STATE", "Invalid EOF state", FRAMING],
    ["HPE_INVALID_TRANSFER_ENCODING", "Request has invalid `Transfer-Encoding`", HEADERS],
    ["ERR_HTTP_REQUEST_TIMEOUT", "a reason", "REQUEST_TIMEOUT"],
  ])(
    "while a request's own body is read, names %s (%s) %s, by its code unless llhttp raises it in more than one part",
    (code, reason, expected) => {
      const failure = connectionFailure(nodeError(code, reason), true);

      expect([failure.code, failure.cause]).toEqual([expected, expect.objectContaining({ code })]);
    }
  );

  it.each([
    ["a parser code the table does not name", "HPE_NOT_YET_KNOWN", false],
    ["the same while a request's own body is read", "HPE_NOT_YET_KNOWN", true],
    ["a socket's error, which is no parser's", "EPIPE", true],
    ["a socket's timeout, which is no parser's", "ETIMEDOUT", false],
  ])("hands on %s as Node's error at 400, under its own code", (_name, code, readingBody) => {
    const error = nodeError(code);

    const failure = connectionFailure(error, readingBody);

    expect(failure).toBe(error);
    expect([failure.code, "statusCode" in failure && failure.statusCode]).toEqual([code, 400]);
  });
});
