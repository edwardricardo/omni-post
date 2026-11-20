/**
 * @file errorRegistry.test.ts
 * @description The error registry's kernel: the closed vocabularies, `defineErrors` and the shape of
 *   the definitions it builds, the code grammar, the lookup and the listing over every table, the
 *   message formatter, the title of a code, the `common` domain, and what the registry's barrel and
 *   the shared kernel export. `defineErrors` is imported by its own path, as no production file may,
 *   to prove its rules on entries the real tables do not hold.
 * @layer infrastructure
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { USE_CASE_ERRORS } from "@core/application/UseCase.js";
import * as sharedKernel from "@shared/types";
import {
  AUTH_ERRORS,
  CATEGORY_STATUSES,
  COMMON_ERRORS,
  ERROR_CATEGORY,
  ERROR_CODE_MAX_LENGTH,
  ERROR_CODE_PATTERN,
  ERROR_FRONT,
  ERROR_TABLES,
  HTTP_ERRORS,
  PARAM_KIND,
  PLATFORM_ERRORS,
  findErrorDefinition,
  formatErrorMessage,
  listErrorDefinitions,
  titleOf,
  type ErrorDefinition,
} from "@shared/types";
import * as registryBarrel from "@shared/types/error-registry/index.js";
import * as definitionModule from "@shared/types/error-registry/definition.js";
import * as authDomain from "@shared/types/error-registry/domains/auth.js";
import * as commonDomain from "@shared/types/error-registry/domains/common.js";
import * as httpDomain from "@shared/types/error-registry/domains/http.js";
import * as platformDomain from "@shared/types/error-registry/domains/platform.js";

const { defineErrors } = definitionModule;

/** Every table, typed as the lookup reads it, so a filled table and an empty one read alike. */
const TABLES: readonly Readonly<Record<string, ErrorDefinition>>[] = ERROR_TABLES;

/** Each domain file's table, by the domain its file name gives, in the registry's order. */
const TABLE_BY_DOMAIN: ReadonlyArray<readonly [string, Readonly<Record<string, ErrorDefinition>>]> =
  [
    ["common", COMMON_ERRORS],
    ["http", HTTP_ERRORS],
    ["auth", AUTH_ERRORS],
    ["platform", PLATFORM_ERRORS],
  ];

/** The fields a definition holds at run time, and no other. */
const DEFINITION_FIELDS = ["category", "code", "domain", "fronts", "message", "params", "status"];

/** The `common` domain: code, category, status and message, in the registry's order. */
const COMMON_ROWS = [
  ["NOT_FOUND", "not_found", 404, "The requested resource was not found"],
  ["VALIDATION_FAILED", "validation", 400, "The request is not valid"],
  ["UNAUTHORIZED", "authentication", 401, "Authentication is required"],
  ["FORBIDDEN", "permission", 403, "The caller is not allowed to do this"],
  ["CONFLICT", "conflict", 409, "The request conflicts with the current state of the resource"],
  ["INTERNAL_ERROR", "internal", 500, "The server could not complete the request"],
  ["NOT_IMPLEMENTED", "not_implemented", 501, "This operation is not available"],
  ["GUARDRAIL_REJECTED", "validation", 422, "A content guardrail rejected the request"],
  [
    "OPERATION_TOO_LARGE",
    "too_large",
    413,
    "The operation is too large to run at once: reduce its scope",
  ],
  [
    "TRANSIENT_FAILURE",
    "unavailable",
    503,
    "The operation failed for a reason that may pass: try it again",
  ],
];

/** A domain the registry does not hold, whose messages carry placeholders. */
const FIXTURE_ERRORS = defineErrors("fixture", {
  VARIABLES_REFUSED: {
    category: ERROR_CATEGORY.CONFIGURATION,
    status: 500,
    message: "Refused {names}: {count} of them, retry {retry}",
    params: { names: PARAM_KIND.STRING_LIST, count: PARAM_KIND.NUMBER, retry: PARAM_KIND.BOOLEAN },
    fronts: [],
  },
  INHERITED_NAME_REFUSED: {
    category: ERROR_CATEGORY.CONFIGURATION,
    status: 500,
    message: "Refused {names} and {constructor}",
    params: { names: PARAM_KIND.STRING_LIST },
    fronts: [],
  },
});

