/**
 * @file customerPasswordReset.integration.test.ts
 * @description MERGE-BLOCKING integration proof for the customer password-reset pair,
 *   driven over HTTP (`app.inject`) against a REAL database through a guarded Prisma
 *   client built exactly as production builds it (`base.$extends(tenantGuardExtension(...))`).
 *
 *   Four properties are proven here and cannot be proven anywhere else:
 *
 *   1. **Reachability.** The four pre-identity customer-auth handlers (register, refresh,
 *      request-password-reset, reset-password) reach the enrolled `customerUser` model.
 *      Without a declared context seam the guard fails closed and they answer 500, 401,
 *      500 and 400 respectively — the 400 being the dangerous one, because it reads to a
 *      caller as an ordinary bad token.
 *   2. **Persisted outcome.** The confirm's success is asserted by reading the row back
 *      and verifying the stored hash in BOTH directions, never by counting calls.
 *   3. **Atomicity.** Two genuinely concurrent confirms of one token race in the database,
 *      not in one event loop. A Map-backed unit fake decides count-gating logic; only this
 *      row decides atomicity.
 *   4. **Leak immunity.** With a tenant context irreversibly bound in the calling frame, a
 *      confirm for a DIFFERENT tenant still claims its own row, and a guarded read after
 *      the request still scopes to the bound tenant.
 *
 *   Uniformity claims here are deliberately non-vacuous: every "these responses are
 *   identical" assertion is paired with a VALID token that must answer 200 in the same
 *   run, so a flow that fails identically for the wrong reason cannot satisfy it.
 *
 * @layer infrastructure
 */

