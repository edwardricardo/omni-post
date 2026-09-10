/**
 * @file rls-tenant-isolation.test.ts
 * @description Integration test for the PostgreSQL Row Level Security
 *   policies installed by `20260527000000_add_rls_tenant_isolation`. Verifies
 *   that the `tenant_isolation` policy gates row visibility and mutation by
 *   the `app.account_id` GUC, the `__system__` sentinel bypasses tenant
 *   scope, and that an unset GUC fails-closed (zero rows visible).
 *
 *   ## Why the REAL application role, and not a synthetic one?
 *
 *   PostgreSQL superusers (and roles with BYPASSRLS) skip RLS entirely, and a
 *   table's OWNER is exempt from its own policies unless the table carries
 *   `FORCE ROW LEVEL SECURITY`. This suite used to prove the policy against a
 *   synthetic `rls_test_role` it created itself, which demonstrated that the
 *   POLICY was written correctly while saying nothing about the role the
 *   application actually connects as. Those are different claims, and the
 *   recorded posture baseline (`docs/reports/RLS_POSTURE_RED_BASELINE.md`)
 *   shows the second one failing: bound to tenant B, the deployed connection
 *   returned tenant A's rows.
 *
 *   So the proofs now run as `omnipost_app` — the role provisioned by
 *   `<ts>_create_omnipost_app_role` and the role the application connects as
 *   after cutover — reached through `SET LOCAL ROLE` inside a Prisma
 *   transaction (tx-scoped: RESET happens on COMMIT/ROLLBACK). Three gates
 *   keep the posture from drifting back: the role carries neither SUPERUSER
 *   nor BYPASSRLS, it owns none of the RLS-covered tables, and a wrong-tenant
 *   read returns zero rows symmetrically in both directions.
 *
 *   ## Why the fixtures are seeded on a DIFFERENT connection
 *
 *   Once `DATABASE_URL` points at `omnipost_app`, the connection this suite
 *   would otherwise seed through is the very connection the policy gates, so
 *   `INSERT INTO "Project"` with no tenant bound fails closed with 42501 —
 *   the fixture layer would take the proof down with it. Seeding therefore
 *   runs on the migrate/owner channel (`MIGRATE_DATABASE_URL`), reached
 *   through `createSeedPrismaClient()`, while every proof keeps running on
 *   the application's own connection. The two channels are named separately
 *   on purpose: a suite that seeds and proves through one connection cannot
 *   tell which of the two it actually measured.
 *
 *   ## Why coverage is audited from `pg_catalog`
 *
 *   "Is RLS on?" is the wrong question, because coverage fails on three
 *   independent axes and two of them fail in OPPOSITE directions: a policy
 *   whose table has row security disabled LEAKS while reading as protected, a
 *   table with row security and no policy DENIES rather than leaks, and an
 *   enabled-and-policied table owned by the app role LEAKS again because an
 *   owner is exempt from its own policies. The coverage gate below reads all
 *   three axes for every guard-enrolled model and names WHICH state it found,
 *   because the remedy differs per state. Its mechanism is the integration
 *   tier rather than a fitness grep: `pg_class.relrowsecurity` is database
 *   state, and no grep can read it.
 *
 *   Decision record: `docs/technical/ADR-0022-rls-enforcement-posture.md`.
 *
 * @layer infrastructure
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { prisma, type PrismaClient } from "@infra/prisma";
import { getTenantScopedModels } from "@infra/prisma/extensions/tenantGuard.js";
import { createSeedPrismaClient, resolveSeedDatabaseUrl } from "./helpers/seedPrismaClient.js";

const ACCOUNT_A = `rls-test-acc-A-${Date.now()}`;
const ACCOUNT_B = `rls-test-acc-B-${Date.now()}`;
const TEST_TAG = "RLS_INTEGRATION";

/** The role the application connects as. Provisioned by migration, never by this suite. */
const APP_ROLE = "omnipost_app";

interface PlanNode {
  readonly "Node Type"?: string;
  readonly "Index Name"?: string;
  readonly Plans?: readonly PlanNode[];
  readonly [key: string]: unknown;
}

interface PlanShape {
  readonly nodeTypes: string[];
  readonly indexNames: string[];
}

/**
 * Flatten an EXPLAIN (FORMAT JSON) plan tree into its node types and the
 * indexes it actually reads. Walking the whole tree rather than reading the
 * root matters: a sequential scan under an Aggregate or a Gather node is still
 * a sequential scan.
 */
function collectPlanShape(
  node: PlanNode | undefined,
  acc: PlanShape = { nodeTypes: [], indexNames: [] }
): PlanShape {
  if (!node || typeof node !== "object") return acc;
  const nodeType = node["Node Type"];
  if (typeof nodeType === "string") acc.nodeTypes.push(nodeType);
  const indexName = node["Index Name"];
  if (typeof indexName === "string") acc.indexNames.push(indexName);
  for (const child of node.Plans ?? []) collectPlanShape(child, acc);
  return acc;
}

/** One table's row-security posture, read straight from `pg_catalog`. */
interface CatalogPosture {
  readonly rlsEnabled: boolean;
  readonly rlsForced: boolean;
  readonly owner: string;
  readonly policyCount: number;
}

/**
 * The coverage verdicts. Each partial state carries its DIRECTION in the
 * label, because a message that only says "RLS not covered" tells whoever
 * reads the failure nothing about whether the table is currently leaking rows
 * or refusing every read — and those two need opposite fixes.
 */
const COVERAGE_STATE = {
  covered: "COVERED",
  policyWithoutRls:
    "policy-without-RLS (LEAKS: the policy is inert and the table is fully readable, " +
    "while the schema still reads as protected)",
  rlsWithoutPolicy:
    "RLS-without-policy (DENIES: PostgreSQL default-denies for non-owners, so the table " +
    "breaks rather than leaks)",
  ownerWithoutForce:
    "owner-without-FORCE (OWNER-EXEMPT LEAK: the app role owns the table and an owner is " +
    "exempt from its own policies unless FORCE ROW LEVEL SECURITY is set)",
  neitherRlsNorPolicy: "no-RLS-and-no-policy (LEAKS: the table sits entirely outside row security)",
  tableMissing: "TABLE-ABSENT (the guard enrolls a model that has no table in this database)",
} as const;

/**
 * Classify one enrolled table against the three coverage axes. COVERED
 * requires all of: row security enabled, at least one policy, and either a
 * non-owner app role or `relforcerowsecurity`.
 */
function classifyCoverage(posture: CatalogPosture | undefined, appRole: string): string {
  if (!posture) return COVERAGE_STATE.tableMissing;
  const hasPolicy = posture.policyCount > 0;
  if (!posture.rlsEnabled) {
    return hasPolicy ? COVERAGE_STATE.policyWithoutRls : COVERAGE_STATE.neitherRlsNorPolicy;
  }
  if (!hasPolicy) return COVERAGE_STATE.rlsWithoutPolicy;
  if (posture.owner === appRole && !posture.rlsForced) return COVERAGE_STATE.ownerWithoutForce;
  return COVERAGE_STATE.covered;
}

/** Guard keys are the lowerCamel Prisma accessors; tables are PascalCase. */
function upperFirst(name: string): string {
  return name.length === 0 ? name : `${name[0]!.toUpperCase()}${name.slice(1)}`;
}

