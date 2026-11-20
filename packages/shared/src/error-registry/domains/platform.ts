/**
 * @file platform.ts
 * @description The `platform` domain: the failures of the environment a process starts in and of the
 *   services it needs to run.
 * @layer domain
 */
import { defineErrors } from "../definition.js";

export const PLATFORM_ERRORS = defineErrors("platform", {});
