/**
 * @file rls-ab-measurement.ts
 * @description Standalone evidence harness for the Post-trio tenant-key work: it
 *   seeds a deterministic two-tenant corpus, `VACUUM (ANALYZE)`s it, and captures
 *   `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)` for the hot `Post` listing paths and
 *   the `postId`-led `PostContent` / `PostMedia` child reads, as the non-bypassing
 *   `omnipost_app` role with `app.account_id` bound. `--phase before` writes the
 *   pre-migration capture, `--phase after` the post-migration one, both into
 *   `docs/reports/TENANT_RLS_AB_MEASUREMENT.md` between generated markers so the
 *   hand-written sections of that report survive a re-run.
 *
 *   ## It is evidence, not a gate
 *
 *   Nothing here asserts a threshold and nothing here runs in CI. It lives outside
 *   the fitness suite and outside every test tier on purpose: a plan shape is a
 *   measurement of one database with one corpus, and a gate built on it would go
 *   red on an unrelated machine while proving nothing about the code. The one
 *   thing it DOES refuse to do is report a plan for a query that is not the one
 *   the application issues — see the mirror-fidelity check below.
 *
 *   ## Two channels, and why the split is not optional
 *
 *   Fixtures are written through the OWNER channel (`MIGRATE_DATABASE_URL`,
 *   falling back to `DATABASE_URL`) because an unbound `INSERT` into an
 *   RLS-covered table is exactly what the `tenant_isolation` policy exists to
 *   refuse. Measurements run through a session whose `current_user` is
 *   `omnipost_app`, because the policy qual only appears in a plan when the role
 *   in effect cannot bypass row security — a plan captured as the owner would be
 *   a plan of a query the application never runs.
 *
 *   ## Mirror fidelity, stated rather than assumed
 *
 *   `EXPLAIN` needs SQL text, and Prisma 7 emits its SQL through a driver adapter
 *   this script cannot subscribe to (query-event logging requires constructing the
 *   client with `log`, which needs `@prisma/adapter-pg` — a dependency of
 *   `infra/prisma`, not of the repo root). Each case therefore carries a
 *   hand-written SQL MIRROR of a named repository call site, and every run
 *   executes BOTH the real Prisma call and the mirror inside the same bound
 *   transaction and compares the returned row identities. A mirror that has
 *   drifted from its source site fails the run instead of quietly producing a
 *   plan for a different question.
 *
 *   ## The comparison must be able to fail
 *
 *   An identity comparison over an empty result is a tautology: "no rows equals no
 *   rows" passes no matter where the mirror points. Every case therefore reports
 *   whether BOTH sides actually matched something, and a case that matched nothing
 *   FAILS the run unless it declares `missProbe`, which says the empty result is
 *   the measured subject rather than an accident. A declared miss probe is checked
 *   in the other direction too — if it starts matching rows, the corpus has moved
 *   out from under the case and the run fails. Neither state is written to the
 *   report: the fidelity and vacuity checks run BEFORE the artifact is written, so
 *   a capture that failed its own guard leaves no readable evidence behind.
 *
 * @layer infrastructure
 */
import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createTestPrismaClient } from "../infra/prisma/src/test-client.js";
import type { PrismaClient } from "../infra/prisma/src/client.js";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DEFAULT_REPORT = join(REPO_ROOT, "docs/reports/TENANT_RLS_AB_MEASUREMENT.md");

/** The non-bypassing role the application connects as after the runtime cutover. */
const APP_ROLE = "omnipost_app";
/** Every row this harness writes carries this prefix so the shared dev DB stays attributable. */
const NS = "tif-ab";
const TENANTS = [`${NS}-a`, `${NS}-b`] as const;
/** Tables whose shape, size, and row-security posture the report records. */
const TRACKED_TABLES = ["Project", "Post", "PostContent", "PostMedia"] as const;

interface Options {
  readonly phase: "before" | "after" | null;
  readonly cleanup: boolean;
  readonly skipSeed: boolean;
  readonly seedOnly: boolean;
  readonly projects: number;
  readonly posts: number;
  readonly runs: number;
  readonly report: string;
}

/**
 * @function parseOptions
 * @description Parses the CLI surface. Unknown flags abort rather than being
 *   ignored, so a typo cannot silently produce a capture with default sizing.
 * @param argv - Raw arguments (`process.argv.slice(2)`).
 * @returns The resolved options.
 * @throws Error on an unknown flag, a missing value, or a non-positive size.
 */
export function parseOptions(argv: readonly string[]): Options {
  let phase: Options["phase"] = null;
  let cleanup = false;
  let skipSeed = false;
  let seedOnly = false;
  let projects = 100;
  let posts = 10_000;
  let runs = 3;
  let report = DEFAULT_REPORT;

  const positive = (flag: string, raw: string | undefined): number => {
    const n = Number(raw);
    if (!Number.isFinite(n) || n <= 0 || !Number.isInteger(n)) {
      throw new Error(`${flag} needs a positive integer, got ${String(raw)}`);
    }
    return n;
  };

  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    switch (flag) {
      case "--phase": {
        const value = argv[(i += 1)];
        if (value !== "before" && value !== "after") {
          throw new Error(`--phase must be "before" or "after", got ${String(value)}`);
        }
        phase = value;
        break;
      }
      case "--cleanup":
        cleanup = true;
        break;
      case "--skip-seed":
        skipSeed = true;
        break;
      case "--seed-only":
        seedOnly = true;
        break;
      case "--projects":
        projects = positive(flag, argv[(i += 1)]);
        break;
      case "--posts":
        posts = positive(flag, argv[(i += 1)]);
        break;
      case "--runs":
        runs = positive(flag, argv[(i += 1)]);
        break;
      case "--out":
        report = argv[(i += 1)] ?? DEFAULT_REPORT;
        break;
      default:
        throw new Error(
          `unknown flag ${String(flag)}. Usage: rls-ab-measurement.ts ` +
            `[--phase before|after] [--cleanup] [--seed-only] [--skip-seed] ` +
            `[--projects N] [--posts N] [--runs N] [--out FILE]`
        );
    }
  }

  if (!cleanup && !seedOnly && phase === null) {
    throw new Error("nothing to do: pass --phase before|after, --seed-only, or --cleanup");
  }
  return { phase, cleanup, skipSeed, seedOnly, projects, posts, runs, report };
}

/**
 * @function ownerUrl
 * @description Resolves the owner/migrate channel, mirroring the precedence
 *   `infra/prisma/prisma.config.ts` and the integration harness both apply. `||`
 *   rather than `??`: the key ships present-but-empty, so an empty string means
 *   unconfigured and must fall through.
 * @param env - Environment to read.
 * @returns The connection string fixtures are written through.
 * @throws Error when neither channel is configured.
 */
function ownerUrl(env: NodeJS.ProcessEnv): string {
  const url = env.MIGRATE_DATABASE_URL || env.DATABASE_URL;
  if (!url) {
    throw new Error(
      "no database channel configured: set MIGRATE_DATABASE_URL (owner) or DATABASE_URL. " +
        "Run with `node --import tsx --env-file=.env scripts/rls-ab-measurement.ts ...`."
    );
  }
  return url;
}

