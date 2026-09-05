/**
 * @file hardDeleteErrorMapping.test.ts
 * @description Unit tests for mapHardDeleteError — proves each hard-delete failure class maps to a
 *   distinct, actionable HTTP status instead of collapsing to 500, and that the actionable classes
 *   (too-large / interlock / timeout) surface the use-case message verbatim.
 * @layer infrastructure
 */

import { describe, it, expect } from "vitest";
import { mapHardDeleteError } from "../../../src/lib/hardDeleteErrorMapping.js";
import { USE_CASE_ERRORS } from "@core/application/UseCase.js";

describe("mapHardDeleteError", () => {
  it("maps NOT_FOUND to 404 with a capitalized entity message", () => {
    expect(mapHardDeleteError(USE_CASE_ERRORS.NOT_FOUND, "ignored", "account")).toEqual({
      status: 404,
      message: "Account not found",
    });
  });

  // The use case returns VALIDATION_FAILED for TWO different inputs, so the mapping must
  // not answer both with one sentence. It used to reply "Invalid project ID" regardless,
  // which sent an admin whose REASON was blank to go and re-check an id that was fine.
  it("maps a malformed id to 400 and keeps the use case's own wording", () => {
    const useCaseMessage = "Invalid project ID: not-a-uuid";
    expect(
      mapHardDeleteError(USE_CASE_ERRORS.VALIDATION_FAILED, useCaseMessage, "project")
    ).toEqual({ status: 400, message: useCaseMessage });
  });

  it("maps a blank reason to 400 naming the REASON, not the id", () => {
    const useCaseMessage = "A non-empty reason is required to hard-delete a project";
    const { status, message } = mapHardDeleteError(
      USE_CASE_ERRORS.VALIDATION_FAILED,
      useCaseMessage,
      "project"
    );
    expect(status).toBe(400);
    expect(message).toBe(useCaseMessage);
    expect(message).not.toContain("ID");
  });

  it("maps OPERATION_TOO_LARGE to 413 and surfaces the use-case message (the count + ceiling)", () => {
    const useCaseMessage =
      "Hard delete refused: this account owns 60000 posts, above the 50000 ceiling...";
    expect(
      mapHardDeleteError(USE_CASE_ERRORS.OPERATION_TOO_LARGE, useCaseMessage, "account")
    ).toEqual({
      status: 413,
      message: useCaseMessage,
    });
  });

  it("maps CONFLICT to 409 (a durable foreign-key interlock, never retryable)", () => {
    const useCaseMessage =
      "Cannot hard-delete account: a protected relationship still references it";
    expect(mapHardDeleteError(USE_CASE_ERRORS.CONFLICT, useCaseMessage, "account")).toEqual({
      status: 409,
      message: useCaseMessage,
    });
  });

  it("maps TRANSIENT_FAILURE to 503 (timeout / serialization conflict, retryable)", () => {
    const useCaseMessage =
      "Hard-delete of project failed due to a transient database conflict or timeout; retry";
    expect(
      mapHardDeleteError(USE_CASE_ERRORS.TRANSIENT_FAILURE, useCaseMessage, "project")
    ).toEqual({
      status: 503,
      message: useCaseMessage,
    });
  });

  it("maps an unknown code to a generic 500", () => {
    expect(mapHardDeleteError(USE_CASE_ERRORS.INTERNAL_ERROR, "ignored", "account")).toEqual({
      status: 500,
      message: "Failed to hard delete account",
    });
  });
});
