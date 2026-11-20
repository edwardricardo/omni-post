/**
 * @file registered-error.ts
 * @description The registry's error class and the readings every `of` and every front go through.
 *   An error is recognized by its code, compared by value, never by its class. Whatever object an
 *   `of` is given, the error it builds takes its text, status and category from the registry's own
 *   entry for the code, and `resolveError` gives every front that same entry's text; a code the
 *   registry does not hold answers `INTERNAL_ERROR`. Nothing here raises.
 * @layer domain
 */
import {
  PARAM_KIND,
  formatErrorMessage,
  type ErrorDefinition,
  type ErrorParams,
  type ParamKind,
  type ParamValue,
  type ParamsOf,
} from "./definition.js";
import { COMMON_ERRORS } from "./domains/common.js";
import { findErrorDefinition, type RegisteredDefinition } from "./tables.js";

/** Any failure recognized by its code: what every reader of an error relies on. */
export interface CodedError {
  readonly code: string;
  readonly params?: ErrorParams | undefined;
}

export interface ErrorCauseOption {
  readonly cause?: Error | undefined;
}

/** The arguments of `of` after the definition: its parameters first when it declares any. */
export type OfArgs<D extends ErrorDefinition> = keyof D["params"] extends never
  ? [options?: ErrorCauseOption]
  : [params: ParamsOf<D["params"]>, options?: ErrorCauseOption];

/** What a front shows for any failure: the registry's entry for its code, or INTERNAL_ERROR's. */
export interface ResolvedError {
  readonly definition: RegisteredDefinition;
  /** The declared parameters only, each of its declared kind; undefined when none is declared. */
  readonly params: ErrorParams | undefined;
  /** False when the value carries no registered code. */
  readonly registered: boolean;
  /** `formatErrorMessage(definition, params)`. */
  readonly message: string;
}

/** What an `of` builds its error from: a resolved error and the cause it was given. */
export interface RegisteredOccurrence extends ResolvedError {
  readonly cause: Error | undefined;
}

const INTERNAL_ERROR: RegisteredDefinition = COMMON_ERRORS.INTERNAL_ERROR;

const UNREGISTERED: ResolvedError = Object.freeze({
  definition: INTERNAL_ERROR,
  params: undefined,
  registered: false,
  message: formatErrorMessage(INTERNAL_ERROR),
});

/**
 * A value read as an object of named fields: arrays and functions are not, so a list carried where
 * parameters belong brings none.
 */
function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Whether a carried value is of a parameter's declared kind. */
function isOfKind(value: unknown, kind: ParamKind): value is ParamValue {
  switch (kind) {
    case PARAM_KIND.STRING:
      return typeof value === "string";
    case PARAM_KIND.NUMBER:
      return typeof value === "number";
    case PARAM_KIND.BOOLEAN:
      return typeof value === "boolean";
    case PARAM_KIND.STRING_LIST:
      return Array.isArray(value) && value.every((item: unknown) => typeof item === "string");
  }
}

/**
 * The parameters a definition declares, read from what a value carries: an own field of the
 * declared name and kind, and nothing else, so a carried value cannot bring a text the registry
 * does not word.
 */
function declaredParams(
  definition: RegisteredDefinition,
  carried: unknown
): ErrorParams | undefined {
  const declared = Object.entries(definition.params);
  if (declared.length === 0) return undefined;
  const params: Record<string, ParamValue> = {};
  if (!isRecord(carried)) return params;
  for (const [name, kind] of declared) {
    const value = Object.hasOwn(carried, name) ? carried[name] : undefined;
    if (isOfKind(value, kind)) params[name] = value;
  }
  return params;
}

/**
 * @description Whether a value is a coded error: an object with a string `code`, whatever class
 *   built it. Its parameters are not trusted by this test: `resolveError` reads them against the
 *   registry.
 * @param value - Any value, a raised one included.
 * @returns True when the value carries a string code.
 */
export function isCodedError(value: unknown): value is CodedError {
  return (
    typeof value === "object" && value !== null && "code" in value && typeof value.code === "string"
  );
}

/**
 * @description Gives a failure the registry's reading: the entry its code names, the declared
 *   parameters it carries and that entry's message worded with them. It never reads the value's own
 *   message, so a text the registry does not hold cannot reach a front through it.
 * @param value - Any value, a raised one included.
 * @returns The registry's entry for the value's code, or `INTERNAL_ERROR`'s when the value carries no
 *   registered code.
 */
export function resolveError(value: unknown): ResolvedError {
  if (!isCodedError(value)) return UNREGISTERED;
  const definition = findErrorDefinition(value.code);
  if (definition === undefined) return UNREGISTERED;
  const params = declaredParams(definition, value.params);
  return { definition, params, registered: true, message: formatErrorMessage(definition, params) };
}

/**
 * @description Reads the arguments of an `of` against the registry: the code comes from the
 *   definition given, and everything else from the registry's own entry for that code, so a copied
 *   or forged definition brings no text, status or category of its own. A code the registry does
 *   not hold is a programming error, answered as `INTERNAL_ERROR` rather than raised, so the core
 *   keeps raising nothing.
 * @param definition - The definition named at the call, whose declared parameters say how the
 *   arguments after it are read.
 * @param args - The parameters first when the definition declares any, then the options.
 * @returns The resolved error and the cause the options give.
 */
export function resolveOccurrence<D extends RegisteredDefinition>(
  definition: D,
  ...args: OfArgs<D>
): RegisteredOccurrence {
  const values: readonly unknown[] = args;
  const declaresParams = Object.keys(definition.params).length > 0;
  const options = values[declaresParams ? 1 : 0];
  const cause = isRecord(options) ? options["cause"] : undefined;
  const resolved = resolveError({
    code: definition.code,
    params: declaresParams ? values[0] : undefined,
  });
  return { ...resolved, cause: cause instanceof Error ? cause : undefined };
}

/** An error raised outside the application core, built only from a registered definition. */
export class RegisteredError extends Error implements CodedError {
  public readonly code: string;
  public readonly definition: RegisteredDefinition;
  public readonly params: ErrorParams | undefined;

  private constructor(occurrence: RegisteredOccurrence) {
    super(
      occurrence.message,
      occurrence.cause === undefined ? undefined : { cause: occurrence.cause }
    );
    this.name = "RegisteredError";
    this.code = occurrence.definition.code;
    this.definition = occurrence.definition;
    this.params = occurrence.params;
  }

  /**
   * @method of
   * @description Builds the error of a registered definition, worded by the registry's entry for
   *   its code.
   * @param definition - A member of a registry table, `<TABLE>.<CODE>`.
   * @param args - The definition's declared parameters first when it declares any, then the options.
   * @returns The error, never raised by this call.
   */
  static of<D extends RegisteredDefinition>(definition: D, ...args: OfArgs<D>): RegisteredError {
    return new RegisteredError(resolveOccurrence(definition, ...args));
  }
}