/**
 * @function createMeasurementClient
 * @description Builds the client every plan is captured through. It targets the
 *   owner channel's HOST and database but asks the server for `role=omnipost_app`
 *   in the startup packet, which is the same mechanism
 *   `apps/api/tests/integration/helpers/appRoleClient.ts` uses. That keeps the
 *   harness runnable on either side of the `DATABASE_URL` cutover and needs no
 *   credential of its own.
 * @param env - Environment to read.
 * @returns A client whose `current_user` is {@link APP_ROLE}.
 */
function createMeasurementClient(env: NodeJS.ProcessEnv): PrismaClient {
  return createTestPrismaClient(ownerUrl(env), `-c role=${APP_ROLE}`);
}

/**
 * @function assertAppRoleSession
 * @description Verifies on the live connection that measurements really run as the
 *   non-bypassing application role. Without this, a plan captured as the owner
 *   would carry no policy qual and the report would understate the cost of every
 *   query in it.
 * @param client - The measurement client.
 * @throws Error when the session is not a non-superuser `omnipost_app`.
 */
async function assertAppRoleSession(client: PrismaClient): Promise<void> {
  const [row] = await client.$queryRawUnsafe<Array<{ role: string; su: string; bypass: boolean }>>(
    `SELECT current_user::text AS role,
            current_setting('is_superuser') AS su,
            (SELECT rolbypassrls FROM pg_roles WHERE rolname = current_user) AS bypass`
  );
  if (!row || row.role !== APP_ROLE || row.su !== "off" || row.bypass) {
    throw new Error(
      `measurements must run as a non-bypassing ${APP_ROLE}: got role=${row?.role ?? "?"}, ` +
        `is_superuser=${row?.su ?? "?"}, rolbypassrls=${String(row?.bypass)}. ` +
        "Apply the create_omnipost_app_role migration (pnpm db:up && pnpm db:migrate)."
    );
  }
}

/** Escape a string for inlining as a SQL literal. Ids here are harness-generated. */
const lit = (value: string): string => `'${value.replace(/'/g, "''")}'`;

/**
 * Escape a value for one Markdown table cell. The BACKSLASH pass has to come first
 * and is the whole point: escaping `|` into `\|` while leaving `\` alone lets an
 * input backslash pair with the escape (`\` + `\|` renders as a literal backslash
 * followed by an UNescaped delimiter), so the cell the escaping exists to protect
 * splits anyway. Both passes are global — escaping only the first occurrence leaves
 * every later delimiter live.
 */
const mdCell = (value: string): string => value.replace(/\\/g, "\\\\").replace(/\|/g, "\\|");

/**
 * @function withScope
 * @description Runs `body` inside one transaction with `app.account_id` bound, the
 *   way `PrismaUnitOfWork` binds it in the application. Every read and every
 *   `EXPLAIN` in this harness goes through here: an unbound statement under the app
 *   role fails closed and would be measured as "fast" for the wrong reason.
 * @param client - The client to open the transaction on.
 * @param scope - The tenant id, or `__system__` for the cross-tenant control.
 * @param body - Work to run on the transaction client.
 * @returns Whatever `body` returns.
 */
async function withScope<T>(
  client: PrismaClient,
  scope: string,
  body: (tx: PrismaClient) => Promise<T>
): Promise<T> {
  return client.$transaction(
    async (tx) => {
      await tx.$executeRawUnsafe(`SELECT set_config('app.account_id', ${lit(scope)}, true)`);
      return body(tx as unknown as PrismaClient);
    },
    { timeout: 600_000, maxWait: 30_000 }
  );
}

/**
 * @function seed
 * @description Writes the two-tenant corpus through the owner channel. Every
 *   statement is a single set-based `INSERT ... SELECT generate_series(...)` and
 *   every id is namespaced, so the corpus is reproducible byte-for-byte and
 *   attributable in a shared database. Re-running is safe: ids collide and
 *   `ON CONFLICT DO NOTHING` absorbs them.
 * @param owner - Owner-channel client.
 * @param opts - Sizing options.
 * @returns Per-tenant row counts, for the report's data-shape section.
 */
async function seed(owner: PrismaClient, opts: Options): Promise<Record<string, number>> {
  for (const tenant of TENANTS) {
    await withScope(owner, "__system__", async (tx) => {
      await tx.$executeRawUnsafe(
        `INSERT INTO "Account" (id, email, name, "createdAt", "updatedAt")
         VALUES (${lit(tenant)}, ${lit(`${tenant}@example.invalid`)}, ${lit(`AB tenant ${tenant}`)}, now(), now())
         ON CONFLICT (id) DO NOTHING`
      );
      await tx.$executeRawUnsafe(
        `INSERT INTO "Project" (id, name, "accountId", "createdAt", "updatedAt")
         SELECT ${lit(tenant)} || '-proj-' || lpad(g::text, 4, '0'),
                'AB project ' || lpad(g::text, 4, '0'),
                ${lit(tenant)},
                now() - (g || ' minutes')::interval,
                now()
         FROM generate_series(1, ${opts.projects}) g
         ON CONFLICT (id) DO NOTHING`
      );
      // Round-robin over the tenant's projects, so per-project listings and the
      // account-wide feed both see a realistic fan-out instead of one hot project.
      // The trio now carries its own tenant key, and `tenant` IS the account id
      // here, so every seeded row agrees with its parent by construction — a
      // divergent value would be refused by the composite foreign key, which is
      // the right outcome but would read as a broken harness.
      await tx.$executeRawUnsafe(
        `INSERT INTO "Post" (id, "projectId", "accountId", status, "scheduledAt", "publishedAt",
                             "createdAt", "updatedAt", "archivedAt", "deletedAt", version)
         SELECT ${lit(tenant)} || '-post-' || lpad(g::text, 6, '0'),
                ${lit(tenant)} || '-proj-' || lpad((((g - 1) % ${opts.projects}) + 1)::text, 4, '0'),
                ${lit(tenant)},
                (ARRAY['DRAFT','SCHEDULED','PUBLISHED','FAILED'])[1 + (g % 4)],
                CASE WHEN g % 4 = 1 THEN now() + ((g % 10000) || ' minutes')::interval END,
                CASE WHEN g % 4 = 2 THEN now() - ((g % 10000) || ' minutes')::interval END,
                now() - ((g % 100000) || ' seconds')::interval,
                now(),
                CASE WHEN g % 10 = 0 THEN now() END,
                CASE WHEN g % 20 = 0 THEN now() END,
                0
         FROM generate_series(1, ${opts.posts}) g
         ON CONFLICT (id) DO NOTHING`
      );
      await tx.$executeRawUnsafe(
        `INSERT INTO "PostContent" (id, "postId", "accountId", locale, title, body, tags, revision,
                                    "createdAt", "updatedAt")
         SELECT ${lit(tenant)} || '-content-' || lpad(g::text, 6, '0'),
                ${lit(tenant)} || '-post-' || lpad(g::text, 6, '0'),
                ${lit(tenant)},
                'en',
                'AB post ' || g,
                repeat('lorem ipsum dolor sit amet ', 8) || g,
                ARRAY['ab','bench'],
                1, now(), now()
         FROM generate_series(1, ${opts.posts}) g
         ON CONFLICT (id) DO NOTHING`
      );
      await tx.$executeRawUnsafe(
        `INSERT INTO "PostMedia" (id, "postId", "accountId", url, type, tags, "createdAt")
         SELECT ${lit(tenant)} || '-media-' || lpad(g::text, 6, '0'),
                ${lit(tenant)} || '-post-' || lpad(g::text, 6, '0'),
                ${lit(tenant)},
                'https://example.invalid/ab/' || g || '.jpg',
                'image'::"MediaKind",
                ARRAY[]::text[],
                now()
         FROM generate_series(1, ${opts.posts}) g
         WHERE g % 3 = 0
         ON CONFLICT (id) DO NOTHING`
      );
    });
  }
  await vacuumAnalyze(owner);
  return namespaceCounts(owner);
}

