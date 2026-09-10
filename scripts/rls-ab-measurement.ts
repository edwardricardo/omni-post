/**
 * @file rls-ab-measurement.ts
 * @description Standalone evidence harness for the Post-trio tenant-key work: it
 *   seeds a deterministic two-tenant corpus, `VACUUM (ANALYZE)`s it, and captures
 *   `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)` for the hot `Post` listing paths and
 *   the `postId`-led `PostContent` / `PostMedia` child reads, as the non-bypassing
 *   `omnipost_app` role with `app.account_id` bound. `--phase before` writes the
 *   pre-migration capture, `--phase after` the post-migration one, `--policy-ab` the
 *   policy-form comparison and `--index-ab` the four-arm index shortlist, all four into
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
 *   ## The quoted figure is a scan-node median, not a statement time
 *
 *   `Execution Time` is the whole statement: sort, aggregate, join and output work
 *   included, none of which a policy form or an index shape touches. Attributing that
 *   shared overhead to whichever arm ran under it is how a previously published
 *   figure had to be retracted. Every headline number here is therefore the MEDIAN,
 *   across runs, of Σ(`Actual Total Time` × `Actual Loops`) over the plan nodes that
 *   read the case's own measured relation — with the statement median printed beside
 *   it so the gap between the two stays visible rather than being collapsed. The
 *   loops multiplier is load-bearing: `EXPLAIN` reports per-loop time, so a scan on
 *   the inner side of a nested loop otherwise all but vanishes from the arithmetic.
 *
 *   ## What this harness refuses to do
 *
 *   It will not quote a median of nothing (`median()` throws rather than returning a
 *   sentinel that renders as `-1.000 ms`), it will not report one run's plan as the
 *   capture's (each run keeps its own index set, and a disagreement is annotated),
 *   and it will not call a policy restored on the strength of its `qual` alone (the
 *   proof compares all five attributes that define a policy, because re-creating one
 *   with `USING (...)` and no `WITH CHECK` leaves `qual` identical while silently
 *   changing the write-path predicate). Nor will it report an index arm as an
 *   index-only result on the strength of the node's name: every `Index Only Scan` an
 *   arm produces must report `Heap Fetches: 0`, and a non-zero or absent counter aborts
 *   the arm rather than being quoted.
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
  /** Run the A′-vs-B′ policy-form comparison and write its own generated block. */
  readonly policyAb: boolean;
  /**
   * Run the four-arm index comparison and write its own generated block. A SHORTLIST
   * filter, not the authoritative capture: every arm builds its index inside a
   * transaction that is rolled back, so the winner is re-measured against the
   * COMMITTED index before any number here is quoted as the shipped one.
   */
  readonly indexAb: boolean;
  readonly projects: number;
  readonly posts: number;
  readonly runs: number;
  /**
   * How many times the WHOLE arm sweep is repeated. Distinct from {@link runs}, which
   * takes several EXPLAIN passes inside one arm transaction: repetitions re-install the
   * policies and re-measure from scratch, which is the only way to see variation that
   * belongs to the run rather than to the form. Measured on this corpus, a single sweep
   * cannot tell the two candidate forms apart — see §The form verdict.
   */
  readonly repetitions: number;
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
  let policyAb = false;
  let indexAb = false;
  let projects = 100;
  let posts = 10_000;
  let runs = 3;
  let repetitions = 3;
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
      case "--policy-ab":
        policyAb = true;
        break;
      case "--index-ab":
        indexAb = true;
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
      case "--repetitions":
        repetitions = positive(flag, argv[(i += 1)]);
        break;
      case "--out":
        report = argv[(i += 1)] ?? DEFAULT_REPORT;
        break;
      default:
        throw new Error(
          `unknown flag ${String(flag)}. Usage: rls-ab-measurement.ts ` +
            `[--phase before|after] [--policy-ab] [--index-ab] [--cleanup] [--seed-only] ` +
            `[--skip-seed] [--projects N] [--posts N] [--runs N] [--repetitions N] [--out FILE]`
        );
    }
  }

  if (!cleanup && !seedOnly && !policyAb && !indexAb && phase === null) {
    throw new Error(
      "nothing to do: pass --phase before|after, --policy-ab, --index-ab, --seed-only, or --cleanup"
    );
  }
  return {
    phase,
    cleanup,
    skipSeed,
    seedOnly,
    policyAb,
    indexAb,
    projects,
    posts,
    runs,
    repetitions,
    report,
  };
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
  /** The table {@link scanTimeMs} is summed over — the case's own measured relation. */
  readonly measuredTable: string;
  /** Per-run scan-node time on {@link measuredTable}. The headline statistic. */
  readonly scanMs: readonly number[];
  readonly nodeTypes: readonly string[];
  /** Union of the indexes used across ALL runs — see {@link indexNamesPerRun}. */
  readonly indexNames: readonly string[];
  /**
   * The index set of EACH run, kept separately because a capture whose runs chose
   * different indexes is not a capture of one plan. Collapsing them — which the
   * previous form did by overwriting the walk on every iteration, so only the LAST
   * run's set survived — makes that disagreement unreportable.
   */
  readonly indexNamesPerRun: ReadonlyArray<readonly string[]>;
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
  /**
   * The relation whose scan nodes carry this case's headline figure. Declared per
   * case rather than derived from {@link group}, because the child-read group spans
   * two tables and a wrong guess would sum the scan time of a relation the case does
   * not measure — silently, since every plan node reports a time.
   */
  readonly measuredTable: "Post" | "PostContent" | "PostMedia";
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
 *
 * The mirror tracks the source site as it is TODAY, never as it was when a previous
 * phase was captured. That is the only honest option: a mirror kept at the old shape
 * would take a plan for a query the application no longer issues, and the fidelity
 * check could not notice, because both texts select the SAME rows and the check
 * compares row identity. Six sites have moved, in two distinct ways, and the
 * difference decides what a before/after delta may be attributed to:
 *
 * - SCHEMA-MOVED — `Q1`/`Q2` (`buildWhereClause` moved from the relation predicate
 *   `project: { accountId }` to the local `Post.accountId`), `Q5` and `Q8` (both
 *   gained an explicit `accountId` from the required `TenantScope`, having carried no
 *   account predicate at all before). Their emission moved BECAUSE `Post` gained its
 *   own tenant column, so their §Before→§After delta is a delta of TWO changes at
 *   once (schema and query), and the report's §Reading the after capture separates
 *   what is attributable to which.
 * - EMISSION-MOVED — `Q3` and `Q4`. The column already existed when §After was
 *   captured; `listGlobal` simply kept reaching through the relation for a tenant it
 *   could read locally, and the reshape stopped it. Their §After→next-capture delta
 *   is therefore attributable to the QUERY alone, with no schema move mixed in. Their
 *   §Before→next delta still carries both.
 *
 * `Q6`, `Q7` and every child read remain textually identical across every phase.
 *
 * §Before cannot be re-captured on a migrated database, so it stays the historical
 * artifact `--phase before` produced against the pre-migration schema.
 */
