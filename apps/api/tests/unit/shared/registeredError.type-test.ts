/**
 * @file registeredError.type-test.ts
 * @description Compile-time pins for building an error on the registry path: `of` takes a
 *   registered definition and the arguments that definition declares, the registry's error class
 *   has no constructor other modules can call, `UseCaseError`'s registry fields cannot be handed to
 *   its constructor by another module, and `USE_CASE_ERRORS` keeps the exact type its importers
 *   compile against.
 *
 *   ## How the pins fail
 *
 *   Each assignment or call stops compiling if the registry path stops accepting what it must.
 *   Each `@ts-expect-error` stops compiling (TS2578, unused directive) if it starts accepting what it
 *   must refuse. The file is named `.type-test.ts`, so the vitest collector never runs it;
 *   `tsconfig.type-tests.json` compiles it in the package's `typecheck` script.
 * @layer infrastructure
 */
import { USE_CASE_ERRORS, UseCaseError, type UseCaseErrorCode } from "@core/application/UseCase.js";
import {
  COMMON_ERRORS,
  RegisteredError,
  resolveOccurrence,
  type CodedError,
  type ErrorDefinition,
  type RegisteredErrorCode,
} from "@shared/types";
import { defineErrors } from "@shared/types/error-registry/definition.js";

/** True when two types are the same type, not merely assignable one way. */
type Exactly<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;

/** A definition that declares a parameter, as a registered one would. */
declare const withCount: ErrorDefinition<
  RegisteredErrorCode,
  "too_large",
  { readonly count: "number" }
>;

const OUTSIDE_ERRORS = defineErrors("outside", {
  OUTSIDE_CODE: {
    category: "internal",
    status: 500,
    message: "A code no registry table holds",
    params: {},
    fronts: [],
  },
});

/** A definition that declares no parameter takes no argument, or its options. */
export const bare = RegisteredError.of(COMMON_ERRORS.CONFLICT);
export const withCause = RegisteredError.of(COMMON_ERRORS.CONFLICT, { cause: new Error("x") });

// @ts-expect-error a definition that declares no parameter takes none
export const undeclaredParams = RegisteredError.of(COMMON_ERRORS.CONFLICT, { count: 2 });

/** A definition that declares parameters takes them first, each of its declared kind. */
export const counted = RegisteredError.of(withCount, { count: 2 }, { cause: new Error("x") });

// @ts-expect-error a declared parameter cannot be left out
export const missingParams = RegisteredError.of(withCount);

// @ts-expect-error a parameter declared as a number takes no string
export const mistypedParams = RegisteredError.of(withCount, { count: "2" });

// @ts-expect-error an object written by hand is no registered definition
export const handWritten = RegisteredError.of({
  code: "CONFLICT",
  domain: "common",
  category: "conflict",
  status: 409,
  message: "an inline text",
  params: {},
  fronts: [],
});

// @ts-expect-error a table built outside the registry holds no registered code
export const outside = RegisteredError.of(OUTSIDE_ERRORS.OUTSIDE_CODE);

// @ts-expect-error the constructor is private: the registry's error is built by `of`
export const constructed = new RegisteredError(resolveOccurrence(COMMON_ERRORS.CONFLICT));

/** `UseCaseError.of` takes what `RegisteredError.of` takes, and returns a `UseCaseError`. */
export const useCaseError: UseCaseError = UseCaseError.of(withCount, { count: 2 });

// @ts-expect-error a table built outside the registry holds no registered code
export const outsideUseCase = UseCaseError.of(OUTSIDE_ERRORS.OUTSIDE_CODE);

/** Every legacy construction keeps compiling: the three parameters, the second a free string. */
export const legacy = new UseCaseError("an inline text", "ANY_CODE", new Error("x"));

export const forgedFields = new UseCaseError(
  "an inline text",
  "CONFLICT",
  undefined,
  // @ts-expect-error the registry fields are built only by `UseCaseError.of`, whatever their shape
  { occurrence: resolveOccurrence(COMMON_ERRORS.CONFLICT) }
);

/** Both classes are coded errors, read by code. */
export const codedUseCaseError: CodedError = legacy;
export const codedRegisteredError: CodedError = bare;

/** `USE_CASE_ERRORS` and its code union are the exact types its importers compile against. */
export const useCaseErrorsUnchanged: Exactly<
  typeof USE_CASE_ERRORS,
  {
    readonly NOT_FOUND: "NOT_FOUND";
    readonly VALIDATION_FAILED: "VALIDATION_FAILED";
    readonly UNAUTHORIZED: "UNAUTHORIZED";
    readonly FORBIDDEN: "FORBIDDEN";
    readonly CONFLICT: "CONFLICT";
    readonly INTERNAL_ERROR: "INTERNAL_ERROR";
    readonly NOT_IMPLEMENTED: "NOT_IMPLEMENTED";
    readonly GUARDRAIL_REJECTED: "GUARDRAIL_REJECTED";
    readonly OPERATION_TOO_LARGE: "OPERATION_TOO_LARGE";
    readonly TRANSIENT_FAILURE: "TRANSIENT_FAILURE";
  }
> = true;

export const useCaseErrorCodeUnchanged: Exactly<
  UseCaseErrorCode,
  | "NOT_FOUND"
  | "VALIDATION_FAILED"
  | "UNAUTHORIZED"
  | "FORBIDDEN"
  | "CONFLICT"
  | "INTERNAL_ERROR"
  | "NOT_IMPLEMENTED"
  | "GUARDRAIL_REJECTED"
  | "OPERATION_TOO_LARGE"
  | "TRANSIENT_FAILURE"
> = true;
