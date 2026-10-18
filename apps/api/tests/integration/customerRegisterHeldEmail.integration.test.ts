/**
 * @file customerRegisterHeldEmail.integration.test.ts
 * @description Real-database proof of what POST /auth/customer/register answers when the e-mail
 *   it claims is already held, by what holds it:
 *
 *   - nothing, because the holder was HARD-deleted: the registration succeeds;
 *   - a LIVE account, with or without a live user: 409 "Email already exists", no notice, also
 *     when the attempt types the address in another casing;
 *   - a SOFT-deleted account (whatever its user's state) or a live account whose user was
 *     soft-deleted: the same 409, byte for byte, and a notice to the owner of the address.
 *
 *   The refusal is identical for every holder so it adds no state a caller can enumerate; only
 *   the owner of the address, in their own inbox, learns that a deleted account holds it. Every
 *   refusal writes nothing.
 *
 *   The use case's duplicate check once read only live CUSTOMER USERS across accounts, while
 *   `Account_email_key` is a partial unique on the ACCOUNT's e-mail among live accounts. A live
 *   account the check could not see collided at the account insert and the route answered 500;
 *   a soft-deleted account the index does not cover let the registration create a second
 *   account beside it. Only the real client, the real driver adapter and the real partial index
 *   can show what the route answers; a double reproduces whatever shape it was given.
 *
 *   The route's answers are asserted through `createApp()`. Who gets a notice is asserted on the
 *   use case itself, over the same real repositories and Unit of Work: behind the route the notice
 *   is dispatched after the response, through a platform-settings read and the throttle's cache,
 *   so no point after the response says the dispatch has ended. Here the platform links resolve
 *   without I/O and the notice mailer records synchronously, so every notice is in by the end of
 *   the event-loop turn the refusal settles in, and the count is final. The route is held
 *   to that same use case by the container check: the mailer it is handed is the throttled one.
 *
 *   The last case drives the use case over the real account repository and the real Unit of Work
 *   with a user insert that fails, and proves the account written before it is rolled back rather
 *   than left behind on its own connection.
 * @layer infrastructure
 */

import { describe, it, before, after, mock } from "node:test";
import assert from "node:assert/strict";
import type { FastifyInstance } from "fastify";
import type { PrismaClient } from "@infra/prisma";
import { ok, err } from "@shared/types";
import { PrismaUnitOfWork } from "@adapters/db-prisma";
import {
  RegisterCustomerUseCase,
  type RegisterCustomerInput,
} from "@core/customer-auth/RegisterCustomerUseCase.js";
import type { CustomerUserRepository } from "@core/domain/repositories/CustomerUserRepository.js";
import type { DeletedAccountNoticeMailer } from "@core/domain/repositories/DeletedAccountNoticeMailer.js";
import type { PlatformCredentialReader } from "@core/domain/repositories/PlatformCredentialReader.js";
import type { LoggerPort } from "@ports/core";
import { createSeedPrismaClient } from "./helpers/seedPrismaClient.js";
import { createApp } from "../../src/index.js";
import { TOKENS } from "../../src/infrastructure/container/types.js";
import { TransactionalEmailAdapter } from "../../src/infrastructure/adapters/TransactionalEmailAdapter.js";
import { ThrottledDeletedAccountNoticeMailer } from "../../src/infrastructure/adapters/ThrottledDeletedAccountNoticeMailer.js";
import { PrismaAccountRepository } from "../../src/infrastructure/repositories/PrismaAccountRepository.js";
import { PrismaCustomerUserRepository } from "../../src/infrastructure/repositories/PrismaCustomerUserRepository.js";
import { PrismaCustomerRoleRepository } from "../../src/infrastructure/repositories/PrismaCustomerRoleRepository.js";
import { PrismaAccountSubscriptionAdapter } from "../../src/infrastructure/repositories/PrismaAccountSubscriptionAdapter.js";
import { Argon2PasswordHasher } from "../../src/infrastructure/adapters/Argon2PasswordHasher.js";
import { CustomerTokenServiceAdapter } from "../../src/infrastructure/adapters/CustomerTokenServiceAdapter.js";
import {
  ambientTenantContextProvider,
  withSystemContext,
} from "../../src/security/tenantContext.js";
import { CUSTOMER_REGISTER_SYSTEM_REASON } from "../../src/auth/customerAuthSystemReasons.js";

const TAG = `register-held-email-${Date.now()}`;
const REGISTER_URL = "/auth/customer/register";
const PASSWORD = "register-password-value";
const SOFT_DELETED_AT = new Date("2026-10-01T00:00:00.000Z");
const SUPPORT_EMAIL = "support@example.test";

/** The one refusal every holder gets, as the route has always written it. */
const EMAIL_EXISTS_BODY = JSON.stringify({ ok: false, error: "Email already exists" });

