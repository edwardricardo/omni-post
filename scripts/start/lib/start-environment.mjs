// @ts-check
/**
 * @file start-environment.mjs
 * @description The pure core of the start sequence's environment: the values a checkout with no
 *   environment file receives, how the file is written and read, and what an existing file lacks.
 *   It reads and writes no file; `scripts/start/platform-start.mjs` does.
 *
 *   TWO CONSUMERS make up the platform. Compose interpolates every `${NAME:?}` of
 *   `docker-compose.yml` whatever services it is asked for, so Postgres and Redis alone need the
 *   seven variables the file names, Grafana's and MinIO's included. The API refuses to boot without
 *   the thirteen its schema declares with no default (`apps/api/src/config/env.ts`), its three
 *   public addresses among them; the workers' three are among them too. A new file also receives
 *   what the development tools need: `SHADOW_DATABASE_URL`, the empty database `prisma migrate dev`
 *   diffs a migration against (`infra/prisma/prisma.config.ts`), and the development seed's
 *   `ADMIN_PASSWORD`, the password of the administrator it creates (`infra/prisma/src/seedGuard.ts`).
 *   The suite holds the generated environment to all of them.
 *
 *   ONE LIST PER PURPOSE. What the platform reads is what an existing file must hold:
 *   `REQUIRED_KEYS` is read off the platform's generator, so the two cannot drift. What the
 *   development tools need is generated for a new file and never required of an existing one: the
 *   platform never reads it, so a file without it still starts the platform, and the tool that
 *   reads it answers for it (the seed refuses without its password, naming it).
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

/**
 * The client portal's development port, the one its `dev` script hands `next dev -p`: the port its
 * address names when the run that writes the file reads no app's port.
 */
const CLIENT_PORTAL_PORT = 3200;

/**
 * @typedef {object} GenerationOptions
 * @property {(size: number) => Buffer} randomBytes The random source every secret is drawn from.
 * @property {number} [postgresHostPort] The host port Postgres is published on, when it is not the
 *   compose file's default.
 * @property {number} [redisHostPort] The host port Redis is published on, when it is not the compose
 *   file's default.
 * @property {number} [apiPort] The port the run starts the API on; without it, the API's default.
 * @property {number} [clientPort] The port the run starts the client portal on; without it, the one
 *   its `dev` script fixes in the repository.
 */

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
 * The variables the platform reads, in file order: the seven Compose interpolates, the host ports
 * when one was chosen, and the thirteen the API requires, its public addresses last.
 * @param {GenerationOptions} options - The random source, and the ports the run settled.
 * @returns {{ entries: Array<[string, string]>, databaseUrl: string }} Each variable with its
 *   value, and the URL of the platform's database, beside which the development tools' sits.
 */
function platformEntries({ randomBytes, postgresHostPort, redisHostPort, apiPort, clientPort }) {
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
  const platformDatabase = databaseUrl(database);
  entries.push(
    ["DATABASE_URL", platformDatabase],
    ["REDIS_URL", `redis://${LOOPBACK}:${redisHostPort ?? DEFAULT_REDIS_HOST_PORT}`]
  );
  for (const key of HMAC_SECRETS) entries.push([key, hex(32)]);
  entries.push(
    ["PLATFORM_ENCRYPTION_KEY", randomBytes(32).toString("base64")],
    ["DELETION_NAME_DIGEST_KEY_RING", JSON.stringify({ 1: hex(32) })]
  );
  // Each app's address is where the run that writes the file serves it. Webhooks and single
  // sign-on name the same API in development.
  const api = `http://${LOOPBACK}:${apiPort ?? DEFAULT_API_PORT}`;
  entries.push(
    ["CLIENT_URL", `http://${LOOPBACK}:${clientPort ?? CLIENT_PORTAL_PORT}`],
    ["API_BASE_URL", api],
    ["APP_BASE_URL", api]
  );
  return { entries, databaseUrl: platformDatabase };
}

