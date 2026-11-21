/**
 * @file UseCase.test.ts
 * @description Unit tests for UseCaseError construction + USE_CASE_ERRORS constants —
 *   the shared error contract consumed by all @core application use cases.
 * @layer infrastructure
 */

import { afterEach, describe, it, vi } from "vitest";
import assert from "node:assert/strict";
import {
  COMMON_ERRORS,
  ERROR_CATEGORY,
  PARAM_KIND,
  type ErrorDefinition,
  type RegisteredErrorCode,
} from "@shared/types";
import { defineErrors } from "@shared/types/error-registry/definition.js";
import { UseCaseError, USE_CASE_ERRORS, classifyPersistenceFailure } from "../../src/UseCase.js";

/** The ten codes as every importer has read them: name and string, in this order. */
const USE_CASE_ERRORS_AS_READ = [
  ["NOT_FOUND", "NOT_FOUND"],
  ["VALIDATION_FAILED", "VALIDATION_FAILED"],
  ["UNAUTHORIZED", "UNAUTHORIZED"],
  ["FORBIDDEN", "FORBIDDEN"],
  ["CONFLICT", "CONFLICT"],
  ["INTERNAL_ERROR", "INTERNAL_ERROR"],
  ["NOT_IMPLEMENTED", "NOT_IMPLEMENTED"],
  ["GUARDRAIL_REJECTED", "GUARDRAIL_REJECTED"],
  ["OPERATION_TOO_LARGE", "OPERATION_TOO_LARGE"],
  ["TRANSIENT_FAILURE", "TRANSIENT_FAILURE"],
];

const PARAMS_TABLE = "@shared/types/error-registry/domains/platform.js";

/** A table that declares parameters, put in the registry's place for one case. */
const FIXTURE_ERRORS = defineErrors("platform", {
  FIXTURE_LIMIT_EXCEEDED: {
    category: ERROR_CATEGORY.TOO_LARGE,
    status: 413,
    message: "The operation touches {count} rows of {tables}",
    params: { count: PARAM_KIND.NUMBER, tables: PARAM_KIND.STRING_LIST },
    fronts: [],
  },
});

/** The fixture's definition, typed as the registry types its own: the loaded registry holds it. */
// canon-exception: test-fixture
const LIMIT_EXCEEDED = FIXTURE_ERRORS.FIXTURE_LIMIT_EXCEEDED as unknown as ErrorDefinition<
  RegisteredErrorCode,
  "too_large",
  (typeof FIXTURE_ERRORS)["FIXTURE_LIMIT_EXCEEDED"]["params"]
>;

describe("USE_CASE_ERRORS constants", () => {
  it("defines NOT_FOUND with the correct literal string", () => {
    assert.strictEqual(USE_CASE_ERRORS.NOT_FOUND, "NOT_FOUND");
  });

  it("defines VALIDATION_FAILED with the correct literal string", () => {
    assert.strictEqual(USE_CASE_ERRORS.VALIDATION_FAILED, "VALIDATION_FAILED");
  });

  it("defines UNAUTHORIZED with the correct literal string", () => {
    assert.strictEqual(USE_CASE_ERRORS.UNAUTHORIZED, "UNAUTHORIZED");
  });

  it("defines FORBIDDEN with the correct literal string", () => {
    assert.strictEqual(USE_CASE_ERRORS.FORBIDDEN, "FORBIDDEN");
  });

  it("defines CONFLICT with the correct literal string", () => {
    assert.strictEqual(USE_CASE_ERRORS.CONFLICT, "CONFLICT");
  });

  it("defines INTERNAL_ERROR with the correct literal string", () => {
    assert.strictEqual(USE_CASE_ERRORS.INTERNAL_ERROR, "INTERNAL_ERROR");
  });

  it("defines NOT_IMPLEMENTED with the correct literal string", () => {
    assert.strictEqual(USE_CASE_ERRORS.NOT_IMPLEMENTED, "NOT_IMPLEMENTED");
  });

  it("defines GUARDRAIL_REJECTED with the correct literal string", () => {
    assert.strictEqual(USE_CASE_ERRORS.GUARDRAIL_REJECTED, "GUARDRAIL_REJECTED");
  });

  it("defines OPERATION_TOO_LARGE with the correct literal string", () => {
    assert.strictEqual(USE_CASE_ERRORS.OPERATION_TOO_LARGE, "OPERATION_TOO_LARGE");
  });

  it("defines TRANSIENT_FAILURE with the correct literal string", () => {
    assert.strictEqual(USE_CASE_ERRORS.TRANSIENT_FAILURE, "TRANSIENT_FAILURE");
  });

  it("exposes exactly 10 known error codes (no undocumented additions)", () => {
    const keys = Object.keys(USE_CASE_ERRORS);
    assert.strictEqual(keys.length, 10);
  });
});

