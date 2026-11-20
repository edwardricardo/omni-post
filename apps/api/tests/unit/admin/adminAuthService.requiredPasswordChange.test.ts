/**
 * @file adminAuthService.requiredPasswordChange.test.ts
 * @description Unit tier for the administrators' sign-in checks and for the replacement of a
 *   password that must be changed. `AdminAuthService` runs for real over the stateful fake of
 *   the Prisma client, so the guarded write's predicate and data execute against stored rows;
 *   the brute-force port and the second factor are recording doubles.
 *
 *   The first block pins what `login` does at each of its checks (the brute-force gate and its
 *   delay, the lookup by normalized e-mail, the manual lock, the active check, the password, the
 *   second factor) and what it does once they pass, since the replacement runs the same checks.
 *   The second block pins that `login` refuses an administrator who must change the password
 *   once every check has passed, and runs nothing a sign-in runs after them. The third block
 *   covers the replacement: every refusal with its code and nothing written, the one guarded
 *   write, no session and no sign-in, and a row moved between the read and the write refused as
 *   a concurrent modification.
 * @layer infrastructure
 */

import { describe, it, beforeAll, beforeEach, afterEach, expect, vi } from "vitest";
import { err, ok } from "@shared/types";
import {
  MFA_SUBJECT_TYPE,
  type BruteForceProtectionPort,
  type CheckLoginAttemptResult,
} from "@ports/core";
import type { PrismaClient } from "@infra/prisma";
import { AdminAuthService } from "../../../src/admin/auth/AdminAuthService.js";
import type { MfaService } from "../../../src/admin/auth/MfaService.js";
import type { DeviceFingerprint } from "../../../src/admin/auth/adminAuthTypes.js";
import { hashPassword, verifyPassword } from "../../../src/auth/passwordHashing.js";
import {
  createStatefulAdminUserPrismaFake,
  type FakeAdminUserRow,
  type StatefulAdminUserPrismaFake,
} from "../helpers/statefulAdminUserPrismaFake.js";

const ADMIN_ID = "admin-required-change";
const ADMIN_EMAIL = "first.admin@required-change.test";
const TYPED_EMAIL = "  First.Admin@Required-Change.TEST ";
const UNKNOWN_EMAIL = "nobody@required-change.test";
const SESSION_ID = "session-held-before-the-change";

/** Fixture passwords, each distinct so a wrong field cannot pass by collision. */
const SINGLE_USE_PASSWORD = "fixture-single-use-Q4";
const NEW_PASSWORD = "Fixture-Next-Pw-8k!";
const RECENT_PASSWORD = "Fixture-Recent-Pw-5j$";
const OUTSIDE_WINDOW_PASSWORD = "Fixture-Aged-Pw-3n&";
const WRONG_PASSWORD = "Fixture-Wrong-Pw-4h%";
const WEAK_PASSWORD = "weak";
const MFA_CODE = "246813";

/** Opaque stored hashes: only their identity is under test, never their content. */
const OPAQUE_HISTORY = ["fixture-hash-h1", "fixture-hash-h2", "fixture-hash-h3", "fixture-hash-h4"];
const MOVED_HASH = "fixture-hash-written-by-another-request";

const DEVICE: DeviceFingerprint = {
  deviceId: "device-required-change",
  userAgent: "fixture-agent/2.0",
  ipAddress: "203.0.113.24",
};

/** The attempt every brute-force call carries: the e-mail as typed, the address, the agent. */
const ATTEMPT = { identifier: TYPED_EMAIL, ip: DEVICE.ipAddress, userAgent: DEVICE.userAgent };

/** The gate's answer when it lets an attempt through without delay. */
const ALLOWED: CheckLoginAttemptResult = { allowed: true, delaySeconds: 0, captchaRequired: false };

/** An old change date, so a new one is decidable. */
const LAST_CHANGED = new Date("2026-01-02T03:04:05.000Z");

interface Hashes {
  singleUse: string;
  recent: string;
  outsideWindow: string;
}

let hashes: Hashes;

beforeAll(async () => {
  hashes = {
    singleUse: await hashPassword(SINGLE_USE_PASSWORD),
    recent: await hashPassword(RECENT_PASSWORD),
    outsideWindow: await hashPassword(OUTSIDE_WINDOW_PASSWORD),
  };
});

type Delegate = Record<string, (args: Record<string, unknown>) => Promise<unknown>>;

interface Harness {
  readonly fake: StatefulAdminUserPrismaFake;
  readonly service: AdminAuthService;
  readonly bruteForce: ReturnType<typeof makeBruteForce>;
  readonly verifyMfaToken: ReturnType<typeof vi.fn>;
  readonly audit: Record<string, unknown>[];
  readonly sessionCreates: Record<string, unknown>[];
  /** The name of every session operation the service called, in order. */
  readonly sessionCalls: string[];
  readonly lookups: { count: number };
  /** Runs `hook` once, right after the next administrator lookup resolves. */
  afterNextLookup(hook: () => void): void;
}