type HolderState = { readonly accountDeleted: boolean; readonly user: "none" | "live" | "deleted" };

/** Every held shape: what holds the address, and whether its owner gets the notice. */
const HELD_SHAPES: readonly {
  readonly name: string;
  readonly slug: string;
  readonly state: HolderState;
  readonly notice: boolean;
}[] = [
  {
    name: "a live account and its live owner",
    slug: "live-account-live-user",
    state: { accountDeleted: false, user: "live" },
    notice: false,
  },
  {
    name: "a live account that has no user",
    slug: "live-account-no-user",
    state: { accountDeleted: false, user: "none" },
    notice: false,
  },
  {
    name: "a live account whose only user was soft-deleted",
    slug: "live-account-deleted-user",
    state: { accountDeleted: false, user: "deleted" },
    notice: true,
  },
  {
    name: "a soft-deleted account whose owner is still live",
    slug: "deleted-account-live-user",
    state: { accountDeleted: true, user: "live" },
    notice: true,
  },
  {
    name: "a soft-deleted account whose owner was soft-deleted too",
    slug: "deleted-account-deleted-user",
    state: { accountDeleted: true, user: "deleted" },
    notice: true,
  },
  {
    name: "a soft-deleted account that never had a user",
    slug: "deleted-account-no-user",
    state: { accountDeleted: true, user: "none" },
    notice: true,
  },
];

/** The platform links, read without I/O so a notice's dispatch ends within microtasks. */
const platformLinks: PlatformCredentialReader = {
  getPlatformCredentials: async () =>
    ok({ baseUrl: "https://app.example.test", supportEmail: SUPPORT_EMAIL }),
};

/**
 * @param slug - The shape's identifier.
 * @returns The address that shape's holder carries.
 */
function addressFor(slug: string): string {
  return `${TAG}-${slug}@example.test`;
}

/**
 * @param email - The address the registration claims for both the account and its owner.
 * @returns The registration input the route would build for that address.
 */
function attemptFor(email: string): RegisterCustomerInput {
  return {
    accountName: `${TAG}-attempt`,
    accountEmail: email,
    firstName: "Returning",
    lastName: "Customer",
    email,
    password: PASSWORD,
  };
}

/**
 * @param notified - Receives, in order, every address a notice is sent to.
 * @returns A notice mailer that records each notice synchronously and sends nothing.
 */
function recordingNoticeMailer(notified: string[]): DeletedAccountNoticeMailer {
  return {
    notifyRegistrationAttemptOnDeletedAccount: async (to: string) => {
      notified.push(to);
      return ok(undefined);
    },
  };
}

/**
 * @param logged - Receives the arguments of every log call.
 * @returns A logger that records each call and writes nothing.
 */
function recordingLogger(logged: unknown[]): LoggerPort {
  return {
    error: (...args: unknown[]) => {
      logged.push(args);
    },
    warn: (...args: unknown[]) => {
      logged.push(args);
    },
  };
}

/**
 * Waits out the current event-loop turn: `setImmediate` fires in the check phase, after the
 * microtask queue has drained and after the turn's I/O callbacks, so every promise continuation
 * queued before it, and every one those queue in turn, has run by then.
 * @returns A promise that settles in the check phase of the current event-loop turn.
 */
