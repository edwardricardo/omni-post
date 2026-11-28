/**
 * @file publicAddresses.test.ts
 * @description The API's environment schema requires each public address of the platform, with no
 *   default: `CLIENT_URL` (the client portal), `API_BASE_URL` (the API as a webhook subscription
 *   names it) and `APP_BASE_URL` (the API as a single sign-on callback names it). Each is an `http`
 *   or `https` origin written as its own serialization, since every reader appends a path to it. An
 *   environment that lacks one, or names it with anything else, is refused by the registry's
 *   `ENV_VARIABLES_REFUSED`, which names the variable and never a value. The names those three
 *   replace, `CLIENT_APP_URL`, `FRONTEND_URL` and `ADMIN_URL`, are refused while they are set, with
 *   what to do instead, and a blank one is unset, as for the removed `TRUSTED_PROXY_HOP_COUNT`.
 *   Driven through the real `parseApiEnv`.
 * @layer infrastructure
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
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

/** What the refusal of each retired name tells the operator to do. */
const RETIRED_INSTRUCTIONS: Record<(typeof RETIRED_VARIABLES)[number], string> = {
  CLIENT_APP_URL: "Set CLIENT_URL to the client portal's origin, then unset CLIENT_APP_URL.",
  FRONTEND_URL: "Set CLIENT_URL to the client portal's origin, then unset FRONTEND_URL.",
  ADMIN_URL: "Nothing in the API reads it, so its value configures nothing. Unset it.",
};

type ParseApiEnv = typeof import("../../../src/config/env.js").parseApiEnv;

/** The fields every reader of a registered error relies on. */
interface RefusalFields {
  readonly code: string;
  readonly message: string;
  readonly params: unknown;
  readonly cause?: unknown;
}

/** The schema's text a refusal carries as its cause, which the API's start shows; empty without. */
function causeText(refusal: RefusalFields | undefined): string {
  return refusal?.cause instanceof Error ? refusal.cause.message : "";
}

/** The real `parseApiEnv`, loaded with an environment the schema accepts. */
async function loadParseApiEnv(): Promise<ParseApiEnv> {
  const module = await withEnvironment(makeApiEnv(), () => import("../../../src/config/env.js"));
  return module.parseApiEnv;
}

/** What a `parseApiEnv` raises for an environment, read by its fields; undefined when it accepts it. */
function refusalUnder(
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

/** What a freshly loaded `parseApiEnv` raises for an environment; undefined when it accepts it. */
async function refusalOf(
  environment: Record<string, string | undefined>
): Promise<RefusalFields | undefined> {
  return refusalUnder(await loadParseApiEnv(), environment);
}

/**
 * Values that are URLs but not the origin a public address is: another scheme, no scheme, or an
 * origin with something after it that a reader's appended path would land behind.
 */
const NOT_ORIGINS = [
  { form: "a javascript: URL", value: "javascript:alert(1)" },
  { form: "a file: URL", value: "file:///etc/passwd" },
  { form: "a data: URL", value: "data:text/plain,origin" },
  { form: "a mailto: URL", value: "mailto:ops@host.test" },
  { form: "an ftp origin", value: "ftp://host.test" },
  { form: "a host and port with no scheme", value: "localhost:3000" },
  { form: "an origin with credentials", value: "https://user:pass@host.test" },
  { form: "an origin with a path", value: "https://host.test/some/path" },
  { form: "an origin with a query", value: "https://host.test?x=1" },
  { form: "an origin with an empty query", value: "https://host.test?" },
  { form: "an origin with a fragment", value: "https://host.test#frag" },
  { form: "an origin with a trailing slash", value: "https://host.test/" },
  { form: "an origin in capitals", value: "HTTPS://HOST.TEST" },
  { form: "an origin that writes out its scheme's default port", value: "https://host.test:443" },
] as const;

/** Origins a public address may be: an `https` host, and an `http` loopback address with a port. */
const ORIGINS = ["https://host.test", "http://127.0.0.1:3200"] as const;

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

describe("a public address is an http or https origin and nothing more", () => {
  let parseApiEnv: ParseApiEnv;

  beforeAll(async () => {
    parseApiEnv = await loadParseApiEnv();
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it.each(
    PUBLIC_ADDRESS_VARIABLES.flatMap((variable) =>
      NOT_ORIGINS.map(({ form, value }) => ({ variable, form, value }))
    )
  )(
    "refuses $variable written as $form, naming the variable and never the value",
    ({ variable, value }) => {
      const refusal = refusalUnder(parseApiEnv, makeApiEnv({ [variable]: value }));

      expect(refusal).toMatchObject({
        code: "ENV_VARIABLES_REFUSED",
        params: { variables: [variable] },
      });
      expect(refusal?.message).not.toContain(value);
      expect(JSON.stringify(refusal?.params)).not.toContain(value);
    }
  );

  it.each(
    PUBLIC_ADDRESS_VARIABLES.flatMap((variable) => ORIGINS.map((origin) => ({ variable, origin })))
  )("accepts $variable written as $origin, and gives it as written", ({ variable, origin }) => {
    const parsed = parseApiEnv(makeApiEnv({ [variable]: origin }));

    expect(parsed[variable]).toBe(origin);
  });
});

describe("the API's environment refuses a retired address name while it is set", () => {
  let parseApiEnv: ParseApiEnv;

  beforeAll(async () => {
    parseApiEnv = await loadParseApiEnv();
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it.each(RETIRED_VARIABLES)(
    "refuses %s set alone, naming it and never its value, and says what to do instead",
    (variable) => {
      const refusal = refusalUnder(
        parseApiEnv,
        makeApiEnv({ [variable]: `https://${PLANTED}.example.test` })
      );

      expect(refusal).toMatchObject({
        code: "ENV_VARIABLES_REFUSED",
        params: { variables: [variable] },
        message: `The environment was refused: these variables are missing or not valid: ${variable}`,
      });
      expect(causeText(refusal)).toContain(`\n  - ${variable}: ${variable} was removed`);
      expect(causeText(refusal)).toContain(RETIRED_INSTRUCTIONS[variable]);
      expect(causeText(refusal)).not.toContain(PLANTED);
    }
  );

  it("accepts an environment that sets none of them, and gives none of them", () => {
    const parsed = parseApiEnv(makeApiEnv());

    expect(RETIRED_VARIABLES.filter((variable) => variable in parsed)).toEqual([]);
  });

  it.each(["", "   "])(
    "takes a retired name set to %j as unset, as the schema takes the removed TRUSTED_PROXY_HOP_COUNT",
    (value) => {
      const blank = Object.fromEntries(RETIRED_VARIABLES.map((variable) => [variable, value]));

      expect(refusalUnder(parseApiEnv, makeApiEnv(blank))).toBeUndefined();
    }
  );
});
