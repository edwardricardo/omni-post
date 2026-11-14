/**
 * @file caseScope.test.ts
 * @description Pins the case scope the integration suites use to tell whether the case that
 *   started a piece of setup is still the case the runner is executing. A hook that node:test
 *   timed out keeps running, and the scope is what lets its late continuation see that its case
 *   is over instead of writing the state the next case reads.
 * @layer infrastructure
 */

import { describe, it, expect } from "vitest";
import { createCaseScope } from "../../integration/helpers/caseScope.js";

describe("createCaseScope", () => {
  it("returns true from owns when the token comes from the latest enter", () => {
    const scope = createCaseScope();

    const token = scope.enter();

    expect(scope.owns(token)).toBe(true);
  });

  it("returns false from owns when a later enter has started another case", () => {
    const scope = createCaseScope();
    const first = scope.enter();

    const second = scope.enter();

    expect(scope.owns(first)).toBe(false);
    expect(scope.owns(second)).toBe(true);
  });

  it("returns false from owns when the token's case has left", () => {
    const scope = createCaseScope();
    const token = scope.enter();

    scope.leave();

    expect(scope.owns(token)).toBe(false);
  });

  it("returns false from owns for a stale token when a new case enters after a leave", () => {
    const scope = createCaseScope();
    const stale = scope.enter();
    scope.leave();

    const current = scope.enter();

    expect(scope.owns(stale)).toBe(false);
    expect(scope.owns(current)).toBe(true);
  });

  it("returns an owned token from enter when leave ran before any case entered", () => {
    const scope = createCaseScope();

    scope.leave();
    const token = scope.enter();

    expect(scope.owns(token)).toBe(true);
  });
});