/**
 * @function vacuumAnalyze
 * @description Prepares the corpus for a REPRODUCIBLE plan.
 *
 *   VACUUM, not just ANALYZE, and it is load-bearing rather than hygiene. Measured:
 *   with `ANALYZE` alone, the first capture after a bulk insert and a later capture
 *   over the IDENTICAL, untouched corpus disagreed on two plans — Q2 moved from a
 *   Bitmap Heap Scan to an Index Only Scan (0.081 → 0.030 ms) and Q4 from a hash join
 *   over two sequential scans to a nested loop with an Index Only Scan
 *   (3.05 → 1.32 ms). Nothing about the data changed; the freshly inserted heap pages
 *   were simply not yet marked all-visible, so no index-only path was available until
 *   autovacuum reached them.
 *
 *   A baseline that changes shape on its own is not a baseline — the after phase would
 *   read that drift as an effect of the migration. `VACUUM` sets the visibility map
 *   before the capture. It runs on the `--skip-seed` path too, because a corpus someone
 *   else left behind is exactly the case where the map's state is unknown.
 * @param owner - Owner-channel client (VACUUM cannot run inside a transaction).
 * @returns Resolves once the five tables are vacuumed and analyzed.
 */
async function vacuumAnalyze(owner: PrismaClient): Promise<void> {
  await owner.$executeRawUnsafe(
    `VACUUM (ANALYZE) "Account", "Project", "Post", "PostContent", "PostMedia"`
  );
}

/**
 * @function namespaceCounts
 * @description Counts this harness's own rows, under `__system__` so a zero means
 *   ABSENCE and not invisibility. Reading them as a scoped app-role session would
 *   make both states produce the same answer.
 * @param owner - Owner-channel client.
 * @returns Row count per tracked table plus the `Account` control.
 */
async function namespaceCounts(owner: PrismaClient): Promise<Record<string, number>> {
  return withScope(owner, "__system__", async (tx) => {
    const out: Record<string, number> = {};
    for (const [table, column] of [
      ["Account", "id"],
      ["Project", "id"],
      ["Post", "id"],
      ["PostContent", "id"],
      ["PostMedia", "id"],
    ] as const) {
      const [row] = await tx.$queryRawUnsafe<Array<{ n: bigint }>>(
        `SELECT count(*)::bigint AS n FROM "${table}" WHERE "${column}" LIKE ${lit(`${NS}-%`)}`
      );
      out[table] = Number(row?.n ?? 0);
    }
    const [control] = await tx.$queryRawUnsafe<Array<{ n: bigint }>>(
      `SELECT count(*)::bigint AS n FROM "Account"`
    );
    out["__control_all_accounts"] = Number(control?.n ?? 0);
    return out;
  });
}

/**
 * @function cleanup
 * @description Removes the corpus and proves the removal. Deleting the two
 *   namespaced `Account` rows cascades through `Project` → `Post` →
 *   `PostContent`/`PostMedia`, so one statement owns the whole tree and no child
 *   can be orphaned by a partial delete.
 * @param owner - Owner-channel client.
 * @returns Namespace counts AFTER the delete, alongside the live account control.
 */
async function cleanup(owner: PrismaClient): Promise<Record<string, number>> {
  await withScope(owner, "__system__", async (tx) => {
    await tx.$executeRawUnsafe(`DELETE FROM "Account" WHERE id LIKE ${lit(`${NS}-%`)}`);
  });
  return namespaceCounts(owner);
}

/** One captured plan plus the numbers that make it comparable across phases. */
interface CaptureResult {
  readonly id: string;
  readonly title: string;
  readonly sourceSite: string;
  readonly why: string;
  readonly sql: string;
  /** The comparable digest the case's own `digest` extracted from each side. */
  readonly fromPrisma: string;
  readonly fromMirror: string;
  readonly fidelity: "match" | "MISMATCH";
  /** Whether BOTH sides matched at least one row — see {@link Comparison.nonEmpty}. */
  readonly nonEmpty: boolean;
  /** Whether the case declared its empty result deliberate. */
  readonly missProbe: boolean;
  readonly prismaWallMs: number;
  readonly planningMs: readonly number[];
  readonly executionMs: readonly number[];
  readonly nodeTypes: readonly string[];
  readonly indexNames: readonly string[];
  readonly plan: string;
}

/**
 * The outcome of comparing one case's Prisma call against its SQL mirror.
 */
interface Comparison {
  /** The comparable digest extracted from the Prisma call. */
  readonly fromPrisma: string;
  /** The same digest extracted from the mirror. Must equal {@link fromPrisma}. */
  readonly fromMirror: string;
  /**
   * Whether BOTH sides actually matched something. Equal digests over two EMPTY
   * results prove nothing — the comparison cannot fail no matter where the mirror
   * points — so this is what separates a real match from a tautology. "Matched
   * something" is the query's own notion: at least one row for a row-returning
   * case, a non-zero total for a count.
   */
  readonly nonEmpty: boolean;
}

/**
 * How a case proves its mirror still answers the same question as its Prisma call.
 * Row COUNTS alone would be too weak for the aggregates (a count query always
 * returns one row on both sides), so each case picks the comparison that can
 * actually fail.
 */
type Digest = (
  fromPrisma: unknown,
  fromMirror: ReadonlyArray<Record<string, unknown>>
) => Comparison;

const rowsOfUnknown = (value: unknown): ReadonlyArray<Record<string, unknown>> =>
  Array.isArray(value) ? (value as ReadonlyArray<Record<string, unknown>>) : [];

/** Sorted id list on both sides — the strongest available check for row-returning cases. */
const byIds: Digest = (fromPrisma, fromMirror) => {
  const ids = (rows: ReadonlyArray<Record<string, unknown>>): string =>
    rows
      .map((r) => String(r["id"]))
      .sort()
      .join(",");
  const prismaRows = rowsOfUnknown(fromPrisma);
  return {
    fromPrisma: ids(prismaRows),
    fromMirror: ids(fromMirror),
    nonEmpty: prismaRows.length > 0 && fromMirror.length > 0,
  };
};

/** Prisma's scalar count against the mirror's single `n` column. */
const byCount: Digest = (fromPrisma, fromMirror) => {
  const prisma = Number(fromPrisma);
  const mirror = Number(fromMirror[0]?.["n"] ?? Number.NaN);
  return {
    fromPrisma: String(prisma),
    fromMirror: String(mirror),
    // A count of zero is a row the aggregate manufactured, not a row it found: the
    // comparison "0 == 0" holds for every project with no post in that bucket.
    nonEmpty: prisma > 0 && mirror > 0,
  };
};