describe("classifyPersistenceFailure", () => {
  it("maps a P2003 foreign-key interlock to CONFLICT (durable, non-retryable)", () => {
    const error = Object.assign(new Error("FK constraint failed"), { code: "P2003" });
    assert.strictEqual(classifyPersistenceFailure(error), USE_CASE_ERRORS.CONFLICT);
  });

  it("maps a P2028 transaction timeout to TRANSIENT_FAILURE (retryable)", () => {
    const error = Object.assign(new Error("transaction timed out"), { code: "P2028" });
    assert.strictEqual(classifyPersistenceFailure(error), USE_CASE_ERRORS.TRANSIENT_FAILURE);
  });

  it("maps a P2034 write conflict / serialization failure to TRANSIENT_FAILURE (retryable)", () => {
    const error = Object.assign(new Error("write conflict"), { code: "P2034" });
    assert.strictEqual(classifyPersistenceFailure(error), USE_CASE_ERRORS.TRANSIENT_FAILURE);
  });

  it("maps a P2002 unique-constraint violation to CONFLICT, not INTERNAL_ERROR", () => {
    // The restore residual race: a LIVE twin was created after the subject was
    // soft-deleted, and clearing deletedAt collides with it on the partial
    // unique. The database is the arbiter that decides the race, and a caller
    // who loses it is in conflict with an existing row — a 409 they can act on
    // (rename the twin, or keep it) rather than an opaque 500 that reads as a
    // system fault the operator caused.
    const error = Object.assign(new Error("Unique constraint failed"), { code: "P2002" });
    assert.strictEqual(classifyPersistenceFailure(error), USE_CASE_ERRORS.CONFLICT);
  });

  it("maps an unclassified error (no known code) to INTERNAL_ERROR", () => {
    assert.strictEqual(
      classifyPersistenceFailure(new Error("something else")),
      USE_CASE_ERRORS.INTERNAL_ERROR
    );
  });

  it("maps a non-error value (null / string) to INTERNAL_ERROR without throwing", () => {
    assert.strictEqual(classifyPersistenceFailure(null), USE_CASE_ERRORS.INTERNAL_ERROR);
    assert.strictEqual(classifyPersistenceFailure("boom"), USE_CASE_ERRORS.INTERNAL_ERROR);
  });
});

describe("UseCaseError", () => {
  describe("construction", () => {
    it("sets message, code, and name correctly", () => {
      const e = new UseCaseError("Not found", USE_CASE_ERRORS.NOT_FOUND);
      assert.strictEqual(e.message, "Not found");
      assert.strictEqual(e.code, USE_CASE_ERRORS.NOT_FOUND);
      assert.strictEqual(e.name, "UseCaseError");
    });

    it("is an instance of Error (extends Error)", () => {
      const e = new UseCaseError("msg", "SOME_CODE");
      assert.ok(e instanceof Error);
    });

    it("sets originalError when a cause is provided", () => {
      const cause = new Error("root cause");
      const e = new UseCaseError("wrapper", USE_CASE_ERRORS.INTERNAL_ERROR, cause);
      assert.strictEqual(e.originalError, cause);
    });

    it("leaves originalError undefined when no cause is provided", () => {
      const e = new UseCaseError("msg", USE_CASE_ERRORS.NOT_FOUND);
      assert.strictEqual(e.originalError, undefined);
    });
  });

  describe("code contract", () => {
    it("code matches the USE_CASE_ERRORS constant passed at construction", () => {
      for (const [, code] of Object.entries(USE_CASE_ERRORS)) {
        const e = new UseCaseError("test", code);
        assert.strictEqual(e.code, code, `Expected code ${code}`);
      }
    });
  });
});

describe("USE_CASE_ERRORS read from the registry", () => {
  it("holds exactly the names and strings every importer has read, key by key", () => {
    assert.deepStrictEqual(Object.entries(USE_CASE_ERRORS), USE_CASE_ERRORS_AS_READ);
  });

  it("names each code of the common domain by its own name", () => {
    assert.deepStrictEqual(
      Object.entries(USE_CASE_ERRORS),
      Object.entries(COMMON_ERRORS).map(([name, definition]) => [name, definition.code])
    );
  });
});