/** A brute-force port that answers `check` and records every call. */
function makeBruteForce(check: CheckLoginAttemptResult = ALLOWED) {
  return {
    checkLoginAttempt: vi.fn(async () => check),
    recordFailedAttempt: vi.fn(async () => undefined),
    recordSuccessfulAttempt: vi.fn(async () => undefined),
    unlockAccount: vi.fn(async () => true),
    unblockIp: vi.fn(async () => true),
    getStats: vi.fn(async () => ({
      lockedAccounts: 0,
      blockedIps: 0,
      recentFailures: 0,
      suspiciousActivities: 0,
    })),
  } satisfies BruteForceProtectionPort;
}

/**
 * One administrator who must change a single-use password, holding one active session, behind
 * the real service. The fake's `adminUser` and `adminSession` delegates hold the rows; the
 * session `create` and the audit `create` only record, so the session a sign-in would open and
 * the security events are observable.
 */
function makeHarness(
  row: Partial<FakeAdminUserRow> = {},
  options: { check?: CheckLoginAttemptResult; mfaValid?: boolean } = {}
): Harness {
  const fake = createStatefulAdminUserPrismaFake();
  fake.seedAdmin({
    id: ADMIN_ID,
    email: ADMIN_EMAIL,
    passwordHash: hashes.singleUse,
    passwordHistory: [hashes.recent],
    passwordChangedAt: LAST_CHANGED,
    mustChangePassword: true,
    ...row,
  });
  fake.seedSession({ id: SESSION_ID, userId: ADMIN_ID });

  const audit: Record<string, unknown>[] = [];
  const sessionCreates: Record<string, unknown>[] = [];
  const sessionCalls: string[] = [];
  const lookups = { count: 0 };
  let afterLookup: (() => void) | null = null;
  const inner = fake.client as unknown as { adminUser: Delegate; adminSession: Delegate };
  const client = {
    adminUser: {
      ...inner.adminUser,
      findUnique: async (args: Record<string, unknown>) => {
        lookups.count += 1;
        const found = await inner.adminUser.findUnique?.(args);
        if (afterLookup) {
          const hook = afterLookup;
          afterLookup = null;
          hook();
        }
        return found;
      },
    },
    adminSession: {
      ...inner.adminSession,
      updateMany: async (args: Record<string, unknown>) => {
        sessionCalls.push("updateMany");
        return inner.adminSession.updateMany?.(args);
      },
      findMany: async () => {
        sessionCalls.push("findMany");
        return [];
      },
      create: async (args: Record<string, unknown>) => {
        sessionCalls.push("create");
        sessionCreates.push(args);
        return { id: "session-a-sign-in-would-open" };
      },
    },
    auditLog: {
      create: async (args: { data: Record<string, unknown> }) => {
        audit.push(args.data);
        return args.data;
      },
    },
  } as unknown as PrismaClient;

  const bruteForce = makeBruteForce(options.check);
  const verifyMfaToken = vi.fn(async () =>
    options.mfaValid === false ? err("INVALID_TOKEN") : ok({ valid: true })
  );
  const mfa = { verifyMfaToken } as unknown as MfaService;

  return {
    fake,
    service: new AdminAuthService(client, bruteForce, mfa),
    bruteForce,
    verifyMfaToken,
    audit,
    sessionCreates,
    sessionCalls,
    lookups,
    afterNextLookup(hook) {
      afterLookup = hook;
    },
  };
}

/** The stored administrator, asserted to exist. */
function storedAdmin(harness: Harness): FakeAdminUserRow {
  const row = harness.fake.readAdmin(ADMIN_ID);
  if (!row) throw new Error("the fixture administrator must still exist");
  return row;
}

/** A refusal wrote no row, opened no session, revoked none and cleared no counter. */
function expectNothingWritten(harness: Harness): void {
  expect(harness.fake.writes()).toEqual([]);
  expect(harness.sessionCreates).toEqual([]);
  expect(harness.fake.readSessions(ADMIN_ID).map((s) => s.isActive)).toEqual([true]);
  expect(harness.bruteForce.recordSuccessfulAttempt).not.toHaveBeenCalled();
  const row = storedAdmin(harness);
  expect(row.passwordHash).toBe(hashes.singleUse);
  expect(row.mustChangePassword).toBe(true);
}

/** The request the endpoint hands over, with the e-mail as the caller typed it. */
function changeRequest(
  newPassword: string,
  extra: { currentPassword?: string; mfaToken?: string } = {}
) {
  return {
    email: TYPED_EMAIL,
    currentPassword: extra.currentPassword ?? SINGLE_USE_PASSWORD,
    newPassword,
    ...(extra.mfaToken !== undefined && { mfaToken: extra.mfaToken }),
  };
}

/** A sign-in request with the e-mail as the caller typed it. */
function signInRequest(password: string, mfaToken?: string) {
  return {
    email: TYPED_EMAIL,
    password,
    rememberMe: false,
    ...(mfaToken !== undefined && { mfaToken }),
  };
}