/**
 * ## The renderings this gate matches, READ BACK from the catalog
 *
 * Every string below was read from `pg_policies` on this project's own
 * PostgreSQL **16.14** on 2026-09-10, never copied from migration source.
 * `pg_get_expr` re-prints a policy body from the parsed tree, so it adds the
 * `::text` casts, the ` AS current_setting` sub-select alias and the outer
 * parentheses that the installing SQL never wrote:
 *
 * ```text
 * -- the standard body, on 60 of the 61 enrolled policies (and on the
 * -- variant's WITH CHECK):
 * ((( SELECT current_setting('app.account_id'::text, true) AS current_setting) = '__system__'::text)
 *  OR ("accountId" = ( SELECT current_setting('app.account_id'::text, true) AS current_setting)))
 *
 * -- the 3-arm variant's USING, on AIPromptTemplate alone:
 * ((( SELECT current_setting('app.account_id'::text, true) AS current_setting) = '__system__'::text)
 *  OR ("accountId" = ( SELECT current_setting('app.account_id'::text, true) AS current_setting))
 *  OR ("accountId" IS NULL))
 *
 * -- the BARE body this change replaced, captured from a rolled-back re-create:
 * ((current_setting('app.account_id'::text, true) = '__system__'::text)
 *  OR ("accountId" = current_setting('app.account_id'::text, true)))
 * ```
 *
 * **The read-back is load-bearing, and it is measured rather than asserted.**
 * The obvious spelling of the rule — count occurrences of the glued literal
 * `"(select current_setting("` — matches **zero** times across all 61 deployed
 * policies, because the deparser emits `( SELECT`, with one space, and
 * collapsing whitespace runs leaves that space in place. A gate written from
 * that literal would have red-lined the entire compliant catalog on its first
 * run. The adjacency below tolerates the whitespace instead of guessing it,
 * and it is the same pattern the sweep migration's own `DO $$` guard uses
 * (`20260910000200_rls_initplan_sweep`), so the gate and the migration cannot
 * disagree about what "hoisted" means.
 *
 * ## Known, unfixed limit: SMELL-91
 *
 * The A/B harness every number behind this form came from —
 * `scripts/rls-ab-measurement.ts` — is **typechecked by nothing in CI**:
 * `scripts/` sits outside every tsconfig project (`apps/api/tsconfig.json`
 * includes `src` plus per-package `src` globs under `packages/`,
 * `packages/core/` and `infra/`, and `scripts/` matches none of them — the
 * globs are spelled out that way here because writing them literally would
 * close this comment) and outside every fitness scope, so its only typecheck
 * is a standalone `tsc --noEmit` invocation run by hand at each gate. This
 * gate does not fix that and does not depend on it — it reads the catalog,
 * not the harness — but a limit stated in the check is a limit the next reader
 * finds, and an unstated one is how "typechecked by nothing" persists.
 */