import { describe, it, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import argon2 from "argon2";
import Fastify, { type FastifyInstance } from "fastify";
import { type PrismaClient } from "@infra/prisma";
import {
  tenantGuardExtension,
  type TenantContextProvider,
} from "@infra/prisma/extensions/tenantGuard.js";
import { ok } from "@shared/types";
import { InMemoryCacheAdapter } from "@adapters/cache-redis";
import { RegisterCustomerUseCase } from "@core/customer-auth/RegisterCustomerUseCase.js";
import { LoginCustomerUseCase } from "@core/customer-auth/LoginCustomerUseCase.js";
import { RefreshCustomerTokenUseCase } from "@core/customer-auth/RefreshCustomerTokenUseCase.js";
import { RequestPasswordResetUseCase } from "@core/customer-auth/RequestPasswordResetUseCase.js";
import { ResetPasswordUseCase } from "@core/customer-auth/ResetPasswordUseCase.js";
import { createSeedPrismaClient, assertSeedChannelConfigured } from "./helpers/seedPrismaClient.js";
import {
  getTenantContext,
  getSystemContext,
  withTenantContext,
  enterTenantContext,
} from "../../src/security/tenantContext.js";
import { Container } from "../../src/infrastructure/container/Container.js";
import { TOKENS } from "../../src/infrastructure/container/types.js";
import { PrismaCustomerUserRepository } from "../../src/infrastructure/repositories/PrismaCustomerUserRepository.js";
import { PrismaCustomerRoleRepository } from "../../src/infrastructure/repositories/PrismaCustomerRoleRepository.js";
import { PrismaAccountRepository } from "../../src/infrastructure/repositories/PrismaAccountRepository.js";
import { PrismaAccountQueryRepository } from "../../src/infrastructure/repositories/PrismaAccountQueryRepository.js";
import { PrismaUnitOfWork } from "../../src/infrastructure/unitofwork/PrismaUnitOfWork.js";
import { Argon2PasswordHasher } from "../../src/infrastructure/adapters/Argon2PasswordHasher.js";
import { CustomerTokenServiceAdapter } from "../../src/infrastructure/adapters/CustomerTokenServiceAdapter.js";
import { customerAuthRoutes } from "../../src/auth/customerAuthRoutes.js";
import { needsRehash } from "../../src/auth/passwordHashing.js";

assertSeedChannelConfigured();

const TAG = `custreset-${Date.now()}`;

const RESET_URL = "/auth/customer/reset-password";
const REQUEST_URL = "/auth/customer/request-password-reset";
const REFRESH_URL = "/auth/customer/refresh";
const REGISTER_URL = "/auth/customer/register";
const LOGIN_URL = "/auth/customer/login";

const hasher = new Argon2PasswordHasher();
const tokenService = new CustomerTokenServiceAdapter();

/**
 * Argon2id parameters deliberately weaker than the canonical ones, used only to
 * seed a stored hash that `needsRehash` reports as stale. The condition has to be
 * FORCED: waiting for a production parameter bump to make the rehash path live
 * would leave the revert it triggers unproven until the day it fires.
 */
const STALE_ARGON2_PARAMS = {
  type: argon2.argon2id,
  memoryCost: 19456,
  timeCost: 2,
  parallelism: 1,
  hashLength: 32,
} as const;

interface SeededUser {
  accountId: string;
  userId: string;
  email: string;
  password: string;
  passwordHash: string;
  token: string;
}

interface CapturedEmail {
  to: string[];
  body: string;
}

describe("Customer password reset — persisted outcomes through the guarded client", () => {
  let base: PrismaClient;
  let guarded: PrismaClient;
  let app: FastifyInstance;
  let ownerRoleId: string;
  let createdOwnerRole = false;

  const accountIds: string[] = [];
  const sentEmails: CapturedEmail[] = [];

  /**
   * Records the exact branch on which the guard is about to throw
   * `TenantContextMissingError` — no system context AND no tenant context on an
   * enrolled model. Observed at the PROVIDER rather than by stacking a second
   * extension, so extension composition order cannot silently change what this
   * probe sees. The two context readers are the real ambient ones.
   */
  const contextMisses: string[] = [];
  const observingProvider: TenantContextProvider = {
    getTenantContext,
    getSystemContext: () => {
      const system = getSystemContext();
      if (system === undefined && getTenantContext() === undefined) {
        contextMisses.push("enrolled-model reach with no bound context");
      }
      return system;
    },
  };

  async function seedAccount(label: string): Promise<string> {
    const account = await base.account.create({
      data: {
        name: `${TAG}-${label}`,
        email: `${TAG}-${label}-${randomUUID()}@test.local`,
        slug: `${TAG}-${label}-${randomUUID()}`,
      },
    });
    accountIds.push(account.id);
    return account.id;
  }

  async function seedUser(
    accountId: string,
    options: {
      email?: string;
      password?: string;
      tokenExpiry?: Date | null;
      deletedAt?: Date | null;
      withToken?: boolean;
      /** Store this exact hash instead of one produced at canonical parameters. */
      storedHash?: string;
    } = {}
  ): Promise<SeededUser> {
    const password = options.password ?? "seeded-password-value";
    const passwordHash = options.storedHash ?? (await hasher.hash(password));
    const email = options.email ?? `${TAG}-user-${randomUUID()}@test.local`;
    const token = `${TAG}-token-${randomUUID()}`;
    const withToken = options.withToken !== false;
    const row = await base.customerUser.create({
      data: {
        accountId,
        email,
        passwordHash,
        firstName: "Reset",
        lastName: "Target",
        roleId: ownerRoleId,
        ...(withToken && {
          resetToken: token,
          resetTokenExpiry: options.tokenExpiry ?? new Date(Date.now() + 60 * 60 * 1000),
        }),
        ...(options.deletedAt !== undefined &&
          options.deletedAt !== null && { deletedAt: options.deletedAt }),
      },
    });
    return { accountId, userId: row.id, email, password, passwordHash, token };
  }

  function storedHash(userId: string): Promise<string> {
    return base.customerUser
      .findUniqueOrThrow({ where: { id: userId }, select: { passwordHash: true } })
      .then((row) => row.passwordHash);
  }

  function readRow(userId: string) {
    return base.customerUser.findUniqueOrThrow({
      where: { id: userId },
      select: { passwordHash: true, resetToken: true, resetTokenExpiry: true, deletedAt: true },
    });
  }

  function confirm(token: string, newPassword: string) {
    return app.inject({ method: "POST", url: RESET_URL, payload: { token, newPassword } });
  }

  before(async () => {
    base = createSeedPrismaClient();

    const existingRole = await base.customerRole.findUnique({ where: { name: "OWNER" } });
    if (existingRole) {
      ownerRoleId = existingRole.id;
    } else {
      const created = await base.customerRole.create({
        data: { name: "OWNER", description: `${TAG} owner role`, level: 100 },
      });
      ownerRoleId = created.id;
      createdOwnerRole = true;
    }

    guarded = base.$extends(tenantGuardExtension(observingProvider)) as unknown as PrismaClient;

    const customerUserRepo = new PrismaCustomerUserRepository(guarded);
    const unitOfWork = new PrismaUnitOfWork(guarded);
    const emailPort = {
      send: async (options: { to: string[]; subject: string; body: string; html?: string }) => {
        sentEmails.push({ to: options.to, body: options.body });
        return ok(undefined);
      },
    };

    const container = new Container();
    container.registerInstance(
      TOKENS.RegisterCustomerUseCase,
      new RegisterCustomerUseCase(
        customerUserRepo,
        new PrismaCustomerRoleRepository(guarded),
        new PrismaAccountRepository(guarded),
        hasher,
        tokenService,
        undefined,
        unitOfWork
      )
    );
    container.registerInstance(
      TOKENS.RefreshCustomerTokenUseCase,
      new RefreshCustomerTokenUseCase(customerUserRepo, new InMemoryCacheAdapter(), tokenService)
    );
    container.registerInstance(
      TOKENS.RequestPasswordResetUseCase,
      new RequestPasswordResetUseCase(
        customerUserRepo,
        "https://portal.example.test",
        emailPort as never,
        unitOfWork,
        new PrismaAccountQueryRepository(guarded) as never
      )
    );
    container.registerInstance(
      TOKENS.ResetPasswordUseCase,
      new ResetPasswordUseCase(customerUserRepo, hasher, unitOfWork)
    );
    // The login use case IS exercised: the transparent rehash writes an upgraded
    // credential, and whether that credential survives the rest of the login is a
    // property only a real end-to-end run can settle. The brute-force gate and the
    // challenge store are the two collaborators a password login does not depend
    // on for its persistence outcome, so they are admissive doubles rather than
    // real adapters — Redis is not part of what this asserts.
    const permissiveBruteForce = {
      checkLoginAttempt: async () => ({
        allowed: true,
        delaySeconds: 0,
        captchaRequired: false,
      }),
      recordFailedAttempt: async () => undefined,
      recordSuccessfulAttempt: async () => undefined,
    };
    const unusedChallengeStore = {
      issue: async () => ok(undefined),
      consume: async () => ok("CONSUMED" as const),
    };
    container.registerInstance(
      TOKENS.LoginCustomerUseCase,
      new LoginCustomerUseCase(
        customerUserRepo,
        new PrismaAccountRepository(guarded),
        hasher,
        tokenService,
        permissiveBruteForce as never,
        unusedChallengeStore as never
      )
    );
    // MFA login and logout are registered because the plugin resolves every handler
    // at registration time. They are NOT the subject of this suite and no assertion
    // below exercises them.
    const unexercised = {
      execute: async () => {
        throw new Error("not exercised by this suite");
      },
    };
    container.registerInstance(TOKENS.CompleteCustomerMfaLoginUseCase, unexercised);
    container.registerInstance(TOKENS.LogoutCustomerUseCase, unexercised);

    app = Fastify();
    app.decorate("container", container);
    await app.register(customerAuthRoutes);
    await app.ready();
  });

  after(async () => {
    await app?.close();
    await base.customerUser
      .deleteMany({ where: { email: { startsWith: TAG } } })
      .catch(() => undefined);
    await base.account.deleteMany({ where: { name: { startsWith: TAG } } }).catch(() => undefined);
    if (createdOwnerRole) {
      await base.customerRole.delete({ where: { id: ownerRoleId } }).catch(() => undefined);
    }
    await base.$disconnect();
  });

  beforeEach(() => {
    contextMisses.length = 0;
    sentEmails.length = 0;
  });

  describe("the four pre-identity handlers answer their contract response", () => {
    it("register creates the account and user instead of failing closed", async () => {
      const email = `${TAG}-register-${randomUUID()}@test.local`;
      const res = await app.inject({
        method: "POST",
        url: REGISTER_URL,
        payload: {
          accountName: `${TAG}-register-account`,
          firstName: "New",
          lastName: "Customer",
          email,
          password: "register-password-value",
        },
      });

      assert.strictEqual(res.statusCode, 201, `register must answer 201, got ${res.body}`);
      assert.deepStrictEqual(contextMisses, [], "register must bind a context before the write");
      const created = await base.customerUser.findFirst({ where: { email } });
      assert.ok(created, "the registered user must be persisted");
      accountIds.push(created.accountId);
    });

    it("refresh re-issues tokens instead of answering USER_NOT_FOUND", async () => {
      const accountId = await seedAccount("refresh");
      const user = await seedUser(accountId, { withToken: false });
      const refreshToken = tokenService.signRefreshToken(user.userId, randomUUID());

      const res = await app.inject({
        method: "POST",
        url: REFRESH_URL,
        payload: { refreshToken },
      });

      assert.strictEqual(res.statusCode, 200, `refresh must answer 200, got ${res.body}`);
      assert.deepStrictEqual(contextMisses, [], "refresh must bind a context before the read");
    });

    it("request-password-reset answers its uniform body instead of 500", async () => {
      const accountId = await seedAccount("request");
      const user = await seedUser(accountId, { withToken: false });

      const res = await app.inject({
        method: "POST",
        url: REQUEST_URL,
        payload: { email: user.email },
      });

      assert.strictEqual(res.statusCode, 200, `request must answer 200, got ${res.body}`);
      assert.deepStrictEqual(contextMisses, [], "request must bind a context before the lookup");
    });

    it("reset-password confirms instead of reporting a bad token", async () => {
      const accountId = await seedAccount("confirm");
      const user = await seedUser(accountId);

      const res = await confirm(user.token, "confirm-password-value");

      assert.strictEqual(
        res.statusCode,
        200,
        `confirm must answer 200 — a 400 here is a context failure wearing a token verdict, got ${res.body}`
      );
      assert.deepStrictEqual(contextMisses, [], "confirm must bind a context before the claim");
    });
  });

  describe("the confirm changes the stored password", () => {
    it("stores a hash verifying the new password only, and consumes the token", async () => {
      const accountId = await seedAccount("d1");
      const user = await seedUser(accountId);
      const newPassword = "d1-new-password-value";

      const res = await confirm(user.token, newPassword);
      assert.strictEqual(res.statusCode, 200, res.body);

      const row = await readRow(user.userId);
      assert.strictEqual(
        await argon2.verify(row.passwordHash, newPassword),
        true,
        "the PERSISTED hash must verify against the new password"
      );
      assert.strictEqual(
        await argon2.verify(row.passwordHash, user.password),
        false,
        "the PERSISTED hash must no longer verify against the old password"
      );
      assert.strictEqual(row.resetToken, null, "the token must be consumed");
      assert.strictEqual(row.resetTokenExpiry, null);
    });
  });

  describe("one token, one claim", () => {
    it("answers exactly one of two concurrent confirms with ok", async () => {
      const accountId = await seedAccount("d2");
      const user = await seedUser(accountId);
      const firstPassword = "d2-first-password-value";
      const secondPassword = "d2-second-password-value";

      const [first, second] = await Promise.all([
        confirm(user.token, firstPassword),
        confirm(user.token, secondPassword),
      ]);

      const statuses = [first.statusCode, second.statusCode].sort();
      assert.deepStrictEqual(
        statuses,
        [200, 400],
        `exactly one confirm may succeed — got ${first.statusCode}/${second.statusCode}`
      );

      const winnerPassword = first.statusCode === 200 ? firstPassword : secondPassword;
      const loserPassword = first.statusCode === 200 ? secondPassword : firstPassword;
      const row = await readRow(user.userId);
      assert.strictEqual(await argon2.verify(row.passwordHash, winnerPassword), true);
      assert.strictEqual(
        await argon2.verify(row.passwordHash, loserPassword),
        false,
        "the loser's password must never be stored"
      );
      assert.strictEqual(row.resetToken, null);
      assert.strictEqual(row.resetTokenExpiry, null);
    });

    it("refuses a sequential replay and leaves the first confirm's hash byte-identical", async () => {
      const accountId = await seedAccount("replay");
      const user = await seedUser(accountId);

      const firstRes = await confirm(user.token, "replay-first-password");
      assert.strictEqual(firstRes.statusCode, 200, firstRes.body);
      const afterFirst = await storedHash(user.userId);

      const replay = await confirm(user.token, "replay-second-password");
      assert.strictEqual(replay.statusCode, 400, "a consumed token must be refused");

      assert.strictEqual(
        await storedHash(user.userId),
        afterFirst,
        "the stored hash must be byte-identical to the one the first confirm stored"
      );
    });
  });

  describe("every unusable token is answered identically", () => {
    it("gives one status, code and message to unknown, expired, claimed and deleted-owner tokens", async () => {
      const accountId = await seedAccount("codes");

      const expired = await seedUser(accountId, {
        tokenExpiry: new Date(Date.now() - 60 * 60 * 1000),
      });
      const claimed = await seedUser(accountId);
      const deletedOwner = await seedUser(accountId, { deletedAt: new Date() });
      const live = await seedUser(accountId);

      const claimRes = await confirm(claimed.token, "already-claimed-password");
      assert.strictEqual(claimRes.statusCode, 200, claimRes.body);

      const responses = await Promise.all([
        confirm(`${TAG}-unknown-${randomUUID()}`, "bad-token-password-one"),
        confirm(expired.token, "bad-token-password-two"),
        confirm(claimed.token, "bad-token-password-three"),
        confirm(deletedOwner.token, "bad-token-password-four"),
      ]);

      const shapes = responses.map((res) => `${res.statusCode}:${res.body}`);
      assert.strictEqual(
        new Set(shapes).size,
        1,
        `all four unusable-token classes must be indistinguishable — got ${JSON.stringify(shapes)}`
      );
      assert.strictEqual(responses[0]?.statusCode, 400);

      // Non-vacuity: a flow that failed identically for the WRONG reason would
      // satisfy the assertion above. A live token in the same run must answer 200.
      const liveRes = await confirm(live.token, "live-token-password-value");
      assert.strictEqual(
        liveRes.statusCode,
        200,
        "the uniformity claim is only meaningful while a VALID token still succeeds"
      );

      const expiredRow = await readRow(expired.userId);
      assert.strictEqual(
        expiredRow.resetToken,
        expired.token,
        "a failed attempt must not consume the expired token"
      );
      const deletedRow = await readRow(deletedOwner.userId);
      assert.strictEqual(deletedRow.passwordHash, deletedOwner.passwordHash);
      assert.notStrictEqual(deletedRow.deletedAt, null, "a deleted owner must stay deleted");
    });
  });

  describe("one address in several accounts", () => {
    it("issues one distinct persisted token per account with no unique-constraint failure", async () => {
      const sharedEmail = `${TAG}-shared-${randomUUID()}@test.local`;
      const seeded: SeededUser[] = [];
      for (const label of ["d3a", "d3b", "d3c"]) {
        const accountId = await seedAccount(label);
        seeded.push(await seedUser(accountId, { email: sharedEmail, withToken: false }));
      }

      const res = await app.inject({
        method: "POST",
        url: REQUEST_URL,
        payload: { email: sharedEmail },
      });
      assert.strictEqual(res.statusCode, 200, res.body);

      const rows = await Promise.all(seeded.map((user) => readRow(user.userId)));
      for (const row of rows) {
        assert.notStrictEqual(row.resetToken, null, "every matched row must carry its own token");
      }
      const tokens = rows.map((row) => row.resetToken);
      assert.strictEqual(
        new Set(tokens).size,
        3,
        "the three tokens must be pairwise distinct — one token across rows collides on a globally-unique column"
      );
      assert.strictEqual(sentEmails.length, 1, "exactly ONE e-mail may be sent");

      // Each token claims only its own row.
      const secondToken = rows[1]?.resetToken;
      assert.ok(secondToken);
      const confirmRes = await confirm(secondToken, "multi-account-new-password");
      assert.strictEqual(confirmRes.statusCode, 200, confirmRes.body);

      const after = await Promise.all(seeded.map((user) => readRow(user.userId)));
      assert.strictEqual(
        await argon2.verify(after[1]?.passwordHash ?? "", "multi-account-new-password"),
        true
      );
      assert.strictEqual(after[1]?.resetToken, null);
      for (const index of [0, 2]) {
        assert.strictEqual(
          after[index]?.passwordHash,
          seeded[index]?.passwordHash,
          "an untargeted row keeps its original hash"
        );
        assert.strictEqual(
          after[index]?.resetToken,
          rows[index]?.resetToken,
          "an untargeted row keeps its still-live token"
        );
      }
    });

    it("answers a matching and a non-matching address identically", async () => {
      const accountId = await seedAccount("silhouette");
      const user = await seedUser(accountId, { withToken: false });

      const matched = await app.inject({
        method: "POST",
        url: REQUEST_URL,
        payload: { email: user.email },
      });
      const unmatched = await app.inject({
        method: "POST",
        url: REQUEST_URL,
        payload: { email: `${TAG}-nobody-${randomUUID()}@test.local` },
      });

      assert.strictEqual(matched.statusCode, unmatched.statusCode);
      assert.strictEqual(matched.body, unmatched.body);
      assert.strictEqual(sentEmails.length, 1, "only the matching address may trigger a send");
    });
  });

  describe("leak immunity of the declared seam", () => {
    it("claims the token's own row while a foreign tenant context is bound in the frame", async () => {
      const accountA = await seedAccount("leak-a");
      const userA = await seedUser(accountA, { withToken: false });
      const accountB = await seedAccount("leak-b");
      const userB = await seedUser(accountB);

      // `app.inject` has no socket, so "the same keep-alive connection" is not
      // expressible. Binding tenant A with the IRREVERSIBLE primitive inside this
      // frame is strictly stronger than hoping a previous request's context
      // survived: the foreign context is GUARANTEED present when B's confirm runs.
      // The outer `withTenantContext` only contains that irreversibility to this
      // test — `.run()` restores the ambient store on exit.
      //
      // Under the wrap, leak and no-leak are OBSERVATIONALLY IDENTICAL (system
      // context wins over tenant context in both the guard and the GUC scope), so
      // this probe says nothing about whether `enterTenantContext` leaks across
      // requests. It is a regression oracle for the wrap itself and for
      // system-before-tenant precedence.
      const outcome = await withTenantContext({ accountId: accountA }, async () => {
        enterTenantContext({ accountId: accountA });
        const res = await confirm(userB.token, "leak-probe-new-password");
        const visible = await guarded.customerUser.findMany({
          where: { email: { startsWith: TAG } },
          select: { id: true, accountId: true },
        });
        return { res, visible };
      });

      assert.strictEqual(
        outcome.res.statusCode,
        200,
        `B's token must claim B's row regardless of the bound tenant, got ${outcome.res.body}`
      );

      const rowB = await readRow(userB.userId);
      assert.strictEqual(await argon2.verify(rowB.passwordHash, "leak-probe-new-password"), true);
      assert.strictEqual(rowB.resetToken, null);

      const rowA = await readRow(userA.userId);
      assert.strictEqual(rowA.passwordHash, userA.passwordHash, "A's row must be untouched");

      assert.ok(
        outcome.visible.length > 0 && outcome.visible.every((row) => row.accountId === accountA),
        "a guarded read AFTER the request must still scope to A — the handler's system context must not escape forward"
      );
    });
  });

  describe("a login that upgrades the stored hash keeps the upgrade", () => {
    it("leaves the UPGRADED hash stored once the whole login completes", async () => {
      const accountId = await seedAccount("rehash");
      const password = "rehash-password-value";
      const staleHash = await argon2.hash(password, STALE_ARGON2_PARAMS);
      const user = await seedUser(accountId, { password, storedHash: staleHash, withToken: false });

      // The fixture is only meaningful while the stored hash genuinely asks to be
      // upgraded. Asserting it up front stops this from degrading into a test that
      // passes because the rehash branch never ran.
      assert.strictEqual(
        needsRehash(staleHash),
        true,
        "the seeded hash must require a rehash, otherwise the branch under test is never entered"
      );
      assert.strictEqual(
        await storedHash(user.userId),
        staleHash,
        "the stale hash must be what the row holds before the login"
      );

      const res = await app.inject({
        method: "POST",
        url: LOGIN_URL,
        payload: { email: user.email, password },
      });
      assert.strictEqual(res.statusCode, 200, `login must succeed, got ${res.body}`);

      const afterLogin = await base.customerUser.findUniqueOrThrow({
        where: { id: user.userId },
        select: { passwordHash: true, lastLoginAt: true },
      });

      assert.strictEqual(
        await argon2.verify(afterLogin.passwordHash, password),
        true,
        "the stored hash must still verify the password"
      );
      assert.notStrictEqual(
        afterLogin.passwordHash,
        staleHash,
        "the UPGRADED hash must be the one that survives — a later write in the same login must not restore the hash the login set out to replace"
      );
      assert.strictEqual(
        needsRehash(afterLogin.passwordHash),
        false,
        "the surviving hash must be at the canonical parameters, not merely different"
      );
      assert.notStrictEqual(
        afterLogin.lastLoginAt,
        null,
        "the login must also have been recorded — the upgrade surviving because nothing else was written would prove nothing"
      );
    });
  });

  describe("customer-user persistence joins the ambient transaction", () => {
    it("leaves no write behind when the enclosing transaction rolls back", async () => {
      const accountId = await seedAccount("rollback");
      const user = await seedUser(accountId, { withToken: false });
      const repo = new PrismaCustomerUserRepository(guarded);
      const unitOfWork = new PrismaUnitOfWork(guarded);
      const rolledBackHash = await hasher.hash("rolled-back-password-value");

      await assert.rejects(
        withTenantContext({ accountId }, () =>
          unitOfWork.executeInTransaction(async () => {
            const written = await repo.updatePasswordHash(user.userId, rolledBackHash);
            assert.ok(written.ok, "the in-transaction write must report success before the abort");
            throw new Error("deliberate abort");
          })
        ),
        /deliberate abort/
      );

      assert.strictEqual(
        await storedHash(user.userId),
        user.passwordHash,
        "the write must have joined the rolled-back transaction, not committed on a second pooled connection"
      );
    });
  });
});