const CASES: readonly Case[] = [
  {
    id: "Q1",
    title: "listByProject — page 1 of a project's live posts",
    sourceSite:
      "apps/api/src/infrastructure/repositories/PrismaPostQueryRepository.ts:157 (where built at :191)",
    why:
      "the customer's post list; the most frequently served Post read. " +
      "EMISSION CHANGED with the trio's tenant column: `buildWhereClause` filtered the " +
      "RELATION (`project: { accountId }`) when §Before was captured and filters the LOCAL " +
      "`Post.accountId` now, so this case's query text differs between the two phases",
    group: "post-listing",
    measuredTable: "Post",
    sql: (c) => `SELECT ${POST_COLS} FROM "Post" p
 WHERE p."projectId" = ${lit(c.projectId)}
   AND p."accountId" = ${lit(c.accountId)}
   AND p."deletedAt" IS NULL
   AND p."archivedAt" IS NULL
 ORDER BY p."createdAt" DESC
 LIMIT 20 OFFSET 0`,
    prisma: (tx, c) =>
      tx.post.findMany({
        where: {
          projectId: c.projectId,
          accountId: c.accountId,
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
    sourceSite: "apps/api/src/infrastructure/repositories/PrismaPostQueryRepository.ts:167",
    why:
      "runs on every page load in the same Promise.all as Q1, over the whole project. " +
      "EMISSION CHANGED with the trio's tenant column — it shares Q1's `buildWhereClause`, " +
      "so the same relation-to-local move applies here",
    group: "post-listing",
    measuredTable: "Post",
    sql: (c) => `SELECT count(*) AS n FROM "Post" p
 WHERE p."projectId" = ${lit(c.projectId)}
   AND p."accountId" = ${lit(c.accountId)}
   AND p."deletedAt" IS NULL
   AND p."archivedAt" IS NULL`,
    prisma: (tx, c) =>
      tx.post.count({
        where: {
          projectId: c.projectId,
          accountId: c.accountId,
          deletedAt: null,
          archivedAt: null,
        },
      }),
    digest: byCount,
  },
  {
    id: "Q3",
    title: "listGlobal — the account-wide feed, page 1",
    sourceSite: "apps/api/src/infrastructure/repositories/PrismaPostQueryRepository.ts:458",
    why:
      "the tenant-wide listing the (accountId, projectId) partial index exists to serve. " +
      "EMISSION CHANGED with the reshape: `listGlobal` reached the tenant through the relation " +
      "when §Before AND §After were captured, and filters the LOCAL `Post.accountId` now, so " +
      "this case's query text differs from BOTH committed phases. Unlike Q1/Q2/Q5/Q8 the move " +
      "is not the schema's — the column already existed when §After was captured, so the delta " +
      "against §After is attributable to the query change alone",
    group: "post-listing",
    measuredTable: "Post",
    sql: (c) => `SELECT ${POST_COLS} FROM "Post" p
 WHERE p."accountId" = ${lit(c.accountId)}
   AND p."deletedAt" IS NULL
   AND EXISTS (SELECT 1 FROM "Project" pr
                WHERE pr.id = p."projectId"
                  AND pr."deletedAt" IS NULL)
 ORDER BY p."createdAt" DESC
 LIMIT 20 OFFSET 0`,
    prisma: (tx, c) =>
      tx.post.findMany({
        where: { accountId: c.accountId, deletedAt: null, project: { deletedAt: null } },
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
    sourceSite: "apps/api/src/infrastructure/repositories/PrismaPostQueryRepository.ts:468",
    why:
      "the account-wide count; it shares Q3's `where`, so it walks into Project for LIVENESS " +
      "only now, not for the tenant. EMISSION CHANGED with the reshape, on Q3's terms and for " +
      "Q3's reason",
    group: "post-listing",
    measuredTable: "Post",
    sql: (c) => `SELECT count(*) AS n FROM "Post" p
 WHERE p."accountId" = ${lit(c.accountId)}
   AND p."deletedAt" IS NULL
   AND EXISTS (SELECT 1 FROM "Project" pr
                WHERE pr.id = p."projectId"
                  AND pr."deletedAt" IS NULL)`,
    prisma: (tx, c) =>
      tx.post.count({
        where: { accountId: c.accountId, deletedAt: null, project: { deletedAt: null } },
      }),
    digest: byCount,
  },
  {
    id: "Q5",
    title: "findByProjectId — the command-side aggregate listing",
    sourceSite: "apps/api/src/infrastructure/repositories/PrismaPostRepository.ts:226",
    why:
      "the command-side listing. EMISSION CHANGED: when §Before was captured it carried NO " +
      "account predicate at all (its tenant scope came from the guard and RLS), and the " +
      "required `TenantScope` now puts `accountId` in the `where` explicitly",
    group: "post-listing",
    measuredTable: "Post",
    sql: (c) => `SELECT ${POST_COLS} FROM "Post" p
 WHERE p."projectId" = ${lit(c.projectId)}
   AND p."accountId" = ${lit(c.accountId)}
   AND p."deletedAt" IS NULL
 ORDER BY p."createdAt" DESC
 LIMIT 20 OFFSET 0`,
    prisma: (tx, c) =>
      tx.post.findMany({
        where: { projectId: c.projectId, accountId: c.accountId, deletedAt: null },
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
    sourceSite: "apps/api/src/infrastructure/repositories/PrismaPostRepository.ts:492",
    why:
      "runs before every bulk mutation; the join into Project IS the isolation check the " +
      "method still writes. Emission UNCHANGED between the two phases",
    group: "post-listing",
    measuredTable: "Post",
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
    sourceSite: "apps/api/src/infrastructure/repositories/PrismaPostRepository.ts:527",
    why:
      "the per-request ownership gate; the composite key MAKES this join optional but the " +
      "method still writes it, so its emission is UNCHANGED between the two phases",
    group: "post-listing",
    measuredTable: "Post",
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
    sourceSite:
      "apps/api/src/infrastructure/repositories/PrismaPostRepository.ts:389 (base at :386)",
    why:
      "five counts issued together per project dashboard load. EMISSION CHANGED: the shared " +
      "`base` where carried no account predicate when §Before was captured and carries the " +
      "required scope's `accountId` now",
    group: "post-listing",
    measuredTable: "Post",
    sql: (c) => `SELECT count(*) AS n FROM "Post" p
 WHERE p."projectId" = ${lit(c.projectId)}
   AND p."accountId" = ${lit(c.accountId)}
   AND p."deletedAt" IS NULL
   AND p.status = 'DRAFT'`,
    prisma: (tx, c) =>
      tx.post.count({
        where: {
          projectId: c.projectId,
          accountId: c.accountId,
          deletedAt: null,
          status: "DRAFT",
        },
      }),
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
      "include `contents` on PrismaPostQueryRepository.ts:160 / PrismaPostRepository.ts:229",
    why:
      "shape-1b evidence: the read stays parent-key-led, and the exemption's revisit trigger " +
      "is measured from whether the policy qual moves it off that index",
    group: "child-read",
    measuredTable: "PostContent",
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
    sourceSite: "include `contents` on PrismaPostRepository.findById (:66)",
    why: "the aggregate-load shape; the narrowest postId-led child read there is",
    group: "child-read",
    measuredTable: "PostContent",
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
    sourceSite: "include `media` on PrismaPostRepository.ts:230",
    why: "shape-1b evidence for the second exempted table",
    group: "child-read",
    measuredTable: "PostMedia",
    sql: (c) => `SELECT m.id, m."postId", m.url, m.type FROM "PostMedia" m
 WHERE m."postId" = ANY(${idList(c.postIds)})`,
    prisma: (tx, c) =>
      tx.postMedia.findMany({ where: { postId: { in: [...c.postIds] } }, select: { id: true } }),
    digest: byIds,
  },
  {
    id: "Q12",
    title: "PostMedia — the `_count` aggregate over one listing page",
    sourceSite: "`_count: { select: { media: true } }` on PrismaPostQueryRepository.ts:161",
    why: "the aggregate arm of the same child read; grouping changes the plan, so it is captured apart",
    group: "child-read",
    measuredTable: "PostMedia",
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
    sourceSite: "include `media` on PrismaPostRepository.findById (:67)",
    why: "the aggregate-load counterpart of Q10, over a parent that actually HAS media",
    group: "child-read",
    measuredTable: "PostMedia",
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
  readonly "Relation Name"?: string;
  readonly "Actual Total Time"?: number;
  readonly "Actual Loops"?: number;
  readonly "Heap Fetches"?: number;
  readonly "Subplan Name"?: string;
  readonly Plans?: readonly PlanNode[];
}

/**
 * One plan node reduced to the fields a scan-node statistic is computed from.
 *
 * `Actual Total Time` in an `EXPLAIN ANALYZE` tree is PER LOOP, so the time a node
 * actually spent is `Actual Total Time × Actual Loops`. A node under a nested loop
 * that reports 0.004 ms over 200 loops cost 0.8 ms, and reading the per-loop figure
 * as the node's cost is how a scan on the inner side of a join disappears from the
 * arithmetic.
 */
interface ScanNode {
  readonly nodeType: string;
  readonly relationName: string;
  /** The index this node read, when it read one — names the offender in a failure. */
  readonly indexName: string | null;
  readonly actualTotalTime: number;
  readonly actualLoops: number;
  /** `null` when the node reported none — only index-only scans carry the counter. */
  readonly heapFetches: number | null;
}

/** Everything one walk of a plan tree collects. */
interface WalkedPlan {
  readonly nodeTypes: string[];
  readonly indexNames: string[];
  /** Every node that named a relation, with the numbers a per-table total needs. */
  readonly scanNodes: ScanNode[];
  /** `InitPlan 1` / `SubPlan 2` labels, in tree order — the InitPlan count reads these. */
  readonly subplanNames: string[];
}

const emptyWalk = (): WalkedPlan => ({
  nodeTypes: [],
  indexNames: [],
  scanNodes: [],
  subplanNames: [],
});

/** Walk the whole tree: a Seq Scan under a Gather or an Aggregate is still a Seq Scan. */
function walkPlan(node: PlanNode | undefined, acc: WalkedPlan = emptyWalk()): WalkedPlan {
  if (!node || typeof node !== "object") return acc;
  if (typeof node["Node Type"] === "string") acc.nodeTypes.push(node["Node Type"]);
  if (typeof node["Index Name"] === "string") acc.indexNames.push(node["Index Name"]);
  if (typeof node["Subplan Name"] === "string") acc.subplanNames.push(node["Subplan Name"]);
  if (typeof node["Relation Name"] === "string") {
    acc.scanNodes.push({
      nodeType: node["Node Type"] ?? "(unknown)",
      relationName: node["Relation Name"],
      indexName: typeof node["Index Name"] === "string" ? node["Index Name"] : null,
      actualTotalTime: node["Actual Total Time"] ?? 0,
      actualLoops: node["Actual Loops"] ?? 1,
      heapFetches: typeof node["Heap Fetches"] === "number" ? node["Heap Fetches"] : null,
    });
  }
  for (const child of node.Plans ?? []) walkPlan(child, acc);
  return acc;
}

/**
 * @function scanTimeMs
 * @description Total time the plan spent on nodes reading ONE table: Σ(`Actual Total
 *   Time` × `Actual Loops`) over every node whose `Relation Name` is that table.
 *
 *   This — not `Execution Time` — is what every A/B figure in this report compares.
 *   The statement total also carries sort, aggregate, join and output-projection work
 *   that no policy form and no index shape touches, so quoting it as the effect of a
 *   policy swap attributes shared overhead to whichever arm happened to run under it.
 *   That conflation is what forced the retraction of a previously published 4.198×.
 *
 *   THROWS when no node in the plan names the table. Summing an empty set returns
 *   `0`, and `0` renders as `0.000 ms` — indistinguishable from a relation that was
 *   read for free. In a three-arm comparison that is not a missing number, it is a
 *   WRONG one: the arm whose plan stopped touching the measured relation would post
 *   the lowest median and win the verdict by being unmeasured.
 * @param walked - One walked plan.
 * @param table - The relation the case is measuring.
 * @param context - What is being measured, for the failure message.
 * @returns Milliseconds spent on that table's scan nodes.
 * @throws Error when the plan contains no node reading `table`.
 */
function scanTimeMs(walked: WalkedPlan, table: string, context: string): number {
  const nodes = walked.scanNodes.filter((n) => n.relationName === table);
  if (nodes.length === 0) {
    const seen = [...new Set(walked.scanNodes.map((n) => n.relationName))];
    throw new Error(
      `${context}: no plan node reads "${table}", so its scan-node time is not zero — it is ` +
        `unmeasured. The plan's relations are [${seen.join(", ") || "(none)"}]. Point the case ` +
        "at the relation its plan actually reads; a 0 here would reach the report as `0.000 ms` " +
        "and win any comparison it entered."
    );
  }
  return nodes.reduce((sum, n) => sum + n.actualTotalTime * n.actualLoops, 0);
}

/**
 * The forced-rollback sentinel.
 *
 * An interactive Prisma transaction aborts only by throwing, so every arm ends by
 * throwing this after its last measurement. It is a CLASS rather than a magic message
 * because `error.message === ABORT` cannot tell the deliberate abort from a genuine
 * failure that happens to carry the same text — and a genuine failure swallowed as
 * "the rollback we wanted" is a run that reports measurements it never took.
 */
class DeliberateRollback extends Error {
  constructor(what: string) {
    super(`rls-ab: deliberate rollback of ${what}`);
    this.name = "DeliberateRollback";
  }
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
  const scanMs: number[] = [];
  const indexNamesPerRun: string[][] = [];
  let lastPlan = "";
  let shape = emptyWalk();

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
    // Every run contributes its OWN scan total and its OWN index set. Overwriting a
    // single accumulator per iteration — the previous form — kept only the last run,
    // so a capture whose runs disagreed reported one run's plan as all three.
    scanMs.push(scanTimeMs(shape, c.measuredTable, `case ${c.id}`));
    indexNamesPerRun.push([...new Set(shape.indexNames)]);
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
    measuredTable: c.measuredTable,
    scanMs,
    nodeTypes: shape.nodeTypes,
    indexNames: [...new Set(indexNamesPerRun.flat())],
    indexNamesPerRun,
    plan: lastPlan,
  };
}

/**
 * One policy form under comparison. `using` is the body of the `USING (...)` clause
 * the arm installs on each of {@link TRIO_TABLES}; `null` measures the SHIPPED policy
 * without touching it, which is what makes arm `A′` a real control rather than a
 * re-creation of itself.
 */
interface PolicyArm {
  readonly id: string;
  readonly label: string;
  readonly note: string;
  readonly using: string | null;
}

/**
 * The three arms of the FORM decision: the shipped bare form as the live control, and
 * the two candidate renderings of the same predicate.
 *
 * `B′` / `B′+sys` — the decorrelated set-membership direction quoted from
 * `docs/technical/TENANT_ISOLATION_RESEARCH.md` §4 — are RETIRED here, and the report
 * keeps their measurements as history rather than pretending they were never run. Two
 * reasons, both already measured: `B′` carries no `__system__` escape at all, so it
 * could never ship (every `withSystemContext()` flow would see nothing under it), and
 * the shippable `B′+sys` measured indistinguishable from the shipped form. A retired
 * direction left in the arm list costs a full transaction per run and invites a reader
 * to compare against a form nobody can commit.
 *
 * What is left is the question the migration actually has to answer: given that the
 * GUC read must be hoisted, is it hoisted as TWO wrapped calls (`W`) or as ONE
 * (`S`)? Both are semantically identical to the shipped policy; the plan and the row
 * digests decide between them, and if they tie, the pre-declared tiebreak does.
 *
 * Every arm installs its form on ALL THREE trio tables — see {@link TRIO_TABLES}.
 */
const POLICY_ARMS: readonly PolicyArm[] = [
  {
    id: "A′",
    label: "shipped local-column policy",
    note:
      "the policy `20260909000500_add_rls_post_trio` installed, measured WITHOUT being " +
      "re-created — the control is the live object, not a copy of it",
    using: null,
  },
  {
    id: "W",
    label: "both halves wrapped — the disjunction, each GUC read hoisted",
    note:
      "SEMANTICALLY IDENTICAL to the shipped policy — same column, same `__system__` " +
      "escape — differing only in that each `current_setting()` is wrapped in `(SELECT ...)`, " +
      "which PostgreSQL evaluates once as an InitPlan instead of once per candidate row. " +
      "This arm was measured as `A′+init` in the retired four-arm comparison; the numbers " +
      "under the old name are the same form",
    using:
      `(SELECT current_setting('app.account_id', true)) = '__system__' ` +
      `OR "accountId" = (SELECT current_setting('app.account_id', true))`,
  },
  {
    id: "S",
    label: "single hoisted read, set-membership against the two admissible values",
    note:
      "the same predicate written so the GUC is read ONCE syntactically: a row is visible " +
      "when the bound value is either the `__system__` sentinel or the row's own account. " +
      "Text equality is symmetric, so this is `x = '__system__' OR x = \"accountId\"`, which " +
      'is the shipped `"accountId" = x` order. It is here to answer whether one wrapped ' +
      "read plans better than two — a question the design refused to settle by argument",
    using: `(SELECT current_setting('app.account_id', true)) IN ('__system__', "accountId")`,
  },
];

/**
 * The tables an arm swaps. All three, not `Post` alone.
 *
 * The earlier form swapped `Post` only, and said so for a reason that has since
 * expired: the three AB_SHAPES read no other table, so the children's policies could
 * not have affected them. The 13 CASES do — five of them read `PostContent` or
 * `PostMedia` — so measuring them against a bare child policy under every arm would
 * put five rows in the report whose numbers CANNOT respond to the arm, and a reader
 * comparing them would be reading noise as a result. The trio migration this run
 * decides rewrites all three tables, so the arm now installs what that migration will
 * install. The blast radius is unchanged in kind: the transaction already held an
 * AccessExclusive lock and is still ALWAYS rolled back.
 */
const TRIO_TABLES = ["Post", "PostContent", "PostMedia"] as const;

/**
 * The three shapes the design names for this comparison: point read by id,
 * `projectId`-filtered listing, listing with no selective predicate. NONE of them
 * carries a tenant predicate of its own — the tenant restriction comes from the policy
 * alone, which is the only way the comparison measures the POLICY rather than the query.
 * They are therefore deliberately NOT the application's queries; the application's
 * queries are the 13 cases above.
 */
interface AbShape {
  readonly id: string;
  readonly title: string;
  readonly why: string;
  readonly sql: (ctx: Ctx) => string;
}

const AB_SHAPES: readonly AbShape[] = [
  {
    id: "S1",
    title: "point read by id",
    why: "the narrowest shape there is; the policy is the only tenant restriction",
    sql: (c) => `SELECT ${POST_COLS} FROM "Post" p
 WHERE p.id = ${lit(c.postId)}`,
  },
  {
    id: "S2",
    title: "projectId-filtered listing",
    why: "the customer listing's selectivity, with the tenant left entirely to the policy",
    sql: (c) => `SELECT ${POST_COLS} FROM "Post" p
 WHERE p."projectId" = ${lit(c.projectId)}
   AND p."deletedAt" IS NULL
 ORDER BY p."createdAt" DESC
 LIMIT 20 OFFSET 0`,
  },
  {
    id: "S3",
    title: "listing with no selective predicate",
    why: "the shape where the policy form is the whole plan; the account-wide feed's worst case",
    sql: () => `SELECT ${POST_COLS} FROM "Post" p
 WHERE p."deletedAt" IS NULL
 ORDER BY p."createdAt" DESC
 LIMIT 20 OFFSET 0`,
  },
];

/** The relation every `AB_SHAPES` entry measures — all three read `Post` alone. */
const AB_MEASURED_TABLE = "Post";

/**
 * One SQL statement an arm measures. The arms run TWO populations under one shape of
 * code: the three synthetic {@link AB_SHAPES}, which carry no tenant predicate so the
 * policy is the whole restriction, and the 13 {@link CASES}, which are what the
 * application actually issues.
 *
 * The cases enter as their SQL MIRRORS, not as their Prisma calls. A Prisma call cannot
 * run inside the arm transaction — the arm reaches `omnipost_app` with `SET LOCAL ROLE`
 * on the OWNER connection, and Prisma's client speaks to its own pool — so the mirror is
 * what an arm can execute. That is sound only because the mirror's fidelity to its
 * Prisma call is proven separately and on every capture run by {@link capture}: the
 * standing proof lives there, and this run consumes it rather than restating it.
 */
interface AbProbe {
  readonly id: string;
  readonly kind: "shape" | "case";
  readonly title: string;
  readonly why: string;
  /** The relation whose scan nodes carry this probe's headline figure. */
  readonly measuredTable: string;
  readonly sql: (ctx: Ctx) => string;
  /**
   * How many rows the statement actually FOUND, which is not always how many rows it
   * RETURNED. A scalar `count(*)` returns exactly one row whether it counted a
   * thousand or none, so reading `rows.length` as "matched something" would report
   * every empty aggregate as a live result — and would report the declared miss probe
   * `Q8`, whose empty bucket IS its subject, as having started matching rows.
   */
  readonly matched: (rows: ReadonlyArray<Record<string, unknown>>) => number;
  /** A probe whose empty result is the measured subject — see {@link Case.missProbe}. */
  readonly missProbe: boolean;
}

/**
 * The scalar-count cases are exactly the ones digesting through {@link byCount}: that
 * function reads the single `n` column, which is the same fact this predicate needs, so
 * it is read from there rather than restated as a second list that could drift.
 */
const matchedRows =
  (c: Case) =>
  (rows: ReadonlyArray<Record<string, unknown>>): number =>
    c.digest === byCount ? Number(rows[0]?.["n"] ?? 0) : rows.length;

/**
 * Every probe an arm runs: the three shapes first, then the 13 application cases in
 * catalog order. Built from the two existing lists rather than restated, so a case
 * added to {@link CASES} is measured by the arms without a second edit.
 */
const AB_PROBES: readonly AbProbe[] = [
  ...AB_SHAPES.map((s): AbProbe => ({
    id: s.id,
    kind: "shape",
    title: s.title,
    why: s.why,
    measuredTable: AB_MEASURED_TABLE,
    sql: s.sql,
    matched: (rows) => rows.length,
    missProbe: false,
  })),
  ...CASES.map((c): AbProbe => ({
    id: c.id,
    kind: "case",
    title: c.title,
    why: c.why,
    measuredTable: c.measuredTable,
    sql: c.sql,
    matched: matchedRows(c),
    missProbe: c.missProbe === true,
  })),
];

/**
 * A row-set digest that compares the WHOLE row, not its id.
 *
 * The arms' acceptance criterion is row-equivalence, and an id list cannot see a
 * column whose VALUE changed — nor can it compare the three aggregate cases at all,
 * whose single row is a count and carries no id. Keys are sorted so column order
 * cannot manufacture a difference, `bigint` and `Date` are given stable text (a
 * `count(*)` arrives as `bigint`, which `JSON.stringify` refuses outright), and the
 * rows themselves are sorted so an ordering difference between two arms is not read
 * as a different row SET. Ordering is separately visible in the plan.
 */
const rawDigest = (rows: ReadonlyArray<Record<string, unknown>>): string => {
  const scalar = (v: unknown): string => {
    if (typeof v === "bigint") return `${v.toString()}n`;
    if (v instanceof Date) return v.toISOString();
    if (v instanceof Uint8Array) return `\\x${Buffer.from(v).toString("hex")}`;
    return JSON.stringify(v) ?? "null";
  };
  return rows
    .map((row) =>
      Object.keys(row)
        .sort()
        .map((k) => `${k}=${scalar(row[k])}`)
        .join("|")
    )
    .sort()
    .join(";");
};

/** One (arm, probe) measurement. */
interface AbResult {
  readonly armId: string;
  readonly probeId: string;
  readonly probeKind: "shape" | "case";
  /** The relation {@link scanMs} is summed over — the probe's own measured table. */
  readonly measuredTable: string;
  /** Whole-row digest of what this probe returned under this arm — the equivalence check. */
  readonly digest: string;
  /** Rows the statement RETURNED — one for a scalar aggregate, whatever it counted. */
  readonly rows: number;
  /** Rows the statement FOUND — see {@link AbProbe.matched}. The refusal logic reads this. */
  readonly matched: number;
  /** Carried through so the refusal logic can tell a declared miss from a vacuous one. */
  readonly missProbe: boolean;
  readonly planningMs: readonly number[];
  readonly executionMs: readonly number[];
  /** Per-run scan-node time on {@link measuredTable} — the arm's headline statistic. */
  readonly scanMs: readonly number[];
  readonly nodeTypes: readonly string[];
  /** Union across runs; {@link indexNamesPerRun} keeps them apart. */
  readonly indexNames: readonly string[];
  /** The index set of EACH run — same last-run-only defect as {@link CaptureResult}. */
  readonly indexNamesPerRun: ReadonlyArray<readonly string[]>;
  /**
   * The `InitPlan`/`SubPlan` labels of EACH run, in tree order. Per run for the reason
   * the index sets are: the InitPlan COUNT is what task 2.4 records as a measured
   * claim about the form, and a field assigned from the last walk quotes one run's
   * plan as the arm's — the same defect the per-run index annotation exists to catch.
   */
  readonly subplanNamesPerRun: ReadonlyArray<readonly string[]>;
  readonly plan: string;
}

/**
 * @function readTrioPolicies
 * @description Reads the FIVE attributes that define each `tenant_isolation` policy on
 *   the trio: `(qual, with_check, permissive, cmd, roles)`.
 *
 *   All five, not `qual` alone, because the restore proof is only as strong as the
 *   attributes it compares. Measured on this database: re-creating the policy the way
 *   an arm does — `CREATE POLICY ... USING (...)` with no `WITH CHECK` — leaves `qual`
 *   byte-identical and silently drops `with_check` from a real expression to `null`.
 *   PostgreSQL then derives the write-path check from `USING`, which is a different
 *   policy object with a different write-path predicate, and a `qual`-only proof
 *   reported that swap as "identical". `permissive`, `cmd` and `roles` are here for the
 *   same reason: each is settable at `CREATE POLICY` time and invisible in `qual`.
 * @param owner - Owner-channel client.
 * @returns A stable multi-line rendering, compared as a whole against a later read.
 */
async function readTrioPolicies(owner: PrismaClient): Promise<string> {
  const rows = await owner.$queryRawUnsafe<
    Array<{
      tablename: string;
      qual: string | null;
      with_check: string | null;
      permissive: string | null;
      cmd: string | null;
      roles: string | null;
    }>
  >(
    `SELECT tablename, qual, with_check, permissive, cmd, roles::text AS roles FROM pg_policies
      WHERE schemaname = 'public' AND policyname = 'tenant_isolation'
        AND tablename IN ('Post', 'PostContent', 'PostMedia')
      ORDER BY tablename`
  );
  return rows
    .map((r) =>
      [
        `${r.tablename}:`,
        `  qual       = ${r.qual ?? "(null)"}`,
        `  with_check = ${r.with_check ?? "(null)"}`,
        `  permissive = ${r.permissive ?? "(null)"}`,
        `  cmd        = ${r.cmd ?? "(null)"}`,
        `  roles      = ${r.roles ?? "(null)"}`,
      ].join("\n")
    )
    .join("\n");
}

/**
 * @function runPolicyArm
 * @description Measures every probe — the three synthetic shapes and the 13 application
 *   cases — under ONE policy form, inside a single transaction that is ALWAYS rolled
 *   back.
 *
 *   The swap is transaction-scoped rather than committed because a committed policy swap
 *   on a shared development database is a tenant-isolation change, and one that a crashed
 *   process would leave installed. `DROP POLICY` / `CREATE POLICY` are transactional in
 *   PostgreSQL, so the arm's own `ROLLBACK` is the restore — there is no repair step that
 *   could itself fail. The rollback is forced by throwing a sentinel after the last
 *   measurement, which is the only way an interactive Prisma transaction aborts.
 *
 *   The DDL runs as the owner and the MEASUREMENT runs as `omnipost_app`, reached with
 *   `SET LOCAL ROLE` inside the same transaction — the mechanism
 *   `apps/api/tests/integration/rls-tenant-isolation.test.ts` already uses. A plan taken
 *   as the owner would carry no policy qual at all, which is precisely what this
 *   comparison is about, so the arm asserts its own posture before measuring anything.
 * @param owner - Owner-channel client (policy DDL needs the table owner).
 * @param arm - The policy form to install, or the shipped one when `using` is null.
 * @param ctx - Shared tenant/id context.
 * @param runs - How many EXPLAIN passes per probe.
 * @returns One result per probe.
 * @throws Error when the session posture is wrong, or when the transaction fails for any
 *   reason other than the deliberate rollback.
 */
async function runPolicyArm(
  owner: PrismaClient,
  arm: PolicyArm,
  ctx: Ctx,
  runs: number
): Promise<readonly AbResult[]> {
  const results: AbResult[] = [];

  try {
    await owner.$transaction(
      async (tx) => {
        if (arm.using !== null) {
          for (const table of TRIO_TABLES) {
            await tx.$executeRawUnsafe(`DROP POLICY tenant_isolation ON "${table}"`);
            await tx.$executeRawUnsafe(
              `CREATE POLICY tenant_isolation ON "${table}" USING (${arm.using})`
            );
          }
        }
        await tx.$executeRawUnsafe(`SET LOCAL ROLE ${APP_ROLE}`);
        await tx.$executeRawUnsafe(
          `SELECT set_config('app.account_id', ${lit(ctx.accountId)}, true)`
        );
        const [posture] = await tx.$queryRawUnsafe<Array<{ role: string; su: string }>>(
          `SELECT current_user::text AS role, current_setting('is_superuser') AS su`
        );
        if (!posture || posture.role !== APP_ROLE || posture.su !== "off") {
          throw new Error(
            `arm ${arm.id} could not reach ${APP_ROLE}: got role=${posture?.role ?? "?"}, ` +
              `is_superuser=${posture?.su ?? "?"}. A plan taken as the owner carries no policy ` +
              "qual and would compare nothing."
          );
        }

        for (const probe of AB_PROBES) {
          const sql = probe.sql(ctx);
          const rows = await tx.$queryRawUnsafe<Array<Record<string, unknown>>>(sql);
          const planningMs: number[] = [];
          const executionMs: number[] = [];
          const scanMs: number[] = [];
          const indexNamesPerRun: string[][] = [];
          const subplanNamesPerRun: string[][] = [];
          let lastPlan = "";
          let walked = emptyWalk();
          for (let i = 0; i < runs; i += 1) {
            const raw = await tx.$queryRawUnsafe<Array<Record<string, unknown>>>(
              `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ${sql}`
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
            walked = walkPlan(root?.Plan);
            // Per run, exactly as `capture()` does: the arms carried the SAME
            // last-run-only defect, so fixing only the capture path would have left
            // every policy arm quoting one run's plan as the arm's.
            scanMs.push(scanTimeMs(walked, probe.measuredTable, `arm ${arm.id} ${probe.id}`));
            indexNamesPerRun.push([...new Set(walked.indexNames)]);
            subplanNamesPerRun.push([...walked.subplanNames]);
            lastPlan = JSON.stringify(parsed, null, 2);
          }
          results.push({
            armId: arm.id,
            probeId: probe.id,
            probeKind: probe.kind,
            measuredTable: probe.measuredTable,
            digest: rawDigest(rows),
            rows: rows.length,
            matched: probe.matched(rows),
            missProbe: probe.missProbe,
            planningMs,
            executionMs,
            scanMs,
            nodeTypes: walked.nodeTypes,
            indexNames: [...new Set(indexNamesPerRun.flat())],
            indexNamesPerRun,
            subplanNamesPerRun,
            plan: lastPlan,
          });
        }
        throw new DeliberateRollback(`the ${arm.id} policy swap`);
      },
      { timeout: 600_000, maxWait: 30_000 }
    );
  } catch (error: unknown) {
    if (!(error instanceof DeliberateRollback)) throw error;
  }
  return results;
}

/** One GUC state under which the two candidate forms were compared row by row. */
interface FormEquivalenceRow {
  /** How `app.account_id` was bound for this comparison. */
  readonly gucState: string;
  /** Sample rows admitted by `W`, as a sorted id list. */
  readonly admittedByW: string;
  /** Sample rows admitted by `S`. Must equal {@link admittedByW}. */
  readonly admittedByS: string;
  /**
   * Sample rows where the two expressions differ BEFORE the policy's implicit
   * `NULL → not visible` collapse. Zero here is a stronger statement than equal
   * admission: it says the forms agree as three-valued expressions, not merely that
   * two different NULL/false mixtures happened to hide the same rows.
   */
  readonly threeValuedDivergences: number;
}

/**
 * @function proveFormEquivalence
 * @description Proves `S` admits exactly the rows `W` admits, under every GUC state a
 *   deployed policy can meet: a bound tenant, the `__system__` sentinel, and an UNSET
 *   GUC.
 *
 *   This exists because the 13-case comparison CANNOT see the difference that matters.
 *   Every case runs with `app.account_id` bound to one tenant, and under a bound tenant
 *   an `S` body that had lost its `__system__` member returns exactly the same rows —
 *   the arms agree, the digests match, and a form that silently revoked every
 *   `withSystemContext()` flow's visibility ships with a green run behind it. The
 *   sentinel and the unset states are reachable only here.
 *
 *   The expressions are read from {@link POLICY_ARMS} rather than restated, so this
 *   proves the bodies the arms actually install. They are evaluated over a literal
 *   3-row sample — local tenant, foreign tenant, NULL `accountId` — rather than over
 *   `Post`: the sample is not subject to row security, so the comparison cannot be
 *   quietly filtered by the very policy under test, and it can include the NULL-account
 *   row that no `Post` carries but the `AIPromptTemplate` variant depends on. The
 *   real-data leg for the bound-tenant state is the 13-case digest equality above.
 * @param owner - Owner-channel client.
 * @param ctx - Shared tenant/id context; supplies the local tenant of the sample.
 * @returns One row per GUC state.
 * @throws Error when the forms admit different rows, when they diverge as three-valued
 *   expressions, when an arm body is missing, or when the UNSET state is not actually
 *   unset on the connection the probe got.
 */
async function proveFormEquivalence(
  owner: PrismaClient,
  ctx: Ctx
): Promise<readonly FormEquivalenceRow[]> {
  const bodyOf = (id: string): string => {
    const arm = POLICY_ARMS.find((a) => a.id === id);
    if (!arm || arm.using === null) {
      throw new Error(
        `the equivalence proof needs arm ${id} with a real USING body; the arm list no longer ` +
          "carries one, so the proof would compare something other than what ships."
      );
    }
    return arm.using;
  };
  const w = bodyOf("W");
  const s = bodyOf("S");
  const sample =
    `(VALUES ('r1-local', ${lit(TENANTS[0])}), ('r2-foreign', ${lit(TENANTS[1])}), ` +
    `('r3-null-account', NULL::text))`;

  const states: ReadonlyArray<{ label: string; bind: string | null }> = [
    { label: `bound tenant \`${ctx.accountId}\``, bind: ctx.accountId },
    { label: "`__system__` sentinel", bind: "__system__" },
    { label: "UNSET (no `set_config` at all)", bind: null },
  ];

  const out: FormEquivalenceRow[] = [];
  for (const state of states) {
    const row = await owner.$transaction(async (tx) => {
      if (state.bind !== null) {
        await tx.$executeRawUnsafe(`SELECT set_config('app.account_id', ${lit(state.bind)}, true)`);
      }
      const [result] = await tx.$queryRawUnsafe<
        Array<{
          guc: string | null;
          w_admitted: string | null;
          s_admitted: string | null;
          divergent: bigint;
        }>
      >(
        `WITH sample(id, "accountId") AS ${sample}
         SELECT current_setting('app.account_id', true) AS guc,
                string_agg(id, ',' ORDER BY id) FILTER (WHERE coalesce(${w}, false)) AS w_admitted,
                string_agg(id, ',' ORDER BY id) FILTER (WHERE coalesce(${s}, false)) AS s_admitted,
                count(*) FILTER (WHERE (${w}) IS DISTINCT FROM (${s})) AS divergent
         FROM sample`
      );
      if (!result) throw new Error("the equivalence probe returned no row at all");
      if (state.bind === null && result.guc !== null && result.guc !== "") {
        throw new Error(
          `the UNSET state was not unset: \`app.account_id\` read back as ` +
            `${JSON.stringify(result.guc)} on this connection, so the NULL-propagation leg of ` +
            "the proof would have tested a bound tenant instead. NOTHING was written."
        );
      }
      return result;
    });

    const admittedByW = row.w_admitted ?? "(none)";
    const admittedByS = row.s_admitted ?? "(none)";
    const threeValuedDivergences = Number(row.divergent);
    if (admittedByW !== admittedByS || threeValuedDivergences > 0) {
      throw new Error(
        `the two candidate forms are NOT equivalent under ${state.label}: W admits ` +
          `[${admittedByW}] and S admits [${admittedByS}], with ${threeValuedDivergences} row(s) ` +
          "differing as three-valued expressions. A form that admits different rows is a " +
          "different policy, whatever it measures. NOTHING was written.\n" +
          `  W = ${w}\n  S = ${s}`
      );
    }
    out.push({ gucState: state.label, admittedByW, admittedByS, threeValuedDivergences });
    console.log(
      `equivalence — ${state.label}: W and S both admit [${admittedByW}], ` +
        `${threeValuedDivergences} three-valued divergence(s)`
    );
  }
  return out;
}

/**
 * Merge the same (arm, probe) measurement taken in several repetitions into one result
 * whose series are the CONCATENATION of theirs.
 *
 * Concatenated rather than averaged: the median of the pooled series is a statistic over
 * every sample actually taken, while a median of medians would hide how wide the samples
 * were. The plan, node types and matched count come from the LAST repetition; they are
 * identical across repetitions or the digest gate would already have refused.
 */
function poolRepetitions(perRepetition: ReadonlyArray<readonly AbResult[]>): readonly AbResult[] {
  const first = perRepetition[0];
  if (!first) throw new Error("no repetition was measured, so there is nothing to pool");
  return first.map((seed) => {
    const all = perRepetition.map((rep) => {
      const hit = rep.find((r) => r.armId === seed.armId && r.probeId === seed.probeId);
      if (!hit) {
        throw new Error(
          `a repetition is missing the ${seed.armId}/${seed.probeId} measurement, so the pooled ` +
            "series would be shorter for that pair than for the others and its median would be " +
            "taken over a different number of samples."
        );
      }
      return hit;
    });
    const last = all[all.length - 1] as AbResult;
    return {
      ...last,
      planningMs: all.flatMap((r) => [...r.planningMs]),
      executionMs: all.flatMap((r) => [...r.executionMs]),
      scanMs: all.flatMap((r) => [...r.scanMs]),
      indexNames: [...new Set(all.flatMap((r) => [...r.indexNames]))],
      indexNamesPerRun: all.flatMap((r) => r.indexNamesPerRun),
      subplanNamesPerRun: all.flatMap((r) => r.subplanNamesPerRun),
    };
  });
}

/**
 * What an arm set varies. It changes ONE sentence of the vacuity refusal, and the
 * sentence has to be right: a policy that admits nothing is trivially the fastest,
 * while an index arm cannot change which rows exist at all — an empty probe there
 * means the corpus moved, not that the arm hid anything.
 */
type ArmSubject = "policy form" | "index shape";

const VACUITY_REASON: Readonly<Record<ArmSubject, string>> = {
  "policy form":
    "a policy that hides everything is trivially fast, so its timing is not a comparison. ",
  "index shape":
    "an index arm cannot change which rows exist, so a probe that matches nothing under one " +
    "measures an empty lookup rather than an access path. ",
};

/**
 * @function assertProbeEquivalence
 * @description The refusal gate every arm set passes before a single number is
 *   rendered: no probe may match nothing, no declared miss probe may start matching,
 *   and no two arms may return DIFFERENT rows for the same probe.
 *
 *   It reads EVERY measurement rather than the pooled one. The pooled digest is the
 *   last repetition's, so checking it alone would let an arm that returned different
 *   rows in an earlier sweep pass unnoticed.
 *
 *   One implementation for both arm sets on purpose. The row-equivalence gate is the
 *   acceptance criterion of this whole change, and a second copy of it is a copy that
 *   drifts — the index arms need exactly the check the policy arms already have.
 * @param everyMeasurement - Every (arm, probe) measurement of every repetition.
 * @param subject - What the arms vary, for the vacuity message.
 * @throws Error naming the probe, the arms, and the digests, when any gate fails.
 */
function assertProbeEquivalence(everyMeasurement: readonly AbResult[], subject: ArmSubject): void {
  for (const probe of AB_PROBES) {
    const forProbe = everyMeasurement.filter((r) => r.probeId === probe.id);
    // A declared miss probe (`Q8`) is EXPECTED to match nothing, and it binds both
    // ways: an empty result is the measured subject, and a miss probe that starts
    // matching rows means the corpus moved out from under the case, so its plan is no
    // longer the one it claims to measure. `capture()` refuses on exactly this pair.
    const empty = forProbe.filter((r) => r.matched === 0);
    if (!probe.missProbe && empty.length > 0) {
      throw new Error(
        `${probe.id} matched nothing under ${empty.map((e) => e.armId).join(", ")}: ` +
          VACUITY_REASON[subject] +
          "NOTHING was written."
      );
    }
    const live = forProbe.filter((r) => r.matched > 0);
    if (probe.missProbe && live.length > 0) {
      throw new Error(
        `${probe.id} declared \`missProbe\` but matched rows under ` +
          `${live.map((l) => `${l.armId}=${l.matched}`).join(", ")}: the corpus has moved out ` +
          "from under the probe, so its plan is no longer the empty-bucket plan it claims to " +
          "measure. NOTHING was written."
      );
    }
    // The hard gate. Whole-row digests, so a column whose VALUE moved is caught, not
    // only a row that appeared or vanished. An arm returning different rows is not a
    // faster answer to this question, it is an answer to a different one.
    const digests = new Set(forProbe.map((r) => r.digest));
    if (digests.size > 1) {
      throw new Error(
        `${probe.id} returned DIFFERENT rows across the arms, so their timings answer ` +
          "different questions and cannot be compared: " +
          forProbe.map((r) => `${r.armId}=${r.matched} matched`).join(", ") +
          `. Digests: ${forProbe.map((r) => `${r.armId}=${truncate(r.digest, 80)}`).join(" ¦ ")}` +
          ". NOTHING was written."
      );
    }
  }
}

/**
 * @function runPolicyAb
 * @description Runs every arm, REPEATEDLY, proves the shipped policy survived, and
 *   refuses to report anything if the arms disagree about WHICH ROWS they let through.
 *
 *   The equivalence check is the counterpart of the mirror-fidelity check above and exists
 *   for the same reason: a policy form that returns different rows is not a faster answer
 *   to the same question, it is an answer to a different one, and comparing their timings
 *   would be meaningless. A row count of zero fails for the vacuity reason — a policy that
 *   hides everything is trivially fast.
 *
 *   The whole sweep repeats because a SINGLE sweep was measured to be unable to tell the
 *   two candidate forms apart on this corpus: six consecutive sweeps put `Q4` anywhere
 *   from 111 µs in `S`'s favour to 112 µs in `W`'s, and a rule reading one sweep would
 *   have announced a different winner depending on which sweep it read. Repetitions are
 *   what separate a difference that belongs to the FORM from one that belongs to the RUN.
 * @param owner - Owner-channel client.
 * @param ctx - Shared tenant/id context.
 * @param runs - EXPLAIN passes per (arm, probe) within one sweep.
 * @param repetitions - How many independent sweeps to take.
 * @returns The pooled measurements, the per-repetition measurements the stability
 *   analysis reads, the before/after policy text used as the restore proof, and the
 *   form-equivalence proof.
 * @throws Error when the arms disagree, when a probe matched nothing, or when the shipped
 *   policy did not come back byte-identical.
 */
async function runPolicyAb(
  owner: PrismaClient,
  ctx: Ctx,
  runs: number,
  repetitions: number
): Promise<{
  results: readonly AbResult[];
  perRepetition: ReadonlyArray<readonly AbResult[]>;
  policiesBefore: string;
  policiesAfter: string;
  equivalence: readonly FormEquivalenceRow[];
}> {
  const policiesBefore = await readTrioPolicies(owner);
  const perRepetition: AbResult[][] = [];
  for (let rep = 0; rep < repetitions; rep += 1) {
    const ofRepetition: AbResult[] = [];
    for (const arm of POLICY_ARMS) {
      const armResults = await runPolicyArm(owner, arm, ctx, runs);
      ofRepetition.push(...armResults);
      for (const r of armResults) {
        console.log(
          `rep ${rep + 1}/${repetitions} ${arm.id} ${r.probeId} — matched ${r.matched} — scan ` +
            `${r.scanMs.map((v) => v.toFixed(3)).join("/")} ms — exec ` +
            `${r.executionMs.map((v) => v.toFixed(2)).join("/")} ms — ${r.nodeTypes.join(" → ")}`
        );
      }
    }
    perRepetition.push(ofRepetition);
  }
  const results = poolRepetitions(perRepetition);
  const policiesAfter = await readTrioPolicies(owner);

  if (policiesAfter !== policiesBefore) {
    throw new Error(
      "the shipped tenant_isolation policies did not come back unchanged after the swap — the " +
        "5-tuple (qual, with_check, permissive, cmd, roles) diverged. NOTHING was written. " +
        `BEFORE:\n${policiesBefore}\nAFTER:\n${policiesAfter}`
    );
  }
  // Across every repetition, not only the pooled result.
  assertProbeEquivalence(perRepetition.flat(), "policy form");
  // AFTER the case comparison, deliberately: the ordering is the demonstration. Every
  // case can pass while the two forms disagree about who `__system__` is, and this is
  // the only step that can say so.
  const equivalence = await proveFormEquivalence(owner, ctx);
  return { results, perRepetition, policiesBefore, policiesAfter, equivalence };
}

/**
 * The index whose shape this comparison decides: the partial `(accountId, projectId)`
 * index `Post` carries today. Named once, because the arms DROP it, the restore proof
 * reads it back, and the report quotes it — three places that must not drift apart.
 */
const SHIPPED_POST_INDEX = "Post_accountId_projectId_idx";

/**
 * One candidate index shape. `drop` and `create` are independent so DROP is a
 * first-class arm rather than a special case: it drops and creates nothing, which is
 * the only way "the index buys nothing" can be a MEASURED answer instead of an opinion.
 *
 * The control declares neither, so it measures the LIVE index without re-creating it —
 * the same reason arm `A′` of the form run carries `using: null`. An arm that rebuilt
 * the shipped index would be comparing three fresh indexes against a fourth fresh one,
 * and a freshly built index is denser than one that has taken writes.
 */
interface IndexArm {
  readonly id: string;
  readonly label: string;
  /** The shape, as a reader sees it. `null` for the arm that leaves `Post` alone. */
  readonly shape: string | null;
  readonly note: string;
  readonly drop: boolean;
  readonly create: { readonly name: string; readonly columns: string } | null;
}

/**
 * The four arms the spec names, all partial `WHERE "deletedAt" IS NULL` — the shipped
 * index is partial, and an arm that dropped the predicate would be measuring a
 * different index as well as a different key.
 *
 * Candidate names follow Prisma's own `Table_col_col_idx` convention, so an arm
 * installs the exact object its migration would install rather than a stand-in.
 */
const INDEX_ARMS: readonly IndexArm[] = [
  {
    id: "IX0",
    label: "as-shipped (control)",
    shape: `("accountId", "projectId")`,
    note: "the live index, untouched — the control this comparison is measured against",
    drop: false,
    create: null,
  },
  {
    id: "IX1",
    label: "+createdAt extension",
    shape: `("accountId", "projectId", "createdAt")`,
    note:
      "extends the shipped key with the column every listing orders by, so a plan that " +
      "takes it can also take its ordering — for a `projectId`-bound scan",
    drop: true,
    create: {
      name: "Post_accountId_projectId_createdAt_idx",
      columns: `"accountId", "projectId", "createdAt"`,
    },
  },
  {
    id: "IX2",
    label: "feed shape",
    shape: `("accountId", "createdAt")`,
    note:
      "drops `projectId` from the key so `createdAt` LEADS under an accountId-only bind — " +
      "the account-wide feed's ordering, which the extension cannot supply",
    drop: true,
    create: {
      name: "Post_accountId_createdAt_idx",
      columns: `"accountId", "createdAt"`,
    },
  },
  {
    id: "IX3",
    label: "DROP",
    shape: null,
    note:
      "no accountId-led index at all. A first-class arm: if no candidate measurably beats " +
      "the control, an index nothing selects is write-path and storage cost with no read " +
      "behind it, and dropping is the measured answer rather than a failure of the exercise",
    drop: true,
    create: null,
  },
];

/** One `Index Only Scan` node, reduced to what the precondition assertion needs. */
interface IndexOnlyScanNode {
  readonly relation: string;
  readonly index: string;
  readonly heapFetches: number | null;
}

/** Every `Index Only Scan` node of one walked plan. */
const indexOnlyScans = (walked: WalkedPlan): readonly IndexOnlyScanNode[] =>
  walked.scanNodes
    .filter((n) => n.nodeType === "Index Only Scan")
    .map((n) => ({
      relation: n.relationName,
      index: n.indexName ?? "(unnamed)",
      heapFetches: n.heapFetches,
    }));

/**
 * @function assertHeapFetchesZero
 * @description Aborts the arm unless every `Index Only Scan` it produced fetched ZERO
 *   heap pages.
 *
 *   This is the assertion that converts a premise into evidence. The arms build their
 *   index inside an open transaction, and "an index built inside an open transaction
 *   still yields index-only scans within it" is an INFERENCE with no citation behind
 *   it. An index-only scan is only index-only while the visibility map covers the pages
 *   it reads; `Heap Fetches` is PostgreSQL's own count of the pages where it did not,
 *   so a non-zero value means the plan printed as index-only while paying heap cost —
 *   an in-transaction artifact quoted as an index-only figure.
 *
 *   An ABSENT counter fails the same way. `EXPLAIN (ANALYZE)` reports `Heap Fetches` on
 *   every index-only scan, so its absence means the assertion cannot see its own
 *   subject, and an assertion that cannot see its subject is not one.
 * @param nodes - The index-only scan nodes of one plan.
 * @param context - Arm and probe, for the failure message.
 * @throws Error when any node reports a non-zero or missing `Heap Fetches`.
 */
function assertHeapFetchesZero(nodes: readonly IndexOnlyScanNode[], context: string): void {
  for (const n of nodes) {
    if (n.heapFetches === 0) continue;
    throw new Error(
      n.heapFetches === null
        ? `${context}: an Index Only Scan on \`${n.index}\` (${n.relation}) reported NO ` +
            "`Heap Fetches` counter, so the index-only precondition cannot be checked at all. " +
            "Failing closed: an assertion that cannot see its subject is not an assertion. " +
            "NOTHING was written."
        : `${context}: an Index Only Scan on \`${n.index}\` (${n.relation}) reported ` +
            `\`Heap Fetches: ${n.heapFetches}\`. The arm is ABORTED as unrepresentative rather ` +
            "than reported as an index-only result: the visibility map does not cover the pages " +
            "this scan read, which is what a write inside the arm transaction does, so the " +
            "figure would be an in-transaction artifact quoted as an index-only measurement. " +
            "NOTHING was written."
    );
  }
}

/**
 * @function readPostIndexes
 * @description Reads `Post`'s index inventory as `(indexname, indexdef)` TUPLES — the
 *   restore proof for the index arms.
 *
 *   The definition travels with the name for the reason the policy proof reads five
 *   attributes rather than one: an arm re-creating an index under the SAME name with a
 *   different key would leave a name-only proof reporting an identical inventory.
 * @param owner - Owner-channel client (catalog read, no tenant scope).
 * @returns One `name :: definition` line per index, ordered by name.
 */
async function readPostIndexes(owner: PrismaClient): Promise<string> {
  const rows = await owner.$queryRawUnsafe<Array<{ indexname: string; indexdef: string }>>(
    `SELECT indexname, indexdef FROM pg_indexes
      WHERE schemaname = 'public' AND tablename = 'Post'
      ORDER BY indexname`
  );
  return rows.map((r) => `${r.indexname} :: ${r.indexdef}`).join("\n");
}

/** What one index arm measured, plus the audit of the precondition it had to satisfy. */
interface IndexArmAudit {
  readonly armId: string;
  /** Index-only-scan nodes the `Heap Fetches` assertion actually inspected. */
  readonly inspected: number;
  /**
   * How many of those nodes read the index THIS ARM BUILT, which is the only subject
   * that can convert the in-transaction inference into evidence.
   *
   * Counted separately because the totals do not distinguish them and the difference is
   * the whole claim: an index-only scan on a PRE-EXISTING index proves that index-only
   * scans work, which nobody doubted. Only an index-only scan on an index created inside
   * the open transaction says anything about whether such an index is usable there.
   */
  readonly onArmCreatedIndex: number;
  /** The `relation.index` pairs those nodes read — deduplicated, in first-seen order. */
  readonly onIndexes: readonly string[];
}

/**
 * @function runIndexArm
 * @description Measures every probe under ONE index shape, inside a transaction that is
 *   ALWAYS rolled back.
 *
 *   Same containment as the policy arms and for the same reason: an index swap committed
 *   on a shared database is a change a crashed process would leave installed, while
 *   `DROP INDEX` / `CREATE INDEX` are transactional in PostgreSQL, so the rollback IS
 *   the restore and there is no repair step that could itself fail. `CONCURRENTLY` is
 *   deliberately NOT used — it cannot run inside a transaction, which is exactly the
 *   containment this arm depends on.
 *
 *   The preconditions that make the numbers believable are structural here rather than
 *   documented: `vacuumAnalyze()` runs BEFORE the transaction (the caller's job, since
 *   `VACUUM` cannot run inside one), the arm issues NO DML on the measured table — any
 *   write would clear visibility-map bits and silently destroy index-only eligibility —
 *   and every index-only scan the arm produces is asserted to have fetched zero heap
 *   pages. `ANALYZE` runs in-transaction, in EVERY arm including the control, so the
 *   planner sees statistics refreshed the same way on all four and the control is not
 *   the only arm planning against different bookkeeping.
 * @param owner - Owner-channel client (index DDL needs the table owner).
 * @param arm - The index shape to install.
 * @param ctx - Shared tenant/id context.
 * @param runs - How many EXPLAIN passes per probe.
 * @returns One result per probe, plus the index-only-scan audit.
 * @throws Error on a wrong session posture, a non-zero `Heap Fetches`, or any failure
 *   other than the deliberate rollback.
 */
async function runIndexArm(
  owner: PrismaClient,
  arm: IndexArm,
  ctx: Ctx,
  runs: number
): Promise<{ results: readonly AbResult[]; audit: IndexArmAudit }> {
  const results: AbResult[] = [];
  const onIndexes = new Set<string>();
  let inspected = 0;
  let onArmCreatedIndex = 0;

  try {
    await owner.$transaction(
      async (tx) => {
        await tx.$executeRawUnsafe(`SET LOCAL lock_timeout = '5s'`);
        // Plain `DROP INDEX`, never `IF EXISTS`: an absent shipped index is state drift,
        // and an arm that shrugged at it would measure a control that is not the control.
        if (arm.drop) await tx.$executeRawUnsafe(`DROP INDEX "${SHIPPED_POST_INDEX}"`);
        if (arm.create !== null) {
          await tx.$executeRawUnsafe(
            `CREATE INDEX "${arm.create.name}" ON "Post" (${arm.create.columns}) ` +
              `WHERE "deletedAt" IS NULL`
          );
        }
        await tx.$executeRawUnsafe(`ANALYZE "Post"`);
        await tx.$executeRawUnsafe(`SET LOCAL ROLE ${APP_ROLE}`);
        await tx.$executeRawUnsafe(
          `SELECT set_config('app.account_id', ${lit(ctx.accountId)}, true)`
        );
        const [posture] = await tx.$queryRawUnsafe<Array<{ role: string; su: string }>>(
          `SELECT current_user::text AS role, current_setting('is_superuser') AS su`
        );
        if (!posture || posture.role !== APP_ROLE || posture.su !== "off") {
          throw new Error(
            `arm ${arm.id} could not reach ${APP_ROLE}: got role=${posture?.role ?? "?"}, ` +
              `is_superuser=${posture?.su ?? "?"}. A plan taken as the owner carries no policy ` +
              "qual, so it would compare index shapes under a restriction the application " +
              "never runs without."
          );
        }

        for (const probe of AB_PROBES) {
          const sql = probe.sql(ctx);
          const rows = await tx.$queryRawUnsafe<Array<Record<string, unknown>>>(sql);
          const planningMs: number[] = [];
          const executionMs: number[] = [];
          const scanMs: number[] = [];
          const indexNamesPerRun: string[][] = [];
          const subplanNamesPerRun: string[][] = [];
          let lastPlan = "";
          let walked = emptyWalk();
          for (let i = 0; i < runs; i += 1) {
            const raw = await tx.$queryRawUnsafe<Array<Record<string, unknown>>>(
              `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ${sql}`
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
            walked = walkPlan(root?.Plan);
            const ios = indexOnlyScans(walked);
            assertHeapFetchesZero(ios, `arm ${arm.id} ${probe.id} run ${i + 1}`);
            inspected += ios.length;
            for (const n of ios) {
              onIndexes.add(`${n.relation}.${n.index}`);
              if (arm.create !== null && n.index === arm.create.name) onArmCreatedIndex += 1;
            }
            scanMs.push(scanTimeMs(walked, probe.measuredTable, `arm ${arm.id} ${probe.id}`));
            indexNamesPerRun.push([...new Set(walked.indexNames)]);
            subplanNamesPerRun.push([...walked.subplanNames]);
            lastPlan = JSON.stringify(parsed, null, 2);
          }
          results.push({
            armId: arm.id,
            probeId: probe.id,
            probeKind: probe.kind,
            measuredTable: probe.measuredTable,
            digest: rawDigest(rows),
            rows: rows.length,
            matched: probe.matched(rows),
            missProbe: probe.missProbe,
            planningMs,
            executionMs,
            scanMs,
            nodeTypes: walked.nodeTypes,
            indexNames: [...new Set(indexNamesPerRun.flat())],
            indexNamesPerRun,
            subplanNamesPerRun,
            plan: lastPlan,
          });
        }
        throw new DeliberateRollback(`the ${arm.id} index swap`);
      },
      { timeout: 600_000, maxWait: 30_000 }
    );
  } catch (error: unknown) {
    if (!(error instanceof DeliberateRollback)) throw error;
  }
  return {
    results,
    audit: { armId: arm.id, inspected, onArmCreatedIndex, onIndexes: [...onIndexes] },
  };
}

/**
 * @function runIndexAb
 * @description Runs every index arm, REPEATEDLY, proves `Post`'s index inventory came
 *   back unchanged, and refuses to report anything if the arms disagree about WHICH ROWS
 *   they returned.
 *
 *   Row-equivalence is a stronger claim here than it looks: an index cannot change which
 *   rows a query is entitled to, so a divergence would mean the corpus moved under the
 *   run rather than that one shape is "wrong" — and either way the timings would be
 *   answering different questions.
 *
 *   The sweep repeats for the reason the form run's does. A single sweep of the form
 *   comparison was measured putting one probe anywhere from 111 µs in one arm's favour
 *   to 112 µs in the other's, and nothing about that instability is specific to
 *   policies: it is this corpus and this instrument.
 * @param owner - Owner-channel client.
 * @param ctx - Shared tenant/id context.
 * @param runs - EXPLAIN passes per (arm, probe) within one sweep.
 * @param repetitions - How many independent sweeps to take.
 * @returns The pooled measurements, the per-sweep measurements the stability analysis
 *   reads, the before/after index inventory, and the per-arm index-only-scan audit.
 * @throws Error when the arms disagree, a probe matched nothing, an index-only scan
 *   fetched heap pages, or `Post`'s index inventory did not come back identical.
 */
async function runIndexAb(
  owner: PrismaClient,
  ctx: Ctx,
  runs: number,
  repetitions: number
): Promise<{
  results: readonly AbResult[];
  perRepetition: ReadonlyArray<readonly AbResult[]>;
  indexesBefore: string;
  indexesAfter: string;
  audits: readonly IndexArmAudit[];
}> {
  const indexesBefore = await readPostIndexes(owner);
  const perRepetition: AbResult[][] = [];
  const audits: IndexArmAudit[] = [];
  for (let rep = 0; rep < repetitions; rep += 1) {
    const ofRepetition: AbResult[] = [];
    for (const arm of INDEX_ARMS) {
      const { results: armResults, audit } = await runIndexArm(owner, arm, ctx, runs);
      ofRepetition.push(...armResults);
      audits.push(audit);
      for (const r of armResults) {
        console.log(
          `rep ${rep + 1}/${repetitions} ${arm.id} ${r.probeId} — matched ${r.matched} — scan ` +
            `${r.scanMs.map((v) => v.toFixed(3)).join("/")} ms — ${r.indexNames.join(", ") || "(no index)"}`
        );
      }
    }
    perRepetition.push(ofRepetition);
  }
  const results = poolRepetitions(perRepetition);
  const indexesAfter = await readPostIndexes(owner);

  if (indexesAfter !== indexesBefore) {
    throw new Error(
      "`Post`'s index inventory did not come back unchanged after the arms — the " +
        "(indexname, indexdef) tuples diverged, so an arm's DDL escaped its rollback. " +
        `NOTHING was written.\nBEFORE:\n${indexesBefore}\nAFTER:\n${indexesAfter}`
    );
  }
  assertProbeEquivalence(perRepetition.flat(), "index shape");
  return { results, perRepetition, indexesBefore, indexesAfter, audits };
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
    `- **Scan-node time on \`${r.measuredTable}\` (ms, per run)**: ${ms(r.scanMs)} — ` +
      "Σ(`Actual Total Time` × `Actual Loops`) over the nodes reading that relation",
    `- **Medians over ${r.executionMs.length} run(s)**: scan-node ` +
      `**${median(r.scanMs).toFixed(3)} ms** · statement-time ${median(r.executionMs).toFixed(3)} ms. ` +
      "The scan-node figure is the one to compare across phases: the statement total also " +
      "carries sort, aggregate, join and output work that neither the policy form nor the " +
      "index shape touches.",
    `- **Plan nodes**: ${r.nodeTypes.join(" → ") || "(none)"}`,
    `- **Indexes used (union across runs)**: ${r.indexNames.join(", ") || "(none)"}` +
      indexAnnotation(r.indexNamesPerRun),
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
      "capture, so the visibility map is set and index-only-scan costing reflects a settled " +
      "heap. That is ALL it buys, and the previous wording claimed more: it said the plan was " +
      '"reproducible across reseeds", which this artifact\'s own data disproves — `Q4` selects ' +
      "a different index between runs of ONE capture, on a 0.11 % planner tie that nothing here " +
      "repairs. Where that happens the case carries a per-run index annotation.",
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

/**
 * Median of a run series — the statistic every table in this report quotes.
 *
 * THROWS on an empty series instead of returning a sentinel. The previous form
 * returned `-1`, and every caller renders through `toFixed(3)`, so a missing
 * measurement reached the report as `-1.000 ms` — a plausible-looking number in a
 * column of real ones, with nothing to distinguish it from a fast query. An absent
 * measurement is a defect in the run, so it fails the run.
 *
 * At an EVEN length there is no middle element and this returns the UPPER of the two
 * middle values rather than their mean, which biases the statistic high by half a gap.
 * Keep `--runs` ODD (the default is 3) and the choice never arises.
 */
const median = (values: readonly number[]): number => {
  if (values.length === 0) {
    throw new Error(
      "median() received an empty series, so there is no measurement to quote. Returning a " +
        "sentinel here would reach the report as `-1.000 ms` and read as a real number."
    );
  }
  return [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)] as number;
};

/**
 * Renders the per-run index sets when the runs DISAGREED, and nothing when they agreed.
 *
 * An annotation, never a failure: the underlying planner tie (`Q4`'s 0.11 % margin) is
 * repaired by nothing in this change, and `Q4` is read for its delta, never for its
 * plan. A guard here would turn the harness red for reporting something true.
 */
const indexAnnotation = (perRun: ReadonlyArray<readonly string[]>): string => {
  const rendered = perRun.map((set) => set.join(", ") || "(none)");
  if (new Set(rendered).size <= 1) return "";
  return (
    " ANNOTATION — the runs of this capture did NOT agree on the index: " +
    rendered.map((set, i) => `run ${i + 1} [${set}]`).join(", ") +
    ". Recorded rather than failed; the plan is a planner tie, not a defect in the query."
  );
};

/**
 * The `InitPlan`/`SubPlan` labels an arm produced, with the runs' disagreement made
 * visible instead of collapsed. Same rule as {@link indexAnnotation}: annotate, never
 * fail — a plan that moved between runs is a fact about the planner, and the InitPlan
 * COUNT is a claim about the FORM, so a run-to-run disagreement must be readable rather
 * than silently resolved to whichever run happened to be last.
 */
const subplanSummary = (perRun: ReadonlyArray<readonly string[]>): string => {
  const rendered = perRun.map((set) => set.join(", ") || "(none)");
  const first = rendered[0] ?? "(none)";
  if (new Set(rendered).size <= 1) return first;
  return `${first} — ANNOTATION, the runs DISAGREED: ${rendered
    .map((set, i) => `run ${i + 1} [${set}]`)
    .join(", ")}`;
};

/** How many `InitPlan` labels an arm's FIRST run carried. */
const initPlanCount = (perRun: ReadonlyArray<readonly string[]>): number =>
  (perRun[0] ?? []).filter((name) => name.startsWith("InitPlan")).length;

/**
 * The adjudication band, from `specs/rls-policy-form/spec.md`: a case that moves by no
 * more than 6 µs, OR by less than 1 % of its own baseline, is inside it.
 *
 * The two limits are an OR rather than an AND on purpose, and the alternative is worse
 * in both directions: an absolute-only band calls every sub-millisecond case
 * out-of-band the moment it wobbles by a few microseconds, and a relative-only band
 * calls a 7 µs case a 100 % regression. Neither reading is "the number got worse"; both
 * are the resolution of the measurement.
 */
const BAND_ABSOLUTE_MS = 0.006;
const BAND_RELATIVE = 0.01;

/** One in-band/out-of-band decision between two medians. */
interface BandVerdict {
  /** `candidate − baseline`, in ms. Negative means the candidate is faster. */
  readonly deltaMs: number;
  /** The same delta relative to the baseline. `null` when the baseline is 0. */
  readonly deltaRatio: number | null;
  readonly inBand: boolean;
}

/**
 * @function classifyBand
 * @description Decides whether a move between two medians is inside the adjudication
 *   band. Every out-of-band pair owes the report a named adjudication; an artifact that
 *   reports only the favourable cases does not satisfy the spec.
 * @param baselineMs - The median being moved from.
 * @param candidateMs - The median being moved to.
 * @returns The signed delta, its ratio, and whether it is inside the band.
 */
function classifyBand(baselineMs: number, candidateMs: number): BandVerdict {
  const deltaMs = candidateMs - baselineMs;
  const deltaRatio = baselineMs === 0 ? null : deltaMs / baselineMs;
  const inBand =
    Math.abs(deltaMs) <= BAND_ABSOLUTE_MS ||
    (deltaRatio !== null && Math.abs(deltaRatio) < BAND_RELATIVE);
  return { deltaMs, deltaRatio, inBand };
}

/**
 * @function signStability
 * @description Whether every sweep agreed on the SIGN of a per-sweep delta series.
 *
 *   A SINGLE sweep is never stable, and that is the whole point of the guard rather than
 *   an edge case tidied away. With one sweep there is exactly one sign, so "every sweep
 *   agreed" is vacuously true and the rule that exists to separate a property of the
 *   subject from a property of the run silently stops separating anything — while still
 *   printing `sign-stable` beside a verdict. Measured on this corpus: six consecutive
 *   single sweeps of the form comparison announced three different winners, and each of
 *   them would have been declared sign-stable by a one-sweep reading.
 *
 *   A zero delta is unstable too: it has no sign to agree about, and a series that
 *   crosses zero is the flip this test is looking for.
 * @param deltaPerSweep - The signed delta of each sweep, in sweep order.
 * @returns True only when there are at least two sweeps and all agree on a non-zero sign.
 */
const signStability = (deltaPerSweep: readonly number[]): boolean => {
  if (deltaPerSweep.length < 2) return false;
  const signs = new Set(deltaPerSweep.map((d) => Math.sign(d)));
  return signs.size === 1 && !signs.has(0);
};

/** One probe's W-vs-S comparison, plus the control it improves on. */
interface FormComparison {
  readonly probeId: string;
  readonly kind: "shape" | "case";
  readonly measuredTable: string;
  readonly controlMs: number;
  readonly wMs: number;
  readonly sMs: number;
  /** W as the baseline, S as the candidate — the tiebreak is stated in that direction. */
  readonly band: BandVerdict;
  /** The signed `S − W` delta of EACH repetition, in ms, in repetition order. */
  readonly deltaPerRepetition: readonly number[];
  /**
   * Whether every repetition agreed on the SIGN of the delta. A probe whose sign flips
   * between repetitions has not measured a property of the form: it has measured the
   * run. Out-of-band AND sign-stable is what makes a difference attributable.
   */
  readonly signStable: boolean;
  /** Which form is faster, and only when the difference is attributable. */
  readonly faster: "W" | "S" | "tie";
}

/** What the decision run concluded, and on what basis. */
interface FormVerdict {
  readonly comparisons: readonly FormComparison[];
  readonly outOfBand: readonly FormComparison[];
  readonly winner: "W" | "S" | "UNDECIDED";
  readonly basis: string;
}

/**
 * @function decideForm
 * @description Applies the decision rule to the measured medians. The verdict is a
 *   MEASUREMENT OUTPUT: it is computed here from the scan-node medians and the
 *   pre-declared tiebreak, never typed into the report by hand.
 *
 *   The rule, in the order it is applied:
 *   1. A probe's difference is ATTRIBUTABLE to the form only when it is outside the band
 *      on the pooled medians AND every repetition agreed on its sign. Out-of-band alone
 *      is not enough, and this is measured rather than assumed: six consecutive sweeps
 *      of this same comparison put `Q4` anywhere from 111 µs in `S`'s favour to 112 µs
 *      in `W`'s, so a one-sweep rule announced `S`, `W` and `UNDECIDED` depending only on
 *      which sweep it happened to read.
 *   2. If no difference is attributable, the two forms are indistinguishable on this
 *      corpus and the PRE-DECLARED tiebreak decides: **`W` wins** — it is the textually
 *      minimal delta from the shipped form, it keeps the 58-policy sweep a pure "wrap
 *      each `current_setting` call" transform identical for the standard and variant
 *      policies, and it keeps the gate matcher one adjacency rule.
 *   3. If attributable differences exist and all favour the same form, that form wins on
 *      measurement and the tiebreak never applies.
 *   4. If they disagree, this returns `UNDECIDED` rather than picking. A split decision
 *      is a finding for a human, and a rule that resolves it silently would be inventing
 *      a verdict.
 * @param results - The POOLED (arm, probe) measurements.
 * @param perRepetition - The same measurements per sweep, for the sign-stability test.
 * @returns The comparisons, the attributable subset, and the winner.
 * @throws Error when an arm is missing a probe the others measured.
 */
function decideForm(
  results: readonly AbResult[],
  perRepetition: ReadonlyArray<readonly AbResult[]>
): FormVerdict {
  const medianOf = (from: readonly AbResult[], armId: string, probeId: string): number => {
    const hit = from.find((r) => r.armId === armId && r.probeId === probeId);
    if (!hit) {
      throw new Error(
        `arm ${armId} has no measurement for ${probeId}, so the forms cannot be compared on it. ` +
          "A verdict computed over a partial arm is a verdict about whichever probes happened " +
          "to run."
      );
    }
    return median(hit.scanMs);
  };

  const comparisons = AB_PROBES.map((probe): FormComparison => {
    const controlMs = medianOf(results, "A′", probe.id);
    const wMs = medianOf(results, "W", probe.id);
    const sMs = medianOf(results, "S", probe.id);
    const band = classifyBand(wMs, sMs);
    const deltaPerRepetition = perRepetition.map(
      (rep) => medianOf(rep, "S", probe.id) - medianOf(rep, "W", probe.id)
    );
    const signStable = signStability(deltaPerRepetition);
    const attributable = !band.inBand && signStable;
    return {
      probeId: probe.id,
      kind: probe.kind,
      measuredTable: probe.measuredTable,
      controlMs,
      wMs,
      sMs,
      band,
      deltaPerRepetition,
      signStable,
      faster: attributable ? (sMs < wMs ? "S" : "W") : "tie",
    };
  });

  const attributable = comparisons.filter((c) => c.faster !== "tie");
  if (attributable.length === 0) {
    const unstable = comparisons.filter((c) => !c.band.inBand && !c.signStable);
    return {
      comparisons,
      outOfBand: comparisons.filter((c) => !c.band.inBand),
      winner: "W",
      basis:
        "no probe's difference is attributable to the form — " +
        (unstable.length === 0
          ? "every W-vs-S move is inside the band"
          : `${unstable.length} probe(s) moved outside the band but their sign FLIPPED between ` +
            `repetitions (${unstable.map((c) => c.probeId).join(", ")}), which measures the run ` +
            "rather than the form") +
        ", so the two forms are indistinguishable on this corpus and the PRE-DECLARED " +
        "tiebreak decides",
    };
  }
  const favoured = new Set(attributable.map((c) => c.faster));
  if (favoured.size === 1) {
    const winner = attributable[0]?.faster === "S" ? "S" : "W";
    return {
      comparisons,
      outOfBand: attributable,
      winner,
      basis:
        `${attributable.length} probe(s) are outside the band AND sign-stable across every ` +
        `repetition, and all of them favour \`${winner}\`, so the measurement decides and the ` +
        "tiebreak does not apply",
    };
  }
  return {
    comparisons,
    outOfBand: attributable,
    winner: "UNDECIDED",
    basis:
      `${attributable.length} probe(s) are outside the band and sign-stable, and they DISAGREE ` +
      "about which form is faster. This run does not pick a winner: a split is a finding for a " +
      "human, and a rule that resolved it silently would be inventing a verdict",
  };
}

/**
 * Render the form verdict: the per-probe W-vs-S table, the InitPlan counts, the
 * equivalence proof, and the decision with the rule that produced it.
 */
function renderFormVerdict(
  measured: Awaited<ReturnType<typeof runPolicyAb>>,
  runs: number,
  repetitions: number
): string {
  const verdict = decideForm(measured.results, measured.perRepetition);
  const us = (ms: number): string => `${(ms * 1000).toFixed(1)} µs`;
  const pct = (ratio: number | null): string =>
    ratio === null ? "n/a" : `${(ratio * 100).toFixed(2)} %`;
  const armIds = POLICY_ARMS.map((a) => a.id);

  // The verdict names the body it just chose, READ FROM THE ARM LIST rather than
  // retyped beside it — the same rule the rest of this renderer follows. A reader
  // who reaches the verdict should not have to scroll to §The arms to learn which
  // predicate won. The refusal below exists because interpolating a null `using`
  // would print `USING (null)`: a winner with no installable body is a broken
  // arm list, not a formatting detail.
  const winnerBody =
    verdict.winner === "UNDECIDED"
      ? null
      : (POLICY_ARMS.find((a) => a.id === verdict.winner)?.using ?? null);
  if (verdict.winner !== "UNDECIDED" && winnerBody === null) {
    throw new Error(
      `the verdict names \`${verdict.winner}\` but that arm declares no \`USING\` body, so the ` +
        "report cannot state the predicate it just chose. An arm that can win must carry the " +
        "text a migration would install."
    );
  }

  const initPlanRows = armIds.map((armId) => {
    const forArm = measured.results.filter((r) => r.armId === armId);
    const counts = [...new Set(forArm.map((r) => initPlanCount(r.subplanNamesPerRun)))].sort();
    const s3 = forArm.find((r) => r.probeId === "S3");
    return (
      `| \`${armId}\` | ${counts.join(" / ")} | ` +
      `${s3 ? subplanSummary(s3.subplanNamesPerRun) : "(no S3 measurement)"} |`
    );
  });

  return [
    "### The form verdict",
    "",
    "**Computed from the medians above, not typed in.** The rule is applied in code " +
      "(`decideForm`), so this section cannot say one thing while the table says another.",
    "",
    `- **The band**: a move is INSIDE it when it is ≤ ${BAND_ABSOLUTE_MS * 1000} µs **or** ` +
      `< ${BAND_RELATIVE * 100} % of its own baseline. The two limits are an OR: an ` +
      "absolute-only band calls every sub-millisecond probe out-of-band for a few " +
      "microseconds of wobble, and a relative-only band calls a 7 µs probe a 100 % " +
      "regression.",
    `- **The statistic**: the SCAN-NODE median over the POOLED ${runs * repetitions} ` +
      `sample(s) — ${runs} EXPLAIN run(s) × ${repetitions} independent sweep(s) — per probe, ` +
      "on that probe's own measured relation. Statement medians are in the tables above and " +
      "are NOT interchangeable with these — the ratio between the two differs by case, which " +
      "is why a band drawn on one cannot be read against the other.",
    "- **The direction**: `W` is the baseline and `S` is the candidate, because the " +
      "pre-declared tiebreak is stated in that direction.",
    "- **Attributability**: a difference counts as the FORM's only when it is out of band " +
      "AND every sweep agreed on its sign. This is not a precaution, it is a measured " +
      "necessity: six consecutive sweeps of this comparison put `Q4` anywhere from 111 µs in " +
      "`S`'s favour to 112 µs in `W`'s, so a rule reading one sweep announced `S`, `W` or " +
      "`UNDECIDED` depending only on which sweep it read.",
    "- **The tiebreak**: pre-declared in task 2.7 BEFORE this run — when no difference is " +
      "attributable, `W` wins, because it is the textually minimal delta from the shipped " +
      'form, it keeps the 58-policy sweep a pure "wrap each `current_setting` call" transform ' +
      "identical for the standard and the `AIPromptTemplate` variant, and it keeps the " +
      "form-uniformity gate matcher one adjacency rule.",
    "",
    "| Probe | Kind | Relation | `A′` control | `W` | `S` | S − W | S − W (%) | In band | Sign stable | Attributable to |",
    "| ----- | ---- | -------- | ------------ | --- | --- | ----- | --------- | ------- | ----------- | --------------- |",
    ...verdict.comparisons.map(
      (c) =>
        `| \`${c.probeId}\` | ${c.kind} | \`${c.measuredTable}\` | ${c.controlMs.toFixed(3)} | ` +
        `${c.wMs.toFixed(3)} | ${c.sMs.toFixed(3)} | ${us(c.band.deltaMs)} | ` +
        `${pct(c.band.deltaRatio)} | ${c.band.inBand ? "yes" : "**NO**"} | ` +
        `${c.signStable ? "yes" : "**no**"} | ` +
        `${c.faster === "tie" ? "—" : `\`${c.faster}\``} |`
    ),
    "",
    "Medians in ms. `S − W` is positive when `S` is SLOWER.",
    "",
    "#### Per-sweep spread — why one sweep cannot decide this",
    "",
    `The signed \`S − W\` delta of each of the ${repetitions} sweeps, in µs. A probe whose ` +
      "sign changes down its row has not measured a property of the form.",
    "",
    `| Probe | ${measured.perRepetition.map((_, i) => `sweep ${i + 1}`).join(" | ")} | Sign stable |`,
    `| ----- | ${measured.perRepetition.map(() => "-------").join(" | ")} | ----------- |`,
    ...verdict.comparisons.map(
      (c) =>
        `| \`${c.probeId}\` | ${c.deltaPerRepetition.map((d) => us(d)).join(" | ")} | ` +
        `${c.signStable ? "yes" : "**no**"} |`
    ),
    "",
    "#### InitPlan count per arm — read from the plan, not assumed",
    "",
    "`design.md` refused to assume whether `W`'s two wrapped reads share one InitPlan and " +
      "asked the plan to answer. It answers here, per arm, from the `Subplan Name` labels " +
      "the walk collects. The labels are kept PER RUN, so a run-to-run disagreement is " +
      "annotated rather than resolved to whichever run was last.",
    "",
    "| Arm | InitPlan count(s) across probes | `S3` labels |",
    "| --- | ------------------------------- | ----------- |",
    ...initPlanRows,
    "",
    "#### Semantic equivalence of the two forms",
    "",
    "The 13-case comparison runs with `app.account_id` bound to ONE tenant, and under a " +
      "bound tenant an `S` body that had lost its `__system__` member returns exactly the " +
      "same rows — every digest matches and a form that revoked every " +
      "`withSystemContext()` flow's visibility would ship with a green run behind it. These " +
      "three states are the ones the case run cannot reach. The expressions are read from " +
      "the arm list, so this proves the bodies the arms install; the sample is a literal " +
      "3-row set (local tenant, foreign tenant, NULL account) rather than `Post`, so the " +
      "comparison cannot be filtered by the policy under test and can include the " +
      "NULL-account row that the `AIPromptTemplate` variant depends on.",
    "",
    "| GUC state | Admitted by `W` | Admitted by `S` | Three-valued divergences |",
    "| --------- | --------------- | --------------- | ------------------------ |",
    ...measured.equivalence.map(
      (e) =>
        `| ${e.gucState} | \`${e.admittedByW}\` | \`${e.admittedByS}\` | ` +
        `${e.threeValuedDivergences} |`
    ),
    "",
    "#### Verdict",
    "",
    verdict.winner === "UNDECIDED"
      ? `**UNDECIDED.** ${verdict.basis}.`
      : `**\`${verdict.winner}\` wins.** ${verdict.basis}. The winning body, read from the arm ` +
        `list rather than retyped beside it: \`USING (${winnerBody})\` — so the verdict names ` +
        "the exact predicate the trio migration installs, without a lookup.",
    "",
    ...(() => {
      const outOfBand = verdict.comparisons.filter((c) => !c.band.inBand);
      if (outOfBand.length === 0) {
        return [
          "No probe moved outside the band on the pooled medians, so the W-vs-S comparison " +
            "owes no out-of-band adjudication. The `A′`→winner improvements are a DIFFERENT " +
            "comparison and are adjudicated in the reading below — they are the point of the " +
            "change, not a regression.",
        ];
      }
      return [
        `**${outOfBand.length} out-of-band probe(s)** on the pooled medians, each owed a ` +
          "named adjudication:",
        "",
        ...outOfBand.map(
          (c) =>
            `- \`${c.probeId}\` — ${us(c.band.deltaMs)} (${pct(c.band.deltaRatio)}), sign ` +
            `${c.signStable ? "STABLE across every sweep, so it is attributable to the form" : "FLIPPED between sweeps, so it measures the run and not the form: **accepted as noise**, and it is the reason the tiebreak governs rather than this number"}.`
        ),
      ];
    })(),
    "",
  ].join("\n");
}

/**
 * Build the generated block for the policy-form comparison. One table per probe group
 * (arms are the rows, so the comparison reads across a line), then the full plan of
 * every (arm, shape) pair — the prose that follows the block is written from THOSE
 * trees, never from the summary line, because a node sequence flattened to a string
 * loses which side of a join each scan sits on.
 */
function renderPolicyAbBlock(
  opts: Options,
  measured: Awaited<ReturnType<typeof runPolicyAb>>,
  meta: { pgVersion: string; startedAt: string; wallMs: number }
): string {
  const armById = (id: string): PolicyArm =>
    POLICY_ARMS.find((a) => a.id === id) ?? (POLICY_ARMS[0] as PolicyArm);
  const out: string[] = [
    "## Policy form decision run — `A′` vs `W` vs `S`",
    "",
    `Captured ${meta.startedAt} in ${(meta.wallMs / 1000).toFixed(1)} s. ` +
      `PostgreSQL: ${meta.pgVersion}. Every arm installs its policy on all three trio tables ` +
      `(${TRIO_TABLES.map((t) => `\`${t}\``).join(", ")}) inside ONE transaction, reaches ` +
      "`omnipost_app` with `SET LOCAL ROLE` in that same transaction, binds " +
      `\`app.account_id\` to \`${TENANTS[0]}\`, measures, and ROLLS BACK. Nothing is ` +
      "committed; the restore is the rollback itself, and the shipped policies are re-read " +
      "afterwards and compared.",
    "",
    "Each arm measures **16 probes**: the three synthetic shapes below, which carry no " +
      "tenant predicate of their own so the policy is the whole restriction, and the **13 " +
      "application cases** of the capture sections — entered as their SQL mirrors, because a " +
      "Prisma call cannot run inside the arm's owner transaction. The mirrors' fidelity to " +
      "their repository calls is proven on every capture run, and this run consumes that " +
      "proof rather than restating it.",
    "",
    "The arm swaps ALL THREE trio tables. An earlier form swapped `Post` alone, which was " +
      "sound while only the three shapes ran; five of the 13 cases read `PostContent` or " +
      "`PostMedia`, and measuring those against a bare child policy under every arm would " +
      "put five rows in this report whose numbers cannot respond to the arm at all.",
    "",
    "**Re-run this exact comparison:**",
    "",
    "```bash",
    "node --import tsx --conditions development --env-file=.env \\",
    `  scripts/rls-ab-measurement.ts --policy-ab --projects ${opts.projects} --posts ${opts.posts} --runs ${opts.runs} --repetitions ${opts.repetitions}`,
    "node --import tsx --conditions development --env-file=.env \\",
    "  scripts/rls-ab-measurement.ts --cleanup",
    "pnpm exec prettier --write docs/reports/TENANT_RLS_AB_MEASUREMENT.md",
    "```",
    "",
    "### The arms",
    "",
    "| Arm | Form | `USING (...)` | Note |",
    "| --- | ---- | ------------- | ---- |",
    ...POLICY_ARMS.map(
      (a) =>
        `| \`${a.id}\` | ${a.label} | ${a.using === null ? "_(the shipped policy, untouched)_" : `\`${mdCell(a.using)}\``} | ${a.note} |`
    ),
    "",
    "### Restore proof",
    "",
    "The three `tenant_isolation` policies, read from `pg_policies` before the first arm and " +
      "again after the last one. The comparison is over the FIVE attributes that define a " +
      "policy — `(qual, with_check, permissive, cmd, roles)` — because an arm re-creates with " +
      "`USING (...)` alone, which leaves `qual` byte-identical while dropping `with_check` to " +
      "`null`; a `qual`-only proof passes on exactly that swap:",
    "",
    "```text",
    measured.policiesBefore,
    "```",
    "",
    measured.policiesAfter === measured.policiesBefore
      ? "The two reads are identical, which is what makes the swap provably transaction-scoped."
      : "THE TWO READS DIFFER — see the run's own failure, which refuses to write this block.",
    "",
  ];

  out.push(renderFormVerdict(measured, opts.runs, opts.repetitions), "");

  out.push(
    "### The 13 application cases, per arm",
    "",
    "Scan-node medians on each case's own measured relation, over " +
      `${opts.runs} run(s). Node types and index sets travel with them, so a plan that MOVED ` +
      "between arms is visible here rather than only in a full tree: a form that changes the " +
      "chosen index is a finding even when the rows are identical. Full plan JSON is not " +
      "repeated for the cases — the shipped form's own trees are in the capture sections " +
      "above, and what the arm comparison needs from them is the summary plus the medians.",
    "",
    "| Case | Relation | Arm | Matched | Scan-node median (ms) | Statement median (ms) | Plan nodes | Indexes | InitPlan/SubPlan |",
    "| ---- | -------- | --- | ------- | --------------------- | --------------------- | ---------- | ------- | ---------------- |"
  );
  for (const probe of AB_PROBES.filter((p) => p.kind === "case")) {
    for (const r of measured.results.filter((x) => x.probeId === probe.id)) {
      out.push(
        `| \`${r.probeId}\` | \`${r.measuredTable}\` | \`${r.armId}\` | ${r.matched} | ` +
          `**${median(r.scanMs).toFixed(3)}** | ${median(r.executionMs).toFixed(3)} | ` +
          `${r.nodeTypes.join(" → ") || "(none)"} | ${r.indexNames.join(", ") || "(none)"} | ` +
          `${mdCell(subplanSummary(r.subplanNamesPerRun))} |`
      );
    }
  }
  out.push(
    "",
    "`Q8` is a declared miss probe: it counts zero on this corpus under every arm, and the " +
      "run refuses to write if it ever starts matching rows.",
    "",
    "### The three synthetic shapes, per arm",
    ""
  );

  for (const shape of AB_SHAPES) {
    const rows = measured.results.filter((r) => r.probeId === shape.id);
    const first = rows[0];
    out.push(
      `#### ${shape.id} — ${shape.title}`,
      "",
      `- **Why it is here**: ${shape.why}`,
      `- **Rows returned (identical under every arm)**: ${first?.rows ?? 0}`,
      "",
      "```sql",
      shape.sql({
        accountId: TENANTS[0],
        projectId: `${TENANTS[0]}-proj-0001`,
        postIds: [],
        postId: "<the page's newest post>",
        mediaPostId: "<unused here>",
      }),
      "```",
      "",
      `| Arm | Plan nodes | Indexes | InitPlan/SubPlan | Planning median (ms) | **Scan-node median (ms)** | Statement median (ms) | Scan per run (ms) |`,
      "| --- | ---------- | ------- | ---------------- | -------------------- | ------------------------- | --------------------- | ----------------- |",
      ...rows.map(
        (r) =>
          `| \`${r.armId}\` | ${r.nodeTypes.join(" → ") || "(none)"} | ` +
          `${r.indexNames.join(", ") || "(none)"} | ` +
          `${mdCell(subplanSummary(r.subplanNamesPerRun))} | ` +
          `${median(r.planningMs).toFixed(3)} | **${median(r.scanMs).toFixed(3)}** | ` +
          `${median(r.executionMs).toFixed(3)} | ${r.scanMs.map((v) => v.toFixed(3)).join(" / ")} |`
      ),
      "",
      `Medians are over ${first?.scanMs.length ?? 0} run(s). The **scan-node median** is the ` +
        `figure this comparison is about: Σ(\`Actual Total Time\` × \`Actual Loops\`) over the ` +
        `nodes reading \`${AB_MEASURED_TABLE}\`, which is where a policy qual is evaluated. The ` +
        "statement median is kept beside it because the two are NOT interchangeable, and " +
        "quoting the statement total as the effect of a policy swap is what forced the " +
        "retraction of a previously published figure.",
      ...rows
        .map((r) => indexAnnotation(r.indexNamesPerRun).trim())
        .filter((note) => note !== "")
        .map((note) => `- ${note}`),
      ""
    );
    for (const r of rows) {
      out.push(
        `<details><summary>Full plan (last run) — ${shape.id} under \`${r.armId}\` (${armById(r.armId).label})</summary>`,
        "",
        "```json",
        r.plan,
        "```",
        "",
        "</details>",
        ""
      );
    }
  }
  return out.join("\n");
}

/**
 * The PRE-DECLARED preference order, stated here BEFORE the run rather than chosen
 * after seeing which arm came out ahead. It applies ONLY when no arm has an
 * attributable improvement — that is, when the measurement cannot separate the shapes
 * on read cost — and the reasoning is a write-path one, which is the only thing left to
 * decide on when the reads are indistinguishable:
 *
 * 1. **`IX3` DROP** — every index is paid for on every INSERT and every UPDATE of the
 *    indexed columns, and `Post` is one of this schema's most written tables. An index
 *    no measured read needs is that cost with nothing behind it.
 * 2. **`IX0` as-shipped** — second because keeping it needs no migration at all, so if
 *    dropping is inadmissible the cheapest remaining outcome is to change nothing.
 * 3. **`IX2` `(accountId, createdAt)`** — a two-column replacement, narrower than (4).
 * 4. **`IX1` `(accountId, projectId, createdAt)`** — last: the widest key, so the most
 *    expensive to maintain, and it would be adopted for an ordering benefit the
 *    measurement did not find.
 *
 * An arm is skipped here if it is INADMISSIBLE — see {@link decideIndex}. The order is
 * a tiebreak, never an override of a measured regression.
 */
const INDEX_PREFERENCE_ORDER: readonly string[] = ["IX3", "IX0", "IX2", "IX1"];

/** One probe's candidate-vs-control comparison under one index arm. */
interface IndexComparison {
  readonly probeId: string;
  readonly kind: "shape" | "case";
  readonly measuredTable: string;
  readonly controlMs: number;
  readonly candidateMs: number;
  /** Control as the baseline, the candidate arm as the candidate. */
  readonly band: BandVerdict;
  /** The signed `candidate − control` delta of EACH sweep, in ms, in sweep order. */
  readonly deltaPerRepetition: readonly number[];
  readonly signStable: boolean;
  /** Attributable to the SHAPE only when out of band AND sign-stable. */
  readonly effect: "improves" | "regresses" | "unattributable";
}

/** One candidate arm's whole standing against the control. */
interface IndexArmScore {
  readonly armId: string;
  readonly comparisons: readonly IndexComparison[];
  readonly caseImprovements: readonly string[];
  readonly caseRegressions: readonly string[];
  readonly shapeImprovements: readonly string[];
  readonly shapeRegressions: readonly string[];
  /** Zero attributable regressions on an APPLICATION case — see {@link decideIndex}. */
  readonly admissible: boolean;
}

/** What the shortlist run concluded, and on what basis. */
interface IndexVerdict {
  readonly scores: readonly IndexArmScore[];
  readonly winner: string;
  readonly basis: string;
  /** Probes whose CONTROL-arm plans actually selected the shipped index. */
  readonly shippedIndexUsedBy: readonly string[];
}

/**
 * @function decideIndex
 * @description Applies the shortlist decision rule to the measured medians. The verdict
 *   is a MEASUREMENT OUTPUT: computed here from the scan-node medians and the
 *   pre-declared preference order, never typed into the report by hand.
 *
 *   The rule, in the order it is applied:
 *   1. **Attributability**, the same bar the form run uses and for the same measured
 *      reason: a candidate's difference from the control counts as the SHAPE's only when
 *      it is outside the band on the pooled medians AND every sweep agreed on its sign.
 *      A sign that flips between sweeps has measured the run, not the index.
 *   2. **Admissibility**: an arm is admissible when it has ZERO attributable regressions
 *      on an APPLICATION case. A regression on a synthetic shape is recorded and
 *      adjudicated but does not disqualify — the shapes deliberately omit the predicates
 *      the application always supplies, and the form run already measured that exact
 *      trap (`S2` regressed 3.5× under both candidate policy forms while its real
 *      counterparts `Q1` and `Q5` got faster). That carve-out is stated here BEFORE the
 *      run so it cannot be reached for afterwards to excuse an inconvenient number.
 *   3. **Measurement wins when it can**: among admissible arms with at least one
 *      attributable case improvement, the winner is the one with the most; ties go to
 *      the fewest attributable shape regressions, then to the pre-declared order.
 *   4. **The tiebreak**, only when no arm has an attributable case improvement: the
 *      shapes are indistinguishable on read cost and {@link INDEX_PREFERENCE_ORDER}
 *      decides among the admissible arms. The control is always admissible, so this
 *      branch always has an answer and never invents one.
 * @param results - The POOLED (arm, probe) measurements.
 * @param perRepetition - The same measurements per sweep, for the sign-stability test.
 * @returns Per-arm scores, the winner, the basis, and the shipped index's measured use.
 * @throws Error when an arm is missing a probe the others measured.
 */
function decideIndex(
  results: readonly AbResult[],
  perRepetition: ReadonlyArray<readonly AbResult[]>
): IndexVerdict {
  const controlId = (INDEX_ARMS[0] as IndexArm).id;
  const medianOf = (from: readonly AbResult[], armId: string, probeId: string): number => {
    const hit = from.find((r) => r.armId === armId && r.probeId === probeId);
    if (!hit) {
      throw new Error(
        `arm ${armId} has no measurement for ${probeId}, so the shapes cannot be compared on ` +
          "it. A verdict computed over a partial arm is a verdict about whichever probes " +
          "happened to run."
      );
    }
    return median(hit.scanMs);
  };

  const scores = INDEX_ARMS.filter((a) => a.id !== controlId).map((arm): IndexArmScore => {
    const comparisons = AB_PROBES.map((probe): IndexComparison => {
      const controlMs = medianOf(results, controlId, probe.id);
      const candidateMs = medianOf(results, arm.id, probe.id);
      const band = classifyBand(controlMs, candidateMs);
      const deltaPerRepetition = perRepetition.map(
        (rep) => medianOf(rep, arm.id, probe.id) - medianOf(rep, controlId, probe.id)
      );
      const signStable = signStability(deltaPerRepetition);
      const attributable = !band.inBand && signStable;
      return {
        probeId: probe.id,
        kind: probe.kind,
        measuredTable: probe.measuredTable,
        controlMs,
        candidateMs,
        band,
        deltaPerRepetition,
        signStable,
        effect: attributable
          ? candidateMs < controlMs
            ? "improves"
            : "regresses"
          : "unattributable",
      };
    });
    const pick = (kind: "shape" | "case", effect: "improves" | "regresses"): string[] =>
      comparisons.filter((c) => c.kind === kind && c.effect === effect).map((c) => c.probeId);
    const caseRegressions = pick("case", "regresses");
    return {
      armId: arm.id,
      comparisons,
      caseImprovements: pick("case", "improves"),
      caseRegressions,
      shapeImprovements: pick("shape", "improves"),
      shapeRegressions: pick("shape", "regresses"),
      admissible: caseRegressions.length === 0,
    };
  });

  const shippedIndexUsedBy = results
    .filter((r) => r.armId === controlId && r.indexNamesPerRun.flat().includes(SHIPPED_POST_INDEX))
    .map((r) => r.probeId);

  const rank = (armId: string): number => {
    const at = INDEX_PREFERENCE_ORDER.indexOf(armId);
    return at === -1 ? INDEX_PREFERENCE_ORDER.length : at;
  };
  const contenders = scores.filter((s) => s.admissible && s.caseImprovements.length > 0);
  if (contenders.length > 0) {
    // The pre-declared preference order is reserved for the no-improvement path below.
    // Carrying it as a hidden third sort key HERE would let it break a tie on the very
    // path whose emitted basis asserts it does not apply — so a residual tie on both
    // declared measurement keys REFUSES instead of deciding.
    const sorted = [...contenders].sort(
      (a, b) =>
        b.caseImprovements.length - a.caseImprovements.length ||
        a.shapeRegressions.length - b.shapeRegressions.length
    );
    const best = sorted[0] as IndexArmScore;
    const runnerUp = sorted[1];
    if (
      runnerUp !== undefined &&
      runnerUp.caseImprovements.length === best.caseImprovements.length &&
      runnerUp.shapeRegressions.length === best.shapeRegressions.length
    ) {
      throw new Error(
        `index verdict REFUSED: arms ${best.armId} and ${runnerUp.armId} tie on both declared ` +
          "measurement keys (attributable case improvements, shape regressions). The declared " +
          "rule reserves the preference order for the no-improvement path, so deciding here " +
          "would contradict the emitted basis. Record the ambiguity and re-run with a corpus " +
          "that separates the arms."
      );
    }
    return {
      scores,
      shippedIndexUsedBy,
      winner: best.armId,
      basis:
        `\`${best.armId}\` improves ${best.caseImprovements.length} application case(s) ` +
        `(${best.caseImprovements.join(", ")}) by an amount attributable to the SHAPE — outside ` +
        "the band AND sign-stable across every sweep — with no attributable case regression, so " +
        "the measurement decides and the pre-declared preference order does not apply",
    };
  }
  const inadmissible = scores.filter((s) => !s.admissible);
  const admissibleIds = [controlId, ...scores.filter((s) => s.admissible).map((s) => s.armId)];
  const winner = [...admissibleIds].sort((a, b) => rank(a) - rank(b))[0] as string;
  return {
    scores,
    shippedIndexUsedBy,
    winner,
    basis:
      "no arm improves an application case by an amount attributable to the shape — " +
      (inadmissible.length === 0
        ? "every candidate's moves are inside the band or sign-unstable"
        : `${inadmissible.map((s) => `\`${s.armId}\` regresses ${s.caseRegressions.join(", ")}`).join("; ")}, ` +
          "and the remaining candidates' moves are inside the band or sign-unstable") +
      ` — so the shapes are indistinguishable on read cost and the PRE-DECLARED preference ` +
      `order decides among the admissible arms (${admissibleIds.join(" > ")} ranked as ` +
      `${INDEX_PREFERENCE_ORDER.join(" > ")})`,
  };
}

/**
 * Render the index shortlist: the preconditions with their audit, the restore proof, the
 * decision rule, the computed verdict, and the per-probe deltas against the control.
 */
function renderIndexAbBlock(
  opts: Options,
  measured: Awaited<ReturnType<typeof runIndexAb>>,
  meta: { pgVersion: string; startedAt: string; wallMs: number }
): string {
  const verdict = decideIndex(measured.results, measured.perRepetition);
  const us = (ms: number): string => `${(ms * 1000).toFixed(1)} µs`;
  const pct = (ratio: number | null): string =>
    ratio === null ? "n/a" : `${(ratio * 100).toFixed(2)} %`;
  const armById = (id: string): IndexArm =>
    INDEX_ARMS.find((a) => a.id === id) ?? (INDEX_ARMS[0] as IndexArm);
  const controlId = (INDEX_ARMS[0] as IndexArm).id;
  const inspectedTotal = measured.audits.reduce((sum, a) => sum + a.inspected, 0);
  const ownIndexTotal = measured.audits.reduce((sum, a) => sum + a.onArmCreatedIndex, 0);
  const winnerArm = armById(verdict.winner);

  const out: string[] = [
    "## Index shortlist run — four arms over `Post`",
    "",
    `Captured ${meta.startedAt} in ${(meta.wallMs / 1000).toFixed(1)} s. ` +
      `PostgreSQL: ${meta.pgVersion}. Each arm installs ONE index shape inside a single ` +
      "transaction, reaches `omnipost_app` with `SET LOCAL ROLE` in that same transaction, " +
      `binds \`app.account_id\` to \`${TENANTS[0]}\`, measures every probe, and ROLLS BACK. ` +
      "Nothing is committed: the rollback IS the restore, so there is no repair step that " +
      "could itself fail, and `Post`'s index inventory is re-read afterwards and compared as " +
      "`(indexname, indexdef)` tuples.",
    "",
    "**This is a SHORTLIST FILTER, not the authoritative capture.** Every number below was " +
      "taken against an index that exists only inside an open transaction. The winner is " +
      "committed by its own migration and re-measured against the COMMITTED index before any " +
      "figure here is quoted as the shipped one.",
    "",
    "**Re-run this exact comparison:**",
    "",
    "```bash",
    "node --import tsx --conditions development --env-file=.env \\",
    `  scripts/rls-ab-measurement.ts --index-ab --projects ${opts.projects} --posts ${opts.posts} --runs ${opts.runs} --repetitions ${opts.repetitions}`,
    "node --import tsx --conditions development --env-file=.env \\",
    "  scripts/rls-ab-measurement.ts --cleanup",
    "pnpm exec prettier --write docs/reports/TENANT_RLS_AB_MEASUREMENT.md",
    "```",
    "",
    "### The arms",
    "",
    "| Arm | Shape | Key | Note |",
    "| --- | ----- | --- | ---- |",
    ...INDEX_ARMS.map(
      (a) =>
        `| \`${a.id}\` | ${a.label} | ${a.shape === null ? "_(no accountId-led index)_" : `\`${mdCell(a.shape)}\``} | ${a.note} |`
    ),
    "",
    `Every candidate is partial \`WHERE "deletedAt" IS NULL\`, because the shipped index is ` +
      "— an arm that dropped the predicate would be measuring a different index as well as a " +
      "different key. Candidate names follow Prisma's own `Table_col_col_idx` convention, so " +
      "each arm installs the exact object its migration would install. `CONCURRENTLY` is " +
      "never used: it cannot run inside a transaction, which is the containment these arms " +
      "depend on.",
    "",
    "### The preconditions that make an in-transaction index believable",
    "",
    "An index built inside an open transaction still yielding index-only scans WITHIN that " +
      "transaction is an inference, not a citation. These three make it evidence instead:",
    "",
    `1. **\`VACUUM (ANALYZE)\` runs BEFORE the arm transaction** — it cannot run inside one — ` +
      "so the visibility map is settled before any arm opens.",
    "2. **No DML on the measured table inside the arm.** Any write clears visibility-map bits " +
      "for the pages it touches and silently destroys index-only eligibility. The arms issue " +
      "DDL, `ANALYZE`, `SET LOCAL ROLE`, `set_config`, the probe statements and their " +
      "`EXPLAIN`s — nothing else.",
    "3. **`Heap Fetches: 0` is ASSERTED on every `Index Only Scan` node**, and a non-zero or " +
      "ABSENT counter aborts the arm rather than being reported as an index-only result.",
    "",
    `\`ANALYZE "Post"\` runs in-transaction in EVERY arm, the control included, so the planner ` +
      "sees statistics refreshed the same way on all four rather than the control alone " +
      "planning against different bookkeeping.",
    "",
    "**What the assertion actually inspected**, so its scope is a measured fact rather than a " +
      "claim — an assertion with no subjects is a gate that cannot fail, and this run says " +
      "outright how many it had. The last column is the one that matters for the inference: " +
      "an index-only scan on a PRE-EXISTING index proves that index-only scans work, which " +
      "nobody doubted; only one on an index built INSIDE the arm transaction says anything " +
      "about whether such an index is usable there.",
    "",
    "| Arm | Index-only-scan nodes inspected | On | Of those, on the index THIS ARM BUILT |",
    "| --- | ------------------------------- | -- | ------------------------------------- |",
    ...INDEX_ARMS.map((arm) => {
      const forArm = measured.audits.filter((a) => a.armId === arm.id);
      const inspected = forArm.reduce((sum, a) => sum + a.inspected, 0);
      const own = forArm.reduce((sum, a) => sum + a.onArmCreatedIndex, 0);
      const on = [...new Set(forArm.flatMap((a) => a.onIndexes))];
      return (
        `| \`${arm.id}\` | ${inspected} | ${on.map((n) => `\`${n}\``).join(", ") || "(none)"} | ` +
        `${arm.create === null ? "_(builds none)_" : own} |`
      );
    }),
    "",
    inspectedTotal === 0
      ? "**VACUOUS — read this before believing any index-only claim in this section.** Not one " +
        "`Index Only Scan` node appeared under any arm, so the `Heap Fetches: 0` assertion had " +
        "NO subject and proved nothing at all. No figure here may be read as an index-only " +
        "result."
      : `The assertion inspected **${inspectedTotal}** index-only-scan node(s) across the arms ` +
        "and every one of them fetched zero heap pages, so no arm was aborted as " +
        "unrepresentative.",
    "",
    ownIndexTotal === 0
      ? "**The inference is NOT fully converted, and the honest statement is the narrow one.** " +
        "Every index-only scan above is on an index that ALREADY EXISTED when the arm opened; " +
        "**not one plan took an index-only scan on an index the arm itself built**. So what " +
        "this run demonstrates is that the visibility map is settled and index-only scans are " +
        "clean inside the arm transaction — which is the precondition the `VACUUM` and the " +
        "no-DML rule exist to establish, and it is worth having. What it does NOT demonstrate " +
        "is the narrower claim that an index built inside an open transaction is itself usable " +
        "index-only within it: the planner never chose one of those indexes for an index-only " +
        "scan on this corpus, so the assertion had no chance to observe it. That bounds this " +
        "mode's validity rather than invalidating it — the arms' figures are ordinary index and " +
        "sequential scans, which are not subject to the visibility-map question at all — and " +
        "the winner is re-measured against the COMMITTED index anyway, where the question does " +
        "not arise. It is recorded because an unconverted inference quietly reported as " +
        "converted is exactly the defect this assertion was added to prevent."
      : `**The inference IS converted**: **${ownIndexTotal}** of those nodes took an index-only ` +
        "scan on an index the arm BUILT inside the open transaction, and every one reported " +
        "`Heap Fetches: 0`. That an index created in an open transaction still yields " +
        "index-only scans within it is evidence on this corpus and this server, not an " +
        "uncited premise.",
    "",
    "### Restore proof",
    "",
    "`Post`'s index inventory, read from `pg_indexes` before the first arm and again after " +
      "the last one, compared as `(indexname, indexdef)` TUPLES — the definition travels with " +
      "the name because an arm re-creating an index under the same name with a different key " +
      "would leave a name-only proof reporting an identical inventory:",
    "",
    "```text",
    measured.indexesBefore,
    "```",
    "",
    measured.indexesAfter === measured.indexesBefore
      ? "The two reads are identical, which is what makes the swaps provably transaction-scoped."
      : "THE TWO READS DIFFER — see the run's own failure, which refuses to write this block.",
    "",
    "### The decision rule, declared before the run",
    "",
    "**Computed from the medians below, not typed in.** The rule is applied in code " +
      "(`decideIndex`), so this section cannot say one thing while its own table says another.",
    "",
    `- **The band**: a move is INSIDE it when it is ≤ ${BAND_ABSOLUTE_MS * 1000} µs **or** ` +
      `< ${BAND_RELATIVE * 100} % of its own baseline — the same band the form run uses, and ` +
      "an OR for the same reason: an absolute-only band calls every sub-millisecond probe " +
      "out-of-band for a few microseconds of wobble, a relative-only band calls a 7 µs probe " +
      "a 100 % regression.",
    `- **The statistic**: the SCAN-NODE median over the POOLED ${opts.runs * opts.repetitions} ` +
      `sample(s) — ${opts.runs} EXPLAIN run(s) × ${opts.repetitions} independent sweep(s) — per ` +
      "probe, on that probe's own measured relation.",
    `- **The direction**: \`${controlId}\` (as-shipped) is the baseline; each candidate is the ` +
      "candidate.",
    "- **Attributability**: a difference counts as the SHAPE's only when it is out of band AND " +
      "every sweep agreed on its sign. Measured necessity, not caution — six consecutive " +
      "sweeps of the FORM comparison on this same corpus put one probe anywhere from 111 µs " +
      "in one arm's favour to 112 µs in the other's. **A single sweep is never sign-stable**: " +
      "with one sweep there is one sign, so `every sweep agreed` is vacuously true and the " +
      "test stops testing while still printing `sign-stable` beside a verdict. At " +
      `\`--repetitions ${opts.repetitions}\` this run ` +
      (opts.repetitions < 2
        ? "**cannot attribute anything**, and every verdict below therefore falls to the tiebreak."
        : "can attribute a difference; below two it could not."),
    "- **Admissibility**: an arm is admissible when it has ZERO attributable regressions on an " +
      "APPLICATION case. A synthetic-shape regression is recorded and adjudicated but does not " +
      "disqualify — the shapes deliberately omit the predicates the application always " +
      "supplies, and the form run measured exactly that trap when `S2` regressed 3.5× under " +
      "both candidate forms while its real counterparts `Q1` and `Q5` got faster.",
    "- **Measurement first**: among admissible arms with at least one attributable case " +
      "improvement, the most improvements wins; ties go to the fewest shape regressions.",
    `- **The tiebreak**, and ONLY when no arm has an attributable case improvement: the ` +
      `pre-declared preference order **${INDEX_PREFERENCE_ORDER.join(" > ")}** decides among ` +
      "the admissible arms. It is a write-path order, which is the only question left when " +
      "the reads cannot be told apart: every index is paid for on every `INSERT` and every " +
      "`UPDATE` of its columns, so DROP is first; the as-shipped control is second because " +
      "keeping it needs no migration at all; the two replacements come last, narrower before " +
      "wider. The order is a tiebreak and never overrides a measured regression.",
    "",
    "> **This rule was authored before the run that produced the numbers below, and the " +
      "`tasks.md` entry for this work unit pre-declared no tiebreak of its own** — unlike the " +
      "form run, whose tiebreak was written into task 2.7. Declaring one afterwards, with the " +
      "medians already visible, would be choosing the rule that produces the preferred answer. " +
      "It is recorded as a declared deviation in this change's apply progress.",
    "",
    "### The verdict",
    "",
    `**\`${verdict.winner}\` — ${winnerArm.label}${winnerArm.shape === null ? "" : `, \`${winnerArm.shape}\``}.**`,
    "",
    `${verdict.basis}.`,
    "",
    "| Arm | Admissible | Case improvements | Case regressions | Shape improvements | Shape regressions |",
    "| --- | ---------- | ----------------- | ---------------- | ------------------ | ----------------- |",
    ...verdict.scores.map(
      (s) =>
        `| \`${s.armId}\` | ${s.admissible ? "yes" : "**no**"} | ` +
        `${s.caseImprovements.join(", ") || "—"} | ${s.caseRegressions.join(", ") || "—"} | ` +
        `${s.shapeImprovements.join(", ") || "—"} | ${s.shapeRegressions.join(", ") || "—"} |`
    ),
    "",
    verdict.shippedIndexUsedBy.length === 0
      ? `**The shipped index \`${SHIPPED_POST_INDEX}\` was selected by NO probe's plan under ` +
        "the control arm.** Measured from the plans, not argued: across every probe and every " +
        "run of the as-shipped arm, no plan named it. An index no measured plan selects is " +
        "paid for on every write and read by nothing."
      : `**The shipped index \`${SHIPPED_POST_INDEX}\` was selected under the control arm by**: ` +
        `${verdict.shippedIndexUsedBy.map((p) => `\`${p}\``).join(", ")} — read from the plans, ` +
        "so the DROP arm's cost is a measured one rather than an assumed one.",
    "",
    "### Per-probe delta against the control",
    "",
    "Scan-node medians on each probe's own measured relation. `Δ` is `candidate − control`: " +
      "negative is faster. A move is the SHAPE's only when it is out of band AND its sign held " +
      "across every sweep, and the two conditions are shown separately so a reader can see " +
      "which one a probe failed.",
    "",
    "| Probe | Kind | Relation | Control (ms) | Arm | Candidate (ms) | Δ | Δ % | In band | Sign stable | Effect |",
    "| ----- | ---- | -------- | ------------ | --- | -------------- | - | --- | ------- | ----------- | ------ |",
  ];
  for (const probe of AB_PROBES) {
    for (const score of verdict.scores) {
      const c = score.comparisons.find((x) => x.probeId === probe.id);
      if (!c) continue;
      out.push(
        `| \`${c.probeId}\` | ${c.kind} | \`${c.measuredTable}\` | ${c.controlMs.toFixed(3)} | ` +
          `\`${score.armId}\` | ${c.candidateMs.toFixed(3)} | ${us(c.band.deltaMs)} | ` +
          `${pct(c.band.deltaRatio)} | ${c.band.inBand ? "yes" : "**no**"} | ` +
          `${c.signStable ? "yes" : "no"} | ${c.effect === "unattributable" ? "—" : `**${c.effect}**`} |`
      );
    }
  }

  out.push(
    "",
    "### The plans, per probe and arm",
    "",
    "Node types and index sets travel with the medians, so a plan that MOVED between arms is " +
      "visible here rather than only in a full tree. A shape that changes the chosen index is " +
      "a finding even when the rows are identical — and the rows ARE identical: the run " +
      "refuses to write if any two arms return different ones.",
    "",
    "| Probe | Relation | Arm | Matched | Scan-node median (ms) | Statement median (ms) | Plan nodes | Indexes |",
    "| ----- | -------- | --- | ------- | --------------------- | --------------------- | ---------- | ------- |"
  );
  for (const probe of AB_PROBES) {
    for (const r of measured.results.filter((x) => x.probeId === probe.id)) {
      out.push(
        `| \`${r.probeId}\` | \`${r.measuredTable}\` | \`${r.armId}\` | ${r.matched} | ` +
          `**${median(r.scanMs).toFixed(3)}** | ${median(r.executionMs).toFixed(3)} | ` +
          `${r.nodeTypes.join(" → ") || "(none)"} | ${r.indexNames.join(", ") || "(none)"} |`
      );
    }
  }

  out.push(
    "",
    "### The index mechanics, stated rather than implied",
    "",
    "With only `accountId` equality-bound — which is what the policy supplies when the query " +
      "itself names no project — the scanned range of `(accountId, projectId, createdAt)` is " +
      "ordered by `(projectId, createdAt)`, **not** by `createdAt`. So the `+createdAt` " +
      "extension does NOT by itself give ordered output for the account-wide feed: Incremental " +
      "Sort needs a leading sorted key, and B-tree skip scan — which could otherwise hop " +
      "`projectId`'s distinct values — is a PostgreSQL 18 feature while this server is " +
      `${meta.pgVersion}. \`(accountId, createdAt)\` is the shape that CAN order that feed, ` +
      "and it is in the arm list for exactly that reason rather than for symmetry.",
    "",
    "### The single-corpus caveat",
    "",
    "**The measurement rests on one shape** — 100 projects × 10 000 posts, exactly 100 per " +
      "project — **which is the condition under which the displaced index wins.** A corpus " +
      "with a different fan-out (a few enormous projects, or thousands of tiny ones) moves " +
      "the selectivity of every `projectId`-led index in this comparison and can move the " +
      "verdict with it. This caveat travels with the decision wherever the decision is " +
      "recorded; it is not a disclaimer about precision, it is the boundary of what was " +
      "measured.",
    ""
  );
  return out.join("\n");
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

<!-- BEGIN generated:policy-ab -->

## A′-vs-B′ — the two policy forms, measured

_Not captured yet._

<!-- END generated:policy-ab -->

<!-- BEGIN generated:index-ab -->

## Index shortlist run — four arms over \`Post\`

_Not captured yet._

<!-- END generated:index-ab -->

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
 * @param phase - Which block to replace: a capture phase, the policy-form comparison, or
 *   the index shortlist.
 * @param body - Rendered Markdown for that block.
 * @throws Error when the markers are missing from an existing report.
 */
function writePhase(
  path: string,
  phase: "before" | "after" | "policy-ab" | "index-ab",
  body: string
): void {
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
 * @description Entry point: resolve channels, optionally seed, run the policy-form
 *   comparison, the index shortlist and/or a phase capture, write the report, and report
 *   namespace control counts. Both A/B modes run BEFORE the phase capture when several
 *   are asked for, so the phase capture always sees the shipped policy and the shipped
 *   index that the arms' own rollbacks restored.
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
    if (opts.seedOnly) return;

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

    if (opts.policyAb) {
      const abStartedAt = new Date().toISOString();
      const abT0 = performance.now();
      const measured = await runPolicyAb(owner, ctx, opts.runs, opts.repetitions);
      writePhase(
        opts.report,
        "policy-ab",
        renderPolicyAbBlock(opts, measured, {
          pgVersion: version,
          startedAt: abStartedAt,
          wallMs: performance.now() - abT0,
        })
      );
      console.log(
        `wrote ${measured.results.length} policy-arm measurements into ${opts.report} ` +
          "(§policy-ab); the shipped policies were re-read and are unchanged"
      );
    }

    if (opts.indexAb) {
      // The corpus was vacuum-analyzed on the way in (seed, or the --skip-seed branch),
      // which is the arms' precondition: VACUUM cannot run inside a transaction, so the
      // visibility map has to be settled before any arm opens. If the policy comparison
      // ran first it committed nothing, so the map is still the one that VACUUM left.
      const ixStartedAt = new Date().toISOString();
      const ixT0 = performance.now();
      const measured = await runIndexAb(owner, ctx, opts.runs, opts.repetitions);
      writePhase(
        opts.report,
        "index-ab",
        renderIndexAbBlock(opts, measured, {
          pgVersion: version,
          startedAt: ixStartedAt,
          wallMs: performance.now() - ixT0,
        })
      );
      console.log(
        `wrote ${measured.results.length} index-arm measurements into ${opts.report} ` +
          "(§index-ab); Post's index inventory was re-read and is unchanged"
      );
    }
    if (opts.phase === null) return;

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