const HOISTED_GUC_READ = /\(\s*select\s+current_setting\s*\(/g;
const ANY_GUC_READ = /current_setting\s*\(/g;

/**
 * Lowercase and collapse whitespace runs. Line breaks and indentation inside a
 * deparsed body are the deparser's business; the gate is about whether the call
 * sits inside a sub-select, not about how the sub-select is laid out.
 */
function normalizePolicyExpr(expr: string): string {
  return expr.replace(/\s+/g, " ").trim().toLowerCase();
}

/** Count non-overlapping matches. The source regex is re-built so `lastIndex` never leaks. */
function countMatches(haystack: string, pattern: RegExp): number {
  return haystack.match(new RegExp(pattern.source, pattern.flags))?.length ?? 0;
}

/** One clause's verdict: how many GUC reads it holds, and how many are hoisted. */
interface ClauseAudit {
  readonly reads: number;
  readonly hoisted: number;
  readonly compliant: boolean;
  readonly reason: string;
}

/**
 * Audit ONE rendered clause (`qual` or `with_check`).
 *
 * Three rules, and the third is the one a counting gate forgets:
 *
 * 1. **A NULL `WITH CHECK` is COMPLIANT** — and only that clause. An
 *    unspecified `WITH CHECK` inherits the `USING` expression by
 *    specification, so it is gated by an expression this same audit already
 *    checked, and a gate demanding a non-null `with_check` would red-line
 *    correct policies. A NULL `USING` is the opposite case and is NOT
 *    exempted: there would be no inherited expression to fall back on, so the
 *    exemption is scoped to the clause that actually has one rather than
 *    written once for "a null clause".
 * 2. **Every GUC read must be hoisted**: `reads === hoisted`. Equality rather
 *    than "contains a sub-select" is what catches a HALF-wrapped body, which
 *    still pays the per-row cost on the arm that stayed bare and is measured
 *    to deparse as `(( SELECT current_setting(…)) = '__system__') OR
 *    ("accountId" = current_setting(…))`.
 * 3. **A clause that is present must read the GUC at least once.** Without
 *    this the rule is vacuously satisfiable: `USING (true)` holds zero reads
 *    and zero hoisted reads, so `0 === 0` would report a policy that gates
 *    NOTHING as compliant. An assertion that cannot see its subject is not one.
 */
function auditClause(expr: string, clause: string): ClauseAudit {
  const normalized = normalizePolicyExpr(expr);
  const reads = countMatches(normalized, ANY_GUC_READ);
  const hoisted = countMatches(normalized, HOISTED_GUC_READ);
  if (reads === 0) {
    return {
      reads,
      hoisted,
      compliant: false,
      reason: `${clause} reads app.account_id ZERO times, so it gates no tenant at all`,
    };
  }
  if (reads !== hoisted) {
    return {
      reads,
      hoisted,
      compliant: false,
      reason:
        `${clause} holds ${reads - hoisted} un-hoisted GUC read(s) of ${reads} ` +
        `(${hoisted} hoisted) — each bare read is re-evaluated once per candidate row`,
    };
  }
  return {
    reads,
    hoisted,
    compliant: true,
    reason: `${clause}: all ${reads} GUC read(s) hoisted`,
  };
}

/**
 * A policy is compliant when BOTH its clauses are. Returns one verdict per
 * clause so a failure can say WHICH half moved: a bare `USING` is a read-path
 * cost, a bare `WITH CHECK` is a write-path cost, and the two are separately
 * repairable.
 */
function auditPolicyForm(qual: string | null, withCheck: string | null): ClauseAudit[] {
  const qualAudit: ClauseAudit =
    qual === null
      ? {
          reads: 0,
          hoisted: 0,
          compliant: false,
          reason: "USING is NULL — the policy declares no visibility predicate at all",
        }
      : auditClause(qual, "USING");
  const checkAudit: ClauseAudit =
    withCheck === null
      ? {
          reads: 0,
          hoisted: 0,
          compliant: true,
          reason: "WITH CHECK is NULL, which inherits USING by specification",
        }
      : auditClause(withCheck, "WITH CHECK");
  return [qualAudit, checkAudit];
}

describe("Row Level Security — tenant_isolation policy", () => {
  /**
   * The migrate/owner connection. Every fixture write goes through it, and
   * nothing else does: the proofs below deliberately run on `prisma`, the
   * connection the application itself opens.
   */
  let seedPrisma: PrismaClient;

  before(async () => {
    // Seed: 2 accounts + 2 projects per account + 1 global AIPromptTemplate.
    // Done through the migration/owner connection → bypasses RLS for the seed
    // phase. No role is created here: `omnipost_app` is a migration artifact,
    // and a suite that provisions its own subject cannot prove anything about
    // the deployment's posture.
    seedPrisma = createSeedPrismaClient();
    const now = Date.now();
    await seedPrisma.account.createMany({
      data: [
        {
          id: ACCOUNT_A,
          name: `RLS-A-${TEST_TAG}`,
          email: `a-${now}@rls.test`,
          slug: `rls-a-${now}`,
        },
        {
          id: ACCOUNT_B,
          name: `RLS-B-${TEST_TAG}`,
          email: `b-${now}@rls.test`,
          slug: `rls-b-${now}`,
        },
      ],
      skipDuplicates: true,
    });
    await seedPrisma.project.createMany({
      data: [
        { id: `${ACCOUNT_A}-proj-1`, accountId: ACCOUNT_A, name: "A1" },
        { id: `${ACCOUNT_A}-proj-2`, accountId: ACCOUNT_A, name: "A2" },
        { id: `${ACCOUNT_B}-proj-1`, accountId: ACCOUNT_B, name: "B1" },
        { id: `${ACCOUNT_B}-proj-2`, accountId: ACCOUNT_B, name: "B2" },
      ],
      skipDuplicates: true,
    });
    await seedPrisma.aIPromptTemplate.create({
      data: {
        id: `global-tpl-${TEST_TAG}`,
        accountId: null,
        name: `Global RLS Test Template ${TEST_TAG}`,
        prompt: "test",
        category: "GENERAL",
        platforms: [],
        tone: [],
        variables: {},
        isSystem: true,
      },
    });
  });

  after(async () => {
    // Cleanup seed data. Grants belong to the role migration, so there is
    // nothing to revoke here.
    await seedPrisma.aIPromptTemplate
      .delete({ where: { id: `global-tpl-${TEST_TAG}` } })
      .catch(() => undefined);
    await seedPrisma.project
      .deleteMany({ where: { accountId: { in: [ACCOUNT_A, ACCOUNT_B] } } })
      .catch(() => undefined);
    await seedPrisma.account
      .deleteMany({ where: { id: { in: [ACCOUNT_A, ACCOUNT_B] } } })
      .catch(() => undefined);
    await seedPrisma.$disconnect();
    await prisma.$disconnect();
  });

  /**
   * Run a function inside a Prisma transaction with `SET LOCAL ROLE
   * omnipost_app`, optionally setting `app.account_id`. Returns whatever the
   * function returns. The role and the GUC are both tx-local and reset on
   * COMMIT/ROLLBACK.
   */
  async function asAppRole<T>(
    accountIdSetting: string | null,
    fn: (tx: Parameters<Parameters<typeof prisma.$transaction>[0]>[0]) => Promise<T>
  ): Promise<T> {
    return prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(`SET LOCAL ROLE ${APP_ROLE}`);
      if (accountIdSetting !== null) {
        await tx.$queryRaw`SELECT set_config('app.account_id', ${accountIdSetting}, true)`;
      }
      return fn(tx);
    });
  }

  describe("application role posture", () => {
    it("the application role exists and carries neither SUPERUSER nor BYPASSRLS", async () => {
      const rows = await prisma.$queryRaw<Array<{ rolsuper: boolean; rolbypassrls: boolean }>>`
        SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = ${APP_ROLE}
      `;
      assert.strictEqual(
        rows.length,
        1,
        `role "${APP_ROLE}" does not exist — apply the create_omnipost_app_role migration`
      );
      assert.strictEqual(rows[0]!.rolsuper, false, `${APP_ROLE} must not be SUPERUSER`);
      assert.strictEqual(rows[0]!.rolbypassrls, false, `${APP_ROLE} must not carry BYPASSRLS`);
    });

    it("the application role owns none of the RLS-covered tables", async () => {
      // Ownership is the third bypass path: an owner is exempt from its own
      // policies unless the table carries FORCE ROW LEVEL SECURITY, and no
      // table in this schema does (ADR-0022 chose the non-owner remedy).
      const rows = await prisma.$queryRaw<Array<{ tablename: string }>>`
        SELECT c.relname AS tablename
        FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public'
          AND c.relkind = 'r'
          AND c.relrowsecurity
          AND pg_get_userbyid(c.relowner) = ${APP_ROLE}
        ORDER BY c.relname
      `;
      assert.deepStrictEqual(
        rows.map((r) => r.tablename),
        [],
        `${APP_ROLE} owns RLS-covered tables and is therefore exempt from their policies`
      );
    });
  });

  describe("harness seed channel", () => {
    it("prefers the migrate channel over the application's DATABASE_URL", () => {
      // The precedence IS the cutover. Reversed, every fixture in the tier
      // would be written through the connection the policy gates.
      const resolved = resolveSeedDatabaseUrl({
        MIGRATE_DATABASE_URL: "postgresql://owner@host/db",
        DATABASE_URL: "postgresql://app@host/db",
      });
      assert.strictEqual(resolved, "postgresql://owner@host/db");
    });

    it("falls back to DATABASE_URL while the split is not yet configured", () => {
      // Before an environment sets the pair, both channels are the same URL.
      // Without this fallback the whole harness would fail to construct on any
      // machine whose .env predates the split.
      const resolved = resolveSeedDatabaseUrl({ DATABASE_URL: "postgresql://only@host/db" });
      assert.strictEqual(resolved, "postgresql://only@host/db");
    });

    it("refuses to construct a client when neither channel is configured", () => {
      // Failing loudly beats handing back a client bound to "", which would
      // surface later as an opaque connection error inside a fixture.
      assert.throws(() => resolveSeedDatabaseUrl({}), /MIGRATE_DATABASE_URL/);
    });

    it("writes an RLS-covered row with no tenant context bound", async () => {
      // The property every fixture in this tier rests on, asserted rather than
      // assumed: this connection is NOT subject to the tenant policy. Point
      // MIGRATE_DATABASE_URL at `omnipost_app` and this fails with 42501,
      // which is the whole point of naming the two channels separately.
      const id = `${ACCOUNT_A}-seed-channel-probe`;
      await seedPrisma.project.create({
        data: { id, accountId: ACCOUNT_A, name: `seed-channel-${TEST_TAG}` },
      });
      const found = await seedPrisma.project.findUnique({ where: { id } });
      assert.ok(found, "the seed channel must be able to write without a tenant bound");
      await seedPrisma.project.delete({ where: { id } });
    });
  });

  describe("pg_catalog coverage gate", () => {
    /**
     * Read the row-security posture of every table in the public schema in one
     * pass, keyed by table name. Reading the whole schema and resolving per
     * model in memory keeps the enrolled-model set as the single source of
     * truth: a model the guard enrolls but the database lacks resolves to
     * `undefined` and is reported as TABLE-ABSENT rather than silently
     * skipped by a query that only returns rows it found.
     */
    async function readCatalogPostures(): Promise<Map<string, CatalogPosture>> {
      const rows = await prisma.$queryRaw<
        Array<{
          table_name: string;
          rls_enabled: boolean;
          rls_forced: boolean;
          table_owner: string;
          policy_count: number;
        }>
      >`
        SELECT c.relname                    AS table_name,
               c.relrowsecurity             AS rls_enabled,
               c.relforcerowsecurity        AS rls_forced,
               pg_get_userbyid(c.relowner)  AS table_owner,
               (SELECT count(*)::int FROM pg_policy p WHERE p.polrelid = c.oid) AS policy_count
        FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public' AND c.relkind = 'r'
      `;
      return new Map(
        rows.map((r) => [
          r.table_name,
          {
            rlsEnabled: r.rls_enabled,
            rlsForced: r.rls_forced,
            owner: r.table_owner,
            policyCount: Number(r.policy_count),
          },
        ])
      );
    }

    it("every guard-enrolled model is fully covered, and any partial state is named", async () => {
      const postures = await readCatalogPostures();
      const enrolled = getTenantScopedModels();
      assert.ok(enrolled.size > 0, "guard must enroll at least one model");

      const findings: string[] = [];
      for (const model of [...enrolled].sort()) {
        const tableName = upperFirst(model);
        const posture = postures.get(tableName);
        const state = classifyCoverage(posture, APP_ROLE);
        if (state === COVERAGE_STATE.covered) continue;
        const observed = posture
          ? `relrowsecurity=${posture.rlsEnabled}, relforcerowsecurity=${posture.rlsForced}, ` +
            `owner=${posture.owner}, policies=${posture.policyCount}`
          : "no row in pg_class";
        findings.push(`  "${tableName}" → ${state}\n      observed: ${observed}`);
      }

      assert.deepStrictEqual(
        findings,
        [],
        `RLS coverage is PARTIAL on ${findings.length} of ${enrolled.size} guard-enrolled ` +
          `table(s). Each is named with the state found, because they fail in opposite ` +
          `directions and need opposite fixes:\n${findings.join("\n")}`
      );
    });

    it("no guard-enrolled table is owned by the application role", async () => {
      // Deliberately scoped to the ENROLLED set rather than to the tables that
      // currently have row security on, which is what the posture gate above
      // checks. An enrolled table that is BOTH owned by the app role AND has
      // row security disabled is invisible to the `relrowsecurity`-filtered
      // form, and it is the worst of the states: doubly exempt.
      const postures = await readCatalogPostures();
      const owned = [...getTenantScopedModels()]
        .map(upperFirst)
        .filter((tableName) => postures.get(tableName)?.owner === APP_ROLE)
        .sort();
      assert.deepStrictEqual(
        owned,
        [],
        `${APP_ROLE} owns guard-enrolled table(s) and is therefore exempt from their ` +
          `policies unless FORCE ROW LEVEL SECURITY is set: ${owned.join(", ")}`
      );
    });
  });

  describe("policy installed", () => {
    it("tenant_isolation policy count equals the guard's enrolled-model count", async () => {
      const rows = await prisma.$queryRawUnsafe<Array<{ count: bigint }>>(
        `SELECT count(*)::bigint AS count FROM pg_policies WHERE policyname = 'tenant_isolation'`
      );
      // Derived from the single source of truth (the guard's enrolled-model
      // Set), never a literal — each enrollment adds one guard entry AND one
      // RLS policy, so layers 1 and 2 MUST stay numerically 1:1.
      const expected = getTenantScopedModels().size;
      assert.ok(expected > 0, "guard must enroll at least one model");
      assert.strictEqual(Number(rows[0]!.count), expected);
    });

    it("every tenant_isolation policy maps 1:1 to a guard-enrolled model", async () => {
      const rows = await prisma.$queryRawUnsafe<Array<{ tablename: string }>>(
        `SELECT tablename FROM pg_policies WHERE policyname = 'tenant_isolation'`
      );
      // pg_policies reports the PascalCase table name; the guard keys are the
      // lowerCamel Prisma model accessors (only the first char is lowered).
      const lowerFirst = (name: string): string =>
        name.length === 0 ? name : `${name[0]!.toLowerCase()}${name.slice(1)}`;
      const policyModels = new Set(rows.map((r) => lowerFirst(r.tablename)));
      const guardModels = getTenantScopedModels();
      assert.ok(policyModels.size > 0, "at least one RLS policy must exist");
      assert.ok(guardModels.size > 0, "guard must enroll at least one model");

      // (a) every RLS policy corresponds to a guard-enrolled model (no orphan
      //     policy without a layer-1 guard entry).
      for (const model of policyModels) {
        assert.ok(
          guardModels.has(model),
          `RLS policy on "${model}" has no matching TENANT_SCOPED_MODELS entry`
        );
      }
      // (b) every guard-enrolled model is protected by an RLS policy (no
      //     enrolled model missing its layer-2 backstop).
      for (const model of guardModels) {
        assert.ok(
          policyModels.has(model),
          `guarded model "${model}" has no tenant_isolation RLS policy`
        );
      }
    });

    it("Account (global) does NOT have RLS enabled", async () => {
      const rows = await prisma.$queryRawUnsafe<Array<{ rowsecurity: boolean }>>(
        `SELECT rowsecurity FROM pg_tables WHERE tablename = 'Account'`
      );
      assert.strictEqual(rows[0]?.rowsecurity, false);
    });

    // This assertion used to read "Post (transitively scoped) does NOT have RLS
    // enabled" and pass. Post carried no tenant column of its own, so its tenancy
    // lived one table away and there was nothing for a policy to filter on. The
    // composite-FK slice gave Post, PostContent and PostMedia a real `accountId`,
    // so the boundary moved and this assertion moves with it — a positive
    // assertion here is the visible proof, not a formality.
    it("the post trio (directly scoped) HAS RLS enabled", async () => {
      const rows = await prisma.$queryRawUnsafe<Array<{ tablename: string; rowsecurity: boolean }>>(
        `SELECT tablename, rowsecurity FROM pg_tables
          WHERE tablename IN ('Post', 'PostContent', 'PostMedia')
          ORDER BY tablename`
      );
      assert.deepStrictEqual(
        rows,
        [
          { tablename: "Post", rowsecurity: true },
          { tablename: "PostContent", rowsecurity: true },
          { tablename: "PostMedia", rowsecurity: true },
        ],
        "all three trio tables must carry row security once they are guard-enrolled"
      );
    });
  });

  describe("policy form — the GUC read is hoisted, and the catalog says so", () => {
    // The subject here is the DEPLOYED rendering, never the migration source
    // bytes. `pg_get_expr` re-prints a policy body from the parsed tree, adding
    // casts, collapsing whitespace and naming sub-select outputs, so a pattern
    // written from the SQL a migration contains asserts an intent that the
    // database may not hold. Everything below reads pg_policies.
    const TRIO = ["Post", "PostContent", "PostMedia"] as const;

    // A hoisted read renders as a sub-select wrapping the call. The exact
    // spelling of the interior (`'app.account_id'::text`, the trailing
    // `AS current_setting` alias) is the deparser's business and is
    // deliberately NOT pinned — what this change is about is whether the call
    // sits inside a sub-select at all, because that is what makes PostgreSQL
    // evaluate it once per statement instead of once per candidate row.
    const HOISTED = /\(\s*SELECT\s+current_setting\s*\(/gi;
    const ANY_READ = /current_setting\s*\(/gi;
    const countOf = (haystack: string, pattern: RegExp): number =>
      haystack.match(new RegExp(pattern.source, pattern.flags))?.length ?? 0;

    interface PolicyRow {
      readonly tablename: string;
      readonly qual: string | null;
      readonly with_check: string | null;
    }

    const readPolicies = async (): Promise<PolicyRow[]> =>
      prisma.$queryRawUnsafe<PolicyRow[]>(
        `SELECT tablename, qual, with_check FROM pg_policies
          WHERE policyname = 'tenant_isolation' ORDER BY tablename`
      );

    it("every GUC read in the trio's policies is hoisted into a sub-select", async () => {
      const rows = (await readPolicies()).filter((r) =>
        (TRIO as readonly string[]).includes(r.tablename)
      );
      assert.strictEqual(rows.length, TRIO.length, "all three trio policies must be installed");

      for (const row of rows) {
        assert.ok(row.qual !== null, `${row.tablename}: policy declares no USING clause`);
        const qual = row.qual;
        const hoisted = countOf(qual, HOISTED);
        const reads = countOf(qual, ANY_READ);
        // Both terms of the disjunction, and nothing left behind: an equal
        // count is what proves no bare read survived. A policy with one arm
        // wrapped and one arm bare still pays the per-row cost on every row
        // the bare arm evaluates, and would satisfy a "contains a sub-select"
        // check that only looked for the pattern once.
        assert.strictEqual(
          hoisted,
          2,
          `${row.tablename}: expected 2 hoisted GUC reads in USING, catalog holds: ${qual}`
        );
        assert.strictEqual(
          reads,
          hoisted,
          `${row.tablename}: ${reads - hoisted} un-hoisted GUC read(s) remain in USING: ${qual}`
        );
      }
    });

    it("both clauses of each trio policy are rendered in one and the same form", async () => {
      const rows = (await readPolicies()).filter((r) =>
        (TRIO as readonly string[]).includes(r.tablename)
      );

      for (const row of rows) {
        // These three declared a WITH CHECK, so they must still declare one:
        // silently dropping it would leave row mutation ungated while reads
        // stayed correct, which no read-path assertion in this file would see.
        assert.ok(
          row.with_check !== null,
          `${row.tablename}: WITH CHECK disappeared — row mutation would be ungated`
        );
        assert.strictEqual(
          row.with_check,
          row.qual,
          `${row.tablename}: visibility and mutation are gated by different expressions`
        );
      }
    });

    // Every enrolled tenant_isolation policy declares WITH CHECK explicitly
    // today, so the expected set is empty. It is a LITERAL rather than a
    // derivation on purpose: the property under test is that this set does not
    // move on its own. A policy that legitimately drops its WITH CHECK —
    // leaving row mutation to another layer — updates this list deliberately,
    // in a diff a reviewer reads, instead of being absorbed by a rule that
    // recomputes the answer from the same catalog it is supposed to be
    // checking.
    const EXPECTED_NO_WITH_CHECK: string[] = [];

    it("exactly the policies expected to declare no WITH CHECK declare none", async () => {
      // The converse guard, and it has to be an equality against a declared set
      // rather than a filter. Selecting the rows whose with_check is already
      // null and then asserting that those rows have a null with_check cannot
      // fail: it re-states its own selector, so it passes on an empty catalog,
      // on a catalog where every policy lost its WITH CHECK, and on every state
      // in between. Comparing the WHOLE set against the literal fails in both
      // directions instead — a policy that LOST its WITH CHECK leaves row
      // mutation ungated while every read-path assertion in this file stays
      // green, and one that GAINED a WITH CHECK it never declared tightens
      // writes another layer was deliberately gating.
      const rows = await readPolicies();
      assert.ok(rows.length > 0, "at least one tenant_isolation policy must exist");
      const withoutCheck = rows.filter((r) => r.with_check === null).map((r) => r.tablename);
      assert.deepStrictEqual(
        withoutCheck,
        EXPECTED_NO_WITH_CHECK,
        `the set of tenant_isolation policies declaring no WITH CHECK moved. ` +
          `expected [${EXPECTED_NO_WITH_CHECK.join(", ")}], ` +
          `catalog holds [${withoutCheck.join(", ")}]. A policy that LOST its WITH CHECK ` +
          `leaves row mutation ungated; one that GAINED it tightens writes another layer ` +
          `was gating. Either way the change is deliberate or it is a defect — update this ` +
          `literal only for the former.`
      );
    });

    // A blast-radius assertion stood here — "no policy outside the trio was
    // rewritten by this migration" — and it was not defective: it was the
    // trio migration's own proof that its rewrite reached exactly three
    // tables. `20260910000200_rls_initplan_sweep` is the change that
    // deliberately widens that radius to the whole enrollment, so its premise
    // expired the moment the sweep applied (measured: 58 offenders, every
    // non-trio enrolled table). It is replaced rather than deleted, by the two
    // assertions the sweep itself owes.
    //
    // What deliberately does NOT stand here is the form-uniformity gate —
    // "every enrolled policy holds a hoisted read". That gate ships in the
    // next link, over a catalog that is already uniform, with its own planted
    // red; landing it here would leave that link gating nothing and would skip
    // the read-back that gives the pinned rendering its provenance.

    // Exactly one enrolled policy carries a THIRD disjunct: `AIPromptTemplate`,
    // whose global templates (`"accountId" IS NULL`) are visible from every
    // tenant context. The sweep rewrites that policy on its own branch for
    // exactly this reason — the generic two-arm rewrite would flatten the arm
    // away, and a lost arm is a silent BEHAVIOUR change, not a performance
    // detail.
    //
    // A declared literal compared as a SET, for the same reason
    // EXPECTED_NO_WITH_CHECK is one: filtering to the three-arm policies and
    // then asserting that those policies are three-arm restates the selector
    // and cannot fail. The equality fails in both directions instead — on an
    // arm LOST (global templates stop being readable) and on an arm GAINED (a
    // policy quietly acquires cross-tenant visibility it was never granted).
    const EXPECTED_THREE_ARM: string[] = ["AIPromptTemplate"];
    const IS_NULL_ARM = /"accountId"\s+IS\s+NULL/gi;

    it("exactly the policies expected to carry the IS NULL third arm carry one", async () => {
      const rows = await readPolicies();
      assert.ok(rows.length > 0, "at least one tenant_isolation policy must exist");

      const threeArm = rows
        .filter((r) => countOf(r.qual ?? "", IS_NULL_ARM) > 0)
        .map((r) => r.tablename);
      assert.deepStrictEqual(
        threeArm,
        EXPECTED_THREE_ARM,
        `the set of tenant_isolation policies carrying an "accountId" IS NULL arm moved. ` +
          `expected [${EXPECTED_THREE_ARM.join(", ")}], catalog holds [${threeArm.join(", ")}]. ` +
          `A LOST arm makes global rows invisible to every tenant; a GAINED one hands a ` +
          `policy cross-tenant read visibility. Update this literal only for a deliberate change.`
      );

      // The read arm is permissive; the WRITE arm is not, and the two are not
      // the same claim. A WITH CHECK that acquired the IS NULL disjunct would
      // let any tenant write a row it can never be held accountable for —
      // and every read-path assertion in this file would stay green.
      for (const row of rows.filter((r) => EXPECTED_THREE_ARM.includes(r.tablename))) {
        assert.ok(row.with_check !== null, `${row.tablename}: WITH CHECK disappeared`);
        assert.strictEqual(
          countOf(row.with_check, IS_NULL_ARM),
          0,
          `${row.tablename}: WITH CHECK acquired an "accountId" IS NULL arm, so any tenant ` +
            `may write an unowned row. Catalog holds: ${row.with_check}`
        );
      }
    });

    // The body `20260910000000_rls_initplan_post_trio` left on the trio, read
    // back from `pg_policies` on this project's PostgreSQL 16.14 — never
    // copied from migration source. `pg_get_expr` re-prints from the parsed
    // tree, adding the `::text` casts and the ` AS current_setting` sub-select
    // alias that the installing SQL never wrote, so a literal taken from the
    // bytes would pin an intent the database does not hold. Whitespace is
    // collapsed on BOTH sides before comparing (line breaks in a deparsed body
    // are the deparser's business); the quoting, the casts and the operand
    // order are pinned.
    const WRAPPED_TRIO_BODY =
      "((( SELECT current_setting('app.account_id'::text, true) AS current_setting)" +
      " = '__system__'::text) OR (\"accountId\" = ( SELECT current_setting('app.account_id'::text," +
      " true) AS current_setting)))";

    /** Collapse whitespace runs so a re-wrapped deparse is not read as a different body. */
    const collapse = (expr: string): string => expr.replace(/\s+/g, " ").trim();

    it("the sweep left the trio's committed body and the enrolled population untouched", async () => {
      const rows = await readPolicies();

      // The sweep excludes the trio because the previous link already rewrote
      // it, and it asserts that exclusion at deploy time. This is the same
      // claim read from the committed catalog afterwards: a sweep that
      // re-derived the trio's body — or that dropped one clause while
      // rewriting the other — leaves a state the deploy-time check has no
      // further chance to see.
      const trio = rows.filter((r) => (TRIO as readonly string[]).includes(r.tablename));
      assert.strictEqual(trio.length, TRIO.length, "all three trio policies must be installed");
      const expectedBody = collapse(WRAPPED_TRIO_BODY);
      for (const row of trio) {
        assert.strictEqual(
          collapse(row.qual ?? ""),
          expectedBody,
          `${row.tablename}: USING no longer holds the body the trio migration installed. ` +
            `catalog holds: ${row.qual}`
        );
        assert.strictEqual(
          collapse(row.with_check ?? ""),
          expectedBody,
          `${row.tablename}: WITH CHECK no longer holds the body the trio migration installed. ` +
            `catalog holds: ${row.with_check}`
        );
      }

      // The sweep rewrites bodies; it creates and drops nothing. The count is
      // derived from the guard's enrolled-model Set rather than written as a
      // literal, and it is the same number the parity test above gates against
      // the same source — restated here so that a sweep which ADDED or REMOVED
      // a policy fails in the test that owns the sweep, naming it, instead of
      // only in the test that owns guard↔policy parity.
      assert.strictEqual(
        rows.length,
        getTenantScopedModels().size,
        `the sweep changed the enrolled population: catalog holds ${rows.length} ` +
          `tenant_isolation policies against ${getTenantScopedModels().size} enrolled models`
      );
    });
  });

  describe("form-uniformity gate — every enrolled policy, read from the catalog", () => {
    // The block above pins the trio's EXACT body, because a migration installed
    // exactly that body and nothing else may. This one asserts a RELATION over
    // the whole enrollment — every GUC read is hoisted — because the sweep
    // rewrote 58 policies through a `DO $$` loop whose per-table output no
    // human read. The two are different claims and the second is the one that
    // scales: it stays true for a policy this change never saw.
    //
    // It ships in THIS link rather than beside the sweep deliberately: a gate
    // landed over a mixed catalog would have had to be born failing or born
    // scoped, and a scoped uniformity gate is how the remainder gets deferred
    // forever. The catalog was made uniform first; the gate that keeps it that
    // way lands second, with its red planted on a real table.
    //
    // The pattern, the normalization and the three compliance rules live at
    // module scope, above — together with the read-back fixtures they were
    // derived from and the SMELL-91 limit this gate does not fix.

    interface EnrolledPolicy {
      readonly tablename: string;
      readonly qual: string | null;
      readonly with_check: string | null;
    }

    const readEnrolledPolicies = async (): Promise<EnrolledPolicy[]> =>
      prisma.$queryRawUnsafe<EnrolledPolicy[]>(
        `SELECT tablename, qual, with_check FROM pg_policies
          WHERE policyname = 'tenant_isolation' ORDER BY tablename`
      );

    it("every enrolled tenant_isolation policy expresses the GUC read in the hoisted form", async () => {
      const rows = await readEnrolledPolicies();

      // Derived from the guard's enrolled-model Set, never a literal: layers 1
      // and 2 are 1:1 by construction, so the expected population is whatever
      // the guard enrolls at the moment the gate runs. A literal here would
      // pass a catalog that lost a policy and gained an enrollment.
      const expected = getTenantScopedModels().size;
      assert.ok(expected > 0, "guard must enroll at least one model");
      assert.strictEqual(
        rows.length,
        expected,
        `expected one tenant_isolation policy per guard-enrolled model: catalog holds ` +
          `${rows.length} against ${expected} enrolled models`
      );

      // One finding line per offending policy, NAMING the table and which
      // clause moved. "The catalog is not uniform" would send whoever reads
      // the failure to re-derive the offender from 61 rows by hand.
      const findings: string[] = [];
      let compliantCount = 0;
      let hoistedReads = 0;
      for (const row of rows) {
        const audits = auditPolicyForm(row.qual, row.with_check);
        hoistedReads += audits.reduce((sum, a) => sum + a.hoisted, 0);
        if (audits.every((a) => a.compliant)) {
          compliantCount += 1;
          continue;
        }
        for (const audit of audits.filter((a) => !a.compliant)) {
          findings.push(
            `  "${row.tablename}" → ${audit.reason}\n` +
              `      USING:      ${row.qual}\n` +
              `      WITH CHECK: ${row.with_check}`
          );
        }
      }

      assert.deepStrictEqual(
        findings,
        [],
        `${findings.length} tenant_isolation policy clause(s) are NOT in the canonical ` +
          `InitPlan-wrapped form, out of ${rows.length} enrolled policies. A bare GUC read is ` +
          `re-evaluated once per candidate row, which is the cost this form exists to remove:\n` +
          `${findings.join("\n")}`
      );

      // Stated as a measured count rather than as "the sweep completed". The
      // expected total is DERIVED per policy, not rows.length × 4: a policy that
      // declares no WITH CHECK is compliant with 2 hoisted reads, not 4 — the
      // per-clause rule above already grants that exemption, and a flat ×4 here
      // would silently override it and red-line a catalog every per-clause rule
      // calls compliant. Vacuous today (all 61 declare one, measured), but the
      // sweep migration's own polwithcheck IS NULL branch exists precisely to
      // make that state reachable.
      assert.strictEqual(compliantCount, rows.length);
      const expectedHoisted = rows.reduce(
        (sum: number, r: PolicyRow) => sum + (r.with_check === null ? 2 : 4),
        0
      );
      assert.strictEqual(
        hoistedReads,
        expectedHoisted,
        `expected ${expectedHoisted} hoisted GUC reads (2 per declared clause) across ` +
          `${rows.length} policies; counted ${hoistedReads}`
      );
    });

    // The renderings below are the ones read back from this catalog on
    // 2026-09-10 (module-scope docblock). They are fixtures rather than live
    // reads on purpose: the two states that must be REJECTED do not exist in a
    // healthy catalog, so a gate that only ever sees the healthy one has never
    // been shown capable of failing. This test is that demonstration, and
    // unlike the planted red of the PR body it re-runs on every CI pass.
    const OBSERVED_WRAPPED =
      "((( SELECT current_setting('app.account_id'::text, true) AS current_setting)" +
      " = '__system__'::text) OR (\"accountId\" = ( SELECT current_setting('app.account_id'::text," +
      " true) AS current_setting)))";
    const OBSERVED_WRAPPED_VARIANT =
      "((( SELECT current_setting('app.account_id'::text, true) AS current_setting)" +
      " = '__system__'::text) OR (\"accountId\" = ( SELECT current_setting('app.account_id'::text," +
      ' true) AS current_setting)) OR ("accountId" IS NULL))';
    const OBSERVED_BARE =
      "((current_setting('app.account_id'::text, true) = '__system__'::text) OR " +
      "(\"accountId\" = current_setting('app.account_id'::text, true)))";
    const OBSERVED_HALF_WRAPPED =
      "((( SELECT current_setting('app.account_id'::text, true) AS current_setting)" +
      " = '__system__'::text) OR (\"accountId\" = current_setting('app.account_id'::text, true)))";

    it("the compliance rule accepts the deployed rendering and rejects a bare or half-wrapped one", () => {
      // ACCEPTED — the wrapped standard body, both clauses.
      assert.deepStrictEqual(
        auditPolicyForm(OBSERVED_WRAPPED, OBSERVED_WRAPPED).map((a) => a.compliant),
        [true, true],
        "the deployed standard rendering must be compliant, or the gate red-lines all 61"
      );

      // REJECTED — fully bare. Two reads, zero hoisted, on each clause.
      const bare = auditPolicyForm(OBSERVED_BARE, OBSERVED_BARE);
      assert.deepStrictEqual(
        bare.map((a) => a.compliant),
        [false, false],
        "a bare policy body must be rejected — this is the state the sweep removed"
      );
      assert.deepStrictEqual(
        bare.map((a) => [a.reads, a.hoisted]),
        [
          [2, 0],
          [2, 0],
        ]
      );

      // REJECTED — HALF-wrapped, which is the state that makes this an equality
      // rather than a "contains a sub-select" check. One arm hoisted, one arm
      // bare: the bare arm is still re-evaluated per candidate row, and a
      // presence check would have passed it.
      const half = auditPolicyForm(OBSERVED_HALF_WRAPPED, OBSERVED_WRAPPED);
      assert.deepStrictEqual(
        half.map((a) => a.compliant),
        [false, true],
        "a half-wrapped USING must be rejected even though it contains a sub-select"
      );
      assert.deepStrictEqual(half[0]!.reads - half[0]!.hoisted, 1);

      // REJECTED — vacuous. `USING (true)` satisfies `reads === hoisted` as
      // `0 === 0`, so the third rule is what stops the gate from blessing a
      // policy that gates nothing at all.
      assert.strictEqual(auditPolicyForm("true", OBSERVED_WRAPPED)[0]!.compliant, false);
      assert.strictEqual(auditPolicyForm(null, OBSERVED_WRAPPED)[0]!.compliant, false);
    });

    it("a policy that declares no WITH CHECK is COMPLIANT, and the 3-arm variant passes", () => {
      // An unspecified WITH CHECK inherits the USING expression by
      // specification, so there is no second expression to be bare: the policy
      // is gated by the one this audit already accepted. Asserted with a
      // fixture rather than left to omission, because "the gate happens not to
      // fail on it" and "the gate treats it as correct" are different claims,
      // and only the second survives someone adding a non-null requirement.
      //
      // Vacuous on today's catalog by measurement — all 61 declare a WITH
      // CHECK — which is exactly why the fixture is the proof. The sweep
      // migration carries the same branch for the same reason and proved it the
      // same way, on a rolled-back re-create of this very table.
      const noWithCheck = auditPolicyForm(OBSERVED_WRAPPED, null);
      assert.deepStrictEqual(
        noWithCheck.map((a) => a.compliant),
        [true, true],
        "a NULL with_check inherits USING and SHALL NOT be reported as a miss"
      );
      assert.match(noWithCheck[1]!.reason, /inherits USING/);

      // The 3-arm variant: three disjuncts, still only two GUC reads, both
      // hoisted. Its WITH CHECK is the strict two-arm body — deliberately, so
      // the global-visibility arm is read-only — and both halves must pass.
      const variant = auditPolicyForm(OBSERVED_WRAPPED_VARIANT, OBSERVED_WRAPPED);
      assert.deepStrictEqual(
        variant.map((a) => a.compliant),
        [true, true],
        "the AIPromptTemplate 3-arm variant must PASS — the third arm reads no GUC"
      );
      assert.deepStrictEqual(variant[0]!, {
        reads: 2,
        hoisted: 2,
        compliant: true,
        reason: "USING: all 2 GUC read(s) hoisted",
      });
    });

    it("the variant that exists in the catalog is audited as compliant by the same rule", async () => {
      // The fixture above proves the RULE accepts a 3-arm body; this proves the
      // rule accepts THE 3-arm body the catalog actually holds. A fixture can
      // drift from the deployment it was copied from — that is the whole reason
      // this gate reads pg_policies — so the variant is re-audited live rather
      // than trusted through its transcript.
      const rows = await readEnrolledPolicies();
      const variants = rows.filter((r) => /"accountId"\s+IS\s+NULL/i.test(r.qual ?? ""));
      assert.strictEqual(
        variants.length,
        1,
        `expected exactly one 3-arm policy in the catalog, found ${variants.length}: ` +
          `[${variants.map((v) => v.tablename).join(", ")}]`
      );
      const audits = auditPolicyForm(variants[0]!.qual, variants[0]!.with_check);
      assert.deepStrictEqual(
        audits.map((a) => a.compliant),
        [true, true],
        `the deployed 3-arm policy on "${variants[0]!.tablename}" is not in the canonical ` +
          `form: ${audits.map((a) => a.reason).join(" · ")}`
      );
    });
  });

  describe("as the application role", () => {
    it("returns 0 rows when app.account_id is unset (fail-closed)", async () => {
      const projects = await asAppRole(null, async (tx) => {
        return tx.project.findMany({ where: { accountId: { in: [ACCOUNT_A, ACCOUNT_B] } } });
      });
      assert.strictEqual(projects.length, 0, "no setting → no rows");
    });

    it("returns only tenant A's rows, and a non-zero count of them, when A is bound", async () => {
      const projects = await asAppRole(ACCOUNT_A, async (tx) => {
        return tx.project.findMany({ where: { accountId: { in: [ACCOUNT_A, ACCOUNT_B] } } });
      });
      // A non-zero count is load-bearing: an empty fixture would make a
      // zero-rows result pass for the wrong reason, so the proof asserts both
      // directions — A's rows ARE visible, B's rows are NOT.
      assert.strictEqual(projects.length, 2);
      assert.ok(projects.every((p) => p.accountId === ACCOUNT_A));
      assert.strictEqual(
        projects.filter((p) => p.accountId === ACCOUNT_B).length,
        0,
        "tenant B's rows leaked into a tenant A read"
      );
    });

    it("returns only tenant B's rows, and a non-zero count of them, when B is bound", async () => {
      const projects = await asAppRole(ACCOUNT_B, async (tx) => {
        return tx.project.findMany({ where: { accountId: { in: [ACCOUNT_A, ACCOUNT_B] } } });
      });
      assert.strictEqual(projects.length, 2);
      assert.ok(projects.every((p) => p.accountId === ACCOUNT_B));
      assert.strictEqual(
        projects.filter((p) => p.accountId === ACCOUNT_A).length,
        0,
        "tenant A's rows leaked into a tenant B read"
      );
    });

    it("returns all matching rows across tenants when app.account_id = __system__", async () => {
      const projects = await asAppRole("__system__", async (tx) => {
        return tx.project.findMany({ where: { accountId: { in: [ACCOUNT_A, ACCOUNT_B] } } });
      });
      assert.strictEqual(projects.length, 4, "system bypass sees both tenants");
    });

    it("AIPromptTemplate: NULL accountId rows visible to any tenant context", async () => {
      const templates = await asAppRole(ACCOUNT_A, async (tx) => {
        return tx.aIPromptTemplate.findMany({
          where: { id: `global-tpl-${TEST_TAG}` },
        });
      });
      assert.strictEqual(
        templates.length,
        1,
        "global system template (accountId=NULL) must be visible to any tenant"
      );
    });

    it("AIPromptTemplate: a tenant reads its OWN rows AND the global rows, and no other tenant's", async () => {
      // The catalog twin of this claim is the three-arm assertion in the policy
      // form block; this is the behavioural half, and the two are not the same
      // proof. The catalog says the disjunct is written; this says the disjunct
      // ADMITS rows — and it is the only one of the two that would notice the
      // arm being satisfied by something other than the row's own tenancy.
      //
      // The planted row is what makes it discriminating. Every
      // `AIPromptTemplate` row reachable here is GLOBAL — measured on the
      // development database: 6 in the corpus plus the one this suite's own
      // fixture seeds, 7 of 7 with `accountId` NULL and none owned by a tenant.
      // Without a tenant-owned row the test would pass on a policy whose
      // "accountId" = <guc> arm had been dropped entirely, asserting only the
      // IS NULL arm it already shares with the previous test.
      //
      // The expected global set is READ from the owner connection rather than
      // written as a count. It is not a restatement of the selector: the owner
      // channel is RLS-exempt, so it is a different source from the app
      // connection under test, and a literal (7 = 6 + 1 here) would encode this
      // host's corpus into a test that also runs against a freshly seeded CI
      // database.
      const ownedId = `own-tpl-${TEST_TAG}-${randomUUID()}`;
      const globalIds = (
        await seedPrisma.aIPromptTemplate.findMany({
          where: { accountId: null },
          select: { id: true },
        })
      )
        .map((r) => r.id)
        .sort();
      assert.ok(globalIds.length > 0, "the fixture must leave at least one global template");

      await seedPrisma.aIPromptTemplate.create({
        data: {
          id: ownedId,
          accountId: ACCOUNT_A,
          name: `Owned RLS Test Template ${TEST_TAG}`,
          prompt: "test",
          category: "GENERAL",
          platforms: [],
          tone: [],
          variables: {},
          isSystem: false,
        },
      });

      try {
        const asA = await asAppRole(ACCOUNT_A, async (tx) =>
          tx.aIPromptTemplate.findMany({ select: { id: true } })
        );
        assert.deepStrictEqual(
          asA.map((r) => r.id).sort(),
          [...globalIds, ownedId].sort(),
          `bound to its own tenant, the policy must admit BOTH disjuncts: the ${globalIds.length} ` +
            `global template(s) and this tenant's own row. Missing the own row means the ` +
            `"accountId" = <guc> arm was lost; missing the globals means the IS NULL arm was.`
        );

        const asB = await asAppRole(ACCOUNT_B, async (tx) =>
          tx.aIPromptTemplate.findMany({ select: { id: true } })
        );
        assert.deepStrictEqual(
          asB.map((r) => r.id).sort(),
          globalIds,
          `a second tenant must still read exactly the global templates. Seeing tenant A's ` +
            `row here would mean the third arm admits owned rows across tenants, which is the ` +
            `failure mode a globals-only corpus cannot distinguish from correct behaviour.`
        );
      } finally {
        // Owner channel: the row is RLS-covered, so a cleanup on the
        // application's connection with no tenant bound would delete nothing
        // and leave the plant behind for every later run.
        await seedPrisma.aIPromptTemplate.delete({ where: { id: ownedId } }).catch(() => undefined);
      }
    });

    it("INSERT with mismatching accountId is rejected", async () => {
      await assert.rejects(
        asAppRole(ACCOUNT_A, async (tx) => {
          return tx.apiKey.create({
            data: {
              id: randomUUID(),
              accountId: ACCOUNT_B, // mismatches the GUC
              name: "rls-test-key",
              keyHash: "x",
              prefix: "x",
            },
          });
        }),
        /row.*security|new row violates/i,
        "INSERT with wrong accountId must violate WITH CHECK"
      );
    });

    it("INSERT with matching accountId succeeds and cleanup removes it", async () => {
      const id = randomUUID();
      await asAppRole(ACCOUNT_A, async (tx) => {
        return tx.apiKey.create({
          data: {
            id,
            accountId: ACCOUNT_A,
            name: "rls-test-key",
            keyHash: `kh-${id}`,
            prefix: `p-${id.slice(0, 6)}`,
          },
        });
      });
      // Verify through the owner connection then cleanup. It has to be the
      // owner connection: `ApiKey` is RLS-covered, so reading the row back on
      // the application's connection with no tenant bound would return zero
      // rows and the assertion would fail for a reason that has nothing to do
      // with whether the INSERT persisted.
      const found = await seedPrisma.apiKey.findUnique({ where: { id } });
      assert.ok(found, "INSERT with matching accountId should have persisted");
      await seedPrisma.apiKey.delete({ where: { id } });
    });

    it("a tenant-scoped read plans as an index scan on a tenant-leading index", async () => {
      // `enable_seqscan = off` is the point of the proof, not a cheat: on a
      // small fixture the planner seq-scans everything regardless of the
      // policy, so the cost model would answer a question nobody asked. With
      // sequential scans penalised, a remaining Seq Scan node means the policy
      // qual made index access IMPOSSIBLE — which is the claim under test.
      //
      // "No Seq Scan" alone is too weak to be the whole assertion, and that is
      // a measured statement: with the tenant predicate replaced by a
      // non-indexed column the planner still avoided a Seq Scan by reading
      // `Project_deletedAt_idx`, so the read would have been reported healthy
      // while no tenant-leading index was involved at all. The requirement is
      // an index scan on a TENANT-LEADING index, so the plan is asserted to
      // name one. The full captured plan lives in
      // docs/reports/RLS_POSTURE_RED_BASELINE.md §Index-scan.
      const shape = await asAppRole(ACCOUNT_A, async (tx) => {
        await tx.$executeRawUnsafe("SET LOCAL enable_seqscan = off");
        const rows = await tx.$queryRaw<Array<{ "QUERY PLAN": unknown }>>`
          EXPLAIN (ANALYZE, FORMAT JSON)
          SELECT id, "accountId" FROM "Project"
          WHERE "accountId" = ${ACCOUNT_A} AND "deletedAt" IS NULL
        `;
        const raw = rows[0]?.["QUERY PLAN"];
        const parsed = (typeof raw === "string" ? JSON.parse(raw) : raw) as
          Array<{ Plan?: PlanNode }> | undefined;
        return collectPlanShape(parsed?.[0]?.Plan);
      });
      assert.ok(shape.nodeTypes.length > 0, "EXPLAIN returned no plan nodes");
      assert.ok(
        !shape.nodeTypes.includes("Seq Scan"),
        `tenant-scoped read degraded to a sequential scan under the RLS policy qual: ${shape.nodeTypes.join(", ")}`
      );
      assert.ok(
        shape.indexNames.some((name) => name.startsWith("Project_accountId")),
        `tenant-scoped read used no tenant-leading index — nodes: [${shape.nodeTypes.join(", ")}], indexes: [${shape.indexNames.join(", ")}]`
      );
    });
  });

  describe("UoW propagation (apps/api PrismaUnitOfWork integration)", () => {
    // Note: the UoW itself uses `getTenantContext()` / `getSystemContext()`
    // from AsyncLocalStorage. Those holders are tested in unit tests
    // (apps/api/tests/unit/security/tenantContext.test.ts). Here we verify
    // the SQL-level integration: the `set_config(...)` call this test
    // simulates is what PrismaUnitOfWork emits.
    it("set_config persists for the duration of the tx and resets on COMMIT", async () => {
      const insideTx = await prisma.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT set_config('app.account_id', 'inside-tx-only', true)`;
        const rows = await tx.$queryRawUnsafe<Array<{ s: string | null }>>(
          `SELECT current_setting('app.account_id', true) AS s`
        );
        return rows[0]?.s;
      });
      assert.strictEqual(insideTx, "inside-tx-only");

      // Outside the tx, the setting is reset.
      const outsideTx = await prisma.$queryRawUnsafe<Array<{ s: string | null }>>(
        `SELECT current_setting('app.account_id', true) AS s`
      );
      assert.notStrictEqual(outsideTx[0]?.s, "inside-tx-only");
    });
  });
});
