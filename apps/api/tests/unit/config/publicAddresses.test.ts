/**
 * @file publicAddresses.test.ts
 * @description The API's environment schema requires each public address of the platform, with no
 *   default: `CLIENT_URL` (the client portal), `API_BASE_URL` (the API as a webhook subscription
 *   names it) and `APP_BASE_URL` (the API as a single sign-on callback names it). An environment
 *   that lacks one, or names it with something that is not a URL, is refused by the registry's
 *   `ENV_VARIABLES_REFUSED`, which names the variable and never a value. The names those three
 *   replace, `CLIENT_APP_URL`, `FRONTEND_URL` and `ADMIN_URL`, are not variables of the API. Driven
 *   through the real `parseApiEnv`.
 * @layer infrastructure
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  PUBLIC_ADDRESS_VARIABLES,
  makeApiEnv,
  makePublicAddressEnv,
  withEnvironment,
} from "../helpers/publicAddressEnv.js";

// `env.ts` calls `process.loadEnvFile()` on import, which would add an env file's variables to the
// fixture; vi.hoisted installs the spy before any import of this file can load env.ts.
vi.hoisted(() => vi.spyOn(process, "loadEnvFile").mockImplementation(() => undefined));

/** A value the refusal may never carry. */
const PLANTED = "planted-Address-Value-q3k8";

/** The names the three public addresses replace. */
const RETIRED_VARIABLES = ["CLIENT_APP_URL", "FRONTEND_URL", "ADMIN_URL"] as const;

type ParseApiEnv = typeof import("../../../src/config/env.js").parseApiEnv;

/** The fields every reader of a registered error relies on. */
interface RefusalFields {
  readonly code: string;
  readonly message: string;
  readonly params: unknown;
}

/** The real `parseApiEnv`, loaded with an environment the schema accepts. */
async function loadParseApiEnv(): Promise<ParseApiEnv> {
  const module = await withEnvironment(makeApiEnv(), () => import("../../../src/config/env.js"));
  return module.parseApiEnv;
}

/** What `parseApiEnv` raises for an environment, read by its fields; undefined when it accepts it. */
async function refusalOf(
  environment: Record<string, string | undefined>
): Promise<RefusalFields | undefined> {
  const parseApiEnv = await loadParseApiEnv();
  try {
    parseApiEnv(environment);
    return undefined;
  } catch (error: unknown) {
    return error as RefusalFields;
  }
}

describe("the API's environment requires each public address", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it.each(PUBLIC_ADDRESS_VARIABLES)(
    "refuses an environment without %s, naming that variable alone",
    async (variable) => {
      const refusal = await refusalOf(makeApiEnv({ [variable]: undefined }));

      expect(refusal).toMatchObject({
        code: "ENV_VARIABLES_REFUSED",
        params: { variables: [variable] },
        message: `The environment was refused: these variables are missing or not valid: ${variable}`,
      });
    }
  );

  it.each(PUBLIC_ADDRESS_VARIABLES)(
    "refuses %s when it is not a URL, naming the variable and never its value",
    async (variable) => {
      const refusal = await refusalOf(makeApiEnv({ [variable]: `not a url ${PLANTED}` }));

      expect(refusal).toMatchObject({
        code: "ENV_VARIABLES_REFUSED",
        params: { variables: [variable] },
      });
      expect(refusal?.message).not.toContain(PLANTED);
      expect(JSON.stringify(refusal?.params)).not.toContain(PLANTED);
    }
  );

  it("gives each public address as the environment wrote it", async () => {
    const parseApiEnv = await loadParseApiEnv();

    const parsed = parseApiEnv(makeApiEnv());

    expect({
      CLIENT_URL: parsed.CLIENT_URL,
      API_BASE_URL: parsed.API_BASE_URL,
      APP_BASE_URL: parsed.APP_BASE_URL,
    }).toEqual(makePublicAddressEnv());
  });
});

describe("the API's environment has no variable for a retired address name", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it.each(RETIRED_VARIABLES)(
    "neither validates nor gives %s when the environment sets it",
    async (variable) => {
      const parseApiEnv = await loadParseApiEnv();

      const parsed = parseApiEnv(makeApiEnv({ [variable]: `not a url ${PLANTED}` }));

      expect(Object.keys(parsed)).not.toContain(variable);
      expect(parsed.CLIENT_URL).toBe(makePublicAddressEnv().CLIENT_URL);
    }
  );
});
