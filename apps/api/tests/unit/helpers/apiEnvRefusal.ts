/**
 * @file apiEnvRefusal.ts
 * @description Reads the refusal of the API's environment module for the suites that drive the
 *   real `parseApiEnv` with an environment of their own: the module loaded with an environment its
 *   schema accepts, what a parse raises, read by the fields every reader of a registered error relies
 *   on, the refusal's own message and the schema's text it carries as its cause. The error is read by
 *   its fields, never by its class: each load brings its own copy of the registry.
 *
 *   `apps/api/src/config/env.ts` calls `process.loadEnvFile()` when it is first imported, so the
 *   suite that loads it here neutralises that call with its own hoisted spy, the only kind that runs
 *   before the import.
 * @layer infrastructure
 */
import { makeApiEnv, withEnvironment } from "./publicAddressEnv.js";

/** The real `parseApiEnv`, as the environment module exports it. */
export type ParseApiEnv = typeof import("../../../src/config/env.js").parseApiEnv;

/** The fields every reader of a registered error relies on. */
export interface RefusalFields {
  readonly code: string;
  readonly message: string;
  readonly params: unknown;
  readonly cause?: unknown;
}

/**
 * @function causeText
 * @description The schema's text a refusal carries as its cause, which the API's start shows.
 * @param refusal - The refusal, or undefined when the environment was accepted.
 * @returns The cause's message, or an empty string when there is no cause.
 */
export function causeText(refusal: RefusalFields | undefined): string {
  return refusal?.cause instanceof Error ? refusal.cause.message : "";
}

/**
 * @function loadParseApiEnv
 * @description Loads the environment module afresh with an environment its schema accepts.
 * @returns The module's `parseApiEnv`.
 */
export async function loadParseApiEnv(): Promise<ParseApiEnv> {
  const module = await withEnvironment(makeApiEnv(), () => import("../../../src/config/env.js"));
  return module.parseApiEnv;
}

/**
 * @function refusalUnder
 * @description What a `parseApiEnv` raises for an environment, read by its fields.
 * @param parseApiEnv - The loaded `parseApiEnv`.
 * @param environment - The environment to parse.
 * @returns The refusal, or undefined when the environment is accepted.
 */
export function refusalUnder(
  parseApiEnv: ParseApiEnv,
  environment: Record<string, string | undefined>
): RefusalFields | undefined {
  try {
    parseApiEnv(environment);
    return undefined;
  } catch (error: unknown) {
    return error as RefusalFields;
  }
}

/**
 * @function refusedMessage
 * @description The refusal's own message for the variables it names.
 * @param variables - The refused variables, in the order the refusal names them.
 * @returns The message.
 */
export function refusedMessage(variables: readonly string[]): string {
  return `The environment was refused: these variables are missing or not valid: ${variables.join(", ")}`;
}