describe("UseCaseError built by its constructor", () => {
  it("keeps the shape every caller and the API's handler read: cause, class and no registry fields", () => {
    const cause = new Error("root cause");

    const e = new UseCaseError("wrapper", "SOME_CODE", cause);

    assert.ok(e instanceof UseCaseError);
    assert.strictEqual(e.constructor.name, "UseCaseError");
    assert.strictEqual(e.message, "wrapper");
    assert.strictEqual(e.cause, cause);
    assert.strictEqual(e.definition, undefined);
    assert.strictEqual(e.params, undefined);
    assert.strictEqual("statusCode" in e, false);
  });

  it("sets no cause when none is given", () => {
    assert.strictEqual(Object.hasOwn(new UseCaseError("msg", "SOME_CODE"), "cause"), false);
  });
});

describe("UseCaseError.of", () => {
  afterEach(() => {
    vi.doUnmock(PARAMS_TABLE);
    vi.resetModules();
  });

  it("builds a UseCaseError from the registry's entry, the option's cause as its original error", () => {
    const cause = new Error("transaction timed out");

    const e = UseCaseError.of(COMMON_ERRORS.TRANSIENT_FAILURE, { cause });

    assert.ok(e instanceof UseCaseError);
    assert.ok(e instanceof Error);
    assert.strictEqual(e.name, "UseCaseError");
    assert.strictEqual(e.code, USE_CASE_ERRORS.TRANSIENT_FAILURE);
    assert.strictEqual(e.definition, COMMON_ERRORS.TRANSIENT_FAILURE);
    assert.strictEqual(e.params, undefined);
    assert.strictEqual(e.message, "The operation failed for a reason that may pass: try it again");
    assert.strictEqual(e.originalError, cause);
    assert.strictEqual(e.cause, cause);
  });

  it("takes the text of the registry's entry, never a text the object passed carries", () => {
    const e = UseCaseError.of({ ...COMMON_ERRORS.NOT_FOUND, message: "an inline text" });

    assert.strictEqual(e.definition, COMMON_ERRORS.NOT_FOUND);
    assert.strictEqual(e.message, "The requested resource was not found");
  });

  it("answers INTERNAL_ERROR, and raises nothing, for a code the registry does not hold", () => {
    // canon-exception: test-fixture
    const unregistered = {
      ...COMMON_ERRORS.NOT_FOUND,
      code: "NOT_A_REGISTERED_CODE",
    } as unknown as typeof COMMON_ERRORS.NOT_FOUND;

    const e = UseCaseError.of(unregistered);

    assert.strictEqual(e.code, USE_CASE_ERRORS.INTERNAL_ERROR);
    assert.strictEqual(e.definition, COMMON_ERRORS.INTERNAL_ERROR);
    assert.strictEqual(e.message, "The server could not complete the request");
    assert.strictEqual(e.originalError, undefined);
  });

  it("carries the declared parameters and words its text with them", async () => {
    vi.resetModules();
    vi.doMock(PARAMS_TABLE, () => ({ PLATFORM_ERRORS: FIXTURE_ERRORS }));
    const fresh = await import("../../src/UseCase.js");

    const e = fresh.UseCaseError.of(LIMIT_EXCEEDED, { count: 12, tables: ["Post", "Media"] });

    assert.ok(e instanceof fresh.UseCaseError);
    assert.strictEqual(e.code, "FIXTURE_LIMIT_EXCEEDED");
    assert.deepStrictEqual(e.params, { count: 12, tables: ["Post", "Media"] });
    assert.strictEqual(e.message, "The operation touches 12 rows of Post, Media");
  });

  it("keeps its registry fields readable and read-only but out of every enumeration a logger reads", async () => {
    vi.resetModules();
    vi.doMock(PARAMS_TABLE, () => ({ PLATFORM_ERRORS: FIXTURE_ERRORS }));
    const fresh = await import("../../src/UseCase.js");
    const e = fresh.UseCaseError.of(LIMIT_EXCEEDED, { count: 12, tables: ["Post", "Media"] });
    const enumerated: string[] = [];

    for (const key in e) enumerated.push(key);

    assert.strictEqual(e.definition, FIXTURE_ERRORS.FIXTURE_LIMIT_EXCEEDED);
    assert.deepStrictEqual(e.params, { count: 12, tables: ["Post", "Media"] });
    assert.deepStrictEqual(enumerated.sort(), ["code", "name", "originalError"]);
    assert.deepStrictEqual(Object.keys({ ...e }).sort(), ["code", "name", "originalError"]);
    for (const field of ["definition", "params"]) {
      const descriptor = Object.getOwnPropertyDescriptor(e, field);
      assert.strictEqual(descriptor?.enumerable, false, field);
      assert.strictEqual(descriptor?.writable, false, field);
    }
  });
});
