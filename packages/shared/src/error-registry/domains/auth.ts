/**
 * @file auth.ts
 * @description The `auth` domain: the failures of administrators and their credentials.
 * @layer domain
 */
import { defineErrors } from "../definition.js";

export const AUTH_ERRORS = defineErrors("auth", {});
