/**
 * @file customerPasswordResetRequest.test.ts
 * @description Outcome tests for the customer reset REQUEST, driven through the REAL
 *   `PrismaCustomerUserRepository` over a stateful Prisma-client fake.
 *
 *   The subject is what ends up on the rows and in the single outgoing e-mail. One
 *   address can exist in several accounts, and `resetToken` is globally unique, so
 *   issuing one token for all of them is a constraint collision in which one arbitrary
 *   row wins and the rest fail. The fake enforces that uniqueness exactly as the
 *   database does, which is what lets these tests see the collision instead of
 *   assuming it.
 *
 *   The anti-enumeration silhouette is asserted alongside: a matching and a
 *   non-matching address must be answered identically.
 * @layer infrastructure
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import assert from "node:assert/strict";
import { ok } from "@shared/types";
import type { SendEmailOptions } from "@core/domain/repositories/EmailPort.js";
import { RequestPasswordResetUseCase } from "@core/customer-auth/RequestPasswordResetUseCase.js";
import { PrismaCustomerUserRepository } from "../../src/infrastructure/repositories/PrismaCustomerUserRepository.js";
import { withSystemContext } from "../../src/security/tenantContext.js";
import {
  createStatefulCustomerUserPrismaFake,
  type StatefulCustomerUserPrismaFake,
} from "./helpers/statefulCustomerUserPrismaFake.js";

/** Stands in for the route's declared seam; the route's own constant is asserted where the route is the subject. */
const SEAM_REASON = "system:customer-request-password-reset";

const SHARED_EMAIL = "shared@example.test";
const CLIENT_URL = "https://portal.example.test";

const ACCOUNTS = [
  { id: "acct-req-1", userId: "user-req-1", name: "First Account" },
  { id: "acct-req-2", userId: "user-req-2", name: "Acme <Ops>" },
  { id: "acct-req-3", userId: "user-req-3", name: "Third Account" },
] as const;

function makeUnitOfWork() {
  return {
    executeInTransaction: vi.fn(async (fn: () => Promise<void>) => {
      await fn();
    }),
  };
}

function makeEmailPort() {
  const sends: SendEmailOptions[] = [];
  const send = vi.fn(async (options: SendEmailOptions) => {
    sends.push(options);
    return ok(undefined);
  });
  return { sends, port: { send } };
}

/** Account read model that can name the first and third accounts only. */
function makeAccountQueryRepo(knownIds: readonly string[]) {
  return {
    findById: vi.fn(async (accountId: string) => {
      const match = ACCOUNTS.find((a) => a.id === accountId);
      if (!match || !knownIds.includes(accountId)) {
        return { ok: false as const, error: "NOT_FOUND" as const };
      }
      return { ok: true as const, value: { id: match.id, name: match.name } };
    }),
  };
}

type UseCaseArgs = ConstructorParameters<typeof RequestPasswordResetUseCase>;