/** A measurable path: a real Prisma call plus the SQL mirror the plan is taken from. */
interface Case {
  readonly id: string;
  readonly title: string;
  readonly sourceSite: string;
  readonly why: string;
  readonly group: "post-listing" | "child-read";
  readonly sql: (ctx: Ctx) => string;
  readonly prisma: (tx: PrismaClient, ctx: Ctx) => Promise<unknown>;
  readonly digest: Digest;
  /**
   * Declares that this case is EXPECTED to match nothing, so its empty result is
   * the measured subject rather than a comparison that silently cannot fail. The
   * declaration binds both ways: the run fails if a miss probe starts matching
   * rows, because that means the corpus moved and the plan is no longer the one
   * the case claims to measure.
   */
  readonly missProbe?: true;
}

/** Values the cases share: the tenant under measurement and its first page of ids. */
interface Ctx {
  readonly accountId: string;
  readonly projectId: string;
  readonly postIds: readonly string[];
  readonly postId: string;
  /**
   * The first post of {@link postIds} that actually carries a `PostMedia` row.
   * Resolved by querying, not by index arithmetic: media is seeded for every third
   * post, so `postIds[0]` names a post with none and a child read pointed at it
   * would measure a lookup that finds nothing.
   */
  readonly mediaPostId: string;
}

const idList = (ids: readonly string[]): string => `ARRAY[${ids.map(lit).join(", ")}]`;
const POST_COLS = `p.id, p."projectId", p.status, p."scheduledAt", p."publishedAt", p."createdAt", p."updatedAt"`;

/**
 * The catalog. Every entry names the repository method it mirrors; the mirror is
 * validated against that method's own Prisma call on every run.
 */