describe("AdminAuthService.login — the sign-in's checks", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns ACCOUNT_LOCKED without a lookup when the brute-force gate reports an account lockout", async () => {
    const harness = makeHarness(
      { mustChangePassword: false },
      {
        check: {
          allowed: false,
          delaySeconds: 0,
          captchaRequired: false,
          reason: "account_lockout",
        },
      }
    );

    const result = await harness.service.login(signInRequest(SINGLE_USE_PASSWORD), DEVICE);

    expect(result).toEqual(err("ACCOUNT_LOCKED"));
    expect(harness.bruteForce.checkLoginAttempt).toHaveBeenCalledWith(ATTEMPT);
    expect(harness.lookups.count).toBe(0);
    expect(harness.bruteForce.recordFailedAttempt).not.toHaveBeenCalled();
  });

  it("returns RATE_LIMIT_EXCEEDED without a lookup when the gate refuses for another reason", async () => {
    const harness = makeHarness(
      { mustChangePassword: false },
      { check: { allowed: false, delaySeconds: 0, captchaRequired: false, reason: "ip_block" } }
    );

    const result = await harness.service.login(signInRequest(SINGLE_USE_PASSWORD), DEVICE);

    expect(result).toEqual(err("RATE_LIMIT_EXCEEDED"));
    expect(harness.lookups.count).toBe(0);
  });

  it("waits the delay the gate asks for before the lookup", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout"] });
    const harness = makeHarness(
      { mustChangePassword: false },
      { check: { allowed: true, delaySeconds: 2, captchaRequired: false } }
    );

    const pending = harness.service.login(signInRequest(WRONG_PASSWORD), DEVICE);
    await vi.advanceTimersByTimeAsync(1999);
    const lookupsBeforeTheDelay = harness.lookups.count;
    await vi.advanceTimersByTimeAsync(1);
    const result = await pending;

    expect(lookupsBeforeTheDelay).toBe(0);
    expect(harness.lookups.count).toBe(1);
    expect(result).toEqual(err("INVALID_CREDENTIALS"));
  });

  it("returns INVALID_CREDENTIALS and records USER_NOT_FOUND for an unknown e-mail", async () => {
    const harness = makeHarness({ mustChangePassword: false });

    const result = await harness.service.login(
      { email: UNKNOWN_EMAIL, password: SINGLE_USE_PASSWORD, rememberMe: false },
      DEVICE
    );

    expect(result).toEqual(err("INVALID_CREDENTIALS"));
    expect(harness.bruteForce.recordFailedAttempt).toHaveBeenCalledTimes(1);
    expect(harness.bruteForce.recordFailedAttempt).toHaveBeenCalledWith({
      identifier: UNKNOWN_EMAIL,
      ip: DEVICE.ipAddress,
      userAgent: DEVICE.userAgent,
      failureReason: "USER_NOT_FOUND",
    });
  });

  it("finds the administrator by the normalized e-mail, so a typed variant reaches the password check", async () => {
    const harness = makeHarness({ mustChangePassword: false });

    await harness.service.login(signInRequest(WRONG_PASSWORD), DEVICE);

    expect(harness.bruteForce.recordFailedAttempt).toHaveBeenCalledWith({
      ...ATTEMPT,
      failureReason: "INVALID_PASSWORD",
    });
  });

  it("returns ACCOUNT_LOCKED for a manual lock and records no failed attempt", async () => {
    const harness = makeHarness({
      mustChangePassword: false,
      lockedUntil: new Date(Date.now() + 3_600_000),
    });

    const result = await harness.service.login(signInRequest(SINGLE_USE_PASSWORD), DEVICE);

    expect(result).toEqual(err("ACCOUNT_LOCKED"));
    expect(harness.bruteForce.recordFailedAttempt).not.toHaveBeenCalled();
    expect(harness.sessionCreates).toEqual([]);
  });

  it("returns ACCOUNT_INACTIVE and records ACCOUNT_INACTIVE for a deactivated administrator", async () => {
    const harness = makeHarness({ mustChangePassword: false, isActive: false });

    const result = await harness.service.login(signInRequest(SINGLE_USE_PASSWORD), DEVICE);

    expect(result).toEqual(err("ACCOUNT_INACTIVE"));
    expect(harness.bruteForce.recordFailedAttempt).toHaveBeenCalledWith({
      ...ATTEMPT,
      failureReason: "ACCOUNT_INACTIVE",
    });
  });

  it("returns INVALID_CREDENTIALS, records INVALID_PASSWORD and writes no security event for a wrong password", async () => {
    const harness = makeHarness({ mustChangePassword: false });

    const result = await harness.service.login(signInRequest(WRONG_PASSWORD), DEVICE);

    expect(result).toEqual(err("INVALID_CREDENTIALS"));
    expect(harness.bruteForce.recordFailedAttempt).toHaveBeenCalledTimes(1);
    expect(harness.bruteForce.recordFailedAttempt).toHaveBeenCalledWith({
      ...ATTEMPT,
      failureReason: "INVALID_PASSWORD",
    });
    expect(harness.audit).toEqual([]);
    expect(harness.sessionCreates).toEqual([]);
  });

  it("returns MFA_REQUIRED without verifying a code or recording a failure when the second factor is missing", async () => {
    const harness = makeHarness({ mustChangePassword: false, mfaEnabled: true });

    const result = await harness.service.login(signInRequest(SINGLE_USE_PASSWORD), DEVICE);

    expect(result).toEqual(err("MFA_REQUIRED"));
    expect(harness.verifyMfaToken).not.toHaveBeenCalled();
    expect(harness.bruteForce.recordFailedAttempt).not.toHaveBeenCalled();
  });

  it("returns MFA_INVALID and records MFA_INVALID when the second factor's code is refused", async () => {
    const harness = makeHarness(
      { mustChangePassword: false, mfaEnabled: true },
      { mfaValid: false }
    );

    const result = await harness.service.login(
      signInRequest(SINGLE_USE_PASSWORD, MFA_CODE),
      DEVICE
    );

    expect(result).toEqual(err("MFA_INVALID"));
    expect(harness.verifyMfaToken).toHaveBeenCalledWith(
      { type: MFA_SUBJECT_TYPE.ADMIN, id: ADMIN_ID },
      MFA_CODE
    );
    expect(harness.bruteForce.recordFailedAttempt).toHaveBeenCalledWith({
      ...ATTEMPT,
      failureReason: "MFA_INVALID",
    });
  });

  it("opens one session, writes lastLoginAt and clears the counters with the checked attempt once every check passes", async () => {
    const row = {
      id: ADMIN_ID,
      email: ADMIN_EMAIL,
      name: "first.admin",
      passwordHash: hashes.singleUse,
      isActive: true,
      emailVerified: true,
      mfaEnabled: false,
      lockedUntil: null,
      maxConcurrentSessions: 3,
      timezone: null,
      locale: null,
      department: null,
      team: null,
      lastLoginAt: null,
      createdAt: LAST_CHANGED,
      updatedAt: LAST_CHANGED,
      role: { name: "SUPER_ADMIN" },
    };
    const userUpdates: Record<string, unknown>[] = [];
    const sessionCreates: Record<string, unknown>[] = [];
    const auditRows: Record<string, unknown>[] = [];
    const client = {
      adminUser: {
        findUnique: async (args: { where: { email?: string; id?: string } }) =>
          args.where.email === ADMIN_EMAIL || args.where.id === ADMIN_ID ? { ...row } : null,
        update: async (args: Record<string, unknown>) => {
          userUpdates.push(args);
          return { ...row };
        },
      },
      adminSession: {
        updateMany: async () => ({ count: 0 }),
        findMany: async () => [],
        create: async (args: Record<string, unknown>) => {
          sessionCreates.push(args);
          return { id: "session-opened-by-login" };
        },
      },
      securitySettings: { findFirst: async () => ({ sessionTimeoutMinutes: 15 }) },
      auditLog: {
        create: async (args: { data: Record<string, unknown> }) => {
          auditRows.push(args.data);
          return args.data;
        },
      },
    } as unknown as PrismaClient;
    const bruteForce = makeBruteForce();
    const service = new AdminAuthService(client, bruteForce, {} as unknown as MfaService);

    const result = await service.login(signInRequest(SINGLE_USE_PASSWORD), DEVICE);

    expect(result.ok).toBe(true);
    expect(auditRows).toEqual([
      {
        action: "LOGIN_SUCCESS",
        resource: "AdminAuth",
        success: true,
        userId: ADMIN_ID,
        actorType: "ADMIN",
        ipAddress: DEVICE.ipAddress,
        userAgent: DEVICE.userAgent,
      },
    ]);
    expect(sessionCreates).toHaveLength(1);
    expect(userUpdates).toHaveLength(1);
    expect(userUpdates[0]).toEqual({
      where: { id: ADMIN_ID },
      data: { lastLoginAt: expect.any(Date) },
    });
    expect(bruteForce.recordSuccessfulAttempt).toHaveBeenCalledTimes(1);
    expect(bruteForce.recordSuccessfulAttempt).toHaveBeenCalledWith(ATTEMPT);
    expect(bruteForce.recordFailedAttempt).not.toHaveBeenCalled();
  });
});