/**
 * The variables the development tools need and the platform never reads: the shadow database
 * `prisma migrate dev` diffs a migration against, on the platform's server, as its user, under its
 * database's name followed by `_shadow`; and the development seed's administrator password, which
 * its password rule requires and takes no default for.
 * @param {{ randomBytes: (size: number) => Buffer }} options - The random source.
 * @param {string} databaseUrl - The URL of the platform's database.
 * @returns {Array<[string, string]>} Each variable with its value.
 */
function developmentToolEntries({ randomBytes }, databaseUrl) {
  const shadow = new URL(databaseUrl);
  shadow.pathname = `${shadow.pathname}_shadow`;
  return [
    ["SHADOW_DATABASE_URL", shadow.href],
    ["ADMIN_PASSWORD", randomBytes(24).toString("hex")],
  ];
}

/**
 * @function generateEnvironment
 * @description The environment of a checkout that has none, in file order: what the platform
 *   reads, then what the development tools need.
 * @param {GenerationOptions} options - The random source, and the ports the run settled.
 * @returns {Array<[string, string]>} Each variable with its value.
 */
export function generateEnvironment(options) {
  const platform = platformEntries(options);
  return [...platform.entries, ...developmentToolEntries(options, platform.databaseUrl)];
}

/** A random source of zeros, for a generation whose values are discarded and names kept. */
const discarded = { randomBytes: (/** @type {number} */ size) => Buffer.alloc(size) };

/**
 * Every variable an environment file must hold: the ones the platform reads, which a new checkout
 * receives. The list is read off one throwaway generation of the platform's variables, of which
 * only the names are kept, so the generator stays the one place that says which variables there
 * are.
 */
export const REQUIRED_KEYS = platformEntries(discarded).entries.map(([key]) => key);

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

/** A loopback host as a URL writes it: IPv4 `127.0.0.0/8`, `localhost`, or IPv6 `[::1]`. */
const LOOPBACK_HOST = /^(?:127(?:\.\d{1,3}){3}|localhost|\[::1\])$/;

/**
 * The port an `http` or `https` URL names when it writes none. The URL parser leaves `port` empty
 * for a scheme's default port, written or not, so the number has to come from the scheme.
 */
const DEFAULT_PORTS = new Map([
  ["http:", 80],
  ["https:", 443],
]);

/**
 * @function staleApiAddresses
 * @description The API addresses of an environment file that name a loopback origin on another
 *   port than the one the run starts the API on, each with the port it names. An address on another
 *   host is left alone, since a file may point at another server on purpose, and so is a value that
 *   is not an `http` or `https` URL, which the API's own schema refuses.
 * @param {Record<string, string>} values - The file's variables.
 * @param {number} apiPort - The port the run starts the API on.
 * @returns {Array<{ key: string, port: number }>} Each such address and its port, `API_BASE_URL`
 *   first, then `APP_BASE_URL`.
 */
export function staleApiAddresses(values, apiPort) {
  /** @type {Array<{ key: string, port: number }>} */
  const stale = [];
  for (const key of ["API_BASE_URL", "APP_BASE_URL"]) {
    const raw = values[key];
    const url = raw !== undefined && URL.canParse(raw) ? new URL(raw) : null;
    const fallback = url === null ? undefined : DEFAULT_PORTS.get(url.protocol);
    if (url === null || fallback === undefined || !LOOPBACK_HOST.test(url.hostname)) continue;
    const port = url.port === "" ? fallback : Number(url.port);
    if (port !== apiPort) stale.push({ key, port });
  }
  return stale;
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
 *   overriding a variable its process already holds, so a `PORT` the calling shell sets wins over
 *   the file's, and with neither it takes the default. An empty value, in either place, is a value
 *   that the API's schema reads as absent, so it ends in the default and the file is not consulted
 *   behind an empty one in the shell.
 * @param {string | undefined} fromShell - `PORT` in the calling shell.
 * @param {string | undefined} fromFile - `PORT` in the environment file.
 * @returns {number | null} The port, or `null` when the value that wins is not a port.
 */
export function apiPort(fromShell, fromFile) {
  const raw = fromShell ?? fromFile;
  return raw ? parsePort(raw) : DEFAULT_API_PORT;
}
