/**
 * @file customerRegisterHeldEmail.integration.test.ts
 * @description Real-database proof of what POST /auth/customer/register answers when the e-mail
 *   it claims is already held, by what holds it:
 *
 *   - nothing, because the holder was HARD-deleted: the registration succeeds;
 *   - a LIVE account, with or without a live user: 409 "Email already exists", no notice;
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
 *   The notice is observed at the transactional-email adapter: `createApp()` builds its own
 *   container and offers no override, so the suite records calls to the adapter's notice
 *   method on its prototype, which the container's instance inherits, and sends nothing.
 *
 *   The last case drives the use case directly over the real account repository and the real
 *   Unit of Work with a user insert that fails, and proves the account written before it is
 *   rolled back rather than left behind on its own connection.
 * @layer infrastructure
 */

import { describe, it, before, after, mock } from "node:test";
import assert from "node:assert/strict";
import type { FastifyInstance } from "fastify";
import type { PrismaClient } from "@infra/prisma";
import { ok, err } from "@shared/types";
import { PrismaUnitOfWork } from "@adapters/db-prisma";
import { RegisterCustomerUseCase } from "@core/customer-auth/RegisterCustomerUseCase.js";
import type { CustomerUserRepository } from "@core/domain/repositories/CustomerUserRepository.js";
import { createSeedPrismaClient } from "./helpers/seedPrismaClient.js";
import { createApp } from "../../src/index.js";
import { TransactionalEmailAdapter } from "../../src/infrastructure/adapters/TransactionalEmailAdapter.js";
import { PrismaAccountRepository } from "../../src/infrastructure/repositories/PrismaAccountRepository.js";
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

/** The one refusal every holder gets, as the route has always written it. */
const EMAIL_EXISTS_BODY = JSON.stringify({ ok: false, error: "Email already exists" });

/** How long a notice may take to reach the adapter after the refusal is answered. */
const NOTICE_WAIT_MS = 5_000;

/** How long the suite waits for a notice that must NOT arrive before it says so. */
const QUIET_PERIOD_MS = 300;

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

/**
 * @param slug - The shape's identifier.
 * @returns The address that shape's holder carries.
 */
function addressFor(slug: string): string {
  return `${TAG}-${slug}@example.test`;
}

/**
 * @param ms - How long to wait.
 * @returns A promise that settles after that long.
 */
function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe("POST /auth/customer/register with an e-mail something already holds", () => {
  let app: FastifyInstance;
  let prisma: PrismaClient;
  let ownerRoleId: string;
  let createdOwnerRole = false;
  const notices: string[] = [];

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

    // Recorded on the prototype before the app builds its adapter instance, which inherits it.
    mock.method(
      TransactionalEmailAdapter.prototype,
      "notifyRegistrationAttemptOnDeletedAccount",
      async (to: string) => {
        notices.push(to);
        return ok(undefined);
      }
    );

    app = await createApp();
    await app.ready();
  });

  after(async () => {
    mock.restoreAll();
    await app?.close();
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

  it("registers an e-mail whose account and owner were hard-deleted", async () => {
    const email = addressFor("hard-deleted");
    const accountId = await seedHolder(email, { accountDeleted: false, user: "live" });
    await prisma.customerUser.deleteMany({ where: { accountId } });
    await prisma.account.delete({ where: { id: accountId } });

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

  it("sends the notice to the owner of every deleted holder's address, and to no one else", async () => {
    const expected = HELD_SHAPES.filter((shape) => shape.notice)
      .map((shape) => addressFor(shape.slug))
      .sort();

    const deadline = Date.now() + NOTICE_WAIT_MS;
    while (notices.length < expected.length && Date.now() < deadline) {
      await delay(25);
    }
    // A notice that should not exist would have had at least as long as the ones awaited.
    await delay(QUIET_PERIOD_MS);

    assert.deepEqual(
      [...notices].sort(),
      expected,
      "exactly one notice per deleted holder, none for a live holder or a hard-deleted one"
    );
  });

  it("rolls the account and its trial back when the user insert fails inside the unit of work", async () => {
    const email = addressFor("rolled-back");
    const failingUsers = {
      findByEmailAcrossAccounts: async () => [],
      existsDeletedByEmailAcrossAccounts: async () => false,
      create: async () => err("INTERNAL_ERROR" as const),
    } as unknown as CustomerUserRepository;
    const logged: unknown[] = [];
    const useCase = new RegisterCustomerUseCase(
      failingUsers,
      new PrismaCustomerRoleRepository(prisma),
      new PrismaAccountRepository(prisma),
      new Argon2PasswordHasher(),
      new CustomerTokenServiceAdapter(),
      {
        error: (...args: unknown[]) => logged.push(args),
        warn: (...args: unknown[]) => logged.push(args),
      },
      new PrismaAccountSubscriptionAdapter(prisma),
      undefined,
      undefined,
      undefined,
      new PrismaUnitOfWork(prisma, ambientTenantContextProvider)
    );

    const result = await withSystemContext(CUSTOMER_REGISTER_SYSTEM_REASON, () =>
      useCase.execute({
        accountName: `${TAG}-rolled-back`,
        accountEmail: email,
        firstName: "Rolled",
        lastName: "Back",
        email,
        password: PASSWORD,
      })
    );

    assert.deepEqual(result, err("INTERNAL_ERROR"));
    const { accounts } = await rowsFor(email);
    assert.equal(accounts.length, 0, "the account written before the failed insert is rolled back");
    const trials = await prisma.accountSubscription.count({
      where: { account: { email } },
    });
    assert.equal(trials, 0, "the trial subscription written with it is rolled back too");
  });
});
