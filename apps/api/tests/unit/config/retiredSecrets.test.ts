/**
 * @file retiredSecrets.test.ts
 * @description The API's environment schema holds no secret that nothing reads. `OAUTH_ENCRYPTION_KEY`
 *   and `JWT_SECRET` are retired names: refused while they are set, the refusal naming the variable
 *   and its constraint and never its value, and a value that is empty or only blanks counting as
 *   unset, as for every other retired name. `SHADOW_DATABASE_URL`, which only `prisma migrate dev`
 *   reads, is optional. One refusal names every cause: a retired name still set is named beside the
 *   declared variables that fail their own rule. Driven through the real `parseApiEnv`, each case
 *   with an environment of its own.
 * @layer infrastructure
 */
import { beforeAll, beforeEach, describe, expect, expectTypeOf, it, vi } from "vitest";
import {
  type ParseApiEnv,
  causeText,
  loadParseApiEnv,
  refusalUnder,
  refusedMessage,
} from "../helpers/apiEnvRefusal.js";
import { makeApiEnv } from "../helpers/publicAddressEnv.js";

// `env.ts` calls `process.loadEnvFile()` on import, which would add an env file's variables to the
// fixture; vi.hoisted installs the spy before any import of this file can load env.ts.
vi.hoisted(() => vi.spyOn(process, "loadEnvFile").mockImplementation(() => undefined));

/** A value the refusal may never carry: long enough for any secret rule the schema ever held. */
const PLANTED = "planted-Retired-Secret-Value-w5r2-k9";

/** The retired secrets, each with the constraint its refusal states. */
const RETIRED_SECRETS = [
  {
    variable: "OAUTH_ENCRYPTION_KEY",
    constraint:
      "OAUTH_ENCRYPTION_KEY was removed. Nothing in the API reads it and nothing replaced it: " +
      "the table it was meant to encrypt no longer exists, so its value protects nothing. " +
      "Delete it from the environment.",
  },
  {
    variable: "JWT_SECRET",
    constraint:
      "JWT_SECRET was removed. Nothing in the API reads it and nothing replaced it, so its value " +
      "configures nothing. Delete it from the environment.",
  },
] as const;

/** Every name the schema refuses while it is set. */
const RETIRED_NAMES = [
  "TRUSTED_PROXY_HOP_COUNT",
  "CLIENT_APP_URL",
  "FRONTEND_URL",
  "ADMIN_URL",
  "OAUTH_ENCRYPTION_KEY",
  "JWT_SECRET",
] as const;

/**
 * Declared variables that each fail their own rule: a required one missing, a URL that is not one,
 * a boolean outside its four spellings, whose rule ends in a transform, and a number that must be
 * whole and is not, after which Zod runs no check of the whole object.
 */
const INVALID_FIELDS: Record<string, string | undefined> = {
  JWT_ACCESS_SECRET: undefined,
  DATABASE_URL: "not a url",
  ENABLE_RATE_LIMITING: "maybe",
  DELETION_RECORD_RETENTION_YEARS: "2.5",
};

/** The variables `INVALID_FIELDS` refuses. */
const INVALID_VARIABLES = [
  "DATABASE_URL",
  "DELETION_RECORD_RETENTION_YEARS",
  "ENABLE_RATE_LIMITING",
  "JWT_ACCESS_SECRET",
];

/** The console methods a refusal could write through, besides the two streams themselves. */
const CONSOLE_METHODS = ["log", "info", "warn", "error", "debug"] as const;

/**
 * Runs `act` with standard output, standard error and the console methods captured, then restores
 * them. Each capture appends to the list it returns, which survives the restore that clears a spy's
 * own record of its calls.
 */
function writtenDuring<T>(act: () => T): { result: T; written: string[] } {
  const written: string[] = [];
  const capture = (...chunks: unknown[]): void => {
    written.push(chunks.map(String).join(" "));
  };
  const spies = [
    vi.spyOn(process.stdout, "write").mockImplementation((chunk: unknown) => {
      capture(chunk);
      return true;
    }),
    vi.spyOn(process.stderr, "write").mockImplementation((chunk: unknown) => {
      capture(chunk);
      return true;
    }),
    ...CONSOLE_METHODS.map((method) => vi.spyOn(console, method).mockImplementation(capture)),
  ];
  try {
    return { result: act(), written };
  } finally {
    for (const spy of spies) spy.mockRestore();
  }
}

