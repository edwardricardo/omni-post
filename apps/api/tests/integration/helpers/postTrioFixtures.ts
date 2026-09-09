/**
 * @file postTrioFixtures.ts
 * @description Raw-SQL fixtures for the `Post` / `PostContent` / `PostMedia`
 *   tenant-key work, shared by `tenant-composite-fk.test.ts` and
 *   `post-trio-tenant-isolation.test.ts`.
 *
 *   ## Why raw SQL rather than the typed client
 *
 *   These suites are written BEFORE the tenant column exists and must keep
 *   compiling AFTER it lands as a required column. The typed client cannot do
 *   both: `prisma.post.create({ data: { accountId } })` does not type-check
 *   today (no such field), and `prisma.post.create({ data: { projectId } })`
 *   stops type-checking once `accountId` is required. Raw SQL is typechecked
 *   against neither shape, so ONE fixture body serves both sides of the
 *   migration and the suites' assertions are what changes colour — not their
 *   setup.
 *
 *   ## Why the column list is discovered rather than assumed
 *
 *   `readTrioTenantColumns` asks `information_schema` which of the three
 *   tables already carry `accountId`, and the insert helpers name the column
 *   only when it is there. This adapts the FIXTURE, never an assertion: every
 *   behavioural expectation in both suites is unconditional, so a missing
 *   column surfaces as the assertion it belongs to rather than as a setup
 *   crash that would read as a broken harness. The discovered shape is
 *   reported by each suite so a run states which side of the migration it
 *   measured.
 *
 *   Every write here goes through the OWNER channel (`createSeedPrismaClient`)
 *   and raw SQL additionally bypasses the `$extends` tenant guard, which is
 *   deliberate: fixtures build the two-tenant world the guard is then measured
 *   against.
 *
 * @layer infrastructure
 */
import { randomUUID } from "node:crypto";
import type { PrismaClient } from "@infra/prisma";

/**
 * Which of the three trio tables currently carry an `accountId` column.
 * All three flip together in the migration that adds them; they are tracked
 * separately so a partially applied migration is visible rather than averaged
 * into a single boolean.
 */
export interface TrioTenantColumns {
  readonly post: boolean;
  readonly postContent: boolean;
  readonly postMedia: boolean;
}

/**
 * @function readTrioTenantColumns
 * @description Reads from `information_schema` which trio tables carry an
 *   `accountId` column, so the insert helpers can name it only when it exists.
 * @param prisma - Owner-channel client.
 * @returns One flag per trio table.
 */
export async function readTrioTenantColumns(prisma: PrismaClient): Promise<TrioTenantColumns> {
  const rows = await prisma.$queryRaw<Array<{ table_name: string }>>`
    SELECT table_name
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name IN ('Post', 'PostContent', 'PostMedia')
      AND column_name = 'accountId'`;
  const present = new Set(rows.map((row) => row.table_name));
  return {
    post: present.has("Post"),
    postContent: present.has("PostContent"),
    postMedia: present.has("PostMedia"),
  };
}

/** The `meta` payload Prisma attaches to a raw-query failure. */
interface DriverAdapterMeta {
  readonly driverAdapterError?: {
    readonly cause?: {
      readonly originalCode?: unknown;
      readonly originalMessage?: unknown;
      readonly kind?: unknown;
    };
  };
  readonly code?: unknown;
}

/**
 * Reads the engine's own error payload out of a Prisma raw-query failure.
 * Measured shape (Prisma 7 through its driver adapter): the thrown value is a
 * `PrismaClientKnownRequestError` whose own `code` is always `P2010` — the
 * generic "raw query failed" — while the discriminating SQLSTATE sits at
 * `meta.driverAdapterError.cause.originalCode`. Reading the outer `code` would
 * therefore collapse a foreign-key violation, a not-null violation and a
 * missing column into one indistinguishable value, which is precisely the
 * distinction these suites exist to make.
 */
function driverCause(error: unknown): {
  code?: string;
  message?: string;
  kind?: string;
} {
  const meta = (error as { meta?: DriverAdapterMeta } | undefined)?.meta;
  const cause = meta?.driverAdapterError?.cause;
  const result: { code?: string; message?: string; kind?: string } = {};
  if (typeof cause?.originalCode === "string") result.code = cause.originalCode;
  if (typeof cause?.originalMessage === "string") result.message = cause.originalMessage;
  if (typeof cause?.kind === "string") result.kind = cause.kind;
  return result;
}