describe("AdminAuthService.login — an administrator who must change the password", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("refuses the right password with PASSWORD_CHANGE_REQUIRED and runs nothing a sign-in runs after its checks", async () => {
    const harness = makeHarness();

    const result = await harness.service.login(signInRequest(SINGLE_USE_PASSWORD), DEVICE);

    expect(result).toEqual(err("PASSWORD_CHANGE_REQUIRED"));
    expect(harness.sessionCalls).toEqual([]);
    expect(harness.fake.writes()).toEqual([]);
    expect(storedAdmin(harness).lastLoginAt).toBeNull();
    expect(harness.fake.readSessions(ADMIN_ID).map((s) => s.isActive)).toEqual([true]);
    expect(harness.bruteForce.checkLoginAttempt).toHaveBeenCalledWith(ATTEMPT);
    expect(harness.bruteForce.recordFailedAttempt).not.toHaveBeenCalled();
    expect(harness.bruteForce.recordSuccessfulAttempt).not.toHaveBeenCalled();
    expect(harness.audit).toEqual([]);
  });

  it("refuses with PASSWORD_CHANGE_REQUIRED after the second factor's code verifies, once", async () => {
    const harness = makeHarness({ mfaEnabled: true });

    const result = await harness.service.login(
      signInRequest(SINGLE_USE_PASSWORD, MFA_CODE),
      DEVICE
    );

    expect(result).toEqual(err("PASSWORD_CHANGE_REQUIRED"));
    expect(harness.verifyMfaToken).toHaveBeenCalledTimes(1);
    expect(harness.verifyMfaToken).toHaveBeenCalledWith(
      { type: MFA_SUBJECT_TYPE.ADMIN, id: ADMIN_ID },
      MFA_CODE
    );
    expect(harness.sessionCalls).toEqual([]);
    expect(harness.fake.writes()).toEqual([]);
    expect(harness.bruteForce.recordFailedAttempt).not.toHaveBeenCalled();
    expect(harness.bruteForce.recordSuccessfulAttempt).not.toHaveBeenCalled();
    expect(harness.audit).toEqual([]);
  });

  it("asks for the missing second factor without saying the password must be changed", async () => {
    const harness = makeHarness({ mfaEnabled: true });

    const result = await harness.service.login(signInRequest(SINGLE_USE_PASSWORD), DEVICE);

    expect(result).toEqual(err("MFA_REQUIRED"));
    expect(harness.verifyMfaToken).not.toHaveBeenCalled();
    expect(harness.sessionCalls).toEqual([]);
  });

  it("answers a wrong password with INVALID_CREDENTIALS and records INVALID_PASSWORD, as for any administrator", async () => {
    const harness = makeHarness();

    const result = await harness.service.login(signInRequest(WRONG_PASSWORD), DEVICE);

    expect(result).toEqual(err("INVALID_CREDENTIALS"));
    expect(harness.bruteForce.recordFailedAttempt).toHaveBeenCalledTimes(1);
    expect(harness.bruteForce.recordFailedAttempt).toHaveBeenCalledWith({
      ...ATTEMPT,
      failureReason: "INVALID_PASSWORD",
    });
    expect(harness.sessionCalls).toEqual([]);
    expect(harness.fake.writes()).toEqual([]);
  });
});

