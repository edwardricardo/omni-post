/**
 * @file startEnvironmentPublicAddresses.test.ts
 * @description The public addresses in the environment `pnpm start:platform` generates
 *   (`scripts/start/lib/start-environment.mjs`): the client portal's address and the API's two, each
 *   a URL on the loopback where the development run serves it, in values the API's own schema
 *   accepts as written; and an existing environment file that lacks one is named as lacking it. The
 *   client portal's port is read from its `dev` script, the one `next dev -p` takes, so the suite
 *   goes red when either side moves alone.
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
  generateEnvironment(options: { randomBytes: (size: number) => Buffer }): Array<[string, string]>;
  missingKeys(values: Record<string, string | undefined>): string[];
  apiPort(fromShell: string | undefined, fromFile: string | undefined): number | null;
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

/** A freshly generated environment, variable by variable. */
function generated(): Record<string, string> {
  return Object.fromEntries(core.generateEnvironment({ randomBytes }));
}

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

  it("names the client portal on the loopback, at the port its dev script fixes", () => {
    const client = new URL(generated().CLIENT_URL ?? "");

    expect(clientPortalDevPort()).not.toBe("");
    expect([client.protocol, client.hostname, client.port, client.pathname]).toEqual([
      "http:",
      core.LOOPBACK,
      clientPortalDevPort(),
      "/",
    ]);
  });

  it("names the API on the loopback, at the port it takes by default, for webhooks and sign-on alike", () => {
    const values = generated();
    const api = `http://${core.LOOPBACK}:${String(core.apiPort(undefined, undefined))}`;

    expect([values.API_BASE_URL, values.APP_BASE_URL]).toEqual([api, api]);
  });

  it("names each public address an existing environment file lacks", () => {
    const values: Record<string, string | undefined> = generated();
    for (const variable of PUBLIC_ADDRESS_VARIABLES) values[variable] = undefined;

    expect(core.missingKeys(values)).toEqual([...PUBLIC_ADDRESS_VARIABLES]);
  });
});