/**
 * @function sqlStateOf
 * @description Extracts the PostgreSQL SQLSTATE from a Prisma raw-query error.
 *   Prefers the structured driver-adapter payload; falls back to the code
 *   Prisma embeds in the message text (`Raw query failed. Code: ` + backticked
 *   value) so a change in the error object's shape degrades to a weaker read
 *   rather than to a silent `undefined` that would make every SQLSTATE
 *   assertion unfalsifiable. Returned as a string because SQLSTATEs are codes,
 *   not numbers — `23503` must never be compared as an integer.
 * @param error - The thrown value from a raw query.
 * @returns The five-character SQLSTATE, or undefined when the error carries none.
 */
export function sqlStateOf(error: unknown): string | undefined {
  const structured = driverCause(error).code;
  if (structured !== undefined && /^[0-9A-Z]{5}$/.test(structured)) {
    return structured;
  }
  const legacyMeta = (error as { meta?: DriverAdapterMeta } | undefined)?.meta?.code;
  if (typeof legacyMeta === "string" && /^[0-9A-Z]{5}$/.test(legacyMeta)) {
    return legacyMeta;
  }
  const message = error instanceof Error ? error.message : String(error);
  const fromText = /\bCode:\s*[`'"]?([0-9A-Z]{5})[`'"]?/.exec(message);
  return fromText?.[1];
}

/**
 * @function describeError
 * @description One-line rendering of a thrown value for assertion messages, so
 *   a red run names the failure verbatim instead of "expected true to be false".
 *   Prefers the engine's own message over Prisma's wrapper, whose first line is
 *   always "Invalid `prisma.$executeRawUnsafe()` invocation" and says nothing
 *   about what the database actually refused.
 * @param error - The thrown value.
 * @returns SQLSTATE and violation kind (when present) plus the engine's message.
 */
export function describeError(error: unknown): string {
  const cause = driverCause(error);
  const state = sqlStateOf(error) ?? "no-sqlstate";
  const kind = cause.kind === undefined ? "" : ` ${cause.kind}`;
  const rawMessage = error instanceof Error ? error.message : String(error);
  const detail =
    cause.message ??
    rawMessage
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0 && !line.startsWith("Invalid `prisma."))
      .join(" ") ??
    "(empty message)";
  return `[${state}${kind}] ${detail}`;
}

/**
 * @function insertAccount
 * @description Inserts an `Account` row through raw SQL.
 * @param prisma - Owner-channel client.
 * @param options - Tag used to build a collision-free email, name and slug.
 * @returns The new account id.
 */
export async function insertAccount(
  prisma: PrismaClient,
  options: { tag: string }
): Promise<string> {
  const id = randomUUID();
  await prisma.$executeRawUnsafe(
    `INSERT INTO "Account" (id, email, name, slug, "updatedAt")
     VALUES ($1, $2, $3, $4, NOW())`,
    id,
    `${options.tag}-${id}@test.local`,
    `${options.tag}-account`,
    `${options.tag}-${id}`
  );
  return id;
}

/**
 * @function insertProject
 * @description Inserts a `Project` row through raw SQL.
 * @param prisma - Owner-channel client.
 * @param options - Owning account and project name.
 * @returns The new project id.
 */
export async function insertProject(
  prisma: PrismaClient,
  options: { accountId: string; name: string }
): Promise<string> {
  const id = randomUUID();
  await prisma.$executeRawUnsafe(
    `INSERT INTO "Project" (id, "accountId", name, "updatedAt")
     VALUES ($1, $2, $3, NOW())`,
    id,
    options.accountId,
    options.name
  );
  return id;
}

/**
 * @function insertPost
 * @description Inserts a `Post` row through raw SQL, naming `accountId` only
 *   when the column exists.
 * @param prisma - Owner-channel client.
 * @param columns - Discovered trio column shape.
 * @param options - Parent project, owning account, and optional status.
 * @returns The new post id.
 */
export async function insertPost(
  prisma: PrismaClient,
  columns: TrioTenantColumns,
  options: { projectId: string; accountId: string; status?: string }
): Promise<string> {
  const id = randomUUID();
  const status = options.status ?? "DRAFT";
  if (columns.post) {
    await prisma.$executeRawUnsafe(
      `INSERT INTO "Post" (id, "projectId", "accountId", status, "updatedAt")
       VALUES ($1, $2, $3, $4, NOW())`,
      id,
      options.projectId,
      options.accountId,
      status
    );
  } else {
    await prisma.$executeRawUnsafe(
      `INSERT INTO "Post" (id, "projectId", status, "updatedAt")
       VALUES ($1, $2, $3, NOW())`,
      id,
      options.projectId,
      status
    );
  }
  return id;
}

