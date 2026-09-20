/**
 * @file domainErrorCodes.test.ts
 * @description Pins the STABLE discriminators this package exports against the errors
 *   that actually carry them. A consumer outside the package cannot narrow on class
 *   identity — the dual conditional export (`development` -> src, `default` -> dist)
 *   can put two constructors for one class in a single process — so it narrows on the
 *   `code` string instead. That only works while the exported constant and the code the
 *   error is constructed with are the SAME value, and nothing but a test says so: the
 *   two live in different statements and drift silently. Each case builds a REAL error
 *   and compares, rather than comparing one literal to another.
 * @layer infrastructure
 */

import { describe, it } from "vitest";
import assert from "node:assert/strict";
import {
  InvalidStateTransitionError,
  VersionConflictError,
  INVALID_STATE_TRANSITION_CODE,
  VERSION_CONFLICT_CODE,
} from "@core/domain/errors/index.js";

describe("domain error discriminators", () => {
  it("exports the code a real InvalidStateTransitionError carries", () => {
    const error = new InvalidStateTransitionError("DRAFT", "PUBLISHED", "Post");

    assert.strictEqual(
      error.code,
      INVALID_STATE_TRANSITION_CODE,
      "a lifecycle refusal must be recognisable by the exported constant"
    );
  });

  it("exports the code a real VersionConflictError carries", () => {
    const error = new VersionConflictError("Post", "post-1", 3, 4);

    assert.strictEqual(
      error.code,
      VERSION_CONFLICT_CODE,
      "a lost compare-and-swap must be recognisable by the exported constant"
    );
  });

  it("keeps the two discriminators distinct", () => {
    // A consumer chooses between FORBIDDEN and CONFLICT on these two values alone
    // (`publicationWriteOutcome.ts` in `@core/posts`); collapsing them would make one
    // of those answers unreachable without a single test going red anywhere else.
    assert.notStrictEqual(INVALID_STATE_TRANSITION_CODE, VERSION_CONFLICT_CODE);
  });
});
