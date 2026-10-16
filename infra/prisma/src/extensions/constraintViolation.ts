/**
 * @file constraintViolation.ts
 * @description Reads which database constraint a Prisma known-request error names, so a
 *   repository can turn one specific violation into its own typed error.
 *
 *   ## Where the constraint lives, measured
 *
 *   Every Prisma 7 query runs through the driver adapter, and the adapter reports a violated
 *   constraint at `meta.driverAdapterError.cause.constraint`. It never fills the `meta.target`
 *   the old query engine set, so a check that reads `meta.target` never matches. Measured on
 *   PostgreSQL 16 through `@prisma/adapter-pg`, a second insert of a live account's e-mail
 *   raises P2002 with:
 *
 *   - 7.9.1: `constraint: { fields: ["email"] }`, the columns parsed from the server's detail,
 *     with a mixed-case column double-quoted as PostgreSQL prints it (`["\"accountId\"", "email"]`);
 *   - 7.10.0: `constraint: { index: "Account_email_key" }`, the constraint's own name, plus the
 *     table beside it.
 *
 *   Both shapes are read. Any other shape, or a constraint object carrying anything but exactly
 *   one of the two keys, reads as unknown, so a caller falls through to its generic failure
 *   instead of mapping a collision it cannot identify to a typed answer.
 * @layer infrastructure
 */

/** The constraint a driver adapter names: by index name, or by the columns it covers. */
export type ViolatedConstraint =
  { readonly index: string } | { readonly fields: readonly string[] };

/** A unique constraint as the schema declares it: its index name and its columns, in order. */
export interface UniqueConstraint {
  readonly index: string;
  readonly fields: readonly string[];
}

/** Prisma's code for a unique-constraint violation. */
const UNIQUE_VIOLATION = "P2002";

/**
 * @param value - Any value.
 * @returns True when the value is a non-null object whose keys can be read.
 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/**
 * Strips the double quotes PostgreSQL puts around a mixed-case identifier in an error detail,
 * undoing the `""` escape inside them, so `"accountId"` compares equal to `accountId`.
 *
 * @param identifier - A column name as the adapter reported it.
 * @returns The column name as the schema spells it.
 */
function unquoteIdentifier(identifier: string): string {
  return identifier.length >= 2 && identifier.startsWith('"') && identifier.endsWith('"')
    ? identifier.slice(1, -1).replaceAll('""', '"')
    : identifier;
}

/**
 * @function violatedConstraint
 * @description Reads the constraint a Prisma known-request error names, through the driver
 *   adapter's payload. Works for every constraint kind the adapter reports this way (unique,
 *   foreign-key, not-null), whatever the error's code.
 * @param error - The value caught from a Prisma call.
 * @returns `{ index }` or `{ fields }` (columns unquoted), or null when the error carries no
 *   constraint in either shape.
 */
export function violatedConstraint(error: unknown): ViolatedConstraint | null {
  if (!isRecord(error) || !isRecord(error.meta)) return null;
  const adapterError = error.meta.driverAdapterError;
  if (!isRecord(adapterError) || !isRecord(adapterError.cause)) return null;
  const constraint = adapterError.cause.constraint;
  if (!isRecord(constraint)) return null;
  const keys = Object.keys(constraint);
  if (keys.length !== 1) return null;
  const { index, fields } = constraint;
  if (keys[0] === "index") {
    return typeof index === "string" && index.length > 0 ? { index } : null;
  }
  if (keys[0] === "fields" && Array.isArray(fields) && fields.length > 0) {
    const names = fields.filter((field): field is string => typeof field === "string");
    return names.length === fields.length && names.every((name) => name.length > 0)
      ? { fields: names.map(unquoteIdentifier) }
      : null;
  }
  return null;
}

/**
 * @function isUniqueViolationOf
 * @description Decides whether an error is a unique-constraint violation of ONE named
 *   constraint. It matches the index name when the adapter names the index, and the exact
 *   ordered column list when it names the columns; a collision on any other constraint of the
 *   same table, or one whose constraint cannot be read, is not this one.
 * @param error - The value caught from a Prisma call.
 * @param constraint - The unique constraint as the schema declares it.
 * @returns True only when the error is P2002 and names that constraint.
 */
export function isUniqueViolationOf(error: unknown, constraint: UniqueConstraint): boolean {
  if (!isRecord(error) || error.code !== UNIQUE_VIOLATION) return false;
  const violated = violatedConstraint(error);
  if (violated === null) return false;
  if ("index" in violated) return violated.index === constraint.index;
  return (
    violated.fields.length === constraint.fields.length &&
    violated.fields.every((field, position) => field === constraint.fields[position])
  );
}
