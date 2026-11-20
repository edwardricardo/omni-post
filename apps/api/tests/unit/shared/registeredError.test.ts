/**
 * @file registeredError.test.ts
 * @description The registry's error class and the readings every `of` and every front go through:
 *   `RegisteredError.of`, `isCodedError` and `resolveError`. A definition is answered with the
 *   registry's own entry for its code, never with what the object passed carries, and a code the
 *   registry does not hold answers `INTERNAL_ERROR`. No domain declares a parameter yet, so the
 *   parameter rules are proved on a registry whose `platform` table is replaced, for one case, by a
 *   table `defineErrors` builds here.
 * @layer infrastructure
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { UseCaseError } from "@core/application/UseCase.js";
import {
  COMMON_ERRORS,
  ERROR_CATEGORY,
  PARAM_KIND,
  RegisteredError,
  isCodedError,
  resolveError,
  type ErrorDefinition,
  type RegisteredErrorCode,
} from "@shared/types";
import { defineErrors } from "@shared/types/error-registry/definition.js";

const PARAMS_TABLE = "@shared/types/error-registry/domains/platform.js";

/** A table that declares one parameter of each kind, put in the registry's place for a case. */
const FIXTURE_ERRORS = defineErrors("platform", {
  FIXTURE_VARIABLES_REFUSED: {
    category: ERROR_CATEGORY.CONFIGURATION,
    status: 500,
    message: "Refused {variables}: {count} of them, retry {retry}, first {first}",
    params: {
      variables: PARAM_KIND.STRING_LIST,
      count: PARAM_KIND.NUMBER,
      retry: PARAM_KIND.BOOLEAN,
      first: PARAM_KIND.STRING,
    },
    fronts: [],
  },
});

type FixtureParams = (typeof FIXTURE_ERRORS)["FIXTURE_VARIABLES_REFUSED"]["params"];

/**
 * The fixture's definition, typed as the registry types its own: the registry this suite loads holds
 * its code at run time, which the static type of the real registry cannot know.
 */
// canon-exception: test-fixture
const VARIABLES_REFUSED = FIXTURE_ERRORS.FIXTURE_VARIABLES_REFUSED as unknown as ErrorDefinition<
  RegisteredErrorCode,
  "configuration",
  FixtureParams
>;

/** What `resolveError` answers for a value that carries no registered code. */
const UNREGISTERED = {
  definition: COMMON_ERRORS.INTERNAL_ERROR,
  params: undefined,
  registered: false,
  message: "The server could not complete the request",
};

/**
 * @description Loads the error module over a registry whose `platform` table is the fixture's.
 * @returns The freshly loaded module.
 */
async function loadRegistryWithParams() {
  vi.resetModules();
  vi.doMock(PARAMS_TABLE, () => ({ PLATFORM_ERRORS: FIXTURE_ERRORS }));
  return import("@shared/types/error-registry/registered-error.js");
}

