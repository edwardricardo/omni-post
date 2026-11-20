/**
 * @file index.ts
 * @description Shared logger factory for all monorepo packages. Exposes one
 *              process-wide base Pino logger and returns lightweight named
 *              child loggers per call. Honours the LOG_LEVEL env var.
 *
 *              Why a shared base: Pino registers a `process.on("exit")`
 *              listener per transport-backed logger (to flush on shutdown,
 *              pino/lib/transport.js). The previous implementation built a
 *              fresh transport-backed root logger on every `createLogger()`
 *              call, so each importing package/module added its own `exit`
 *              listener. With 11 provider adapters (plus adapters/observability)
 *              calling the factory at module scope, the count crossed Node's
 *              default `MaxListeners` (10) and emitted a spurious
 *              `MaxListenersExceededWarning`. One base + `child({ name })`
 *              means exactly one transport and one `exit` listener for the
 *              whole process, with per-logger namespacing preserved.
 *
 *              Redaction: this module owns `REDACT_PATHS`, the one list of
 *              sensitive paths every logger applies (ADR-0034, decision 8). The
 *              base logger redacts with it, and `apps/api/src/lib/logger.ts`
 *              imports it, so a field added here is masked by both.
 * @layer infrastructure
 */
import pino from "pino";

const LOG_LEVEL = process.env.LOG_LEVEL || "info";

/**
 * Paths whose values every logger replaces with `REDACT_CENSOR`. Pino matches a
 * path case-sensitively and only at the depth it names: `token` masks a top-level
 * key, `*.token` one key one level down, `*.*.token` one two levels down. A new
 * sensitive field is added here, with its case variations spelled out, so that the
 * API logger and every package logger mask it at once.
 */
export const REDACT_PATHS: readonly string[] = Object.freeze([
  "password",
  "token",
  "apiKey",
  "apiSecret",
  "accessToken",
  "accessTokenSecret",
  "refreshToken",
  "bearerToken",
  "secret",
  "credentials",
  "authorization",
  "cookie",
  // A Bluesky app password signs in as the account, with no second factor.
  "appPassword",
  // The OAuth client secret of an OIDC configuration, and a provider app's secret.
  "clientSecret",
  "appSecret",
  // Whoever holds a bot token acts as the bot.
  "botToken",
  // The signing secret of a webhook subscription: it forges deliveries.
  "secretKey",
  "webhookSecret",
  // The TOTP seed generates every future code; each backup code is a second factor.
  "mfaSecret",
  "backupCodes",
  // A PKCE verifier redeems the authorization code it was issued with (RFC 7636).
  "codeVerifier",
  // An incoming-webhook URL and a Zapier or Make hook URL are the credential itself:
  // anyone holding the URL can post to it.
  "webhookUrl",
  "targetUrl",
  "privateKey",
  "*.password",
  "*.token",
  "*.apiKey",
  "*.secret",
  // The credential fields one level down, inside a session, a channel or a config.
  "*.accessToken",
  "*.refreshToken",
  "*.credentials",
  // Two levels down, a provider configuration inside a request context.
  "*.*.token",
  "*.*.secret",
  // The arguments of the Redis command an error failed on: ioredis attaches `command.args` to
  // the error it emits, and pino's error serializer copies it, so on an AUTH failure the line
  // holds the password. An error is logged at the top level (`err`, `error`) or one level down;
  // the third path reaches an error two levels down, an array of errors one level down and the
  // nested errors of an AggregateError, which the serializer writes under `aggregateErrors`.
  "*.command.args",
  "*.*.command.args",
  "*.*.*.command.args",
  "req.headers.authorization",
  "req.headers.cookie",
  // Use bracket notation for hyphenated keys
  'res.headers["set-cookie"]',
]);

/** The value every redacted path is replaced with. */
export const REDACT_CENSOR = "[REDACTED]";

/**
 * Single process-wide base logger. Created once when this module is first
 * imported — one transport, one `process` `exit` listener for the whole
 * process. It redacts `REDACT_PATHS`, and its children inherit the redaction.
 * In non-production a pino/file transport writes to stdout (fd 1);
 * in production pino writes synchronously to stdout with no transport thread.
 */
const baseLogger: pino.Logger = pino({
  level: LOG_LEVEL,
  redact: { paths: [...REDACT_PATHS], censor: REDACT_CENSOR },
  ...(process.env.NODE_ENV !== "production" && {
    transport: {
      target: "pino/file",
      options: { destination: 1 }, // stdout
    },
  }),
});

/**
 * @function createLogger
 * @description Returns a namespaced child of the shared base logger. Child
 *              loggers reuse the base's stream/transport, so repeated calls
 *              add no additional process listeners or transport threads.
 * @param name - Logical name bound to every line this logger emits (`name` field).
 * @returns A pino child logger namespaced with `{ name }`.
 */
export function createLogger(name: string): pino.Logger {
  return baseLogger.child({ name });
}

export type { Logger } from "pino";
export {
  CONNECTION_ERROR_LOG_WINDOW_MS,
  MAX_NESTED_DEPTH,
  MAX_NESTED_ERRORS,
  MAX_TRACKED_ERROR_IDENTITIES,
  createThrottledErrorListener,
  createThrottledWorkerErrorListener,
  logConnectionErrors,
  type ConnectionEventSource,
  type ErrorLogSink,
  type ThrottledErrorListener,
} from "./throttledErrorListener.js";
