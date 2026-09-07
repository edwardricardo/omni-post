/**
 * @file appRoleClient.ts
 * @description The integration harness's APPLICATION-ROLE channel: a connection whose
 *   `current_user` is `omnipost_app`, the NOSUPERUSER / NOBYPASSRLS role the application
 *   connects as after the runtime cutover. Suites that must observe row security ACTING —
 *   rather than a superuser walking through it — read through this client.
 *
 *   ## Why a suite needs it at all
 *
 *   Row security is enforced against the role in effect. Under the owner channel every
 *   `tenant_isolation` policy is bypassed, so a read that WOULD return zero rows in production
 *   returns them all in a test, and a suite written to catch a fail-closed defect reports green
 *   over it. That is not hypothetical: the same 18-suite batch measured 177/177 as the owner and
 *   170/177 as `omnipost_app`.
 *
 *   ## How the role is reached, and why not through a login
 *
 *   The connection is the OWNER channel with `role=omnipost_app` in the startup packet, so the
 *   session runs as that role from its first statement — the same mechanism
 *   `rls-tenant-isolation.test.ts` uses with `SET LOCAL ROLE`, hoisted to the whole session so a
 *   repository under test needs no cooperation from the suite. Measured, not assumed:
 *   `current_user = omnipost_app`, `session_user = postgres`, `current_setting('is_superuser')
 *   = off`, an unbound read of an RLS-covered table returns null, and the same read inside a
 *   transaction that binds `app.account_id` returns the row.
 *
 *   A credentialed login as `omnipost_app` was the other candidate and was rejected on a
 *   measurement: `OMNIPOST_APP_DB_PASSWORD` is not in this repo's environment channel, and CI
 *   exports it only to the two `Enable app-role login` steps, never to a test step. A suite
 *   gated on a credential is a suite only its provisioner can re-run — the exact reason the
 *   previous link's merge-blocking measurement could not be reproduced by its reviewer. This
 *   route needs nothing beyond the owner channel every integration suite already has.
 *
 *   What it therefore does NOT prove, stated rather than implied: that the role can LOG IN and
 *   that its grants are right under its own login. `rls-tenant-isolation.test.ts` owns that
 *   proof (`rolcanlogin/rolsuper/rolbypassrls`, ownership, and a real login connection), and
 *   this helper deliberately does not restate it.
 *
 *   ## It never falls back to the owner channel
 *
 *   A silent fallback would turn every assertion written against this client into a claim about
 *   a superuser session. {@link assertAppRoleSession} therefore verifies the posture on the live
 *   connection and throws — naming the migration that provisions the role — when the session is
 *   anything other than a non-bypassing `omnipost_app`.
 *
 * @layer infrastructure
 */
import { createTestPrismaClient, type PrismaClient } from "@infra/prisma";
import { resolveSeedDatabaseUrl } from "./seedPrismaClient.js";

/** The role the application connects as after the runtime cutover. */
export const APP_ROLE = "omnipost_app";

/**
 * @function createAppRoleClient
 * @description Builds a PrismaClient whose session runs as {@link APP_ROLE}. Pair it with
 *   {@link assertAppRoleSession} before asserting anything about what it can or cannot see.
 * @param env - Environment to read; defaults to `process.env`. The connection target comes from
 *   the owner channel (`MIGRATE_DATABASE_URL`, falling back to `DATABASE_URL`) so the helper
 *   keeps naming the same database on both sides of the `DATABASE_URL` cutover.
 * @returns A PrismaClient whose `current_user` is `omnipost_app`.
 */
export function createAppRoleClient(env: NodeJS.ProcessEnv = process.env): PrismaClient {
  return createTestPrismaClient(resolveSeedDatabaseUrl(env), `-c role=${APP_ROLE}`);
}

/**
 * @function assertAppRoleSession
 * @description Verifies on the live connection that the session really is the non-bypassing
 *   application role. Call it once in a suite's `before` hook.
 * @param client - The client returned by {@link createAppRoleClient}.
 * @throws Error when the session is not `omnipost_app`, or is `omnipost_app` with superuser
 *   attributes still in force — either state would make every later assertion a statement about
 *   a role that bypasses the policies under test.
 */
export async function assertAppRoleSession(client: PrismaClient): Promise<void> {
  const rows = await client.$queryRaw<Array<{ role: string; superuser: string }>>`
    SELECT current_user::text AS role, current_setting('is_superuser') AS superuser
  `;
  const posture = rows[0];
  if (!posture || posture.role !== APP_ROLE || posture.superuser !== "off") {
    throw new Error(
      `the app-role channel is not in force: current_user=${posture?.role ?? "unknown"}, ` +
        `is_superuser=${posture?.superuser ?? "unknown"} (expected ${APP_ROLE} / off). ` +
        "Apply the create_omnipost_app_role migration (pnpm db:up && pnpm db:migrate); " +
        "reading through the owner channel instead would make every assertion below a " +
        "statement about a role that bypasses the policies under test."
    );
  }
}
