/**
 * @file tables.ts
 * @description Every domain's table in one ordered list, the union of their codes, and the lookup
 *   and the listing every reader of the registry goes through: a definition is found by its code,
 *   compared by value.
 * @layer domain
 */
import type { ErrorDefinition } from "./definition.js";
import { AUTH_ERRORS } from "./domains/auth.js";
import { COMMON_ERRORS } from "./domains/common.js";
import { HTTP_ERRORS } from "./domains/http.js";
import { PLATFORM_ERRORS } from "./domains/platform.js";

export const ERROR_TABLES = [COMMON_ERRORS, HTTP_ERRORS, AUTH_ERRORS, PLATFORM_ERRORS] as const;

type KeysOfUnion<T> = T extends unknown ? keyof T : never;

export type RegisteredErrorCode = KeysOfUnion<(typeof ERROR_TABLES)[number]>;
export type RegisteredDefinition = ErrorDefinition<RegisteredErrorCode>;

/**
 * Indexes the tables by code. On a code two tables hold, the first table's definition is kept and
 * nothing is raised: the registry gate is what refuses the second.
 */
function indexByCode(
  tables: readonly Readonly<Record<string, RegisteredDefinition>>[]
): ReadonlyMap<string, RegisteredDefinition> {
  const byCode = new Map<string, RegisteredDefinition>();
  for (const table of tables) {
    for (const definition of Object.values(table)) {
      if (!byCode.has(definition.code)) byCode.set(definition.code, definition);
    }
  }
  return byCode;
}

const DEFINITIONS_BY_CODE = indexByCode(ERROR_TABLES);
const DEFINITIONS: readonly RegisteredDefinition[] = Object.freeze([
  ...DEFINITIONS_BY_CODE.values(),
]);

/**
 * @description Finds the registry's definition of a code, an own key of a table and nothing a
 *   plain object inherits.
 * @param code - The code to look up, from any source.
 * @returns The definition, or undefined when no table holds the code.
 */
export function findErrorDefinition(code: string): RegisteredDefinition | undefined {
  return DEFINITIONS_BY_CODE.get(code);
}

/**
 * @description Lists the registry's definitions, each code once, in the order of the tables and of
 *   the entries within each.
 * @returns Every definition `findErrorDefinition` answers.
 */
export function listErrorDefinitions(): readonly RegisteredDefinition[] {
  return DEFINITIONS;
}
