/**
 * @file seedGuard.test.ts
 * @description Pins `evaluateSeedEnvironment` (`infra/prisma/src/seedGuard.ts`), the pure guard
 *   the development seed runs once its env file is loaded, before it builds its database client: a
 *   `NODE_ENV` that is `production` once trimmed and lower-cased is refused with the guard's reason,
 *   so a mistyped casing fails closed, and every other value, the absent and the empty included, is
 *   allowed. Each case asserts the whole verdict, the reason's text included.
 *
 *   It also pins `evaluateAdminPassword`, the second rule the seed runs at the same place: the seed
 *   creates an administrator and takes no default password, so an `ADMIN_PASSWORD` that is absent,
 *   empty or blank once trimmed is refused with that rule's reason, which never carries the value it
 *   was given, and any other value is returned exactly as given, surrounding whitespace included.
 * @layer infrastructure
 */

import assert from "node:assert/strict";
import { describe, it } from "vitest";
import {
  evaluateAdminPassword,
  evaluateSeedEnvironment,
} from "../../../../infra/prisma/src/seedGuard.js";

/** The verdict a production environment receives, reason included. */
const REFUSED_UNDER_PRODUCTION = {
  allowed: false,
  reason:
    "The development seed does not run under a production environment: NODE_ENV is production.",
} as const;

/** The verdict every other environment receives. */
const ALLOWED = { allowed: true } as const;

/** An environment that sets `NODE_ENV` to `value`, or leaves it out when `value` is undefined. */
function environmentWith(value?: string): { NODE_ENV?: string } {
  return value === undefined ? {} : { NODE_ENV: value };
}

describe("evaluateSeedEnvironment", () => {
  it("refuses the seed with the production reason when NODE_ENV is production", () => {
    assert.deepStrictEqual(
      evaluateSeedEnvironment(environmentWith("production")),
      REFUSED_UNDER_PRODUCTION
    );
  });

  it.each(["Production", "PRODUCTION", " production", "production ", "\tPrOdUcTiOn\n"])(
    "refuses the seed with the production reason when NODE_ENV is %j, production by casing or surrounding whitespace",
    (value) => {
      assert.deepStrictEqual(
        evaluateSeedEnvironment(environmentWith(value)),
        REFUSED_UNDER_PRODUCTION
      );
    }
  );

  it.each(["development", "test"])("allows the seed when NODE_ENV is %j", (value) => {
    assert.deepStrictEqual(evaluateSeedEnvironment(environmentWith(value)), ALLOWED);
  });

  it("allows the seed when NODE_ENV is absent", () => {
    assert.deepStrictEqual(evaluateSeedEnvironment(environmentWith()), ALLOWED);
  });

  it("allows the seed when NODE_ENV is empty", () => {
    assert.deepStrictEqual(evaluateSeedEnvironment(environmentWith("")), ALLOWED);
  });

  it("allows the seed when NODE_ENV only contains production inside a longer value", () => {
    assert.deepStrictEqual(evaluateSeedEnvironment(environmentWith("preproduction")), ALLOWED);
  });
});

/** The verdict an environment with no usable administrator password receives, reason included. */
const REFUSED_WITHOUT_ADMIN_PASSWORD = {
  allowed: false,
  reason:
    "The development seed creates an administrator and takes no default password: set ADMIN_PASSWORD in the environment or in the env file at the repository root.",
} as const;

/** An obviously fake administrator password, with `padding` on both sides of it. */
function fakeAdminPassword(padding = ""): string {
  return `${padding}fake-seed-admin-password${padding}`;
}

/** An environment that sets `ADMIN_PASSWORD` to `value`, or leaves it out when `value` is undefined. */
function environmentWithAdminPassword(value?: string): { ADMIN_PASSWORD?: string } {
  return value === undefined ? {} : { ADMIN_PASSWORD: value };
}

describe("evaluateAdminPassword", () => {
  it("refuses the seed with the password reason when ADMIN_PASSWORD is absent", () => {
    assert.deepStrictEqual(
      evaluateAdminPassword(environmentWithAdminPassword()),
      REFUSED_WITHOUT_ADMIN_PASSWORD
    );
  });

  it("refuses the seed with the password reason when ADMIN_PASSWORD is empty", () => {
    assert.deepStrictEqual(
      evaluateAdminPassword(environmentWithAdminPassword("")),
      REFUSED_WITHOUT_ADMIN_PASSWORD
    );
  });

  it.each([" ", "\t", "\n", " \t\r\n "])(
    "refuses the seed with the password reason when ADMIN_PASSWORD is %j, blank once trimmed",
    (value) => {
      assert.deepStrictEqual(
        evaluateAdminPassword(environmentWithAdminPassword(value)),
        REFUSED_WITHOUT_ADMIN_PASSWORD
      );
    }
  );

  it("refuses the seed with a reason that carries none of the value when ADMIN_PASSWORD is Unicode whitespace only", () => {
    const value = "\u00a0\u2003\ufeff";

    const verdict = evaluateAdminPassword(environmentWithAdminPassword(value));

    assert.deepStrictEqual(verdict, REFUSED_WITHOUT_ADMIN_PASSWORD);
    assert.strictEqual(verdict.allowed === false && verdict.reason.includes(value), false);
  });

  it("returns the password exactly as given when ADMIN_PASSWORD is set", () => {
    assert.deepStrictEqual(
      evaluateAdminPassword(environmentWithAdminPassword(fakeAdminPassword())),
      {
        allowed: true,
        password: fakeAdminPassword(),
      }
    );
  });

  it("returns the password exactly as given, surrounding whitespace included, when ADMIN_PASSWORD is padded", () => {
    assert.deepStrictEqual(
      evaluateAdminPassword(environmentWithAdminPassword(fakeAdminPassword(" \t"))),
      { allowed: true, password: fakeAdminPassword(" \t") }
    );
  });
});
