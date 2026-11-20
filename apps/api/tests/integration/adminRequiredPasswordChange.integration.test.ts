/**
 * @file adminRequiredPasswordChange.integration.test.ts
 * @description `POST /admin/auth/password/change-required` against a database of its own,
 *              migrated from empty. Each case empties the administrators' tables and creates the
 *              first administrator through the composition the operator command uses, so the
 *              administrator holds a single-use password and must change it. The route runs over
 *              the real `AdminAuthService` on a client of that database; the brute-force port
 *              allows every attempt and records nothing, since the subject is the stored row.
 *
 *              The case of two calls at once does not leave the interleaving to chance: a third
 *              connection holds the administrator's row lock, which plain reads do not wait on,
 *              so both calls pass the sign-in's checks and reach their guarded write; once both
 *              writes are observed blocked in `pg_stat_activity`, the holder commits without
 *              changing anything. The first write then lands, and the second, re-checked against
 *              the row the first committed, matches nothing. Without the hold, the second call
 *              would usually read the row after the first committed, fail the password check and
 *              answer `INVALID_CREDENTIALS`, so the guarded write's refusal would go unobserved.
 * @layer infrastructure
 */

import { describe, it, before, after, afterEach } from "node:test";
import assert from "node:assert/strict";
import Fastify, { type FastifyInstance } from "fastify";
import { ok } from "@shared/types";
import { createTestPrismaClient, type PrismaClient } from "@infra/prisma";
import { assertSeedChannelConfigured } from "./helpers/seedPrismaClient.js";
import {
  BLOCKED_BACKENDS_TIMEOUT_MS,
  createMigratedScratchDatabase,
  waitUntilBackendsBlocked,
  type MigratedScratchDatabase,
} from "./helpers/migratedScratchDatabase.js";
import { composeCreateFirstAdministrator } from "../../src/infrastructure/container/firstAdministratorComposition.js";
import { AdminAuthService } from "../../src/admin/auth/AdminAuthService.js";
import type { MfaService } from "../../src/admin/auth/MfaService.js";
import { adminAuthRoutes } from "../../src/admin/auth/adminAuthRoutes.js";
import { Container } from "../../src/infrastructure/container/Container.js";
import { TOKENS } from "../../src/infrastructure/container/types.js";
import { verifyPassword } from "../../src/auth/passwordHashing.js";

assertSeedChannelConfigured();

/** Budget for every test and hook in this file: the migration in `before` blocks for minutes. */
const TIMING = { timeout: 180_000 } as const;

const ROUTE = "/admin/auth/password/change-required";
const ADMIN_EMAIL = "first.admin@required-change-integration.test";
const NEW_PASSWORD = "Fixture-Lasting-Pw-4q!";
const RIVAL_PASSWORD = "Fixture-Rival-Pw-7u?";
const WRONG_PASSWORD = "Fixture-Wrong-Pw-2d%";

/**
 * A `LIKE` pattern for the current statement of a backend blocked in the guarded write: the
 * update of the administrators' table, as `pg_stat_activity` shows the Prisma client's statement.
 */
const GUARDED_WRITE_STATEMENT = 'UPDATE "public"."AdminUser" SET %';

interface FirstAdministrator {
  readonly id: string;
  readonly email: string;
  readonly password: string;
}

interface Call {
  readonly status: number;
  readonly body: unknown;
}

/** A brute-force port that allows every attempt: the subject here is the stored row. */
const permissiveBruteForce = {
  checkLoginAttempt: async () => ({ allowed: true, delaySeconds: 0, captchaRequired: false }),
  recordFailedAttempt: async () => undefined,
  recordSuccessfulAttempt: async () => undefined,
  unlockAccount: async () => false,
  unblockIp: async () => false,
  getStats: async () => ({
    lockedAccounts: 0,
    blockedIps: 0,
    recentFailures: 0,
    suspiciousActivities: 0,
  }),
};

