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

    it("no policy outside the trio was rewritten by this migration", async () => {
      // Blast-radius proof. This migration names three tables explicitly and
      // touches nothing else; an accidental sweep would show up here as a
      // hoisted read on a table that was never in scope.
      //
      // BOTH clauses are read, because both clauses are what the rewrite moves:
      // the migration wraps the GUC read in USING and in WITH CHECK alike, so a
      // sweep that reached an out-of-scope policy would leave a hoisted read in
      // either one. A qual-only check would miss the WITH CHECK half entirely
      // and report a clean blast radius over a policy whose mutation gate had
      // already been rewritten.
      const others = (await readPolicies()).filter(
        (r) => !(TRIO as readonly string[]).includes(r.tablename)
      );
      const rewritten = others.filter(
        (r) => countOf(r.qual ?? "", HOISTED) > 0 || countOf(r.with_check ?? "", HOISTED) > 0
      );
      assert.deepStrictEqual(
        rewritten.map((r) => r.tablename),
        [],
        "policies outside the trio must keep the form they shipped with"
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