const CASES: readonly Case[] = [
  {
    id: "Q1",
    title: "listByProject — page 1 of a project's live posts",
    sourceSite:
      "apps/api/src/infrastructure/repositories/PrismaPostQueryRepository.ts:136 (where built at :185)",
    why: "the customer's post list; the most frequently served Post read",
    group: "post-listing",
    sql: (c) => `SELECT ${POST_COLS} FROM "Post" p
 WHERE p."projectId" = ${lit(c.projectId)}
   AND p."deletedAt" IS NULL
   AND p."archivedAt" IS NULL
   AND EXISTS (SELECT 1 FROM "Project" pr
                WHERE pr.id = p."projectId" AND pr."accountId" = ${lit(c.accountId)})
 ORDER BY p."createdAt" DESC
 LIMIT 20 OFFSET 0`,
    prisma: (tx, c) =>
      tx.post.findMany({
        where: {
          projectId: c.projectId,
          project: { accountId: c.accountId },
          deletedAt: null,
          archivedAt: null,
        },
        select: { id: true },
        orderBy: { createdAt: "desc" },
        skip: 0,
        take: 20,
      }),
    digest: byIds,
  },
  {
    id: "Q2",
    title: "listByProject — the paired total count",
    sourceSite: "apps/api/src/infrastructure/repositories/PrismaPostQueryRepository.ts:161",
    why: "runs on every page load in the same Promise.all as Q1, over the whole project",
    group: "post-listing",
    sql: (c) => `SELECT count(*) AS n FROM "Post" p
 WHERE p."projectId" = ${lit(c.projectId)}
   AND p."deletedAt" IS NULL
   AND p."archivedAt" IS NULL
   AND EXISTS (SELECT 1 FROM "Project" pr
                WHERE pr.id = p."projectId" AND pr."accountId" = ${lit(c.accountId)})`,
    prisma: (tx, c) =>
      tx.post.count({
        where: {
          projectId: c.projectId,
          project: { accountId: c.accountId },
          deletedAt: null,
          archivedAt: null,
        },
      }),
    digest: byCount,
  },
  {
    id: "Q3",
    title: "listGlobal — the account-wide feed, page 1",
    sourceSite: "apps/api/src/infrastructure/repositories/PrismaPostQueryRepository.ts:405",
    why: "the tenant-wide listing the new (accountId, projectId) partial index exists to serve",
    group: "post-listing",
    sql: (c) => `SELECT ${POST_COLS} FROM "Post" p
 WHERE p."deletedAt" IS NULL
   AND EXISTS (SELECT 1 FROM "Project" pr
                WHERE pr.id = p."projectId"
                  AND pr."accountId" = ${lit(c.accountId)}
                  AND pr."deletedAt" IS NULL)
 ORDER BY p."createdAt" DESC
 LIMIT 20 OFFSET 0`,
    prisma: (tx, c) =>
      tx.post.findMany({
        where: { deletedAt: null, project: { accountId: c.accountId, deletedAt: null } },
        select: { id: true },
        orderBy: { createdAt: "desc" },
        skip: 0,
        take: 20,
      }),
    digest: byIds,
  },
  {
    id: "Q4",
    title: "listGlobal — the paired total count",
    sourceSite: "apps/api/src/infrastructure/repositories/PrismaPostQueryRepository.ts:436",
    why: "the account-wide count; today it can only be answered by walking into Project",
    group: "post-listing",
    sql: (c) => `SELECT count(*) AS n FROM "Post" p
 WHERE p."deletedAt" IS NULL
   AND EXISTS (SELECT 1 FROM "Project" pr
                WHERE pr.id = p."projectId"
                  AND pr."accountId" = ${lit(c.accountId)}
                  AND pr."deletedAt" IS NULL)`,
    prisma: (tx, c) =>
      tx.post.count({
        where: { deletedAt: null, project: { accountId: c.accountId, deletedAt: null } },
      }),
    digest: byCount,
  },
  {
    id: "Q5",
    title: "findByProjectId — aggregate listing with no account predicate",
    sourceSite: "apps/api/src/infrastructure/repositories/PrismaPostRepository.ts:177",
    why: "the command-side listing; its tenant scope comes from the guard and RLS, not the query",
    group: "post-listing",
    sql: (c) => `SELECT ${POST_COLS} FROM "Post" p
 WHERE p."projectId" = ${lit(c.projectId)}
   AND p."deletedAt" IS NULL
 ORDER BY p."createdAt" DESC
 LIMIT 20 OFFSET 0`,
    prisma: (tx, c) =>
      tx.post.findMany({
        where: { projectId: c.projectId, deletedAt: null },
        select: { id: true },
        orderBy: { createdAt: "desc" },
        skip: 0,
        take: 20,
      }),
    digest: byIds,
  },
  {
    id: "Q6",
    title: "filterIdsByAccount — the bulk cross-tenant gate",
    sourceSite: "apps/api/src/infrastructure/repositories/PrismaPostRepository.ts:416",
    why: "runs before every bulk mutation; the join into Project IS the isolation check today",
    group: "post-listing",
    sql: (c) => `SELECT p.id FROM "Post" p
 WHERE p.id = ANY(${idList(c.postIds)})
   AND p."deletedAt" IS NULL
   AND EXISTS (SELECT 1 FROM "Project" pr
                WHERE pr.id = p."projectId" AND pr."accountId" = ${lit(c.accountId)})`,
    prisma: (tx, c) =>
      tx.post.findMany({
        where: {
          id: { in: [...c.postIds] },
          deletedAt: null,
          project: { accountId: c.accountId },
        },
        select: { id: true },
      }),
    digest: byIds,
  },
  {
    id: "Q7",
    title: "findOwnerAccountId — ownership resolved through the parent",
    sourceSite: "apps/api/src/infrastructure/repositories/PrismaPostRepository.ts:444",
    why: "the per-request ownership gate; the composite key is meant to make this join optional",
    group: "post-listing",
    sql: (c) => `SELECT pr."accountId" FROM "Post" p
 JOIN "Project" pr ON pr.id = p."projectId"
 WHERE p.id = ${lit(c.postId)} AND p."deletedAt" IS NULL
 LIMIT 1`,
    prisma: (tx, c) =>
      tx.post.findFirst({
        where: { id: c.postId, deletedAt: null },
        select: { project: { select: { accountId: true } } },
      }),
    // Both sides must resolve the SAME owning account, not merely one row each:
    // a mirror that lost the join would still return exactly one row.
    digest: (fromPrisma, fromMirror) => {
      const nested = (fromPrisma ?? {}) as { project?: { accountId?: string } };
      const prisma = nested.project?.accountId;
      const mirror = fromMirror[0]?.["accountId"];
      return {
        fromPrisma: String(prisma ?? "(none)"),
        fromMirror: String(mirror ?? "(none)"),
        nonEmpty: prisma !== undefined && mirror !== undefined,
      };
    },
  },
  {
    id: "Q8",
    title: "getProjectStats — the per-status count fan-out (DRAFT arm)",
    sourceSite: "apps/api/src/infrastructure/repositories/PrismaPostRepository.ts:331",
    why: "five counts issued together per project dashboard load",
    group: "post-listing",
    sql: (c) => `SELECT count(*) AS n FROM "Post" p
 WHERE p."projectId" = ${lit(c.projectId)}
   AND p."deletedAt" IS NULL
   AND p.status = 'DRAFT'`,
    prisma: (tx, c) =>
      tx.post.count({ where: { projectId: c.projectId, deletedAt: null, status: "DRAFT" } }),
    digest: byCount,
    // Declared: this arm counts ZERO on this corpus, and that is the measured
    // subject. The seeder cycles status by `g % 4` while a project's posts are the
    // `g` congruent to its own number modulo the project count, so every post under
    // `-proj-0001` is SCHEDULED and the DRAFT bucket is legitimately empty. The plan
    // is still the real one the dashboard issues for an empty bucket — but "0 == 0"
    // holds for three projects in four, so without this declaration the comparison
    // would read as identity evidence it cannot supply.
    missProbe: true,
  },
  {
    id: "Q9",
    title: "PostContent — batched postId-led read for one listing page",
    sourceSite:
      "include `contents` on PrismaPostQueryRepository.ts:153 / PrismaPostRepository.ts:188",
    why: "shape-1b evidence: today PostContent carries no accountId and no policy qual at all",
    group: "child-read",
    sql: (c) => `SELECT c.id, c."postId", c.locale, c.title, c.summary, c.revision
 FROM "PostContent" c
 WHERE c."postId" = ANY(${idList(c.postIds)})`,
    prisma: (tx, c) =>
      tx.postContent.findMany({
        where: { postId: { in: [...c.postIds] } },
        select: { id: true },
      }),
    digest: byIds,
  },
  {
    id: "Q10",
    title: "PostContent — single-parent read",
    sourceSite: "include `contents` on PrismaPostRepository.findById (:64)",
    why: "the aggregate-load shape; the narrowest postId-led child read there is",
    group: "child-read",
    sql: (c) => `SELECT c.id, c."postId", c.locale, c.title, c.summary, c.revision
 FROM "PostContent" c
 WHERE c."postId" = ${lit(c.postId)}`,
    prisma: (tx, c) =>
      tx.postContent.findMany({ where: { postId: c.postId }, select: { id: true } }),
    digest: byIds,
  },
  {
    id: "Q11",
    title: "PostMedia — batched postId-led read for one listing page",
    sourceSite: "include `media` on PrismaPostRepository.ts:190",
    why: "shape-1b evidence for the second exempted table",
    group: "child-read",
    sql: (c) => `SELECT m.id, m."postId", m.url, m.type FROM "PostMedia" m
 WHERE m."postId" = ANY(${idList(c.postIds)})`,
    prisma: (tx, c) =>
      tx.postMedia.findMany({ where: { postId: { in: [...c.postIds] } }, select: { id: true } }),
    digest: byIds,
  },
  {
    id: "Q12",
    title: "PostMedia — the `_count` aggregate over one listing page",
    sourceSite: "`_count: { select: { media: true } }` on PrismaPostQueryRepository.ts:155",
    why: "the aggregate arm of the same child read; grouping changes the plan, so it is captured apart",
    group: "child-read",
    sql: (c) => `SELECT m."postId", count(*) AS n FROM "PostMedia" m
 WHERE m."postId" = ANY(${idList(c.postIds)})
 GROUP BY m."postId"`,
    prisma: (tx, c) =>
      tx.postMedia.groupBy({
        by: ["postId"],
        where: { postId: { in: [...c.postIds] } },
        _count: true,
      }),
    // Compare the grouped pairs, not the group count: a mirror that dropped the
    // GROUP BY key would still produce the same number of rows on this corpus.
    digest: (fromPrisma, fromMirror) => {
      const pairs = (
        rows: ReadonlyArray<Record<string, unknown>>,
        countKey: "_count" | "n"
      ): string =>
        rows
          .map((r) => `${String(r["postId"])}:${Number(r[countKey])}`)
          .sort()
          .join(",");
      const prismaRows = rowsOfUnknown(fromPrisma);
      return {
        fromPrisma: pairs(prismaRows, "_count"),
        fromMirror: pairs(fromMirror, "n"),
        nonEmpty: prismaRows.length > 0 && fromMirror.length > 0,
      };
    },
  },
  {
    id: "Q13",
    title: "PostMedia — single-parent read",
    sourceSite: "include `media` on PrismaPostRepository.findById (:66)",
    why: "the aggregate-load counterpart of Q10, over a parent that actually HAS media",
    group: "child-read",
    // `mediaPostId`, not `postId`: media is seeded for every third post, so the
    // page's newest post carries none and this read would return nothing on both
    // sides — an identity comparison no mirror error could turn red, over a plan
    // whose `Actual Rows` is 0. The exemption's revisit trigger is measured from
    // this row, and a lookup that finds nothing cannot demonstrate degradation.
    sql: (c) => `SELECT m.id, m."postId", m.url, m.type FROM "PostMedia" m
 WHERE m."postId" = ${lit(c.mediaPostId)}`,
    prisma: (tx, c) =>
      tx.postMedia.findMany({ where: { postId: c.mediaPostId }, select: { id: true } }),
    digest: byIds,
  },
];

interface PlanNode {
  readonly "Node Type"?: string;
  readonly "Index Name"?: string;
  readonly Plans?: readonly PlanNode[];
}

/** Walk the whole tree: a Seq Scan under a Gather or an Aggregate is still a Seq Scan. */
function walkPlan(
  node: PlanNode | undefined,
  acc: { nodeTypes: string[]; indexNames: string[] } = { nodeTypes: [], indexNames: [] }
): { nodeTypes: string[]; indexNames: string[] } {
  if (!node || typeof node !== "object") return acc;
  if (typeof node["Node Type"] === "string") acc.nodeTypes.push(node["Node Type"]);
  if (typeof node["Index Name"] === "string") acc.indexNames.push(node["Index Name"]);
  for (const child of node.Plans ?? []) walkPlan(child, acc);
  return acc;
}