describe("AdminAuthService.changeRequiredPassword — replacing a password that must be changed", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("replaces the password and clears the mark in one guarded write, revokes every session and opens none", async () => {
    const harness = makeHarness();

    const result = await harness.service.changeRequiredPassword(
      changeRequest(NEW_PASSWORD),
      DEVICE
    );

    expect(result).toEqual(ok(undefined));
    const writes = harness.fake.writes();
    expect(writes).toHaveLength(1);
    const [write] = writes;
    expect(write?.op).toBe("updateMany");
    expect(write?.count).toBe(1);
    expect(write?.where).toEqual({
      id: ADMIN_ID,
      mustChangePassword: true,
      isActive: true,
      mfaEnabled: false,
      passwordHash: hashes.singleUse,
      passwordHistory: { equals: [hashes.recent] },
    });
    expect(Object.keys(write?.data ?? {}).sort()).toEqual([
      "mustChangePassword",
      "passwordChangedAt",
      "passwordHash",
      "passwordHashAlgo",
      "passwordHistory",
    ]);

    const row = storedAdmin(harness);
    expect(await verifyPassword(row.passwordHash, NEW_PASSWORD)).toBe(true);
    expect(await verifyPassword(row.passwordHash, SINGLE_USE_PASSWORD)).toBe(false);
    expect(row.passwordHashAlgo).toBe("argon2id");
    expect(row.passwordHistory).toEqual([hashes.recent, hashes.singleUse]);
    expect(row.passwordChangedAt.getTime()).toBeGreaterThan(LAST_CHANGED.getTime());
    expect(row.mustChangePassword).toBe(false);
    expect(row.lastLoginAt).toBeNull();

    expect(harness.sessionCreates).toEqual([]);
    const sessions = harness.fake.readSessions(ADMIN_ID);
    expect(sessions.map((s) => [s.isActive, s.revokeReason])).toEqual([
      [false, "PASSWORD_CHANGED"],
    ]);
  });

  it("stores the change as a successful PASSWORD_CHANGED audit row and clears the counters with the checked attempt", async () => {
    const harness = makeHarness();

    await harness.service.changeRequiredPassword(changeRequest(NEW_PASSWORD), DEVICE);

    expect(harness.audit).toEqual([
      {
        action: "PASSWORD_CHANGED",
        resource: "AdminAuth",
        success: true,
        userId: ADMIN_ID,
        actorType: "ADMIN",
        ipAddress: DEVICE.ipAddress,
        userAgent: DEVICE.userAgent,
      },
    ]);
    expect(harness.bruteForce.checkLoginAttempt).toHaveBeenCalledWith(ATTEMPT);
    expect(harness.bruteForce.recordSuccessfulAttempt).toHaveBeenCalledTimes(1);
    expect(harness.bruteForce.recordSuccessfulAttempt).toHaveBeenCalledWith(ATTEMPT);
    expect(harness.bruteForce.recordFailedAttempt).not.toHaveBeenCalled();
    const recorded = JSON.stringify(harness.audit);
    expect(recorded.includes(NEW_PASSWORD)).toBe(false);
    expect(recorded.includes(SINGLE_USE_PASSWORD)).toBe(false);
  });

  it("refuses an administrator whose password is not marked for a change, recording no failed attempt", async () => {
    const harness = makeHarness({ mustChangePassword: false });

    const result = await harness.service.changeRequiredPassword(
      changeRequest(NEW_PASSWORD),
      DEVICE
    );

    expect(result).toEqual(err("PASSWORD_CHANGE_NOT_REQUIRED"));
    expect(harness.fake.writes()).toEqual([]);
    expect(harness.bruteForce.recordFailedAttempt).not.toHaveBeenCalled();
    expect(harness.bruteForce.recordSuccessfulAttempt).not.toHaveBeenCalled();
    expect(harness.audit).toEqual([]);
    expect(storedAdmin(harness).passwordHash).toBe(hashes.singleUse);
    expect(harness.fake.readSessions(ADMIN_ID).map((s) => s.isActive)).toEqual([true]);
  });

  it("refuses a wrong current password with INVALID_CREDENTIALS, recording the failed attempt and no security event", async () => {
    const harness = makeHarness();

    const result = await harness.service.changeRequiredPassword(
      changeRequest(NEW_PASSWORD, { currentPassword: WRONG_PASSWORD }),
      DEVICE
    );

    expect(result).toEqual(err("INVALID_CREDENTIALS"));
    expectNothingWritten(harness);
    expect(harness.bruteForce.recordFailedAttempt).toHaveBeenCalledWith({
      ...ATTEMPT,
      failureReason: "INVALID_PASSWORD",
    });
    expect(harness.audit).toEqual([]);
  });

  it("refuses an unknown e-mail with INVALID_CREDENTIALS, records USER_NOT_FOUND and names no administrator in an event", async () => {
    const harness = makeHarness();

    const result = await harness.service.changeRequiredPassword(
      { email: UNKNOWN_EMAIL, currentPassword: SINGLE_USE_PASSWORD, newPassword: NEW_PASSWORD },
      DEVICE
    );

    expect(result).toEqual(err("INVALID_CREDENTIALS"));
    expectNothingWritten(harness);
    expect(harness.bruteForce.recordFailedAttempt).toHaveBeenCalledWith({
      identifier: UNKNOWN_EMAIL,
      ip: DEVICE.ipAddress,
      userAgent: DEVICE.userAgent,
      failureReason: "USER_NOT_FOUND",
    });
    expect(harness.audit).toEqual([]);
  });

  it("refuses a deactivated administrator with ACCOUNT_INACTIVE and writes nothing", async () => {
    const harness = makeHarness({ isActive: false });

    const result = await harness.service.changeRequiredPassword(
      changeRequest(NEW_PASSWORD),
      DEVICE
    );

    expect(result).toEqual(err("ACCOUNT_INACTIVE"));
    expectNothingWritten(harness);
    expect(harness.bruteForce.recordFailedAttempt).toHaveBeenCalledWith({
      ...ATTEMPT,
      failureReason: "ACCOUNT_INACTIVE",
    });
  });

  it("refuses a manually locked administrator with ACCOUNT_LOCKED and writes nothing", async () => {
    const harness = makeHarness({ lockedUntil: new Date(Date.now() + 3_600_000) });

    const result = await harness.service.changeRequiredPassword(
      changeRequest(NEW_PASSWORD),
      DEVICE
    );

    expect(result).toEqual(err("ACCOUNT_LOCKED"));
    expectNothingWritten(harness);
    expect(harness.bruteForce.recordFailedAttempt).not.toHaveBeenCalled();
  });

  it("refuses before any lookup when the brute-force gate locks the account", async () => {
    const harness = makeHarness(
      {},
      {
        check: {
          allowed: false,
          delaySeconds: 0,
          captchaRequired: false,
          reason: "account_lockout",
        },
      }
    );

    const result = await harness.service.changeRequiredPassword(
      changeRequest(NEW_PASSWORD),
      DEVICE
    );

    expect(result).toEqual(err("ACCOUNT_LOCKED"));
    expect(harness.lookups.count).toBe(0);
    expectNothingWritten(harness);
  });

  it("asks for the second factor when the administrator has one and no code was given", async () => {
    const harness = makeHarness({ mfaEnabled: true });

    const result = await harness.service.changeRequiredPassword(
      changeRequest(NEW_PASSWORD),
      DEVICE
    );

    expect(result).toEqual(err("MFA_REQUIRED"));
    expect(harness.verifyMfaToken).not.toHaveBeenCalled();
    expectNothingWritten(harness);
  });

  it("refuses a second-factor code the service refuses, with MFA_INVALID and its failure recorded", async () => {
    const harness = makeHarness({ mfaEnabled: true }, { mfaValid: false });

    const result = await harness.service.changeRequiredPassword(
      changeRequest(NEW_PASSWORD, { mfaToken: MFA_CODE }),
      DEVICE
    );

    expect(result).toEqual(err("MFA_INVALID"));
    expectNothingWritten(harness);
    expect(harness.bruteForce.recordFailedAttempt).toHaveBeenCalledWith({
      ...ATTEMPT,
      failureReason: "MFA_INVALID",
    });
  });

  it("replaces the password when the second factor's code verifies", async () => {
    const harness = makeHarness({ mfaEnabled: true });

    const result = await harness.service.changeRequiredPassword(
      changeRequest(NEW_PASSWORD, { mfaToken: MFA_CODE }),
      DEVICE
    );

    expect(result).toEqual(ok(undefined));
    expect(harness.verifyMfaToken).toHaveBeenCalledWith(
      { type: MFA_SUBJECT_TYPE.ADMIN, id: ADMIN_ID },
      MFA_CODE
    );
    expect(storedAdmin(harness).mustChangePassword).toBe(false);
  });

  it("refuses a new password the policy refuses with PASSWORD_TOO_WEAK and writes nothing", async () => {
    const harness = makeHarness();

    const result = await harness.service.changeRequiredPassword(
      changeRequest(WEAK_PASSWORD),
      DEVICE
    );

    expect(result).toEqual(err("PASSWORD_TOO_WEAK"));
    expectNothingWritten(harness);
    expect(harness.audit).toEqual([]);
  });

  it("refuses the current password as the new one with PASSWORD_REUSED and writes nothing", async () => {
    const harness = makeHarness({ passwordHash: await hashPassword(NEW_PASSWORD) });

    const result = await harness.service.changeRequiredPassword(
      changeRequest(NEW_PASSWORD, { currentPassword: NEW_PASSWORD }),
      DEVICE
    );

    expect(result).toEqual(err("PASSWORD_REUSED"));
    expect(harness.fake.writes()).toEqual([]);
    expect(harness.bruteForce.recordSuccessfulAttempt).not.toHaveBeenCalled();
    expect(storedAdmin(harness).mustChangePassword).toBe(true);
  });

  it("refuses a recent password with PASSWORD_REUSED and writes nothing", async () => {
    const harness = makeHarness();

    const result = await harness.service.changeRequiredPassword(
      changeRequest(RECENT_PASSWORD),
      DEVICE
    );

    expect(result).toEqual(err("PASSWORD_REUSED"));
    expectNothingWritten(harness);
  });

  it("accepts a password older than the reuse window, the window the authenticated change applies", async () => {
    const history = [hashes.outsideWindow, ...OPAQUE_HISTORY, hashes.recent];
    const harness = makeHarness({ passwordHistory: history });

    const result = await harness.service.changeRequiredPassword(
      changeRequest(OUTSIDE_WINDOW_PASSWORD),
      DEVICE
    );

    expect(result).toEqual(ok(undefined));
    expect(storedAdmin(harness).passwordHistory).toEqual([
      ...OPAQUE_HISTORY.slice(1),
      hashes.recent,
      hashes.singleUse,
    ]);
  });

  it("returns CONCURRENT_MODIFICATION and writes nothing when the mark was cleared after the read", async () => {
    const harness = makeHarness();
    harness.afterNextLookup(() =>
      harness.fake.mutateAdmin(ADMIN_ID, { mustChangePassword: false })
    );

    const result = await harness.service.changeRequiredPassword(
      changeRequest(NEW_PASSWORD),
      DEVICE
    );

    expect(result).toEqual(err("CONCURRENT_MODIFICATION"));
    expect(storedAdmin(harness).passwordHash).toBe(hashes.singleUse);
    expect(harness.fake.readSessions(ADMIN_ID).map((s) => s.isActive)).toEqual([true]);
    expect(harness.audit).toEqual([]);
    expect(harness.bruteForce.recordSuccessfulAttempt).not.toHaveBeenCalled();
  });

  it("returns CONCURRENT_MODIFICATION and keeps the other writer's hash when the hash moved after the read", async () => {
    const harness = makeHarness();
    harness.afterNextLookup(() => harness.fake.mutateAdmin(ADMIN_ID, { passwordHash: MOVED_HASH }));

    const result = await harness.service.changeRequiredPassword(
      changeRequest(NEW_PASSWORD),
      DEVICE
    );

    expect(result).toEqual(err("CONCURRENT_MODIFICATION"));
    const row = storedAdmin(harness);
    expect(row.passwordHash).toBe(MOVED_HASH);
    expect(row.mustChangePassword).toBe(true);
    expect(harness.audit).toEqual([]);
  });

  it("returns CONCURRENT_MODIFICATION and writes nothing when the history moved after the read", async () => {
    const harness = makeHarness();
    harness.afterNextLookup(() =>
      harness.fake.mutateAdmin(ADMIN_ID, { passwordHistory: [hashes.recent, MOVED_HASH] })
    );

    const result = await harness.service.changeRequiredPassword(
      changeRequest(NEW_PASSWORD),
      DEVICE
    );

    expect(result).toEqual(err("CONCURRENT_MODIFICATION"));
    const row = storedAdmin(harness);
    expect(row.passwordHash).toBe(hashes.singleUse);
    expect(row.passwordHistory).toEqual([hashes.recent, MOVED_HASH]);
  });

  it("returns CONCURRENT_MODIFICATION and writes nothing when the second factor was enabled after the read", async () => {
    const harness = makeHarness();
    harness.afterNextLookup(() => harness.fake.mutateAdmin(ADMIN_ID, { mfaEnabled: true }));

    const result = await harness.service.changeRequiredPassword(
      changeRequest(NEW_PASSWORD),
      DEVICE
    );

    expect(result).toEqual(err("CONCURRENT_MODIFICATION"));
    const row = storedAdmin(harness);
    expect(row.passwordHash).toBe(hashes.singleUse);
    expect(row.mustChangePassword).toBe(true);
    expect(harness.verifyMfaToken).not.toHaveBeenCalled();
    expect(harness.fake.readSessions(ADMIN_ID).map((s) => s.isActive)).toEqual([true]);
    expect(harness.audit).toEqual([]);
  });

  it("returns CONCURRENT_MODIFICATION and writes nothing when the second factor was disabled after the read", async () => {
    const harness = makeHarness({ mfaEnabled: true });
    harness.afterNextLookup(() => harness.fake.mutateAdmin(ADMIN_ID, { mfaEnabled: false }));

    const result = await harness.service.changeRequiredPassword(
      changeRequest(NEW_PASSWORD, { mfaToken: MFA_CODE }),
      DEVICE
    );

    expect(result).toEqual(err("CONCURRENT_MODIFICATION"));
    const row = storedAdmin(harness);
    expect(row.passwordHash).toBe(hashes.singleUse);
    expect(row.mustChangePassword).toBe(true);
    expect(row.mfaEnabled).toBe(false);
    expect(harness.verifyMfaToken).toHaveBeenCalledTimes(1);
    expect(harness.fake.readSessions(ADMIN_ID).map((s) => s.isActive)).toEqual([true]);
    expect(harness.audit).toEqual([]);
  });

  it("returns CONCURRENT_MODIFICATION and writes nothing when the administrator was deactivated after the read", async () => {
    const harness = makeHarness();
    harness.afterNextLookup(() => harness.fake.mutateAdmin(ADMIN_ID, { isActive: false }));

    const result = await harness.service.changeRequiredPassword(
      changeRequest(NEW_PASSWORD),
      DEVICE
    );

    expect(result).toEqual(err("CONCURRENT_MODIFICATION"));
    const row = storedAdmin(harness);
    expect(row.passwordHash).toBe(hashes.singleUse);
    expect(row.mustChangePassword).toBe(true);
    expect(harness.fake.readSessions(ADMIN_ID).map((s) => s.isActive)).toEqual([true]);
    expect(harness.audit).toEqual([]);
  });
});

