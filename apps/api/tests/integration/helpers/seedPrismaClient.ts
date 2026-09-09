/**
 * @file seedPrismaClient.ts
 * @description The integration harness's OWNER-channel Prisma client. Fixtures
 *   are written through `MIGRATE_DATABASE_URL` (the migrate/superuser channel)
 *   instead of `DATABASE_URL` (the channel the application connects on), so a
 *   suite keeps its ability to seed after `DATABASE_URL` is cut over to the
 *   non-bypassing `omnipost_app` role.
 *
 *   ## Why the harness needs two channels at all
 *
 *   Row security is enforced against the CONNECTING role. Before the cutover
 *   the application connected as a superuser, so a fixture write and an
 *   application write were the same thing and one connection could serve both.
 *   After it, they are opposites: an `INSERT INTO "Project"` with no tenant
 *   bound is exactly what the `tenant_isolation` policy exists to refuse, and
 *   it fails closed with SQLSTATE 42501 — for the fixture as readily as for an
 *   attacker. A harness that seeded on the application's connection would
 *   therefore report the cutover as a broken test suite.
 *
 *   ## Why this is a separate, NAMED factory
 *
 *   Binding the owner channel silently inside `createTestPrismaClient()` would
 *   have been one line instead of a call-site change per suite, and it would
 *   have made every future test connection bypass row security without saying
 *   so at the point of use. That is the same defect this workstream exists to
 *   remove — a proof that never observed the role it claims to be about. A
 *   suite that wants the APPLICATION's posture keeps using the `@infra/prisma`
 *   singleton or `createTestPrismaClient()`; a suite that wants to bypass the
 *   policy to build its fixtures has to say so here, in one greppable name.
 *
 * @layer infrastructure
 */
import { createTestPrismaClient, type PrismaClient } from "@infra/prisma";

/**
 * @function resolveSeedDatabaseUrl
 * @description Resolves the owner/migrate connection string for fixture writes,
 *   mirroring the `MIGRATE_DATABASE_URL || DATABASE_URL` precedence that
 *   `infra/prisma/prisma.config.ts` applies to the Prisma CLI. `||` on purpose:
 *   `.env.example` ships the key present-but-empty, so an empty string means
 *   "unconfigured" and must fall through. The fallback is what keeps an
 *   environment that has not yet configured the pair working unchanged: both
 *   channels are then the same URL, which is the pre-cutover state.
 * @param env - Environment to read; injectable so the precedence is testable
 *   without mutating `process.env`.
 * @returns The connection string fixtures must be written through.
 * @throws Error when neither channel is configured — an empty connection string
 *   would surface later as an opaque failure inside an unrelated fixture.
 */
export function resolveSeedDatabaseUrl(env: NodeJS.ProcessEnv = process.env): string {
  const url = env.MIGRATE_DATABASE_URL || env.DATABASE_URL;
  if (!url) {
    throw new Error(
      "seed channel is not configured: set MIGRATE_DATABASE_URL (the migrate/owner " +
        "channel) or DATABASE_URL. Fixtures cannot be written through the application's " +
        "role once it no longer bypasses row security."
    );
  }
  return url;
}

/**
 * @function createSeedPrismaClient
 * @description Builds a PrismaClient bound to the owner/migrate channel. Use it
 *   for every fixture write, fixture read-back, and cleanup in an integration
 *   suite; use the application's own connection for whatever the suite actually
 *   proves.
 * @param env - Environment to read; defaults to `process.env`.
 * @returns A PrismaClient on the owner channel, carrying the same session pin
 *   production uses (see `PG_SESSION_OPTIONS`).
 */
export function createSeedPrismaClient(env: NodeJS.ProcessEnv = process.env): PrismaClient {
  return createTestPrismaClient(resolveSeedDatabaseUrl(env));
}

/**
 * @function assertSeedChannelConfigured
 * @description Module-scope preflight: resolves the seed channel at IMPORT time so
 *   a missing one aborts the file before any test is registered.
 *
 *   Why it exists as a separate call. `createSeedPrismaClient()` is normally
 *   invoked inside `before()`, and node:test reports a failing `before` hook by
 *   CANCELLING every child — measured on this suite, 18 cancelled / 0 failed. A
 *   run in that shape reads as a leak or a hang: "test did not finish before its
 *   parent" is what a resource leak looks like, and the one line that names the
 *   real cause is buried under 18 that do not. Resolving at module scope means
 *   there are no children to cancel; the file fails to load, once, with the
 *   reason.
 *
 *   This is for the caller who runs a suite by hand, without the harness that
 *   sources the root env — `run-tests.sh` supplies both channels, so under the
 *   batch this call is a no-op that costs one environment read.
 * @param env - Environment to read; defaults to `process.env`.
 * @throws Error naming the missing channel, before any `describe` executes.
 */
export function assertSeedChannelConfigured(env: NodeJS.ProcessEnv = process.env): void {
  resolveSeedDatabaseUrl(env);
}