/**
 * @function capture
 * @description Runs one case: the real Prisma call and its SQL mirror inside the
 *   same bound transaction (the fidelity check), then `--runs` independent
 *   `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)` passes, each in its own bound
 *   transaction so no plan reuses a warm snapshot from the previous one.
 * @param client - The app-role measurement client.
 * @param c - The case to measure.
 * @param ctx - Shared tenant/id context.
 * @param runs - How many EXPLAIN passes to take.
 * @returns The capture, including the full plan JSON of the last pass.
 */
async function capture(
  client: PrismaClient,
  c: Case,
  ctx: Ctx,
  runs: number
): Promise<CaptureResult> {
  const sql = c.sql(ctx);

  const { comparison, prismaWallMs } = await withScope(client, ctx.accountId, async (tx) => {
    const started = performance.now();
    const viaPrisma = await c.prisma(tx, ctx);
    const wall = performance.now() - started;
    const viaMirror = await tx.$queryRawUnsafe<Array<Record<string, unknown>>>(sql);
    return {
      comparison: c.digest(viaPrisma, viaMirror),
      prismaWallMs: Number(wall.toFixed(2)),
    };
  });

  const planningMs: number[] = [];
  const executionMs: number[] = [];
  let lastPlan = "";
  let shape = { nodeTypes: [] as string[], indexNames: [] as string[] };

  for (let i = 0; i < runs; i += 1) {
    const raw = await withScope(client, ctx.accountId, async (tx) =>
      tx.$queryRawUnsafe<Array<Record<string, unknown>>>(
        `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ${sql}`
      )
    );
    const value = raw[0]?.["QUERY PLAN"];
    const parsed = (typeof value === "string" ? JSON.parse(value) : value) as Array<{
      Plan?: PlanNode;
      "Planning Time"?: number;
      "Execution Time"?: number;
    }>;
    const root = parsed[0];
    planningMs.push(root?.["Planning Time"] ?? -1);
    executionMs.push(root?.["Execution Time"] ?? -1);
    shape = walkPlan(root?.Plan);
    lastPlan = JSON.stringify(parsed, null, 2);
  }

  return {
    id: c.id,
    title: c.title,
    sourceSite: c.sourceSite,
    why: c.why,
    sql,
    fromPrisma: comparison.fromPrisma,
    fromMirror: comparison.fromMirror,
    fidelity: comparison.fromPrisma === comparison.fromMirror ? "match" : "MISMATCH",
    nonEmpty: comparison.nonEmpty,
    missProbe: c.missProbe === true,
    prismaWallMs,
    planningMs,
    executionMs,
    nodeTypes: shape.nodeTypes,
    indexNames: [...new Set(shape.indexNames)],
    plan: lastPlan,
  };
}

/**
 * @function readShape
 * @description Records the corpus as PostgreSQL sees it — live tuple estimates,
 *   relation size, the index inventory, and the row-security posture per table. A
 *   plan is only comparable against another plan taken over a comparable shape, so
 *   this travels with the capture rather than being described in prose.
 * @param owner - Owner-channel client (catalog reads need no tenant scope).
 * @returns Markdown-ready rows.
 */
async function readShape(owner: PrismaClient): Promise<{
  tables: Array<Record<string, string>>;
  indexes: Array<{ table: string; index: string; definition: string }>;
}> {
  const tables: Array<Record<string, string>> = [];
  for (const table of TRACKED_TABLES) {
    const [row] = await owner.$queryRawUnsafe<
      Array<{
        live: bigint;
        est: number;
        size: string;
        rls: boolean;
        forced: boolean;
        owner: string;
        policies: bigint;
      }>
    >(
      `SELECT (SELECT count(*)::bigint FROM "${table}") AS live,
              c.reltuples::float8 AS est,
              pg_size_pretty(pg_total_relation_size(c.oid)) AS size,
              c.relrowsecurity AS rls,
              c.relforcerowsecurity AS forced,
              c.relowner::regrole::text AS owner,
              (SELECT count(*)::bigint FROM pg_policy p WHERE p.polrelid = c.oid) AS policies
       FROM pg_class c WHERE c.oid = '"${table}"'::regclass`
    );
    tables.push({
      table,
      liveRows: String(row?.live ?? "?"),
      plannerEstimate: String(Math.round(row?.est ?? -1)),
      totalSize: row?.size ?? "?",
      rls: String(row?.rls ?? false),
      forced: String(row?.forced ?? false),
      owner: row?.owner ?? "?",
      policies: String(row?.policies ?? 0),
    });
  }
  const indexes = await owner.$queryRawUnsafe<
    Array<{ table: string; index: string; definition: string }>
  >(
    `SELECT tablename AS table, indexname AS index, indexdef AS definition
     FROM pg_indexes
     WHERE schemaname = 'public'
       AND tablename IN (${TRACKED_TABLES.map(lit).join(", ")})
     ORDER BY tablename, indexname`
  );
  return { tables, indexes };
}

/** Keep a 20-id digest readable in a table cell without hiding a mismatch. */
const truncate = (value: string, max = 120): string =>
  value.length <= max ? value : `${value.slice(0, max)}… (${value.length} chars)`;

/**
 * Render a digest so an EMPTY one stays visible. Two adjacent backticks are a code
 * span containing nothing, so interpolating `""` between them makes the surrounding
 * sentence fuse into what looks like ordinary prose and the missing value cannot be
 * seen at all. An empty digest gets words instead of an empty span.
 */
const renderDigest = (value: string): string =>
  value === "" ? "**(empty — the query matched no rows)**" : `\`${truncate(value)}\``;

/** Render one capture as Markdown. */
function renderCapture(r: CaptureResult): string {
  const ms = (values: readonly number[]): string => values.map((v) => v.toFixed(3)).join(" / ");
  const vacuity = r.missProbe
    ? " This case is a DECLARED miss probe: the empty result is the measured subject, and the" +
      " run fails if it ever starts matching rows."
    : r.nonEmpty
      ? ""
      : " WARNING: both sides matched nothing, so this comparison could not have failed.";
  return [
    `#### ${r.id} — ${r.title}`,
    "",
    `- **Source site**: \`${r.sourceSite}\``,
    `- **Why it is here**: ${r.why}`,
    `- **Mirror fidelity**: ${r.fidelity} — the case's own comparison returned ` +
      `${renderDigest(r.fromPrisma)} from the Prisma call and ${renderDigest(r.fromMirror)} ` +
      `from the mirror.${vacuity}`,
    `- **Prisma call wall time**: ${r.prismaWallMs} ms`,
    `- **Planning time (ms, per run)**: ${ms(r.planningMs)}`,
    `- **Execution time (ms, per run)**: ${ms(r.executionMs)}`,
    `- **Plan nodes**: ${r.nodeTypes.join(" → ") || "(none)"}`,
    `- **Indexes used**: ${r.indexNames.join(", ") || "(none)"}`,
    "",
    "Query text (the mirror; `EXPLAIN` is taken from exactly this):",
    "",
    "```sql",
    r.sql,
    "```",
    "",
    "<details><summary>Full plan (last run)</summary>",
    "",
    "```json",
    r.plan,
    "```",
    "",
    "</details>",
    "",
  ].join("\n");
}