function afterCurrentTurn(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

describe("POST /auth/customer/register with an e-mail something already holds", () => {
  let app: FastifyInstance;
  let prisma: PrismaClient;
  let ownerRoleId: string;
  let createdOwnerRole = false;

  before(async () => {
    prisma = createSeedPrismaClient();

    // Registration resolves the OWNER role before it writes anything; without it every attempt
    // fails for a reason that has nothing to do with the e-mail.
    const existingRole = await prisma.customerRole.findUnique({ where: { name: "OWNER" } });
    if (existingRole) {
      ownerRoleId = existingRole.id;
    } else {
      const created = await prisma.customerRole.create({
        data: { name: "OWNER", description: `${TAG} owner role`, level: 100 },
      });
      ownerRoleId = created.id;
      createdOwnerRole = true;
    }

    // The route's refusals still dispatch their notices through the container. Answering on the
    // prototype, which the app's adapter instance inherits, keeps every one of them away from
    // the transport.
    mock.method(
      TransactionalEmailAdapter.prototype,
      "notifyRegistrationAttemptOnDeletedAccount",
      async () => ok(undefined)
    );

    app = await createApp();
    await app.ready();
  });

  after(async () => {
    // Closed before the prototype is restored: a notice the last refusal dispatched may still be
    // on its way, and it must meet the recorded method or a closed connection, never the
    // transport.
    await app?.close();
    mock.restoreAll();
    if (prisma) {
      await prisma.customerUser
        .deleteMany({ where: { email: { startsWith: TAG } } })
        .catch(() => undefined);
      await prisma.account
        .deleteMany({
          where: { OR: [{ name: { startsWith: TAG } }, { email: { startsWith: TAG } }] },
        })
        .catch(() => undefined);
      if (createdOwnerRole) {
        await prisma.customerRole.delete({ where: { id: ownerRoleId } }).catch(() => undefined);
      }
      await prisma.$disconnect();
    }
  });

  /**
   * @param email - The address the registration claims for both the account and its owner.
   * @returns The route's response to a registration for that address.
   */
  async function register(email: string) {
    return app.inject({
      method: "POST",
      url: REGISTER_URL,
      payload: {
        accountName: `${TAG}-attempt`,
        firstName: "Returning",
        lastName: "Customer",
        email,
        password: PASSWORD,
      },
    });
  }

  /**
   * @param notified - Receives every address the use case sends a notice to.
   * @param logged - Receives the arguments of every log call the use case makes.
   * @returns The registration use case over the real repositories and the real Unit of Work.
   */
  function registrationOver(notified: string[], logged: unknown[]): RegisterCustomerUseCase {
    return new RegisterCustomerUseCase(
      new PrismaCustomerUserRepository(prisma),
      new PrismaCustomerRoleRepository(prisma),
      new PrismaAccountRepository(prisma),
      new Argon2PasswordHasher(),
      new CustomerTokenServiceAdapter(),
      recordingLogger(logged),
      recordingNoticeMailer(notified),
      new PrismaAccountSubscriptionAdapter(prisma),
      undefined,
      platformLinks,
      new PrismaUnitOfWork(prisma, ambientTenantContextProvider)
    );
  }

  /**
   * @param email - The address whose rows are read.
   * @returns Every account and every customer user carrying the address, deleted or not.
   */
  async function rowsFor(email: string) {
    const accounts = await prisma.account.findMany({
      where: { email },
      select: { id: true, deletedAt: true },
      orderBy: { id: "asc" },
    });
    const users = await prisma.customerUser.findMany({
      where: { email },
      select: { id: true, accountId: true, deletedAt: true },
      orderBy: { id: "asc" },
    });
    return { accounts, users };
  }

  /**
   * @param email - The address the account and, when asked, its owner carry.
   * @param state - Which rows exist and which of them are soft-deleted.
   * @returns The id of the seeded account.
   */
  async function seedHolder(email: string, state: HolderState): Promise<string> {
    const account = await prisma.account.create({
      data: {
        email,
        name: `${TAG}-held`,
        ...(state.accountDeleted && { deletedAt: SOFT_DELETED_AT }),
      },
    });
    if (state.user !== "none") {
      await prisma.customerUser.create({
        data: {
          accountId: account.id,
          email,
          passwordHash: "",
          firstName: "Former",
          lastName: "Owner",
          roleId: ownerRoleId,
          ...(state.user === "deleted" && { deletedAt: SOFT_DELETED_AT }),
        },
      });
    }
    return account.id;
  }

  /**
   * @param email - The address whose live account and live owner are seeded and then erased.
   */
  async function seedHardDeletedHolder(email: string): Promise<void> {
    const accountId = await seedHolder(email, { accountDeleted: false, user: "live" });
    await prisma.customerUser.deleteMany({ where: { accountId } });
    await prisma.account.delete({ where: { id: accountId } });
  }

  it("registers an e-mail whose account and owner were hard-deleted", async () => {
    const email = addressFor("hard-deleted");
    await seedHardDeletedHolder(email);

    const res = await register(email);

    assert.equal(
      res.statusCode,
      201,
      `a hard-deleted holder leaves nothing behind, got ${res.body}`
    );
    const { accounts, users } = await rowsFor(email);
    assert.equal(accounts.length, 1, "the registration creates exactly one account");
    assert.equal(accounts[0]?.deletedAt, null);
    assert.equal(users.length, 1, "the registration creates exactly one user");
    assert.equal(users[0]?.accountId, accounts[0]?.id);
  });

  for (const { name, slug, state } of HELD_SHAPES) {
    it(`answers the one EMAIL_EXISTS refusal when ${name}, and writes nothing`, async () => {
      const email = addressFor(slug);
      await seedHolder(email, state);
      const before = await rowsFor(email);

      const res = await register(email);

      assert.equal(res.statusCode, 409, `expected the refusal for ${email}, got ${res.body}`);
      assert.equal(
        res.body,
        EMAIL_EXISTS_BODY,
        "every holder gets the same refusal, byte for byte"
      );
      assert.deepEqual(
        await rowsFor(email),
        before,
        "the refused registration must neither add nor change a row"
      );
    });
  }

  it("answers the EMAIL_EXISTS refusal when a live account holds the address in another casing, and writes nothing", async () => {
    // `foo@example.com` and `FOO@EXAMPLE.COM` are one registration identity. The holder carries
    // the canonical form registration stores; the attempt types the same address in capitals. A
    // check that compared raw bytes would miss the holder and give one person a second account.
    const held = addressFor("case-twin");
    const twin = held.toUpperCase();
    assert.notEqual(
      twin,
      held,
      "the attempt must differ from the holder's bytes or it proves nothing"
    );
    await seedHolder(held, { accountDeleted: false, user: "live" });
    const before = await rowsFor(held);

    const res = await register(twin);

    assert.equal(res.statusCode, 409, `expected the refusal for ${twin}, got ${res.body}`);
    assert.equal(res.body, EMAIL_EXISTS_BODY, "the case-twin gets the one refusal, byte for byte");
    assert.deepEqual(
      await rowsFor(held),
      before,
      "the refused registration must neither add nor change a row of the holder"
    );
    assert.deepEqual(
      await rowsFor(twin),
      { accounts: [], users: [] },
      "no row carries the address as the attempt typed it"
    );
  });

  it("hands the registration a notice mailer that throttles each address", () => {
    const container = app.container;
    assert.ok(container, "createApp() decorates the instance with its container");

    const noticeMailer = container.resolve<DeletedAccountNoticeMailer>(
      TOKENS.DeletedAccountNoticeMailer
    );

    assert.ok(
      noticeMailer instanceof ThrottledDeletedAccountNoticeMailer,
      "the notice the route triggers goes through the per-address throttle"
    );
  });

  for (const { name, slug, state, notice } of HELD_SHAPES) {
    it(`sends ${notice ? "exactly one notice, to the address," : "no notice"} when ${name}`, async () => {
      const email = addressFor(`notice-${slug}`);
      await seedHolder(email, state);
      const notified: string[] = [];
      const logged: unknown[] = [];

      const result = await withSystemContext(CUSTOMER_REGISTER_SYSTEM_REASON, () =>
        registrationOver(notified, logged).execute(attemptFor(email))
      );
      await afterCurrentTurn();

      assert.deepEqual(result, err("EMAIL_EXISTS"));
      assert.deepEqual(
        notified,
        notice ? [email] : [],
        "one notice for a deleted holder, none for a live one"
      );
      assert.deepEqual(logged, [], "the refusal and its notice log nothing");
    });
  }

  it("sends no notice when the holder was hard-deleted, and registers the address", async () => {
    const email = addressFor("notice-hard-deleted");
    await seedHardDeletedHolder(email);
    const notified: string[] = [];
    const logged: unknown[] = [];

    const result = await withSystemContext(CUSTOMER_REGISTER_SYSTEM_REASON, () =>
      registrationOver(notified, logged).execute(attemptFor(email))
    );
    await afterCurrentTurn();

    assert.equal(result.ok, true, "a hard-deleted holder leaves the address free");
    assert.deepEqual(notified, [], "no deleted holder, so no notice");
    assert.deepEqual(logged, []);
  });

  it("rolls the account and its trial back when the user insert fails inside the unit of work", async () => {
    const email = addressFor("rolled-back");
    const failingUsers = {
      findByEmailAcrossAccounts: async () => [],
      existsDeletedByEmailAcrossAccounts: async () => false,
      create: async () => err("INTERNAL_ERROR" as const),
    } as unknown as CustomerUserRepository;
    const notified: string[] = [];
    const logged: unknown[] = [];
    const useCase = new RegisterCustomerUseCase(
      failingUsers,
      new PrismaCustomerRoleRepository(prisma),
      new PrismaAccountRepository(prisma),
      new Argon2PasswordHasher(),
      new CustomerTokenServiceAdapter(),
      recordingLogger(logged),
      recordingNoticeMailer(notified),
      new PrismaAccountSubscriptionAdapter(prisma),
      undefined,
      platformLinks,
      new PrismaUnitOfWork(prisma, ambientTenantContextProvider)
    );

    const result = await withSystemContext(CUSTOMER_REGISTER_SYSTEM_REASON, () =>
      useCase.execute({ ...attemptFor(email), accountName: `${TAG}-rolled-back` })
    );

    assert.deepEqual(result, err("INTERNAL_ERROR"));
    const { accounts } = await rowsFor(email);
    assert.equal(accounts.length, 0, "the account written before the failed insert is rolled back");
    const trials = await prisma.accountSubscription.count({
      where: { account: { email } },
    });
    assert.equal(trials, 0, "the trial subscription written with it is rolled back too");
    assert.deepEqual(notified, [], "a failed registration is not a refusal, so no notice");
  });
});
