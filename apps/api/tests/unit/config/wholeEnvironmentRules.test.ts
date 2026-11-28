/**
 * @file wholeEnvironmentRules.test.ts
 * @description The rules of the API's environment schema that read more than one variable, or a
 *   variable as a whole: the trusted-proxy pair, the key ring's contiguity and the key ring's active
 *   version. Each runs whenever every variable it reads passed its own schema, whatever the other
 *   variables did, so one refusal names its cause beside theirs. None runs on a variable its own
 *   schema refused, which would add a second issue about a value already refused. Driven through
 *   the real `parseApiEnv`, each case with an environment of its own.
 * @layer infrastructure
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
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

/** Key material of one generation of the name-digest ring: 32 bytes as 64 lowercase hex. */
const keyOf = (digit: string): string => digit.repeat(64);

/**
 * Each rule over the whole environment, with an environment that breaks it and nothing else, the
 * variable its refusal names and the part of its constraint that says which rule refused.
 */
const RULES = [
  {
    rule: "the trusted-proxy pair, trusted-ranges with no ranges",
    environment: { TRUSTED_PROXY_MODE: "trusted-ranges" },
    variable: "TRUSTED_PROXY_RANGES",
    constraint: "required when TRUSTED_PROXY_MODE=trusted-ranges",
  },
  {
    rule: "the trusted-proxy pair, socket-only with ranges",
    environment: { TRUSTED_PROXY_MODE: "socket-only", TRUSTED_PROXY_RANGES: "10.0.0.1" },
    variable: "TRUSTED_PROXY_RANGES",
    constraint: "TRUSTED_PROXY_RANGES is set but TRUSTED_PROXY_MODE=socket-only",
  },
  {
    rule: "the key ring's contiguity",
    environment: {
      DELETION_NAME_DIGEST_KEY_RING: JSON.stringify({ 1: keyOf("1"), 3: keyOf("3") }),
    },
    variable: "DELETION_NAME_DIGEST_KEY_RING",
    constraint: "DELETION_NAME_DIGEST_KEY_RING is missing version 2",
  },
  {
    rule: "the key ring's active version",
    environment: { DELETION_NAME_DIGEST_ACTIVE_VERSION: "2" },
    variable: "DELETION_NAME_DIGEST_ACTIVE_VERSION",
    constraint: "DELETION_NAME_DIGEST_ACTIVE_VERSION=2 names no ring entry",
  },
] as const;

/**
 * Variables that fail their own schema in the ways that stop Zod from running a refinement of the
 * whole object: a required variable left out and a number that is not one, after which Zod runs
 * only a check told to run anyway, and a number that must be whole and is not, after which it runs
 * no check at all.
 */
const UNRELATED_FAILURES: Record<string, string | undefined> = {
  JWT_ACCESS_SECRET: undefined,
  PORT: "not-a-port",
  DELETION_RECORD_RETENTION_YEARS: "2.5",
};

/** The variables `UNRELATED_FAILURES` refuses. */
const UNRELATED_VARIABLES = ["DELETION_RECORD_RETENTION_YEARS", "JWT_ACCESS_SECRET", "PORT"];

/**
 * Environments that write a variable a rule reads with no value, as a leftover line of an
 * environment file does. The schema reads such a variable as unset, its default applied, and the
 * rule reads the same: the variable its refusal names and the part of its constraint that says so.
 */
const EMPTY_VALUES = [
  {
    written: "an empty TRUSTED_PROXY_MODE beside ranges",
    environment: { TRUSTED_PROXY_MODE: "", TRUSTED_PROXY_RANGES: "10.0.0.1" },
    variable: "TRUSTED_PROXY_RANGES",
    constraint: "TRUSTED_PROXY_RANGES is set but TRUSTED_PROXY_MODE=socket-only",
  },
  {
    written: "an empty TRUSTED_PROXY_RANGES under trusted-ranges",
    environment: { TRUSTED_PROXY_MODE: "trusted-ranges", TRUSTED_PROXY_RANGES: "" },
    variable: "TRUSTED_PROXY_RANGES",
    constraint: "required when TRUSTED_PROXY_MODE=trusted-ranges",
  },
  {
    written: "an empty DELETION_NAME_DIGEST_ACTIVE_VERSION beside a ring with a gap",
    environment: {
      DELETION_NAME_DIGEST_ACTIVE_VERSION: "",
      DELETION_NAME_DIGEST_KEY_RING: JSON.stringify({ 1: keyOf("1"), 3: keyOf("3") }),
    },
    variable: "DELETION_NAME_DIGEST_KEY_RING",
    constraint: "DELETION_NAME_DIGEST_KEY_RING is missing version 2",
  },
] as const;