describe("the order of the sign-in's checks and the second factor", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("answers ACCOUNT_LOCKED, not ACCOUNT_INACTIVE, for a locked and deactivated administrator, recording no failed attempt", async () => {
    const harness = makeHarness({
      mustChangePassword: false,
      isActive: false,
      lockedUntil: new Date(Date.now() + 3_600_000),
    });
    expect(await harness.service.login(signInRequest(SINGLE_USE_PASSWORD), DEVICE)).toEqual(
      err("ACCOUNT_LOCKED")
    );
    expect(harness.bruteForce.recordFailedAttempt).not.toHaveBeenCalled();
  });

  it("answers ACCOUNT_INACTIVE for a deactivated administrator before the password is verified", async () => {
    const harness = makeHarness({ mustChangePassword: false, isActive: false });
    expect(await harness.service.login(signInRequest(WRONG_PASSWORD), DEVICE)).toEqual(
      err("ACCOUNT_INACTIVE")
    );
    expect(harness.bruteForce.recordFailedAttempt).toHaveBeenCalledWith({
      ...ATTEMPT,
      failureReason: "ACCOUNT_INACTIVE",
    });
  });

  it("verifies the password before it asks for a missing second factor", async () => {
    const harness = makeHarness({ mustChangePassword: false, mfaEnabled: true });
    expect(await harness.service.login(signInRequest(WRONG_PASSWORD), DEVICE)).toEqual(
      err("INVALID_CREDENTIALS")
    );
    expect(harness.bruteForce.recordFailedAttempt).toHaveBeenCalledWith({
      ...ATTEMPT,
      failureReason: "INVALID_PASSWORD",
    });
  });

  it("refuses a new password the policy refuses without verifying the second factor, so its code is not spent", async () => {
    const harness = makeHarness({ mfaEnabled: true });
    const result = await harness.service.changeRequiredPassword(
      changeRequest(WEAK_PASSWORD, { mfaToken: MFA_CODE }),
      DEVICE
    );
    expect(result).toEqual(err("PASSWORD_TOO_WEAK"));
    expect(harness.verifyMfaToken).not.toHaveBeenCalled();
    expectNothingWritten(harness);
  });

  it("answers PASSWORD_TOO_WEAK for a weak new password with a wrong current password, before any lookup or recorded attempt", async () => {
    const harness = makeHarness();
    const result = await harness.service.changeRequiredPassword(
      changeRequest(WEAK_PASSWORD, { currentPassword: WRONG_PASSWORD }),
      DEVICE
    );
    expect(result).toEqual(err("PASSWORD_TOO_WEAK"));
    expect(harness.bruteForce.checkLoginAttempt).not.toHaveBeenCalled();
    expect(harness.lookups.count).toBe(0);
    expect(harness.bruteForce.recordFailedAttempt).not.toHaveBeenCalled();
    expectNothingWritten(harness);
  });
});
