/**
 * @file startEnvironmentPublicAddresses.test.ts
 * @description The public addresses in the environment `pnpm start:platform` generates
 *   (`scripts/start/lib/start-environment.mjs`): the client portal's address and the API's two, each
 *   a URL on the loopback where the development run serves it, in values the API's own schema
 *   accepts as written; and an existing environment file that lacks one is named as lacking it. The
 *   client portal's port is read from its `dev` script, the one `next dev -p` takes, so the suite
 *   goes red when either side moves alone. It also pins which API addresses of a kept environment
 *   file the start reads as naming a loopback port the API does not take, form by form.
 * @layer infrastructure
 */
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { findMonorepoRoot } from "@packages/vitest-shared";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  PUBLIC_ADDRESS_VARIABLES,
  makeApiEnv,
  withEnvironment,
} from "../helpers/publicAddressEnv.js";

// `env.ts` calls `process.loadEnvFile()` on import, which would add an env file's variables to the
// fixture; vi.hoisted installs the spy before any import of this file can load env.ts.
vi.hoisted(() => vi.spyOn(process, "loadEnvFile").mockImplementation(() => undefined));

const ROOT = findMonorepoRoot(path.dirname(fileURLToPath(import.meta.url)));
const CORE = path.join(ROOT, "scripts", "start", "lib", "start-environment.mjs");

/** The part of the start's pure core this suite reads. */
interface EnvironmentModule {
  LOOPBACK: string;
  generateEnvironment(options: {
    randomBytes: (size: number) => Buffer;
    apiPort?: number;
    clientPort?: number;
  }): Array<[string, string]>;
  missingKeys(values: Record<string, string | undefined>): string[];
  apiPort(fromShell: string | undefined, fromFile: string | undefined): number | null;
  staleApiAddresses(
    values: Record<string, string>,
    apiPort: number
  ): Array<{ key: string; port: number }>;
}

const core = (await import(CORE)) as EnvironmentModule;

/** The port the client portal's `dev` script hands `next dev -p`. */
function clientPortalDevPort(): string {
  const manifest = JSON.parse(
    readFileSync(path.join(ROOT, "apps/client/package.json"), "utf8")
  ) as {
    scripts?: Record<string, string>;
  };
  return /\s-p\s+(\d+)/.exec(manifest.scripts?.dev ?? "")?.[1] ?? "";
}

/** A freshly generated environment, variable by variable, for the app ports a run gives. */
function generated(ports: { apiPort?: number; clientPort?: number } = {}): Record<string, string> {
  return Object.fromEntries(core.generateEnvironment({ randomBytes, ...ports }));
}

/** App ports a run gives that are neither app's default. */
const RUN_PORTS = { apiPort: 4321, clientPort: 4322 } as const;

describe("the generated environment's public addresses", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("holds the three, in values the API's schema accepts as written", async () => {
    const values = generated();
    const { parseApiEnv } = await withEnvironment(
      makeApiEnv(),
      () => import("../../../src/config/env.js")
    );

    const parsed = parseApiEnv(values);

    expect(PUBLIC_ADDRESS_VARIABLES.filter((variable) => !values[variable])).toEqual([]);
    expect({
      CLIENT_URL: parsed.CLIENT_URL,
      API_BASE_URL: parsed.API_BASE_URL,
      APP_BASE_URL: parsed.APP_BASE_URL,
    }).toEqual({
      CLIENT_URL: values.CLIENT_URL,
      API_BASE_URL: values.API_BASE_URL,
      APP_BASE_URL: values.APP_BASE_URL,
    });
  });

  it("names the client portal on the loopback, at the port its dev script fixes, when the run gives none", () => {
    const client = new URL(generated().CLIENT_URL ?? "");

    expect(clientPortalDevPort()).not.toBe("");
    expect([client.protocol, client.hostname, client.port, client.pathname]).toEqual([
      "http:",
      core.LOOPBACK,
      clientPortalDevPort(),
      "/",
    ]);
  });

  it("names the API on the loopback, at the port it takes by default, for webhooks and sign-on alike, when the run gives none", () => {
    const values = generated();
    const api = `http://${core.LOOPBACK}:${String(core.apiPort(undefined, undefined))}`;

    expect([values.API_BASE_URL, values.APP_BASE_URL]).toEqual([api, api]);
  });

  it("names the API and the client portal at the ports the run gives them, and writes no PORT", () => {
    const values = generated(RUN_PORTS);
    const api = `http://${core.LOOPBACK}:${String(RUN_PORTS.apiPort)}`;

    expect({
      CLIENT_URL: values.CLIENT_URL,
      API_BASE_URL: values.API_BASE_URL,
      APP_BASE_URL: values.APP_BASE_URL,
      PORT: values.PORT,
    }).toEqual({
      CLIENT_URL: `http://${core.LOOPBACK}:${String(RUN_PORTS.clientPort)}`,
      API_BASE_URL: api,
      APP_BASE_URL: api,
      PORT: undefined,
    });
  });

  it("names each public address an existing environment file lacks", () => {
    const values: Record<string, string | undefined> = generated();
    for (const variable of PUBLIC_ADDRESS_VARIABLES) values[variable] = undefined;

    expect(core.missingKeys(values)).toEqual([...PUBLIC_ADDRESS_VARIABLES]);
  });
});

