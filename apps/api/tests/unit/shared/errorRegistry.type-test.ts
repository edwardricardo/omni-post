/**
 * @file errorRegistry.type-test.ts
 * @description Compile-time pins for the error registry's types: what the compiler accepts as a
 *   registered definition, how a category bounds its status, which strings are registered codes, and
 *   how a parameter's declared kind types its value.
 *
 *   ## Why these are the contract
 *
 *   A definition carries a mark only `defineErrors` gives, keyed by a symbol no other module can
 *   name. That is what lets the registry path accept a registered definition and refuse an object
 *   literal written by hand, however complete. It does not refuse a spread copy of a registered
 *   definition, which carries the mark on: the lint rule's `definitionSource` shape refuses that copy
 *   at an `of` call, and `of` keeps only its code (`registeredError.type-test.ts` pins that the copy
 *   compiles, `registeredError.test.ts` that it brings no text). The category's statuses are a type, so an entry whose status
 *   its category does not allow does not compile. The registered codes are the union of the tables'
 *   keys, so a code no table holds is refused where a registered one is named, even in a table
 *   `defineErrors` built outside the registry, which this file does by its own path to prove it.
 *
 *   ## How the pins fail
 *
 *   Each assignment stops compiling if the registry stops accepting what it must. Each
 *   `@ts-expect-error` stops compiling (TS2578, unused directive) if the registry starts accepting
 *   what it must refuse. The file is named `.type-test.ts`, so the vitest collector never runs it;
 *   `tsconfig.type-tests.json` compiles it in the package's `typecheck` script.
 * @layer infrastructure
 */
import {
  COMMON_ERRORS,
  type CategoryStatus,
  type ErrorDefinition,
  type ErrorEntry,
  type ErrorParams,
  type ParamsOf,
  type RegisteredDefinition,
  type RegisteredErrorCode,
} from "@shared/types";
import { defineErrors } from "@shared/types/error-registry/definition.js";

/** A definition the registry built is a registered definition. */
export const registeredDefinition: RegisteredDefinition = COMMON_ERRORS.NOT_FOUND;

/** A table keeps each definition's code, category and status as literals, for the sites that read them. */
export const literalCode: "NOT_FOUND" = COMMON_ERRORS.NOT_FOUND.code;
export const literalCategory: "not_found" = COMMON_ERRORS.NOT_FOUND.category;
export const literalStatus: 404 = COMMON_ERRORS.NOT_FOUND.status;

// @ts-expect-error a table holds only the codes written in its file
export const absentMember = COMMON_ERRORS.NOT_A_REGISTERED_CODE;

// @ts-expect-error an object literal written by hand lacks the registry's mark, however complete it is
export const handWrittenRegistered: RegisteredDefinition = {
  code: "NOT_FOUND",
  domain: "common",
  category: "not_found",
  status: 404,
  message: "The requested resource was not found",
  params: {},
  fronts: ["admin", "client"],
};

// @ts-expect-error the mark is what makes a definition, whatever its code
export const handWrittenDefinition: ErrorDefinition = {
  code: "ANY_CODE",
  domain: "common",
  category: "internal",
  status: 500,
  message: "Any message",
  params: {},
  fronts: [],
};

/**
 * The limit of the mark, stated so it cannot drift: a spread copy of a registered definition with
 * its message changed carries the mark on and is a definition. `of` keeps only its code.
 */
export const spreadCopyIsADefinition: ErrorDefinition = {
  ...COMMON_ERRORS.NOT_FOUND,
  message: "an inline text",
};

/** A registered code is a key of a table. */
export const registeredCode: RegisteredErrorCode = "TRANSIENT_FAILURE";

// @ts-expect-error a string no table holds is not a registered code
export const unregisteredCode: RegisteredErrorCode = "NOT_A_REGISTERED_CODE";

const OUTSIDE_ERRORS = defineErrors("outside", {
  OUTSIDE_CODE: {
    category: "internal",
    status: 500,
    message: "A code no registry table holds",
    params: {},
    fronts: [],
  },
});

/** A table built outside the registry carries the mark, and its definitions are definitions. */
export const outsideIsADefinition: ErrorDefinition = OUTSIDE_ERRORS.OUTSIDE_CODE;

// @ts-expect-error a code no registry table holds is not a registered definition, whoever built it
export const outsideIsRegistered: RegisteredDefinition = OUTSIDE_ERRORS.OUTSIDE_CODE;

/** `defineErrors` refuses an entry whose status its category does not allow. */
export const statusOutsideItsCategoryTable = defineErrors("outside", {
  // @ts-expect-error a conflict answers 409 and nothing else
  WRONG_STATUS: {
    category: "conflict",
    status: 404,
    message: "The subject's state refuses the operation",
    params: {},
    fronts: [],
  },
});

/** An entry's status is one its category allows. */
export const conflictEntry: ErrorEntry = {
  category: "conflict",
  status: 409,
  message: "The subject's state refuses the operation",
  params: {},
  fronts: [],
};

// @ts-expect-error a conflict answers 409 and nothing else
export const statusOutsideItsCategory: ErrorEntry = {
  category: "conflict",
  status: 404,
  message: "The subject's state refuses the operation",
  params: {},
  fronts: [],
};

/** A category with several statuses allows each of them and no other. */
export const validationStatus: CategoryStatus<"validation"> = 422;

// @ts-expect-error a validation failure never answers 401
export const validationAsAuthentication: CategoryStatus<"validation"> = 401;

/** A declared parameter's kind types its value. */
export const declaredParams: ParamsOf<{ names: "string[]"; count: "number" }> = {
  names: ["DATABASE_URL"],
  count: 1,
};

export const wronglyKindedParams: ParamsOf<{ names: "string[]"; count: "number" }> = {
  names: ["DATABASE_URL"],
  // @ts-expect-error a parameter declared as a number takes no string
  count: "1",
};

// @ts-expect-error a parameter's value is a string, a number, a boolean or a list of strings
export const objectParam: ErrorParams = { nested: { value: 1 } };