describe("Customer reset request — one token per row, one e-mail", () => {
  let fake: StatefulCustomerUserPrismaFake;
  let repo: PrismaCustomerUserRepository;
  let email: ReturnType<typeof makeEmailPort>;

  beforeEach(() => {
    vi.clearAllMocks();
    fake = createStatefulCustomerUserPrismaFake();
    repo = new PrismaCustomerUserRepository(fake.client);
    email = makeEmailPort();
  });

  function seedAllThree(): void {
    for (const account of ACCOUNTS) {
      fake.seed({
        id: account.userId,
        accountId: account.id,
        email: SHARED_EMAIL,
        passwordHash: "stored-hash-value",
        firstName: "Shared",
        lastName: "Owner",
      });
    }
  }

  function buildUseCase(knownIds: readonly string[] = ACCOUNTS.map((a) => a.id)) {
    return new RequestPasswordResetUseCase(
      repo,
      CLIENT_URL,
      email.port as unknown as UseCaseArgs[2],
      makeUnitOfWork() as unknown as UseCaseArgs[3],
      makeAccountQueryRepo(knownIds) as unknown as UseCaseArgs[4]
    );
  }

  function tokensIn(text: string): string[] {
    return [...text.matchAll(/reset-password\?token=([A-Za-z0-9]+)/g)].map((m) => m[1] as string);
  }

  it("issues one distinct persisted token per account and sends exactly one e-mail", async () => {
    seedAllThree();
    const useCase = buildUseCase();

    const result = await withSystemContext(SEAM_REASON, () =>
      useCase.execute({ email: SHARED_EMAIL })
    );

    assert.ok(result.ok);

    const stored = ACCOUNTS.map((a) => fake.read(a.userId));
    for (const row of stored) {
      assert.ok(row, "every matched row must still exist");
      assert.notStrictEqual(
        row.resetToken,
        null,
        "every matched row must carry its OWN persisted reset token"
      );
    }
    const persisted = stored.map((row) => row?.resetToken);
    assert.strictEqual(
      new Set(persisted).size,
      3,
      "the three persisted tokens must be pairwise distinct — one token across rows collides on a globally-unique column"
    );

    assert.strictEqual(email.sends.length, 1, "EXACTLY one e-mail may be sent");
    const sent = email.sends[0];
    assert.ok(sent);
    const linked = tokensIn(sent.body);
    assert.strictEqual(linked.length, 3, "the e-mail must carry one link per matching account");
    assert.deepStrictEqual(
      [...linked].sort(),
      [...persisted].sort(),
      "every e-mailed token must be one that was actually persisted"
    );
  });

  it("labels each link with the account it resets", async () => {
    seedAllThree();
    const useCase = buildUseCase();

    await withSystemContext(SEAM_REASON, () => useCase.execute({ email: SHARED_EMAIL }));

    const sent = email.sends[0];
    assert.ok(sent);
    for (const account of ACCOUNTS) {
      assert.ok(
        sent.body.includes(account.name),
        `the plain-text body must name "${account.name}" so the recipient can choose`
      );
    }
  });

  it("escapes an account name before interpolating it into the HTML body", async () => {
    seedAllThree();
    const useCase = buildUseCase();

    await withSystemContext(SEAM_REASON, () => useCase.execute({ email: SHARED_EMAIL }));

    const sent = email.sends[0];
    assert.ok(sent?.html);
    assert.ok(
      !sent.html.includes("Acme <Ops>"),
      "an account name is tenant-controlled text and must never reach the HTML body unescaped"
    );
    assert.ok(sent.html.includes("Acme &lt;Ops&gt;"), "the name must appear escaped");
  });

  it("still links an account the read model cannot name, using a generic label", async () => {
    seedAllThree();
    const useCase = buildUseCase([ACCOUNTS[0].id, ACCOUNTS[2].id]);

    const result = await withSystemContext(SEAM_REASON, () =>
      useCase.execute({ email: SHARED_EMAIL })
    );

    assert.ok(result.ok, "an unnameable account is a labelling gap, never an error");
    const sent = email.sends[0];
    assert.ok(sent);
    assert.strictEqual(
      tokensIn(sent.body).length,
      3,
      "the unnameable account keeps its link — only its label degrades"
    );
  });

  it("surfaces a per-row write failure and e-mails no link for that row", async () => {
    seedAllThree();
    fake.failWritesFor(ACCOUNTS[1].userId);
    const useCase = buildUseCase();

    const result = await withSystemContext(SEAM_REASON, () =>
      useCase.execute({ email: SHARED_EMAIL })
    );

    assert.ok(result.ok, "the uniform response is preserved even when a row fails");
    assert.strictEqual(
      result.value.unpersistedCount,
      1,
      "a per-row write failure must be SURFACED, never discarded"
    );

    const sent = email.sends[0];
    assert.ok(sent);
    const linked = tokensIn(sent.body);
    const live = fake
      .rows()
      .map((row) => row.resetToken)
      .filter((token): token is string => token !== null);
    assert.deepStrictEqual(
      [...linked].sort(),
      [...live].sort(),
      "no link whose token was not persisted may be e-mailed"
    );
    assert.strictEqual(
      fake.read(ACCOUNTS[1].userId)?.resetToken,
      null,
      "the failed row carries no token"
    );
  });

  it("sends nothing for an address that matches no row, with the uniform body", async () => {
    seedAllThree();
    const useCase = buildUseCase();

    const matched = await withSystemContext(SEAM_REASON, () =>
      useCase.execute({ email: SHARED_EMAIL })
    );
    const unmatched = await withSystemContext(SEAM_REASON, () =>
      useCase.execute({ email: "nobody@example.test" })
    );

    assert.ok(matched.ok);
    assert.ok(unmatched.ok);
    assert.strictEqual(
      unmatched.value.message,
      matched.value.message,
      "matching and non-matching addresses must be indistinguishable to the caller"
    );
    expect(email.port.send).toHaveBeenCalledTimes(1);
  });
});
