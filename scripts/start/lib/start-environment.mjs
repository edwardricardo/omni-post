// @ts-check
/**
 * @file start-environment.mjs
 * @description The pure core of the start sequence's environment: the values a checkout with no
 *   environment file receives, how the file is written and read, and what an existing file lacks.
 *   It reads and writes no file; `scripts/start/platform-start.mjs` does.
 *
 *   TWO CONSUMERS decide what is generated. Compose interpolates every `${NAME:?}` of
 *   `docker-compose.yml` whatever services it is asked for, so Postgres and Redis alone need the
 *   seven variables the file names, Grafana's and MinIO's included. The API refuses to boot without
 *   the twelve its schema declares with no default (`apps/api/src/config/env.ts`); the workers'
 *   three are among them. The suite holds the generated environment to both sources.
 *
 *   ONE LIST: what a new checkout receives is what an existing file must hold. `REQUIRED_KEYS` is
 *   read off the generator, so the two cannot drift.
 *
 *   THREE READERS take the file: Compose, Node's loader (`process.loadEnvFile`, `--env-file`) and a
 *   shell that sources it. A value outside the plain set is written in single quotes, the one
 *   spelling all three read alike; the key ring's JSON is the case.
 * @layer infrastructure
 */
import { parseEnv } from "node:util";

/** The root environment file: the one Compose, the API's `dev` script and the workers already read. */
export const ENVIRONMENT_FILE = ".env";

/** Where the compose file publishes both services, and so where every generated URL points. */
export const LOOPBACK = "127.0.0.1";

export const DEFAULT_POSTGRES_HOST_PORT = 5432;
export const DEFAULT_REDIS_HOST_PORT = 6379;

/** The port the API takes when neither the calling shell nor the environment file names one. */
const DEFAULT_API_PORT = 3000;

/** The API's HMAC secrets: its schema asks each for 32 characters or more. */
const HMAC_SECRETS = [
  "JWT_ACCESS_SECRET",
  "JWT_REFRESH_SECRET",
  "CUSTOMER_JWT_SECRET",
  "ADMIN_JWT_ACCESS_SECRET",
  "ADMIN_JWT_REFRESH_SECRET",
  "COOKIE_SECRET",
];

/** A value every reader of the file takes whole without quotes. */
const PLAIN_VALUE = /^[A-Za-z0-9_./:@+=-]+$/;

const HEADER = [
  "# Written by `pnpm start:platform` because this checkout had no environment file.",
  "# Every secret below is random and belongs to this checkout. The command never rewrites this file:",
  "# to start again, delete it together with the volumes (`docker compose down --volumes`).",
].join("\n");

/**
 * @function generateEnvironment
 * @description The environment of a checkout that has none, in file order: the seven variables
 *   Compose interpolates, the host ports when one was chosen, and the twelve the API requires.
 * @param {{ randomBytes: (size: number) => Buffer, postgresHostPort?: number, redisHostPort?: number }} options
 *   The random source every secret is drawn from, and the host ports to publish when they are not
 *   the compose file's defaults.
 * @returns {Array<[string, string]>} Each variable with its value.
 */