/** Build the whole generated block for one phase. */
function renderBlock(
  phase: "before" | "after",
  opts: Options,
  counts: Record<string, number>,
  shape: Awaited<ReturnType<typeof readShape>>,
  results: readonly CaptureResult[],
  meta: { pgVersion: string; role: string; startedAt: string; wallMs: number }
): string {
  const heading =
    phase === "before" ? "Before — pre-migration capture" : "After — post-migration capture";
  const listings = results.filter(
    (r) => CASES.find((c) => c.id === r.id)?.group === "post-listing"
  );
  const children = results.filter((r) => CASES.find((c) => c.id === r.id)?.group === "child-read");

  return [
    `## ${heading}`,
    "",
    `Captured ${meta.startedAt} in ${(meta.wallMs / 1000).toFixed(1)} s. ` +
      `PostgreSQL: ${meta.pgVersion}. Measuring role: \`${meta.role}\` ` +
      `(non-superuser, non-bypassing), \`app.account_id\` bound to \`${TENANTS[0]}\` for every ` +
      "statement below.",
    "",
    "**Re-run this exact capture:**",
    "",
    "```bash",
    "pnpm db:up",
    "node --import tsx --conditions development --env-file=.env \\",
    `  scripts/rls-ab-measurement.ts --phase ${phase} --projects ${opts.projects} --posts ${opts.posts} --runs ${opts.runs}`,
    "node --import tsx --conditions development --env-file=.env \\",
    "  scripts/rls-ab-measurement.ts --cleanup",
    "# The generator emits unpadded Markdown tables and Prettier aligns them, so the",
    "# capture ALWAYS leaves this file formatting-dirty. Run this or the repo gate fails:",
    "pnpm exec prettier --write docs/reports/TENANT_RLS_AB_MEASUREMENT.md",
    "```",
    "",
    "### Data shape",
    "",
    `Two tenants (\`${TENANTS[0]}\`, \`${TENANTS[1]}\`), ${opts.projects} projects and ${opts.posts} posts each, ` +
      "posts round-robined over the tenant's projects; every 20th post soft-deleted, every 10th " +
      "archived, statuses cycling DRAFT/SCHEDULED/PUBLISHED/FAILED, one `PostContent` per post and " +
      "one `PostMedia` per third post. `VACUUM (ANALYZE)` ran on all five tables before the " +
      "capture, so the visibility map is set and the plan is reproducible across reseeds.",
    "",
    "| Namespaced rows | Count |",
    "| --------------- | ----- |",
    ...["Account", "Project", "Post", "PostContent", "PostMedia"].map(
      (t) => `| \`${t}\` (\`${NS}-%\`) | ${counts[t] ?? 0} |`
    ),
    `| _control: all \`Account\` rows in the database_ | ${counts["__control_all_accounts"] ?? 0} |`,
    "",
    "| Table | Live rows | Planner estimate | Total size | RLS | FORCE | Owner | Policies |",
    "| ----- | --------- | ---------------- | ---------- | --- | ----- | ----- | -------- |",
    ...shape.tables.map(
      (t) =>
        `| \`${t["table"]}\` | ${t["liveRows"]} | ${t["plannerEstimate"]} | ${t["totalSize"]} | ` +
        `${t["rls"]} | ${t["forced"]} | \`${t["owner"]}\` | ${t["policies"]} |`
    ),
    "",
    "<details><summary>Index inventory at capture time</summary>",
    "",
    "| Table | Index | Definition |",
    "| ----- | ----- | ---------- |",
    ...shape.indexes.map(
      (i) => `| \`${i.table}\` | \`${i.index}\` | \`${mdCell(i.definition)}\` |`
    ),
    "",
    "</details>",
    "",
    "### Hot `Post` listing paths",
    "",
    ...listings.map(renderCapture),
    "### `postId`-led child reads — `PostContent` and `PostMedia`",
    "",
    "These two tables are the ones the leg-1 index exemption governs: the design gives them no " +
      "accountId-led index, on the argument that their reads are parent-key-led and equality is " +
      "LEAKPROOF, so the caller's filter still index-scans ahead of the policy qual. The plans " +
      "below are the evidence that argument gets compared against once the columns and policies " +
      "land.",
    "",
    ...children.map(renderCapture),
  ].join("\n");
}

const SCAFFOLD = `# Tenant isolation — Post trio A/B measurement

> Generated by \`scripts/rls-ab-measurement.ts\`. The two capture sections below are
> written between markers; everything outside them is hand-written and survives a re-run.

## Method, and what it does not claim

Plans are captured through a session whose \`current_user\` is \`omnipost_app\` — the
non-superuser, non-bypassing role the application connects as — with \`app.account_id\`
bound exactly as \`PrismaUnitOfWork\` binds it. A plan taken as the owner would carry no
policy qual and would understate every query here.

Each case pairs a REAL Prisma call from a named repository site with a hand-written SQL
mirror, runs both inside the same bound transaction, and compares the returned row
identities before taking any plan. The mirror is what \`EXPLAIN\` sees, because Prisma 7
emits its SQL through a driver adapter this script cannot subscribe to; the fidelity check
is what stops that mirror from drifting into a different question. Honest limits, stated
rather than implied:

- The mirror is **semantically** validated, not textually identical to Prisma's emission.
  Prisma may render a relation predicate as a join where the mirror writes \`EXISTS\`;
  where that distinction matters it is called out in the case's notes.
- Literal values are inlined, so these are **custom** plans. A generic plan for the same
  statement can differ.
- One database, one corpus, one machine. Numbers here are comparable to the other phase of
  the same file and to nothing else.

<!-- BEGIN generated:before -->

## Before — pre-migration capture

_Not captured yet._

<!-- END generated:before -->

<!-- BEGIN generated:after -->

## After — post-migration capture

_Not captured yet._

<!-- END generated:after -->

## Spike — Prisma shared-scalar relation pattern

_Not recorded yet._
`;

/**
 * @function isEnoent
 * @description Narrows a caught value to Node's "path does not exist" system error.
 * @param error - The caught value.
 * @returns True when the value is an `ENOENT` error.
 */
function isEnoent(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}

/**
 * @function writePhase
 * @description Replaces the generated block for one phase inside the report,
 *   creating the report from a scaffold when it does not exist. Marker-scoped so a
 *   re-run of one phase never touches the other phase or the hand-written sections.
 *
 *   Absence is discovered by ATTEMPTING the read and handling `ENOENT`, never by
 *   asking `existsSync` first: a check-then-use pair answers about the file as it
 *   was at the check, and the read that follows can land on a different file (or on
 *   none). The result is byte-identical either way — the old form wrote the scaffold
 *   and read it straight back, which is what starting from the scaffold in memory
 *   produces, minus one write nobody consumed.
 *
 *   The write is atomic: the spliced document goes to a uniquely named temp file in
 *   the SAME directory and is then renamed over the report. A crash or a failed
 *   write can therefore leave the previous report intact or the new one complete,
 *   but never a half-written file — and this report's hand-written sections are not
 *   recoverable from anywhere else.
 * @param path - Report path.
 * @param phase - Which block to replace.
 * @param body - Rendered Markdown for that block.
 * @throws Error when the markers are missing from an existing report.
 */
