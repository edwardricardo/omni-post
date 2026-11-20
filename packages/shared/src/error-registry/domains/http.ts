/**
 * @file http.ts
 * @description The `http` domain: the failures the HTTP boundary raises itself, before or outside
 *   any route, such as a request the framework refuses or a path no route matches.
 * @layer domain
 */
import { defineErrors } from "../definition.js";

export const HTTP_ERRORS = defineErrors("http", {});