describe("the error registry", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  describe("its closed vocabularies", () => {
    it("allows each category exactly the statuses of the decision", () => {
      expect(CATEGORY_STATUSES).toEqual({
        validation: [400, 415, 417, 422],
        authentication: [401],
        permission: [403],
        not_found: [404],
        conflict: [409],
        too_large: [413, 414, 431],
        timeout: [408],
        rate_limit: [429],
        not_implemented: [501],
        upstream: [502, 504],
        unavailable: [503],
        configuration: [500],
        internal: [500],
      });
      expect(Object.values(ERROR_CATEGORY).sort()).toEqual(Object.keys(CATEGORY_STATUSES).sort());
    });

    it("names four parameter kinds and the two portals", () => {
      expect(Object.values(PARAM_KIND)).toEqual(["string", "number", "boolean", "string[]"]);
      expect(Object.values(ERROR_FRONT)).toEqual(["admin", "client"]);
    });
  });

  describe("defineErrors", () => {
    it("builds one frozen definition per key, the key its code and the argument its domain", () => {
      const table = defineErrors("fixture", {
        SUBJECT_REFUSED: {
          category: ERROR_CATEGORY.CONFLICT,
          status: 409,
          message: "The subject refuses it",
          params: { subjectId: PARAM_KIND.STRING },
          fronts: [ERROR_FRONT.ADMIN],
          code: "ANOTHER_CODE",
          domain: "another",
          extra: true,
        },
      });

      expect(table.SUBJECT_REFUSED).toEqual({
        code: "SUBJECT_REFUSED",
        domain: "fixture",
        category: "conflict",
        status: 409,
        message: "The subject refuses it",
        params: { subjectId: "string" },
        fronts: ["admin"],
      });
      expect(Object.isFrozen(table.SUBJECT_REFUSED)).toBe(true);
      expect(Object.keys(table)).toEqual(["SUBJECT_REFUSED"]);
    });

    it("checks nothing at run time and raises nothing on an entry that breaks every rule", () => {
      // canon-exception: test-fixture
      const brokenEntry = {
        category: "unknown",
        status: 999,
        message: "",
        params: { Bad: "object" },
        fronts: ["nowhere", "nowhere"],
      } as never;

      const table = defineErrors("Not A Domain", { not_a_code: brokenEntry });

      expect(table.not_a_code).toEqual({
        code: "not_a_code",
        domain: "Not A Domain",
        category: "unknown",
        status: 999,
        message: "",
        params: { Bad: "object" },
        fronts: ["nowhere", "nowhere"],
      });
    });
  });

  describe("the code grammar", () => {
    it("accepts upper snake case that starts with a letter and refuses every other spelling", () => {
      const accepted = ["NOT_FOUND", "X", "OAUTH2_TOKEN_EXPIRED", "A1_B2"];
      const refused = [
        "not_found",
        "Not_Found",
        "_NOT_FOUND",
        "NOT_FOUND_",
        "NOT__FOUND",
        "1X",
        "NOT-FOUND",
        "NOT FOUND",
        "",
        "NOT_FOUND\n",
      ];

      expect(accepted.filter((code) => !ERROR_CODE_PATTERN.test(code))).toEqual([]);
      expect(refused.filter((code) => ERROR_CODE_PATTERN.test(code))).toEqual([]);
      expect(ERROR_CODE_MAX_LENGTH).toBe(63);
    });

    it("holds every registered code to the grammar and the length, once across every table", () => {
      const codes = TABLES.flatMap((table) => Object.keys(table));

      expect(codes.filter((code) => !ERROR_CODE_PATTERN.test(code))).toEqual([]);
      expect(codes.filter((code) => code.length > ERROR_CODE_MAX_LENGTH)).toEqual([]);
      expect(new Set(codes).size).toBe(codes.length);
    });
  });

  describe("a domain table", () => {
    it("is the one export of its domain file, and the tables are listed in a fixed order", () => {
      expect(Object.keys(commonDomain)).toEqual(["COMMON_ERRORS"]);
      expect(Object.keys(httpDomain)).toEqual(["HTTP_ERRORS"]);
      expect(Object.keys(authDomain)).toEqual(["AUTH_ERRORS"]);
      expect(Object.keys(platformDomain)).toEqual(["PLATFORM_ERRORS"]);
      expect(ERROR_TABLES).toHaveLength(TABLE_BY_DOMAIN.length);
      ERROR_TABLES.forEach((table, index) => {
        expect(table).toBe(TABLE_BY_DOMAIN[index]?.[1]);
      });
    });

    it("gives each definition its key as the code and its file's name as the domain, frozen", () => {
      for (const [domain, table] of TABLE_BY_DOMAIN) {
        for (const [key, definition] of Object.entries(table)) {
          expect(definition.code).toBe(key);
          expect(definition.domain).toBe(domain);
          expect(Object.keys(definition).sort()).toEqual(DEFINITION_FIELDS);
          expect(Object.isFrozen(definition)).toBe(true);
        }
      }
    });
  });

  describe("the common domain", () => {
    it("holds the ten generic codes with their categories, statuses and messages", () => {
      expect(
        Object.values(COMMON_ERRORS).map((definition) => [
          definition.code,
          definition.category,
          definition.status,
          definition.message,
        ])
      ).toEqual(COMMON_ROWS);
    });

    it("keeps the ten strings of USE_CASE_ERRORS, each under its own name", () => {
      expect(Object.keys(COMMON_ERRORS).sort()).toEqual(Object.values(USE_CASE_ERRORS).sort());
      for (const [name, code] of Object.entries(USE_CASE_ERRORS)) {
        expect(code).toBe(name);
      }
    });

    it("declares no parameter and reaches both portals with every code", () => {
      expect(
        Object.values(COMMON_ERRORS).map((definition) => [
          definition.code,
          definition.params,
          definition.fronts,
        ])
      ).toEqual(COMMON_ROWS.map(([code]) => [code, {}, ["admin", "client"]]));
    });
  });

  describe("findErrorDefinition", () => {
    it("returns the registry's own definition for every registered code", () => {
      for (const table of TABLES) {
        for (const definition of Object.values(table)) {
          expect(findErrorDefinition(definition.code)).toBe(definition);
        }
      }
      expect(findErrorDefinition("NOT_FOUND")).toBe(COMMON_ERRORS.NOT_FOUND);
    });

    it("returns undefined for a code no table holds, a name every object inherits included", () => {
      const absent = ["NOT_A_REGISTERED_CODE", "not_found", "", "constructor", "toString"];

      expect(absent.filter((code) => findErrorDefinition(code) !== undefined)).toEqual([]);
      expect(findErrorDefinition("__proto__")).toBeUndefined();
    });
  });

  describe("listErrorDefinitions", () => {
    it("lists every definition of every table once, in the tables' order", () => {
      const expected = TABLES.flatMap((table) => Object.values(table));
      expect(listErrorDefinitions()).toEqual(expected);
      listErrorDefinitions().forEach((definition, index) => {
        expect(definition).toBe(expected[index]);
      });
    });
  });

  describe("a code two tables hold", () => {
    const SECOND_TABLE = "@shared/types/error-registry/domains/http.js";

    afterEach(() => {
      vi.doUnmock(SECOND_TABLE);
      vi.resetModules();
    });

    it("is answered by the first table that holds it, and loading the registry raises nothing", async () => {
      vi.resetModules();
      vi.doMock(SECOND_TABLE, () => ({
        HTTP_ERRORS: defineErrors("http", {
          NOT_FOUND: {
            category: ERROR_CATEGORY.NOT_FOUND,
            status: 404,
            message: "A second table",
            params: {},
            fronts: [],
          },
        }),
      }));

      const tables = await import("@shared/types/error-registry/tables.js");

      expect(tables.findErrorDefinition("NOT_FOUND")?.domain).toBe("common");
      expect(tables.findErrorDefinition("NOT_FOUND")?.message).toBe(
        "The requested resource was not found"
      );
      expect(
        tables
          .listErrorDefinitions()
          .filter((definition) => definition.code === "NOT_FOUND")
          .map((definition) => definition.domain)
      ).toEqual(["common"]);
    });
  });

  describe("formatErrorMessage", () => {
    it("returns the message as written when the entry declares no parameter", () => {
      expect(formatErrorMessage(COMMON_ERRORS.NOT_FOUND)).toBe(
        "The requested resource was not found"
      );
    });

    it("joins a list with a comma and a space and writes any other value through String", () => {
      expect(
        formatErrorMessage(FIXTURE_ERRORS.VARIABLES_REFUSED, {
          names: ["DATABASE_URL", "REDIS_URL"],
          count: 2,
          retry: false,
        })
      ).toBe("Refused DATABASE_URL, REDIS_URL: 2 of them, retry false");
    });

    it("leaves a placeholder with no value as written, a name every object inherits included", () => {
      const definition = FIXTURE_ERRORS.INHERITED_NAME_REFUSED;

      expect(formatErrorMessage(definition)).toBe("Refused {names} and {constructor}");
      expect(formatErrorMessage(definition, { count: 2 })).toBe(
        "Refused {names} and {constructor}"
      );
    });

    it("inserts each value verbatim and formats the message once", () => {
      expect(
        formatErrorMessage(FIXTURE_ERRORS.VARIABLES_REFUSED, { names: ["$&", "{count}"], count: 2 })
      ).toBe("Refused $&, {count}: 2 of them, retry {retry}");
    });
  });

  describe("titleOf", () => {
    it("writes a code as a sentence-case title", () => {
      expect(titleOf("ADMINISTRATOR_ALREADY_EXISTS")).toBe("Administrator already exists");
      expect(titleOf("NOT_FOUND")).toBe("Not found");
      expect(titleOf("CONFLICT")).toBe("Conflict");
      expect(titleOf("OAUTH2_TOKEN_EXPIRED")).toBe("Oauth2 token expired");
    });

    it("spells an acronym of its table in capitals, first word or not", () => {
      expect([titleOf("JSON_BODY_EMPTY"), titleOf("BODY_NOT_JSON")]).toEqual([
        "JSON body empty",
        "Body not JSON",
      ]);
    });
  });

  describe("the public interface", () => {
    it("exports every value of the definitions but defineErrors, here and from the shared kernel", () => {
      const published = Object.keys(definitionModule).filter((name) => name !== "defineErrors");

      expect(published.sort()).toEqual([
        "CATEGORY_STATUSES",
        "ERROR_CATEGORY",
        "ERROR_CODE_MAX_LENGTH",
        "ERROR_CODE_PATTERN",
        "ERROR_FRONT",
        "PARAM_KIND",
        "formatErrorMessage",
        "titleOf",
      ]);
      expect(published.filter((name) => !Object.hasOwn(registryBarrel, name))).toEqual([]);
      expect(Object.hasOwn(registryBarrel, "defineErrors")).toBe(false);
      expect(Object.hasOwn(sharedKernel, "defineErrors")).toBe(false);
    });

    it("re-exports every value of the registry's barrel from the shared kernel, the same object", () => {
      const names = Object.keys(registryBarrel);

      expect(names).toEqual(
        expect.arrayContaining([
          "AUTH_ERRORS",
          "COMMON_ERRORS",
          "ERROR_TABLES",
          "HTTP_ERRORS",
          "PLATFORM_ERRORS",
          "findErrorDefinition",
          "listErrorDefinitions",
        ])
      );
      expect(
        names.filter(
          (name) => Reflect.get(sharedKernel, name) !== Reflect.get(registryBarrel, name)
        )
      ).toEqual([]);
    });
  });
});