/** No administrator here enrols a second factor, so a call to it is a defect of the case. */
const noSecondFactor = {
  verifyMfaToken: async () => {
    throw new Error("no administrator of this suite has a second factor");
  },
} as unknown as MfaService;

describe("The required password change on a migrated database", { concurrency: 1 }, () => {
  let database: MigratedScratchDatabase | undefined;
  let scratch: PrismaClient | undefined;
  let appClient: PrismaClient | undefined;
  let openApp: FastifyInstance | undefined;

  before(async () => {
    database = await createMigratedScratchDatabase("omnipost_required_change");
    scratch = createTestPrismaClient(database.url);
    appClient = createTestPrismaClient(database.url);
  }, TIMING);

  after(async () => {
    await appClient?.$disconnect();
    await scratch?.$disconnect();
    await database?.drop();
  }, TIMING);

  // Closed here rather than at the end of each case, so a failed assertion does not leave it open.
  afterEach(async () => {
    await openApp?.close();
    openApp = undefined;
  }, TIMING);

  /** The fixture client, after asserting the migration ran. */
  function migrated(): PrismaClient {
    assert.ok(database, "the scratch database was created");
    database.assertMigrated();
    assert.ok(scratch, "a client of the scratch database was built");
    return scratch;
  }

  /** Empties the administrators' tables and creates the first administrator as the command does. */
  async function firstAdministrator(): Promise<FirstAdministrator> {
    const client = migrated();
    await client.auditLog.deleteMany({});
    await client.adminSession.deleteMany({});
    await client.adminUser.deleteMany({});
    await client.role.deleteMany({});
    const created = await composeCreateFirstAdministrator(client).execute({ email: ADMIN_EMAIL });
    assert.ok(created.ok, "the first administrator was created");
    return { id: created.value.id, email: created.value.email, password: created.value.password };
  }

  /** The route over the real service on the application's client of the scratch database. */
  async function buildApp() {
    assert.ok(appClient, "an application client of the scratch database was built");
    const app = Fastify({ logger: false });
    const container = new Container();
    container.registerInstance(
      TOKENS.AdminAuthService,
      new AdminAuthService(appClient, permissiveBruteForce, noSecondFactor)
    );
    container.registerInstance(TOKENS.PlatformCredentialService, {
      getCredential: async () => ok(null),
    });
    container.registerInstance(TOKENS.EmailPort, { send: async () => ok(undefined) });
    container.registerInstance(TOKENS.HttpRateLimiter, {
      tryConsume: async () => ({ allowed: true }),
    });
    app.decorate("container", container);
    openApp = app;
    await app.register(adminAuthRoutes);
    await app.ready();
    return app;
  }

  /** One call of the route. */
  async function change(
    app: Awaited<ReturnType<typeof buildApp>>,
    currentPassword: string,
    newPassword: string
  ): Promise<Call> {
    const res = await app.inject({
      method: "POST",
      url: ROUTE,
      payload: { email: ADMIN_EMAIL, currentPassword, newPassword },
    });
    return { status: res.statusCode, body: JSON.parse(res.body) as unknown };
  }

  /** The administrator's stored row. */
  async function storedAdmin(id: string) {
    return migrated().adminUser.findUniqueOrThrow({ where: { id } });
  }

  it("refuses a wrong current password with 401 and changes nothing", TIMING, async () => {
    const admin = await firstAdministrator();
    const rowBefore = await storedAdmin(admin.id);
    const app = await buildApp();

    const call = await change(app, WRONG_PASSWORD, NEW_PASSWORD);

    assert.deepEqual(call, { status: 401, body: { ok: false, error: "INVALID_CREDENTIALS" } });
    assert.deepEqual(await storedAdmin(admin.id), rowBefore);
  });

  it(
    "replaces the single-use password with the new one, clears the mark, leaves lastLoginAt null and opens no session",
    TIMING,
    async () => {
      const admin = await firstAdministrator();
      const rowBefore = await storedAdmin(admin.id);
      const app = await buildApp();

      const call = await change(app, admin.password, NEW_PASSWORD);

      assert.equal(call.status, 200);
      const row = await storedAdmin(admin.id);
      assert.equal(await verifyPassword(row.passwordHash, NEW_PASSWORD), true);
      assert.equal(await verifyPassword(row.passwordHash, admin.password), false);
      assert.equal(row.mustChangePassword, false);
      assert.equal(row.lastLoginAt, null);
      assert.deepEqual(row.passwordHistory, [rowBefore.passwordHash]);
      assert.equal(await migrated().adminSession.count({ where: { userId: admin.id } }), 0);
    }
  );

  it(
    "refuses a second change as not required, with the new password as the current one, and changes nothing",
    TIMING,
    async () => {
      const admin = await firstAdministrator();
      const app = await buildApp();
      const first = await change(app, admin.password, NEW_PASSWORD);
      assert.equal(first.status, 200);
      const afterFirst = await storedAdmin(admin.id);

      const second = await change(app, NEW_PASSWORD, RIVAL_PASSWORD);

      assert.deepEqual(second, {
        status: 409,
        body: { ok: false, error: "PASSWORD_CHANGE_NOT_REQUIRED" },
      });
      assert.deepEqual(await storedAdmin(admin.id), afterFirst);
    }
  );

  it(
    "stores exactly one of two new passwords and refuses the other as a concurrent modification, when two changes run at once",
    TIMING,
    async () => {
      const admin = await firstAdministrator();
      const rowBefore = await storedAdmin(admin.id);
      const app = await buildApp();
      assert.ok(database, "the scratch database was created");
      const { owner, name } = database;

      let held!: () => void;
      const holding = new Promise<void>((resolve) => {
        held = resolve;
      });
      let blockedStatements: string[] = [];
      const holder = migrated().$transaction(
        async (tx) => {
          await tx.$executeRaw`SELECT id FROM "AdminUser" WHERE id = ${admin.id} FOR UPDATE`;
          held();
          blockedStatements = await waitUntilBackendsBlocked(
            owner,
            name,
            2,
            GUARDED_WRITE_STATEMENT,
            "both guarded writes to block on the held row; without that overlap the case proves nothing"
          );
        },
        // The transaction must outlive the wait inside it, or Prisma ends the transaction first
        // and the wait's own message, which says what did not block, is lost.
        { timeout: 3 * BLOCKED_BACKENDS_TIMEOUT_MS }
      );
      await Promise.race([holding, holder]);

      // Both outcomes are awaited before either is judged, so a failed holder cannot leave the
      // two calls pending behind the lock it held.
      const [callsOutcome, holderOutcome] = await Promise.allSettled([
        Promise.all([
          change(app, admin.password, NEW_PASSWORD),
          change(app, admin.password, RIVAL_PASSWORD),
        ]),
        holder,
      ]);
      if (holderOutcome.status === "rejected") throw holderOutcome.reason;
      if (callsOutcome.status === "rejected") throw callsOutcome.reason;
      const calls = callsOutcome.value;

      assert.equal(blockedStatements.length, 2);

      const succeeded = calls.filter((call) => call.status === 200);
      const refused = calls.filter((call) => call.status !== 200);
      assert.equal(succeeded.length, 1);
      assert.deepEqual(refused, [
        { status: 409, body: { ok: false, error: "CONCURRENT_MODIFICATION" } },
      ]);
      const winner = calls[0]?.status === 200 ? NEW_PASSWORD : RIVAL_PASSWORD;
      const loser = winner === NEW_PASSWORD ? RIVAL_PASSWORD : NEW_PASSWORD;
      const row = await storedAdmin(admin.id);
      assert.equal(await verifyPassword(row.passwordHash, winner), true);
      assert.equal(await verifyPassword(row.passwordHash, loser), false);
      assert.equal(row.mustChangePassword, false);
      assert.deepEqual(row.passwordHistory, [rowBefore.passwordHash]);
    }
  );
});