describe("the API's environment requires no secret that nothing reads", () => {
  let parseApiEnv: ParseApiEnv;

  beforeAll(async () => {
    parseApiEnv = await loadParseApiEnv();
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("accepts an environment without OAUTH_ENCRYPTION_KEY, and gives no such variable", () => {
    const environment = makeApiEnv({ OAUTH_ENCRYPTION_KEY: undefined });

    const parsed = parseApiEnv(environment);

    expect(parsed.DATABASE_URL).toBe(environment.DATABASE_URL);
    expectTypeOf(parsed).not.toHaveProperty("OAUTH_ENCRYPTION_KEY");
    expectTypeOf(parsed).not.toHaveProperty("JWT_SECRET");
  });

  it("accepts an environment without SHADOW_DATABASE_URL, and gives it as unset", () => {
    const environment = makeApiEnv({ SHADOW_DATABASE_URL: undefined });

    const parsed = parseApiEnv(environment);

    expect(parsed.DATABASE_URL).toBe(environment.DATABASE_URL);
    expect(parsed.SHADOW_DATABASE_URL).toBeUndefined();
  });

  it("gives SHADOW_DATABASE_URL as the environment wrote it when it is set", () => {
    const shadow = "postgresql://omnipost:secret@127.0.0.1:5432/omnipostdb_shadow";

    const parsed = parseApiEnv(makeApiEnv({ SHADOW_DATABASE_URL: shadow }));

    expect(parsed.SHADOW_DATABASE_URL).toBe(shadow);
  });

  it("refuses a SHADOW_DATABASE_URL that is not a URL, naming it and never its value", () => {
    const refusal = refusalUnder(
      parseApiEnv,
      makeApiEnv({ SHADOW_DATABASE_URL: `not a url ${PLANTED}` })
    );

    expect(refusal).toMatchObject({
      code: "ENV_VARIABLES_REFUSED",
      params: { variables: ["SHADOW_DATABASE_URL"] },
      message: refusedMessage(["SHADOW_DATABASE_URL"]),
    });
    expect(causeText(refusal)).toContain("\n  - SHADOW_DATABASE_URL: ");
    expect(refusal?.message).not.toContain(PLANTED);
    expect(JSON.stringify(refusal?.params)).not.toContain(PLANTED);
  });
});

describe("the API's environment refuses a retired secret while it is set", () => {
  let parseApiEnv: ParseApiEnv;

  beforeAll(async () => {
    parseApiEnv = await loadParseApiEnv();
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it.each(RETIRED_SECRETS)(
    "refuses $variable set alone, naming it and its constraint and never its value",
    ({ variable, constraint }) => {
      const refusal = refusalUnder(parseApiEnv, makeApiEnv({ [variable]: PLANTED }));

      expect(refusal).toMatchObject({
        code: "ENV_VARIABLES_REFUSED",
        params: { variables: [variable] },
        message: refusedMessage([variable]),
      });
      expect(causeText(refusal)).toContain(`\n  - ${variable}: ${constraint}\n`);
      expect(refusal?.message).not.toContain(PLANTED);
      expect(JSON.stringify(refusal?.params)).not.toContain(PLANTED);
      expect(causeText(refusal)).not.toContain(PLANTED);
    }
  );

  it.each(RETIRED_SECRETS)(
    "writes nothing to standard output or standard error while it refuses $variable",
    ({ variable }) => {
      const { result: refusal, written } = writtenDuring(() =>
        refusalUnder(parseApiEnv, makeApiEnv({ [variable]: PLANTED }))
      );

      expect(refusal).toMatchObject({
        code: "ENV_VARIABLES_REFUSED",
        params: { variables: [variable] },
      });
      expect(written).toEqual([]);
    }
  );

  it.each(
    RETIRED_SECRETS.flatMap(({ variable }) => ["", "   "].map((value) => ({ variable, value })))
  )(
    "takes $variable set to $value as unset, as for every other retired name",
    ({ variable, value }) => {
      const refusal = refusalUnder(parseApiEnv, makeApiEnv({ [variable]: value }));

      expect(refusal).toBeUndefined();
    }
  );
});

describe("one refusal names every cause", () => {
  let parseApiEnv: ParseApiEnv;

  beforeAll(async () => {
    parseApiEnv = await loadParseApiEnv();
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it.each(RETIRED_NAMES)(
    "names %s beside the declared variables that fail their own rule, and never its value",
    (variable) => {
      const refusal = refusalUnder(
        parseApiEnv,
        makeApiEnv({ ...INVALID_FIELDS, [variable]: PLANTED })
      );

      const named = [...INVALID_VARIABLES, variable].sort();
      expect(refusal).toMatchObject({
        code: "ENV_VARIABLES_REFUSED",
        params: { variables: named },
        message: refusedMessage(named),
      });
      expect(causeText(refusal)).toContain(`\n  - ${variable}: ${variable} was removed`);
      expect(refusal?.message).not.toContain(PLANTED);
      expect(JSON.stringify(refusal?.params)).not.toContain(PLANTED);
      expect(causeText(refusal)).not.toContain(PLANTED);
    }
  );

  it("names a retired name beside a variable that a rule over the whole environment refuses", () => {
    const refusal = refusalUnder(
      parseApiEnv,
      makeApiEnv({ TRUSTED_PROXY_MODE: "trusted-ranges", OAUTH_ENCRYPTION_KEY: PLANTED })
    );

    expect(refusal).toMatchObject({
      code: "ENV_VARIABLES_REFUSED",
      params: { variables: ["OAUTH_ENCRYPTION_KEY", "TRUSTED_PROXY_RANGES"] },
    });
    expect(causeText(refusal)).toContain("\n  - TRUSTED_PROXY_RANGES: ");
    expect(causeText(refusal)).not.toContain(PLANTED);
  });
});
