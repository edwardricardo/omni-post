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
    message: "The request body's length differs from the one its Content-Length header declares",
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
  REQUEST_NOT_PARSABLE: {
    category: ERROR_CATEGORY.VALIDATION,
    status: 400,
    message: "The request is not valid HTTP: its request line or its headers could not be read",
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
    category: ERROR_CATEGORY.TOO_LARGE,
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
});
