/**
 * @file http.ts
 * @description The `http` domain: the failures the HTTP boundary raises itself, before or outside
 *   any route, such as a request the framework refuses or a path no route matches. Operators and
 *   logs read them; no portal acts on one.
 * @layer domain
 */
import { ERROR_CATEGORY, defineErrors } from "../definition.js";

export const HTTP_ERRORS = defineErrors("http", {
  MALFORMED_REQUEST: {
    category: ERROR_CATEGORY.VALIDATION,
    status: 400,
    message: "The request could not be read: its body or its headers are malformed",
    params: {},
    fronts: [],
  },
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
});
