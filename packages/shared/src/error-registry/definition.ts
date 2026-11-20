/**
 * @file definition.ts
 * @description What an error definition is: the twelve categories and the statuses each allows, the
 *   four kinds of a parameter, the portals a code can reach, the grammar of a code, the definition
 *   with the mark only this module gives, `defineErrors`, which builds a domain's table, and the two
 *   functions that word a definition: its message with one occurrence's parameters, and its code as
 *   a title. Nothing here imports outside the registry's directory or needs Node: the portals load
 *   the shared kernel in browser code, and the registry gate loads this file on its own.
 * @layer domain
 */

export const ERROR_CATEGORY = {
  VALIDATION: "validation",
  AUTHENTICATION: "authentication",
  PERMISSION: "permission",
  NOT_FOUND: "not_found",
  CONFLICT: "conflict",
  TOO_LARGE: "too_large",
  RATE_LIMIT: "rate_limit",
  NOT_IMPLEMENTED: "not_implemented",
  UPSTREAM: "upstream",
  UNAVAILABLE: "unavailable",
  CONFIGURATION: "configuration",
  INTERNAL: "internal",
} as const;
export type ErrorCategory = (typeof ERROR_CATEGORY)[keyof typeof ERROR_CATEGORY];

/** The statuses each category allows: an entry's status is one of its category's. */
export const CATEGORY_STATUSES = {
  validation: [400, 415, 422],
  authentication: [401],
  permission: [403],
  not_found: [404],
  conflict: [409],
  too_large: [413],
  rate_limit: [429],
  not_implemented: [501],
  upstream: [502, 504],
  unavailable: [503],
  configuration: [500],
  internal: [500],
} as const satisfies Record<ErrorCategory, readonly number[]>;
export type CategoryStatus<C extends ErrorCategory> = (typeof CATEGORY_STATUSES)[C][number];

export const PARAM_KIND = {
  STRING: "string",
  NUMBER: "number",
  BOOLEAN: "boolean",
  STRING_LIST: "string[]",
} as const;
export type ParamKind = (typeof PARAM_KIND)[keyof typeof PARAM_KIND];
/** The value a parameter of each kind takes. */
export interface ParamValueByKind {
  string: string;
  number: number;
  boolean: boolean;
  "string[]": readonly string[];
}
export type ParamValue = ParamValueByKind[ParamKind];
export type ParamSpec = Readonly<Record<string, ParamKind>>;
export type ParamsOf<S extends ParamSpec> = { readonly [K in keyof S]: ParamValueByKind[S[K]] };
export type ErrorParams = Readonly<Record<string, ParamValue>>;

/** The portals that can receive a code; a portal's id is its directory under `apps/`. */
export const ERROR_FRONT = { ADMIN: "admin", CLIENT: "client" } as const;
export type ErrorFront = (typeof ERROR_FRONT)[keyof typeof ERROR_FRONT];

/**
 * Not exported, and with no value at run time: only `defineErrors` gives it, and a spread copy of a
 * definition it built carries it on.
 */
declare const REGISTERED: unique symbol;

/**
 * One registered error: its code, the domain whose table holds it, its category and status, the
 * English message an operator or a developer reads, its declared parameters, and the portals that
 * can receive it. The mark keeps an object literal written anywhere else from being one without a
 * cast. It does not refuse a spread copy of a registered definition with a field changed: the lint
 * rule `errors/no-inline-error` (its `definitionSource` shape) refuses that copy at an `of` call,
 * and `of` keeps only the copy's code, reading every other field from the registry's own entry.
 */
export interface ErrorDefinition<
  TCode extends string = string,
  TCategory extends ErrorCategory = ErrorCategory,
  TParams extends ParamSpec = ParamSpec,
> {
  readonly [REGISTERED]: true;
  readonly code: TCode;
  readonly domain: string;
  readonly category: TCategory;
  readonly status: CategoryStatus<TCategory>;
  readonly message: string;
  readonly params: TParams;
  readonly fronts: readonly ErrorFront[];
}

/** What a domain file writes per code: the union ties `status` to `category`. */
export type ErrorEntry = {
  [C in ErrorCategory]: {
    readonly category: C;
    readonly status: CategoryStatus<C>;
    readonly message: string;
    readonly params: ParamSpec;
    readonly fronts: readonly ErrorFront[];
  };
}[ErrorCategory];

export type ErrorTable<T extends Readonly<Record<string, ErrorEntry>>> = {
  readonly [K in keyof T & string]: ErrorDefinition<K, T[K]["category"], T[K]["params"]>;
};

/** A code's grammar and length, AIP-193's: upper snake case that starts with a letter. */
export const ERROR_CODE_PATTERN = /^[A-Z][A-Z0-9]*(_[A-Z0-9]+)*$/;
export const ERROR_CODE_MAX_LENGTH = 63;

/** A placeholder of a message: a parameter's name in braces. */
const PLACEHOLDER = /\{([a-z][A-Za-z0-9]*)\}/g;

/** A definition's fields before the table gives it the mark. */
type UnmarkedDefinition = Omit<ErrorDefinition, typeof REGISTERED>;

/**
 * @description Builds a domain's table: one frozen definition per key, whose code is the key and
 *   whose domain is the argument. It checks nothing at run time and raises nothing: the compiler
 *   holds the entry's shape and the registry gate holds every other rule.
 * @param domain - The domain the table holds, the name of its file under `domains/`.
 * @param entries - The domain's entries, one per code, keyed by the code.
 * @returns The domain's table, its definitions carrying the registry's mark.
 */
export function defineErrors<const T extends Readonly<Record<string, ErrorEntry>>>(
  domain: string,
  entries: T
): ErrorTable<T> {
  const source: Readonly<Record<string, ErrorEntry>> = entries;
  const table: Record<string, UnmarkedDefinition> = {};
  for (const [code, entry] of Object.entries(source)) {
    table[code] = Object.freeze({
      code,
      domain,
      category: entry.category,
      status: entry.status,
      message: entry.message,
      params: entry.params,
      fronts: entry.fronts,
    });
  }
  return table as ErrorTable<T>;
}

/**
 * @description Words a definition's message for one occurrence: each `{name}` takes its parameter's
 *   value, a list joined with ", " and any other value through `String`. A placeholder with no value
 *   stays as written, and a value is inserted as it is, never read as a placeholder again.
 * @param definition - The definition whose message is worded.
 * @param params - The occurrence's parameters, by name.
 * @returns The message with every placeholder that has a value replaced.
 */
export function formatErrorMessage(definition: ErrorDefinition, params?: ErrorParams): string {
  const values = new Map<string, ParamValue>(params === undefined ? [] : Object.entries(params));
  return definition.message.replace(PLACEHOLDER, (placeholder: string, name: string) => {
    const value = values.get(name);
    if (value === undefined) return placeholder;
    return typeof value === "object" ? value.join(", ") : String(value);
  });
}

/**
 * @description Writes a code in words, the same for every occurrence of it:
 *   `ADMINISTRATOR_ALREADY_EXISTS` is "Administrator already exists".
 * @param code - A registered code.
 * @returns The code in sentence case, its underscores as spaces.
 */
export function titleOf(code: string): string {
  const words = code.toLowerCase().replaceAll("_", " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}