function writePhase(path: string, phase: "before" | "after", body: string): void {
  mkdirSync(dirname(path), { recursive: true });
  let current: string;
  try {
    current = readFileSync(path, "utf8");
  } catch (error: unknown) {
    if (!isEnoent(error)) throw error;
    current = SCAFFOLD;
  }
  const open = `<!-- BEGIN generated:${phase} -->`;
  const close = `<!-- END generated:${phase} -->`;
  const start = current.indexOf(open);
  const end = current.indexOf(close);
  if (start === -1 || end === -1 || end < start) {
    throw new Error(
      `${path} is missing the ${open} / ${close} markers — refusing to guess where the ` +
        `${phase} capture belongs. Restore the markers or delete the file to regenerate it.`
    );
  }
  const next = `${current.slice(0, start + open.length)}\n\n${body}\n${current.slice(end)}`;
  const temp = `${path}.${randomUUID()}.tmp`;
  let renamed = false;
  try {
    writeFileSync(temp, next, "utf8");
    renameSync(temp, path);
    renamed = true;
  } finally {
    // A failed write or rename leaves the temp file behind next to the report;
    // `force` keeps the cleanup a no-op once the rename has consumed it. No catch
    // here on purpose — whatever went wrong above is the error worth propagating.
    if (!renamed) rmSync(temp, { force: true });
  }
}

/**
 * @function main
 * @description Entry point: resolve channels, optionally seed, capture, write the
 *   report, and report namespace control counts.
 * @returns Resolves when the run has written everything it is going to write.
 */
async function main(): Promise<void> {
  const opts = parseOptions(process.argv.slice(2));
  const owner = createTestPrismaClient(ownerUrl(process.env));
  const app = createMeasurementClient(process.env);

  try {
    if (opts.cleanup) {
      const after = await cleanup(owner);
      console.log("cleanup — namespace counts AFTER delete (read with __system__ bound):");
      console.table(after);
      return;
    }

    let counts: Record<string, number>;
    if (opts.skipSeed) {
      await vacuumAnalyze(owner);
      counts = await namespaceCounts(owner);
      console.log(
        `seed skipped; ${counts["Post"] ?? 0} namespaced posts already present, vacuum-analyzed`
      );
    } else {
      const started = performance.now();
      counts = await seed(owner, opts);
      console.log(
        `seeded + vacuum-analyzed in ${((performance.now() - started) / 1000).toFixed(1)} s`
      );
      console.table(counts);
    }
    if (opts.seedOnly || opts.phase === null) return;

    await assertAppRoleSession(app);
    const versionRows = await app.$queryRawUnsafe<Array<{ version: string }>>(
      `SELECT split_part(version(), ' on ', 1) AS version`
    );
    const version = versionRows[0]?.version ?? "unknown";

    const accountId = TENANTS[0];
    const projectId = `${accountId}-proj-0001`;
    const postIds = await withScope(app, accountId, async (tx) => {
      const rows = await tx.$queryRawUnsafe<Array<{ id: string }>>(
        `SELECT id FROM "Post"
          WHERE "projectId" = ${lit(projectId)} AND "deletedAt" IS NULL
          ORDER BY "createdAt" DESC LIMIT 20`
      );
      return rows.map((r) => r.id);
    });
    if (postIds.length === 0) {
      throw new Error(
        `no live posts under ${projectId}: seed first (drop --skip-seed) — a capture over an ` +
          "empty corpus would report plans nobody can compare against."
      );
    }
    // Which of the page's posts actually carry media, asked rather than derived: the
    // child-read cases must not be pointed at a parent with no children.
    const withMedia = await withScope(app, accountId, async (tx) => {
      const rows = await tx.$queryRawUnsafe<Array<{ postId: string }>>(
        `SELECT DISTINCT m."postId" FROM "PostMedia" m WHERE m."postId" = ANY(${idList(postIds)})`
      );
      return new Set(rows.map((r) => r.postId));
    });
    const mediaPostId = postIds.find((id) => withMedia.has(id));
    if (mediaPostId === undefined) {
      throw new Error(
        `none of the ${postIds.length} posts on ${projectId}'s first page carries a PostMedia ` +
          "row, so the single-parent child read would compare two empty results and pass " +
          "regardless of its mirror. Reseed at a size where the media rule reaches this page."
      );
    }
    const ctx: Ctx = {
      accountId,
      projectId,
      postIds,
      postId: postIds[0] as string,
      mediaPostId,
    };

    const startedAt = new Date().toISOString();
    const t0 = performance.now();
    const results: CaptureResult[] = [];
    for (const c of CASES) {
      const r = await capture(app, c, ctx, opts.runs);
      results.push(r);
      console.log(
        `${r.id} ${r.fidelity === "match" ? "ok" : "FIDELITY MISMATCH"} — ` +
          `exec ${r.executionMs.map((v) => v.toFixed(2)).join("/")} ms — ${r.nodeTypes.join(" → ")}`
      );
    }

    // Both guards run BEFORE anything is written. A report is the only artifact this
    // script produces, so writing one whose own fidelity check then failed would put
    // plans on disk that the run had already refused to stand behind.
    const mismatches = results.filter((r) => r.fidelity !== "match");
    if (mismatches.length > 0) {
      throw new Error(
        `mirror fidelity failed for ${mismatches.map((m) => m.id).join(", ")}: the SQL mirror no ` +
          "longer returns what its repository call returns. Fix the mirror against its source " +
          `site before trusting any plan. NOTHING was written to ${opts.report}.`
      );
    }
    const vacuous = results.filter((r) => !r.nonEmpty && !r.missProbe);
    if (vacuous.length > 0) {
      throw new Error(
        `${vacuous.map((v) => v.id).join(", ")} matched nothing on both sides, so the fidelity ` +
          "check passed without being able to fail and the plan measures an empty lookup. Point " +
          "the case at data that exists, or declare `missProbe: true` if the empty result IS the " +
          `subject. NOTHING was written to ${opts.report}.`
      );
    }
    const unexpectedlyLive = results.filter((r) => r.missProbe && r.nonEmpty);
    if (unexpectedlyLive.length > 0) {
      throw new Error(
        `${unexpectedlyLive.map((v) => v.id).join(", ")} declared \`missProbe\` but matched rows: ` +
          "the corpus has moved out from under the case, so its plan is no longer the empty-bucket " +
          `plan it claims to measure. NOTHING was written to ${opts.report}.`
      );
    }

    const shape = await readShape(owner);
    const body = renderBlock(opts.phase, opts, counts, shape, results, {
      pgVersion: version,
      role: APP_ROLE,
      startedAt,
      wallMs: performance.now() - t0,
    });
    writePhase(opts.report, opts.phase, body);
    console.log(`wrote ${results.length} captures into ${opts.report} (§${opts.phase})`);
  } finally {
    await owner.$disconnect();
    await app.$disconnect();
  }
}

// No top-level `await`: the repo root has no `"type": "module"`, so tsx compiles
// this file as CJS and a top-level await would fail to transform.
main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
