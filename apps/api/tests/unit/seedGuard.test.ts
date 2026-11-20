/**
 * @file seedGuard.test.ts
 * @description Pins `evaluateSeedEnvironment` (`infra/prisma/src/seedGuard.ts`), the pure guard
 *   the development seed runs once its env file is loaded, before it loads its database client: the
 *   seed runs only when `NODE_ENV` is exactly `development` or `test`, or is absent, which counts as
 *   development. Every other value is refused, `production`, `staging`, the empty value, an unknown
 *   one and a different casing or surrounding whitespace of an accepted one alike, with a reason
 *   that names the value it met, quoted, and the two it accepts. Each case asserts the whole
 *   verdict, the reason's text included.
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

/** The verdict an allowed environment receives. */
const ALLOWED = { allowed: true } as const;

/** The verdict a refused environment receives, whose reason shows the value as `shown`. */
function refusedWith(shown: string): { allowed: false; reason: string } {
  return {
    allowed: false,
    reason: `The development seed runs only when NODE_ENV is development or test, or is unset: NODE_ENV is ${shown}.`,
  };
}

/** An environment that sets `NODE_ENV` to `value`, or leaves it out when `value` is undefined. */
function environmentWith(value?: string): { NODE_ENV?: string } {
  return value === undefined ? {} : { NODE_ENV: value };
}

describe("evaluateSeedEnvironment", () => {
  it("allows the seed when NODE_ENV is development", () => {
    assert.deepStrictEqual(evaluateSeedEnvironment(environmentWith("development")), ALLOWED);
  });

  it("allows the seed when NODE_ENV is test", () => {
    assert.deepStrictEqual(evaluateSeedEnvironment(environmentWith("test")), ALLOWED);
  });

  it("allows the seed when NODE_ENV is absent, which counts as development", () => {
    assert.deepStrictEqual(evaluateSeedEnvironment(environmentWith()), ALLOWED);
  });

  it("refuses the seed with a reason naming the value when NODE_ENV is production", () => {
    assert.deepStrictEqual(
      evaluateSeedEnvironment(environmentWith("production")),
      refusedWith('"production"')
    );
  });

  it("refuses the seed with a reason naming the value when NODE_ENV is staging", () => {
    assert.deepStrictEqual(
      evaluateSeedEnvironment(environmentWith("staging")),
      refusedWith('"staging"')
    );
  });

  it("refuses the seed with a reason naming the empty value when NODE_ENV is empty", () => {
    assert.deepStrictEqual(evaluateSeedEnvironment(environmentWith("")), refusedWith('""'));
  });

  it("refuses the seed with a reason naming the value when NODE_ENV is an unknown value", () => {
    assert.deepStrictEqual(
      evaluateSeedEnvironment(environmentWith("preproduction")),
      refusedWith('"preproduction"')
    );
  });

  it.each(["Development", "TEST", " test", "development\n"])(
    "refuses the seed with a reason naming the value when NODE_ENV is %j, an accepted value by another casing or whitespace",
    (value) => {
      assert.deepStrictEqual(
        evaluateSeedEnvironment(environmentWith(value)),
        refusedWith(JSON.stringify(value))
      );
    }
  );
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