/** The lines of a refusal's cause that name `variable`, each with its constraint. */
function linesNaming(cause: string, variable: string): string[] {
  return cause.split("\n").filter((line) => line.startsWith(`  - ${variable}: `));
}

describe("a rule over the whole environment runs beside the variables that failed their own", () => {
  let parseApiEnv: ParseApiEnv;

  beforeAll(async () => {
    parseApiEnv = await loadParseApiEnv();
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it.each(RULES)(
    "names $variable alone when $rule refuses an environment that fails nothing else",
    ({ environment, variable, constraint }) => {
      const refusal = refusalUnder(parseApiEnv, makeApiEnv(environment));

      expect(refusal).toMatchObject({
        code: "ENV_VARIABLES_REFUSED",
        params: { variables: [variable] },
        message: refusedMessage([variable]),
      });
      expect(linesNaming(causeText(refusal), variable)).toHaveLength(1);
      expect(causeText(refusal)).toContain(constraint);
    }
  );

  it.each(RULES)(
    "names $variable, refused by $rule, beside variables that failed their own schema",
    ({ environment, variable, constraint }) => {
      const refusal = refusalUnder(
        parseApiEnv,
        makeApiEnv({ ...UNRELATED_FAILURES, ...environment })
      );

      const named = [...UNRELATED_VARIABLES, variable].sort();
      expect(refusal).toMatchObject({
        code: "ENV_VARIABLES_REFUSED",
        params: { variables: named },
        message: refusedMessage(named),
      });
      expect(causeText(refusal)).toContain(constraint);
    }
  );
});

describe("a rule over the whole environment never runs on a variable its own schema refused", () => {
  let parseApiEnv: ParseApiEnv;

  beforeAll(async () => {
    parseApiEnv = await loadParseApiEnv();
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it.each(["0", "1.5"])(
    "refuses an active version of %s by its own schema alone, with no claim about the ring",
    (activeVersion) => {
      const refusal = refusalUnder(
        parseApiEnv,
        makeApiEnv({ DELETION_NAME_DIGEST_ACTIVE_VERSION: activeVersion })
      );

      expect(refusal).toMatchObject({
        code: "ENV_VARIABLES_REFUSED",
        params: { variables: ["DELETION_NAME_DIGEST_ACTIVE_VERSION"] },
      });
      expect(linesNaming(causeText(refusal), "DELETION_NAME_DIGEST_ACTIVE_VERSION")).toHaveLength(
        1
      );
      expect(causeText(refusal)).not.toContain("names no ring entry");
    }
  );

  it("refuses a blank TRUSTED_PROXY_MODE by its own schema alone, with no claim about the ranges", () => {
    const refusal = refusalUnder(
      parseApiEnv,
      makeApiEnv({ TRUSTED_PROXY_MODE: " ", TRUSTED_PROXY_RANGES: "10.0.0.1" })
    );

    expect(refusal).toMatchObject({
      code: "ENV_VARIABLES_REFUSED",
      params: { variables: ["TRUSTED_PROXY_MODE"] },
    });
    expect(linesNaming(causeText(refusal), "TRUSTED_PROXY_RANGES")).toEqual([]);
  });
});

describe("a rule over the whole environment reads a variable written with no value as unset", () => {
  let parseApiEnv: ParseApiEnv;

  beforeAll(async () => {
    parseApiEnv = await loadParseApiEnv();
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it.each(EMPTY_VALUES)(
    "names $variable when the environment writes $written",
    ({ environment, variable, constraint }) => {
      const refusal = refusalUnder(parseApiEnv, makeApiEnv(environment));

      expect(refusal).toMatchObject({
        code: "ENV_VARIABLES_REFUSED",
        params: { variables: [variable] },
        message: refusedMessage([variable]),
      });
      expect(causeText(refusal)).toContain(constraint);
    }
  );
});
