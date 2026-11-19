/**
 * @file PasswordService.changePassword.test.ts
 * @description Unit tier for `PasswordService.changePassword`, the authenticated change, over the
 *   stateful fake of the Prisma client. It pins what the change does at each step whose code the
 *   replacement of a required password shares with it: the policy and reuse rule over the recent
 *   history, the history it writes and the sessions it revokes.
 * @layer infrastructure
 */

import { describe, it, beforeAll, beforeEach, expect, vi } from "vitest";
import { err, ok } from "@shared/types";
import { PasswordService } from "../../../../src/admin/auth/PasswordService.js";
import type { SecurityEventType } from "../../../../src/admin/auth/adminAuthTypes.js";
import { hashPassword, verifyPassword } from "../../../../src/auth/passwordHashing.js";
import {
  createStatefulAdminUserPrismaFake,
  type FakeAdminUserRow,
  type StatefulAdminUserPrismaFake,
} from "../../helpers/statefulAdminUserPrismaFake.js";

const ADMIN_ID = "admin-authenticated-change";
const SESSION_ID = "session-of-the-authenticated-change";

/** Fixture passwords, each distinct so a wrong field cannot pass by collision. */
const CURRENT_PASSWORD = "Fixture-Current-Pw-7t*";
const NEW_PASSWORD = "Fixture-Changed-Pw-2w@";
const RECENT_PASSWORD = "Fixture-Earlier-Pw-6v#";
const AGED_PASSWORD = "Fixture-Oldest-Pw-1z^";
const WRONG_PASSWORD = "Fixture-Mistyped-Pw-9y(";
const WEAK_PASSWORD = "short";

/** Opaque stored hashes: only their identity is under test. */
const OPAQUE_HISTORY = ["fixture-hash-c1", "fixture-hash-c2", "fixture-hash-c3", "fixture-hash-c4"];

interface CapturedEvent {
  type: SecurityEventType;
  userId: string;
  success: boolean;
  error?: string;
}

interface Hashes {
  current: string;
  recent: string;
  aged: string;
}

let hashes: Hashes;

beforeAll(async () => {
  hashes = {
    current: await hashPassword(CURRENT_PASSWORD),
    recent: await hashPassword(RECENT_PASSWORD),
    aged: await hashPassword(AGED_PASSWORD),
  };
});

interface Fixture {
  readonly fake: StatefulAdminUserPrismaFake;
  readonly service: PasswordService;
  readonly events: CapturedEvent[];
  readonly onSecurityEvent: (event: CapturedEvent & { timestamp: Date }) => Promise<void>;
}

/** One administrator holding one active session, behind the real service. */
function makeFixture(row: Partial<FakeAdminUserRow> = {}): Fixture {
  const fake = createStatefulAdminUserPrismaFake();
  fake.seedAdmin({
    id: ADMIN_ID,
    passwordHash: hashes.current,
    passwordHistory: [hashes.recent],
    mustChangePassword: true,
    ...row,
  });
  fake.seedSession({ id: SESSION_ID, userId: ADMIN_ID });
  const events: CapturedEvent[] = [];
  return {
    fake,
    service: new PasswordService(fake.client),
    events,
    onSecurityEvent: async (event) => {
      events.push({
        type: event.type,
        userId: event.userId,
        success: event.success,
        ...(event.error !== undefined && { error: event.error }),
      });
    },
  };
}

/** The stored administrator, asserted to exist. */
function storedAdmin(fixture: Fixture): FakeAdminUserRow {
  const row = fixture.fake.readAdmin(ADMIN_ID);
  if (!row) throw new Error("the fixture administrator must still exist");
  return row;
}