export function generateEnvironment({ randomBytes, postgresHostPort, redisHostPort }) {
  const hex = (/** @type {number} */ size) => randomBytes(size).toString("hex");
  const user = "omnipost";
  const database = "omnipostdb";
  const password = hex(24);
  const databaseUrl = (/** @type {string} */ name) => {
    const url = new URL(
      `postgresql://${LOOPBACK}:${postgresHostPort ?? DEFAULT_POSTGRES_HOST_PORT}/${name}`
    );
    url.username = user;
    url.password = password;
    return url.href;
  };

  /** @type {Array<[string, string]>} */
  const entries = [
    ["POSTGRES_USER", user],
    ["POSTGRES_PASSWORD", password],
    ["POSTGRES_DB", database],
    ["GF_SECURITY_ADMIN_USER", "admin"],
    ["GF_SECURITY_ADMIN_PASSWORD", hex(24)],
    ["MINIO_ROOT_USER", "omnipost"],
    ["MINIO_ROOT_PASSWORD", hex(24)],
  ];
  if (postgresHostPort !== undefined) {
    entries.push(["POSTGRES_HOST_PORT", String(postgresHostPort)]);
  }
  if (redisHostPort !== undefined) {
    entries.push(["REDIS_HOST_PORT", String(redisHostPort)]);
  }
  entries.push(
    ["DATABASE_URL", databaseUrl(database)],
    ["SHADOW_DATABASE_URL", databaseUrl(`${database}_shadow`)],
    ["REDIS_URL", `redis://${LOOPBACK}:${redisHostPort ?? DEFAULT_REDIS_HOST_PORT}`]
  );
  for (const key of HMAC_SECRETS) entries.push([key, hex(32)]);
  entries.push(
    ["PLATFORM_ENCRYPTION_KEY", randomBytes(32).toString("base64")],
    ["OAUTH_ENCRYPTION_KEY", hex(32)],
    ["DELETION_NAME_DIGEST_KEY_RING", JSON.stringify({ 1: hex(32) })]
  );
  return entries;
}

/**
 * Every variable an environment file must hold: the ones a new checkout receives. The list is read
 * off one throwaway generation, of which only the names are kept (the zero-filled random source
 * exists to make that call possible, and its values are discarded), so the generator stays the one
 * place that says which variables there are.
 */
export const REQUIRED_KEYS = generateEnvironment({
  randomBytes: (size) => Buffer.alloc(size),
}).map(([key]) => key);

/**
 * @function renderEnvironmentFile
 * @description The text of the environment file: a header, then one `NAME=value` line per variable.
 *   A value outside the plain set goes between single quotes as it is, with nothing escaped: no
 *   generated value holds a single quote, and the suite's reader case, which compares what Node and
 *   a shell read back with what was generated, goes red on the first one that does.
 * @param {Array<[string, string]>} entries - The variables, in file order.
 * @returns {string} The file's text.
 */
export function renderEnvironmentFile(entries) {
  const lines = entries.map(([key, value]) =>
    PLAIN_VALUE.test(value) ? `${key}=${value}` : `${key}='${value}'`
  );
  return `${HEADER}\n${lines.join("\n")}\n`;
}

/**
 * @function readEnvironment
 * @description Reads an environment file's text the way the API and the workers will: with Node's
 *   own parser.
 * @param {string} text - The file's text.
 * @returns {Record<string, string>} Each variable with its value.
 */
export function readEnvironment(text) {
  return { ...parseEnv(text) };
}

/**
 * @function missingKeys
 * @description The required variables an environment leaves out or leaves empty.
 * @param {Record<string, string | undefined>} values - The environment to check.
 * @returns {string[]} The missing names, in file order.
 */
export function missingKeys(values) {
  return REQUIRED_KEYS.filter((key) => !values[key]);
}

/**
 * @function parsePort
 * @description Reads a TCP port written as text.
 * @param {string} raw - The text.
 * @returns {number | null} The port, or `null` when the text is not an integer from 1 to 65535.
 */
export function parsePort(raw) {
  const port = /^[1-9]\d{0,4}$/.test(raw) ? Number(raw) : 0;
  return port >= 1 && port <= 65535 ? port : null;
}

/**
 * @function apiPort
 * @description The port the API alone would listen on: it loads the environment file without
 *   overriding a variable its process already holds, so the calling shell's `PORT` wins over the
 *   file's, and with neither it takes the default. An empty value counts as unset.
 * @param {string | undefined} fromShell - `PORT` in the calling shell.
 * @param {string | undefined} fromFile - `PORT` in the environment file.
 * @returns {number | null} The port, or `null` when the value that wins is not a port.
 */
export function apiPort(fromShell, fromFile) {
  const raw = fromShell || fromFile;
  return raw ? parsePort(raw) : DEFAULT_API_PORT;
}