/** The port the run starts the API on, and a port derived from it, so the two always differ. */
const TAKEN_PORT = RUN_PORTS.apiPort;
const OTHER_PORT = TAKEN_PORT + 1000;

/** An environment file whose two API addresses are both `address`. */
function apiAddresses(address: string): Record<string, string> {
  return { API_BASE_URL: address, APP_BASE_URL: address };
}

describe("the API addresses of a kept environment file", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it.each([
    {
      form: "the IPv4 loopback on another port",
      address: `http://127.0.0.1:${String(OTHER_PORT)}`,
      port: OTHER_PORT,
    },
    {
      form: "another address of the IPv4 loopback block",
      address: `http://127.8.8.8:${String(OTHER_PORT)}`,
      port: OTHER_PORT,
    },
    {
      form: "localhost on another port",
      address: `http://localhost:${String(OTHER_PORT)}`,
      port: OTHER_PORT,
    },
    {
      form: "the IPv6 loopback on another port",
      address: `http://[::1]:${String(OTHER_PORT)}`,
      port: OTHER_PORT,
    },
    {
      form: "an https loopback on another port",
      address: `https://localhost:${String(OTHER_PORT)}`,
      port: OTHER_PORT,
    },
    { form: "an http loopback that writes no port", address: "http://localhost", port: 80 },
    {
      form: "an http loopback that writes its default port",
      address: "http://localhost:80",
      port: 80,
    },
    { form: "an https loopback that writes no port", address: "https://localhost", port: 443 },
  ])("returns both names with the port each names when each is $form", ({ address, port }) => {
    expect(core.staleApiAddresses(apiAddresses(address), TAKEN_PORT)).toEqual([
      { key: "API_BASE_URL", port },
      { key: "APP_BASE_URL", port },
    ]);
  });

  it.each([
    {
      form: "a loopback on the port the API takes",
      address: `http://127.0.0.1:${String(TAKEN_PORT)}`,
    },
    { form: "on another host", address: `http://api.internal.test:${String(OTHER_PORT)}` },
    {
      form: "a loopback under a scheme that is neither http nor https",
      address: `ftp://127.0.0.1:${String(OTHER_PORT)}`,
    },
    { form: "a host and a port with no scheme", address: `localhost:${String(OTHER_PORT)}` },
    { form: "not a URL", address: `127.0.0.1:${String(OTHER_PORT)}` },
  ])("returns nothing when each is $form", ({ address }) => {
    expect(core.staleApiAddresses(apiAddresses(address), TAKEN_PORT)).toEqual([]);
  });

  it("returns the one stale name when the other is on the port the API takes", () => {
    const values = {
      API_BASE_URL: `http://127.0.0.1:${String(TAKEN_PORT)}`,
      APP_BASE_URL: `http://127.0.0.1:${String(OTHER_PORT)}`,
    };

    expect(core.staleApiAddresses(values, TAKEN_PORT)).toEqual([
      { key: "APP_BASE_URL", port: OTHER_PORT },
    ]);
  });

  it("returns API_BASE_URL first when the file writes APP_BASE_URL first and both are stale", () => {
    const stale = `http://127.0.0.1:${String(OTHER_PORT)}`;
    const values = { APP_BASE_URL: stale, API_BASE_URL: stale };

    expect(core.staleApiAddresses(values, TAKEN_PORT).map(({ key }) => key)).toEqual([
      "API_BASE_URL",
      "APP_BASE_URL",
    ]);
  });

  it("returns nothing when the file holds neither address", () => {
    expect(core.staleApiAddresses({}, TAKEN_PORT)).toEqual([]);
  });
});
