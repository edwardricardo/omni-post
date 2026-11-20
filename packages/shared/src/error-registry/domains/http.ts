/**
 * @file http.ts
 * @description The `http` domain: the failures the HTTP boundary raises itself, before or outside
 *   any route, such as a request the framework refuses, a path no route matches, a connection whose
 *   request cannot be read, or a request that reaches a server that is closing. Each names its own
 *   cause. Operators and logs read them; no portal acts on one.
 * @layer domain
 */
import { ERROR_CATEGORY, defineErrors } from "../definition.js";

export const HTTP_ERRORS = defineErrors("http", {
  PAYLOAD_TOO_LARGE: {
    category: ERROR_CATEGORY.TOO_LARGE,
    status: 413,
    message: "The request body is larger than this route accepts",
    params: {},
    fronts: [],
  },
  UNSUPPORTED_MEDIA_TYPE: {
    category: ERROR_CATEGORY.VALIDATION,
    status: 415,
    message: "The request's content type is not one this route accepts",
    params: {},
    fronts: [],
  },
  ROUTE_NOT_FOUND: {
    category: ERROR_CATEGORY.NOT_FOUND,
    status: 404,
    message: "No route matches this method and path",
    params: {},
    fronts: [],
  },
  PATH_NOT_DECODABLE: {
    category: ERROR_CATEGORY.VALIDATION,
    status: 400,
    message: "The request's path holds a percent-encoded sequence that does not decode",
    params: {},
    fronts: [],
  },
  ROUTE_PARAMETER_TOO_LONG: {
    category: ERROR_CATEGORY.TOO_LARGE,
    status: 414,
    message: "A parameter of the request's path is longer than the router accepts",
    params: {},
    fronts: [],
  },
  JSON_BODY_EMPTY: {
    category: ERROR_CATEGORY.VALIDATION,
    status: 400,
    message: "The request declares a JSON body and sends an empty one",
    params: {},
    fronts: [],
  },
  JSON_BODY_NOT_PARSABLE: {
    category: ERROR_CATEGORY.VALIDATION,
    status: 400,
    message: "The request body is not valid JSON",
    params: {},
    fronts: [],
  },
  BODY_LENGTH_MISMATCH: {
    category: ERROR_CATEGORY.VALIDATION,
    status: 400,
    message:
      "The request body, as a hook's stream delivered it, is not the length its Content-Length header declares",
    params: {},
    fronts: [],
  },
  CONTENT_TYPE_MISSING: {
    category: ERROR_CATEGORY.VALIDATION,
    status: 400,
    message: "A request of this method must declare the content type of its body",
    params: {},
    fronts: [],
  },
  REQUEST_LINE_NOT_PARSABLE: {
    category: ERROR_CATEGORY.VALIDATION,
    status: 400,
    message:
      "The request line could not be read: check its method, its target and its HTTP version",
    params: {},
    fronts: [],
  },
  REQUEST_HEADERS_NOT_PARSABLE: {
    category: ERROR_CATEGORY.VALIDATION,
    status: 400,
    message:
      "A request header could not be read: check each header's name and value, and that Content-Length is a number",
    params: {},
    fronts: [],
  },
  REQUEST_BODY_FRAMING_NOT_PARSABLE: {
    category: ERROR_CATEGORY.VALIDATION,
    status: 400,
    message:
      "The request body's framing could not be read: check its chunk sizes and extensions, and that the body is sent whole",
    params: {},
    fronts: [],
  },
  DATA_AFTER_REQUEST_UNEXPECTED: {
    category: ERROR_CATEGORY.VALIDATION,
    status: 400,
    message:
      "Data that is not a request follows a complete request: check the body's length against its Content-Length, and send nothing after a request that closes the connection",
    params: {},
    fronts: [],
  },
  TRANSFER_ENCODING_CONFLICTS_WITH_CONTENT_LENGTH: {
    category: ERROR_CATEGORY.VALIDATION,
    status: 400,
    message:
      "The request sends both Transfer-Encoding and Content-Length, a shape used to smuggle a request, which the server refuses: send one of them",
    params: {},
    fronts: [],
  },
  CONTENT_LENGTH_REPEATED: {
    category: ERROR_CATEGORY.VALIDATION,
    status: 400,
    message:
      "The request sends its Content-Length header more than once, a shape used to smuggle a request, which the server refuses: send it once",
    params: {},
    fronts: [],
  },
  REQUEST_INCOMPLETE: {
    category: ERROR_CATEGORY.VALIDATION,
    status: 400,
    message:
      "The client ended its side of the connection before the request arrived whole: send the whole request before ending the connection's sending side",
    params: {},
    fronts: [],
  },
  REQUEST_BODY_ABORTED: {
    category: ERROR_CATEGORY.VALIDATION,
    status: 400,
    message: "The connection closed before the request body was received whole",
    params: {},
    fronts: [],
  },
  // Answered at the status the refusal carries, any from 400 to 499, which this category's
  // statuses need not hold (ADR-0047, decision 2.7): 400 is the status the entry declares, and a
  // refusal answers it only when it carries 400.
  REQUEST_REFUSED: {
    category: ERROR_CATEGORY.VALIDATION,
    status: 400,
    message:
      "The request was refused and the server holds no more specific code for the cause: the status says what was refused",
    params: {},
    fronts: [],
  },
  EXPECTATION_UNSUPPORTED: {
    category: ERROR_CATEGORY.VALIDATION,
    status: 417,
    message:
      "The request's Expect header asks for something other than 100-continue, which the server does not support: send the request without it",
    params: {},
    fronts: [],
  },
  REQUEST_HEADERS_TOO_LARGE: {
    category: ERROR_CATEGORY.TOO_LARGE,
    status: 431,
    message: "The request's headers are larger than the server accepts",
    params: {},
    fronts: [],
  },
  REQUEST_TIMEOUT: {
    category: ERROR_CATEGORY.TIMEOUT,
    status: 408,
    message: "The request was not received in full within the time the server waits for one",
    params: {},
    fronts: [],
  },
  SERVER_CLOSING: {
    category: ERROR_CATEGORY.UNAVAILABLE,
    status: 503,
    message:
      "The server is shutting down and takes no new request: send it again on a new connection",
    params: {},
    fronts: [],
  },
  CONNECT_NOT_IMPLEMENTED: {
    category: ERROR_CATEGORY.NOT_IMPLEMENTED,
    status: 501,
    message: "The server opens no tunnel: it is not a proxy, and it does not implement CONNECT",
    params: {},
    fronts: [],
  },
});
