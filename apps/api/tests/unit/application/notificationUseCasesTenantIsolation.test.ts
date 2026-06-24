/**
 * @file notificationUseCasesTenantIsolation.test.ts
 * @description Cross-tenant (CWE-639 / IDOR-NOTIFICATIONS) regression tests for
 *              CreateNotificationUseCase. The POST /notifications route runs under
 *              `requireClientAuth` (customer, not admin) and previously accepted an
 *              arbitrary body `recipientId`, letting a caller in account B push a
 *              notification to a recipient in account A. The use case now takes an
 *              optional `callerAccountId`; when present it resolves the recipient's
 *              owning account via `findRecipientAccountId` and rejects a foreign
 *              recipient with NOT_FOUND (anti-enumeration — same shape as a missing
 *              recipient). Recipients (CustomerUser) carry `accountId`; the gate
 *              lives at the use-case boundary because Notification has no direct
 *              tenant FK the `$extends` guard can inject.
 * @layer infrastructure
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { ok, err } from "@shared/types";
import { AccountId } from "@core/domain/value-objects/EntityId.js";
import { EntityNotFoundError } from "@core/domain/errors/index.js";
import { CreateNotificationUseCase } from "@core/notifications/CreateNotificationUseCase.js";
import { NOTIFICATION_TYPES } from "@core/domain/value-objects/NotificationType.js";
import { USE_CASE_ERRORS } from "@core/application/UseCase.js";

const TENANT_A = AccountId.generate().value;
const TENANT_B = AccountId.generate().value;
const RECIPIENT_IN_A = "recipient-in-a";
const RECIPIENT_UNKNOWN = "recipient-unknown";

/**
 * Notification repo mock with the recipient-ownership hook.
 * `findRecipientAccountId(recipientId)` resolves the recipient's owning account
 * via the `notification.recipient -> customerUser.accountId` chain.
 */
function makeNotificationRepo(owner: Record<string, string> = { [RECIPIENT_IN_A]: TENANT_A }) {
  return {
    owner,
    save: vi.fn(async () => undefined),
    findById: vi.fn(async (id: string) => err(new EntityNotFoundError("Notification", id))),
    findByRecipient: vi.fn(async () => ({ items: [] })),
    markAsRead: vi.fn(async () => ok(undefined)),
    markAllAsRead: vi.fn(async () => 0),
    countUnread: vi.fn(async () => 0),
    delete: vi.fn(async () => undefined),
    findRecipientAccountId: vi.fn(async (recipientId: string) => {
      const acc = owner[recipientId];
      return acc ? AccountId.fromStringUnsafe(acc) : null;
    }),
  };
}

/** Preference repo that enables every type (no skip). */
function makePreferenceRepo() {
  return {
    findByMember: vi.fn(async () => []),
    upsert: vi.fn(async () => undefined),
  };
}

function makeInput(overrides: Record<string, unknown> = {}) {
  return {
    recipientId: RECIPIENT_IN_A,
    type: NOTIFICATION_TYPES.MENTION,
    title: "Hello",
    body: "You were mentioned",
    ...overrides,
  };
}

describe("CreateNotificationUseCase — tenant isolation (IDOR-NOTIFICATIONS, CWE-639)", () => {
  let repo: ReturnType<typeof makeNotificationRepo>;
  let prefs: ReturnType<typeof makePreferenceRepo>;
  let useCase: CreateNotificationUseCase;

  beforeEach(() => {
    vi.clearAllMocks();
    repo = makeNotificationRepo();
    prefs = makePreferenceRepo();
    useCase = new CreateNotificationUseCase(repo as never, prefs as never);
  });

  it("returns not-found and persists nothing when tenant B targets a recipient in tenant A", async () => {
    const result = await useCase.execute(makeInput({ callerAccountId: TENANT_B }) as never);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe(USE_CASE_ERRORS.NOT_FOUND);
    expect(repo.save).not.toHaveBeenCalled();
  });

  it("returns not-found when the recipient does not exist (anti-enumeration)", async () => {
    const result = await useCase.execute(
      makeInput({ recipientId: RECIPIENT_UNKNOWN, callerAccountId: TENANT_A }) as never
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe(USE_CASE_ERRORS.NOT_FOUND);
    expect(repo.save).not.toHaveBeenCalled();
  });

  it("creates the notification when the caller owns the recipient's account", async () => {
    const result = await useCase.execute(makeInput({ callerAccountId: TENANT_A }) as never);

    expect(result.ok).toBe(true);
    expect(repo.save).toHaveBeenCalledOnce();
  });

  it("still creates the notification for internal callers that omit callerAccountId (admin/system path)", async () => {
    const result = await useCase.execute(makeInput());

    expect(result.ok).toBe(true);
    expect(repo.save).toHaveBeenCalledOnce();
  });
});
