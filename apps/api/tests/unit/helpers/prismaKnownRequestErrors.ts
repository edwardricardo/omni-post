/**
 * @file prismaKnownRequestErrors.ts
 * @description Builds Prisma known-request errors in the shape Prisma 7 actually raises through
 *   `@prisma/adapter-pg`, measured on PostgreSQL 16 on 2026-10-15 by inserting a duplicate row
 *   through the real client. The constraint a unique violation names sits at
 *   `meta.driverAdapterError.cause.constraint`, and `meta.target`, which the Prisma 5 and 6 query
 *   engine filled, is absent:
 *
 *   - 7.10.0 names the index: `{ index: "Account_email_key" }`, with the table beside it and
 *     `meta.modelName` resolved from that table;
 *   - 7.9.1 names the columns parsed from the server's detail, a mixed-case column
 *     double-quoted as PostgreSQL prints it: `{ fields: ["\"accountId\"", "email"] }`.
 *
 *   A double that raises the old `meta.target` shape tests a branch production never reaches, so
 *   suites raise these instead.
 * @layer infrastructure
 */

/** The error class name Prisma gives a known-request error. */
const KNOWN_REQUEST_ERROR = "PrismaClientKnownRequestError";

/** A Prisma known-request error as a repository catches it. */
export interface MeasuredPrismaError extends Error {
  readonly code: string;
  readonly clientVersion: string;
  readonly meta: Record<string, unknown>;
}

/**
 * @param code - The Prisma error code.
 * @param message - The message's last line, as Prisma renders it.
 * @param clientVersion - The client version the shape was measured on.
 * @param meta - The error's `meta`.
 * @returns An Error carrying the code, version and meta the way Prisma's error does.
 */
function knownRequestError(
  code: string,
  message: string,
  clientVersion: string,
  meta: Record<string, unknown>
): MeasuredPrismaError {
  const error = new Error(message) as Error & {
    code: string;
    clientVersion: string;
    meta: Record<string, unknown>;
  };
  error.name = KNOWN_REQUEST_ERROR;
  error.code = code;
  error.clientVersion = clientVersion;
  error.meta = meta;
  return error;
}

/**
 * @description Builds the unique violation Prisma 7.10.0 raises through the PostgreSQL adapter, which names the violated index.
 * @param index - The violated constraint's name, e.g. `CustomerUser_accountId_email_key`.
 * @param table - The table PostgreSQL reported, which is also the model name here.
 * @returns The P2002 Prisma 7.10.0 raises for that constraint through `@prisma/adapter-pg`.
 */
export function uniqueViolationOnIndex(index: string, table: string): MeasuredPrismaError {
  return knownRequestError(
    "P2002",
    `Unique constraint failed on the constraint: \`${index}\``,
    "7.10.0",
    {
      driverAdapterError: {
        name: "DriverAdapterError",
        cause: {
          originalCode: "23505",
          originalMessage: `duplicate key value violates unique constraint "${index}"`,
          kind: "UniqueConstraintViolation",
          constraint: { index },
          table,
        },
      },
      modelName: table,
    }
  );
}

/**
 * @description Builds the unique violation Prisma 7.9.1 raised through the PostgreSQL adapter, which listed the violated fields.
 * @param fields - The columns as PostgreSQL's detail lists them, mixed-case ones double-quoted.
 * @param index - The constraint's name, which 7.9.1 reports only inside the original message.
 * @param modelName - The model of the operation that raised it.
 * @returns The P2002 Prisma 7.9.1 raised for that constraint through `@prisma/adapter-pg`.
 */
export function uniqueViolationOnFields(
  fields: readonly string[],
  index: string,
  modelName: string
): MeasuredPrismaError {
  return knownRequestError(
    "P2002",
    `Unique constraint failed on the fields: (${fields.map((field) => `\`${field}\``).join(", ")})`,
    "7.9.1",
    {
      modelName,
      driverAdapterError: {
        name: "DriverAdapterError",
        cause: {
          originalCode: "23505",
          originalMessage: `duplicate key value violates unique constraint "${index}"`,
          kind: "UniqueConstraintViolation",
          constraint: { fields: [...fields] },
        },
      },
    }
  );
}

/**
 * @description Builds the foreign-key violation both Prisma 7.9.1 and 7.10.0 raise through the PostgreSQL adapter.
 * @param index - The violated foreign key's name, e.g. `Project_accountId_fkey`.
 * @param table - The table of the row that referenced a missing one.
 * @returns The P2003 Prisma 7.9.1 and 7.10.0 alike raise for that foreign key through
 *   `@prisma/adapter-pg`, measured with a project whose account does not exist.
 */
export function foreignKeyViolationOnIndex(index: string, table: string): MeasuredPrismaError {
  return knownRequestError(
    "P2003",
    `Foreign key constraint violated on the constraint: \`${index}\``,
    "7.10.0",
    {
      modelName: table,
      driverAdapterError: {
        name: "DriverAdapterError",
        cause: {
          originalCode: "23503",
          originalMessage: `insert or update on table "${table}" violates foreign key constraint "${index}"`,
          kind: "ForeignKeyConstraintViolation",
          constraint: { index },
        },
      },
    }
  );
}

/**
 * @description Builds a unique violation whose constraint payload has a shape no reader recognises.
 * @param constraint - A constraint payload in a shape the adapter does not produce today.
 * @returns A P2002 whose constraint no reader can identify, for the fail-closed cases.
 */
export function uniqueViolationWithConstraint(constraint: unknown): MeasuredPrismaError {
  return knownRequestError("P2002", "Unique constraint failed", "7.10.0", {
    driverAdapterError: {
      name: "DriverAdapterError",
      cause: { originalCode: "23505", kind: "UniqueConstraintViolation", constraint },
    },
  });
}