/**
 * @function insertPostContent
 * @description Inserts a `PostContent` row through raw SQL, naming `accountId`
 *   only when the column exists.
 * @param prisma - Owner-channel client.
 * @param columns - Discovered trio column shape.
 * @param options - Parent post, owning account, body text and optional locale.
 * @returns The new content row id.
 */
export async function insertPostContent(
  prisma: PrismaClient,
  columns: TrioTenantColumns,
  options: { postId: string; accountId: string; body: string; locale?: string }
): Promise<string> {
  const id = randomUUID();
  const locale = options.locale ?? "en";
  if (columns.postContent) {
    await prisma.$executeRawUnsafe(
      `INSERT INTO "PostContent" (id, "postId", "accountId", locale, body, tags, "updatedAt")
       VALUES ($1, $2, $3, $4, $5, ARRAY[]::text[], NOW())`,
      id,
      options.postId,
      options.accountId,
      locale,
      options.body
    );
  } else {
    await prisma.$executeRawUnsafe(
      `INSERT INTO "PostContent" (id, "postId", locale, body, tags, "updatedAt")
       VALUES ($1, $2, $3, $4, ARRAY[]::text[], NOW())`,
      id,
      options.postId,
      locale,
      options.body
    );
  }
  return id;
}

/**
 * @function insertPostMedia
 * @description Inserts a `PostMedia` row through raw SQL, naming `accountId`
 *   only when the column exists.
 * @param prisma - Owner-channel client.
 * @param columns - Discovered trio column shape.
 * @param options - Parent post, owning account and media URL.
 * @returns The new media row id.
 */
export async function insertPostMedia(
  prisma: PrismaClient,
  columns: TrioTenantColumns,
  options: { postId: string; accountId: string; url: string }
): Promise<string> {
  const id = randomUUID();
  if (columns.postMedia) {
    await prisma.$executeRawUnsafe(
      `INSERT INTO "PostMedia" (id, "postId", "accountId", url, type)
       VALUES ($1, $2, $3, $4, 'image'::"MediaKind")`,
      id,
      options.postId,
      options.accountId,
      options.url
    );
  } else {
    await prisma.$executeRawUnsafe(
      `INSERT INTO "PostMedia" (id, "postId", url, type)
       VALUES ($1, $2, $3, 'image'::"MediaKind")`,
      id,
      options.postId,
      options.url
    );
  }
  return id;
}

/**
 * @function deleteAccountsCascade
 * @description Removes every fixture row created under the given accounts, in
 *   FK order, through raw SQL. Raw rather than typed for the same reason the
 *   inserts are: the statement must not name a column whose existence depends
 *   on which side of the migration the run is on.
 * @param prisma - Owner-channel client.
 * @param accountIds - Accounts whose trees are removed.
 */
export async function deleteAccountsCascade(
  prisma: PrismaClient,
  accountIds: readonly string[]
): Promise<void> {
  if (accountIds.length === 0) return;
  const ids = [...accountIds];
  await prisma.$executeRawUnsafe(
    `DELETE FROM "PostMedia" WHERE "postId" IN (
       SELECT p.id FROM "Post" p
       JOIN "Project" pr ON pr.id = p."projectId"
       WHERE pr."accountId" = ANY($1::text[]))`,
    ids
  );
  await prisma.$executeRawUnsafe(
    `DELETE FROM "PostContent" WHERE "postId" IN (
       SELECT p.id FROM "Post" p
       JOIN "Project" pr ON pr.id = p."projectId"
       WHERE pr."accountId" = ANY($1::text[]))`,
    ids
  );
  await prisma.$executeRawUnsafe(
    `DELETE FROM "Post" WHERE "projectId" IN (
       SELECT id FROM "Project" WHERE "accountId" = ANY($1::text[]))`,
    ids
  );
  await prisma.$executeRawUnsafe(`DELETE FROM "Project" WHERE "accountId" = ANY($1::text[])`, ids);
  await prisma.$executeRawUnsafe(`DELETE FROM "Account" WHERE id = ANY($1::text[])`, ids);
}

/**
 * @function countRows
 * @description Counts rows in one of the fixture tables matching a raw predicate.
 *   Used for the DB-as-found control counts each suite reports.
 * @param prisma - Owner-channel client.
 * @param table - Table name (a literal from the suite, never caller input).
 * @returns The row count as a number.
 */
export async function countRows(prisma: PrismaClient, table: string): Promise<number> {
  const rows = await prisma.$queryRawUnsafe<Array<{ count: bigint }>>(
    `SELECT COUNT(*)::bigint AS count FROM "${table}"`
  );
  return Number(rows[0]?.count ?? 0n);
}
