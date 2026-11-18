/**
 * @file seedGuard.test.ts
 * @description Pins `evaluateSeedEnvironment` (`infra/prisma/src/seedGuard.ts`), the pure guard
 *   the development seed runs once its env file is loaded, before it builds its database client: a
 *   `NODE_ENV` that is `production` once trimmed and lower-cased is refused with the guard's reason,
 *   so a mistyped casing fails closed, and every other value, the absent and the empty included, is
 *   allowed. Each case asserts the whole verdict, the reason's text included.
 * @layer infrastructure
 */

import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { evaluateSeedEnvironment } from "../../../../infra/prisma/src/seedGuard.js";

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