describe("the registry's errors", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.doUnmock(PARAMS_TABLE);
    vi.resetModules();
  });

  describe("RegisteredError.of", () => {
    it("builds the error of a registered definition: its code, the registry's entry and its text", () => {
      const error = RegisteredError.of(COMMON_ERRORS.CONFLICT);

      expect(error).toBeInstanceOf(RegisteredError);
      expect(error).toBeInstanceOf(Error);
      expect(error.name).toBe("RegisteredError");
      expect(error.code).toBe("CONFLICT");
      expect(error.definition).toBe(COMMON_ERRORS.CONFLICT);
      expect(error.params).toBeUndefined();
      expect(error.message).toBe("The request conflicts with the current state of the resource");
      expect(Object.hasOwn(error, "cause")).toBe(false);
    });

    it("keeps the cause it is given, and drops one that is not an error", () => {
      const cause = new Error("the driver's own text");

      expect(RegisteredError.of(COMMON_ERRORS.TRANSIENT_FAILURE, { cause }).cause).toBe(cause);
      // canon-exception: test-fixture
      const notAnError = { cause: "a text" } as never;
      expect(Object.hasOwn(RegisteredError.of(COMMON_ERRORS.CONFLICT, notAnError), "cause")).toBe(
        false
      );
    });

    it("takes the text, status and category of the registry's entry, never of the object passed", () => {
      const copied = {
        ...COMMON_ERRORS.CONFLICT,
        category: ERROR_CATEGORY.INTERNAL,
        status: 500 as const,
        message: "an inline text",
        fronts: [],
      };

      const error = RegisteredError.of(copied);

      expect(error.definition).toBe(COMMON_ERRORS.CONFLICT);
      expect(error.definition.status).toBe(409);
      expect(error.definition.category).toBe("conflict");
      expect(error.message).toBe("The request conflicts with the current state of the resource");
    });

    it("answers INTERNAL_ERROR, and raises nothing, for a code the registry does not hold", () => {
      const cause = new Error("the original failure");
      // canon-exception: test-fixture
      const unregistered = {
        ...COMMON_ERRORS.CONFLICT,
        code: "NOT_A_REGISTERED_CODE",
      } as unknown as typeof COMMON_ERRORS.CONFLICT;

      const error = RegisteredError.of(unregistered, { cause });

      expect(error.code).toBe("INTERNAL_ERROR");
      expect(error.definition).toBe(COMMON_ERRORS.INTERNAL_ERROR);
      expect(error.params).toBeUndefined();
      expect(error.message).toBe("The server could not complete the request");
      expect(error.cause).toBe(cause);
    });

    it("reads the parameters first when the definition declares some, and words its text with them", async () => {
      const fresh = await loadRegistryWithParams();
      const cause = new Error("the environment's own text");

      const error = fresh.RegisteredError.of(
        VARIABLES_REFUSED,
        { variables: ["DATABASE_URL", "REDIS_URL"], count: 2, retry: false, first: "DATABASE_URL" },
        { cause }
      );

      expect(error.code).toBe("FIXTURE_VARIABLES_REFUSED");
      expect(error.definition).toBe(FIXTURE_ERRORS.FIXTURE_VARIABLES_REFUSED);
      expect(error.params).toEqual({
        variables: ["DATABASE_URL", "REDIS_URL"],
        count: 2,
        retry: false,
        first: "DATABASE_URL",
      });
      expect(error.message).toBe(
        "Refused DATABASE_URL, REDIS_URL: 2 of them, retry false, first DATABASE_URL"
      );
      expect(error.cause).toBe(cause);
    });

    it("keeps only the declared parameters of their declared kind, so none brings a text of its own", async () => {
      const fresh = await loadRegistryWithParams();
      // canon-exception: test-fixture
      const mistyped = {
        variables: ["DATABASE_URL", 1],
        count: "an inline text",
        retry: false,
        extra: "another text",
      } as never;

      const error = fresh.RegisteredError.of(VARIABLES_REFUSED, mistyped);

      expect(error.params).toEqual({ retry: false });
      expect(error.message).toBe(
        "Refused {variables}: {count} of them, retry false, first {first}"
      );
    });
  });

  describe("isCodedError", () => {
    it("is true for any object with a string code, whatever built it", () => {
      const values = [
        RegisteredError.of(COMMON_ERRORS.NOT_FOUND),
        new UseCaseError("an inline text", "NOT_FOUND"),
        Object.assign(new Error("a driver's failure"), { code: "P2002" }),
        { code: "ANY_CODE" },
      ];

      expect(values.map((value) => isCodedError(value))).toEqual([true, true, true, true]);
    });

    it("is false for a value with no string code", () => {
      const values = [
        null,
        undefined,
        "NOT_FOUND",
        404,
        {},
        { code: 404 },
        new Error("no code"),
        Object.assign(() => undefined, { code: "NOT_FOUND" }),
      ];

      expect(values.map((value) => isCodedError(value))).toEqual(values.map(() => false));
    });
  });

  describe("resolveError", () => {
    it("answers a registered error with its definition, its parameters and the registry's text", () => {
      expect(resolveError(RegisteredError.of(COMMON_ERRORS.NOT_FOUND))).toEqual({
        definition: COMMON_ERRORS.NOT_FOUND,
        params: undefined,
        registered: true,
        message: "The requested resource was not found",
      });
    });

    it("answers by the code, never by the text the value carries", () => {
      const legacy = new UseCaseError("an inline text", "CONFLICT");
      const plain = { code: "FORBIDDEN", message: "another inline text" };

      expect(resolveError(legacy).message).toBe(
        "The request conflicts with the current state of the resource"
      );
      expect(resolveError(legacy).definition).toBe(COMMON_ERRORS.CONFLICT);
      expect(resolveError(plain)).toEqual({
        definition: COMMON_ERRORS.FORBIDDEN,
        params: undefined,
        registered: true,
        message: "The caller is not allowed to do this",
      });
    });

    it("answers INTERNAL_ERROR, unregistered, for a value with no registered code", () => {
      const values = [
        null,
        undefined,
        "CONFLICT",
        new Error("an inline text"),
        { code: "NOT_A_REGISTERED_CODE" },
        { code: "constructor" },
        { code: 409 },
      ];

      expect(values.map((value) => resolveError(value))).toEqual(values.map(() => UNREGISTERED));
    });

    it("carries no parameter for a definition that declares none", () => {
      expect(resolveError({ code: "CONFLICT", params: { count: 2 } }).params).toBeUndefined();
    });

    it("keeps only the declared parameters, each of its declared kind", async () => {
      const fresh = await loadRegistryWithParams();

      const resolved = fresh.resolveError({
        code: "FIXTURE_VARIABLES_REFUSED",
        params: { variables: ["A", "B"], count: 2, retry: "no", first: 1, extra: "an inline text" },
      });

      expect(resolved.registered).toBe(true);
      expect(resolved.params).toEqual({ variables: ["A", "B"], count: 2 });
      expect(resolved.message).toBe("Refused A, B: 2 of them, retry {retry}, first {first}");
    });

    it("reads no parameter a value inherits or carries in another shape", async () => {
      const fresh = await loadRegistryWithParams();
      const code = "FIXTURE_VARIABLES_REFUSED";

      const carried = [
        Object.create({ count: 2 }),
        ["A", "B"],
        "count=2",
        null,
        { variables: ["A", 1] },
      ];

      expect(carried.map((params) => fresh.resolveError({ code, params }).params)).toEqual(
        carried.map(() => ({}))
      );
    });
  });
});