describe("PasswordService.changePassword — the authenticated change", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("stores the new hash, appends the replaced one to the history, clears the mark and revokes every session", async () => {
    const fixture = makeFixture();

    const result = await fixture.service.changePassword(
      ADMIN_ID,
      CURRENT_PASSWORD,
      NEW_PASSWORD,
      fixture.onSecurityEvent
    );

    expect(result).toEqual(ok(true));
    const row = storedAdmin(fixture);
    expect(await verifyPassword(row.passwordHash, NEW_PASSWORD)).toBe(true);
    expect(row.passwordHistory).toEqual([hashes.recent, hashes.current]);
    expect(row.mustChangePassword).toBe(false);
    expect(fixture.fake.writes().map((w) => [w.op, w.where])).toEqual([
      ["update", { id: ADMIN_ID }],
    ]);
    expect(fixture.events).toEqual([{ type: "PASSWORD_CHANGED", userId: ADMIN_ID, success: true }]);
    expect(fixture.fake.readSessions(ADMIN_ID).map((s) => [s.isActive, s.revokeReason])).toEqual([
      [false, "PASSWORD_CHANGED"],
    ]);
  });

  it("keeps the history to the reuse window when it appends", async () => {
    const fixture = makeFixture({ passwordHistory: [...OPAQUE_HISTORY, hashes.recent] });

    await fixture.service.changePassword(
      ADMIN_ID,
      CURRENT_PASSWORD,
      NEW_PASSWORD,
      fixture.onSecurityEvent
    );

    expect(storedAdmin(fixture).passwordHistory).toEqual([
      ...OPAQUE_HISTORY.slice(1),
      hashes.recent,
      hashes.current,
    ]);
  });

  it("refuses a wrong current password with INVALID_CREDENTIALS and a failed PASSWORD_CHANGED event", async () => {
    const fixture = makeFixture();

    const result = await fixture.service.changePassword(
      ADMIN_ID,
      WRONG_PASSWORD,
      NEW_PASSWORD,
      fixture.onSecurityEvent
    );

    expect(result).toEqual(err("INVALID_CREDENTIALS"));
    expect(fixture.fake.writes()).toEqual([]);
    expect(fixture.events).toEqual([
      {
        type: "PASSWORD_CHANGED",
        userId: ADMIN_ID,
        success: false,
        error: "Invalid current password",
      },
    ]);
  });

  it("refuses a password the policy refuses with PASSWORD_TOO_WEAK and writes nothing", async () => {
    const fixture = makeFixture();

    const result = await fixture.service.changePassword(
      ADMIN_ID,
      CURRENT_PASSWORD,
      WEAK_PASSWORD,
      fixture.onSecurityEvent
    );

    expect(result).toEqual(err("PASSWORD_TOO_WEAK"));
    expect(fixture.fake.writes()).toEqual([]);
    expect(fixture.fake.readSessions(ADMIN_ID).map((s) => s.isActive)).toEqual([true]);
  });

  it("refuses a recent password with PASSWORD_REUSED and writes nothing", async () => {
    const fixture = makeFixture();

    const result = await fixture.service.changePassword(
      ADMIN_ID,
      CURRENT_PASSWORD,
      RECENT_PASSWORD,
      fixture.onSecurityEvent
    );

    expect(result).toEqual(err("PASSWORD_REUSED"));
    expect(fixture.fake.writes()).toEqual([]);
  });

  it("accepts a password older than the reuse window", async () => {
    const fixture = makeFixture({
      passwordHistory: [hashes.aged, ...OPAQUE_HISTORY, hashes.recent],
    });

    const result = await fixture.service.changePassword(
      ADMIN_ID,
      CURRENT_PASSWORD,
      AGED_PASSWORD,
      fixture.onSecurityEvent
    );

    expect(result).toEqual(ok(true));
  });

  it("checks reuse against the history only, so the current password is not in its window", async () => {
    const fixture = makeFixture();

    const result = await fixture.service.changePassword(
      ADMIN_ID,
      CURRENT_PASSWORD,
      CURRENT_PASSWORD,
      fixture.onSecurityEvent
    );

    expect(result).toEqual(ok(true));
    expect(storedAdmin(fixture).passwordHistory).toEqual([hashes.recent, hashes.current]);
  });
});
