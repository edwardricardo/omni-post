/**
 * @file ApprovalRequestId.ts
 * @description Strongly-typed identifier for ApprovalRequest aggregates.
 * @layer domain
 */
import { type Result, ok, err } from "@shared/types";
import { InvalidIdError } from "../errors/index.js";
import { EntityId } from "./EntityId.js";

/**
 * @class ApprovalRequestId
 * @description Unique identifier for approval request aggregates.
 *   Wraps a UUID string with type safety and validation.
 */
export class ApprovalRequestId extends EntityId {
  protected readonly entityType = "ApprovalRequestId";

  private constructor(value: string) {
    super(value);
  }

  /**
   * @method generate
   * @description Creates a new ApprovalRequestId with a freshly generated UUID.
   * @returns A new ApprovalRequestId instance
   */
  static generate(): ApprovalRequestId {
    return new ApprovalRequestId(EntityId.generateUUID());
  }

  /**
   * @method fromString
   * @description Creates an ApprovalRequestId from an existing string, validating UUID format.
   * @param id - The UUID string to parse
   * @returns Result containing ApprovalRequestId on success, InvalidIdError on failure
   */
  static fromString(id: string): Result<ApprovalRequestId, InvalidIdError> {
    if (!id || id.trim().length === 0) {
      return err(new InvalidIdError("ApprovalRequestId", id));
    }
    if (!EntityId.isValidUUID(id)) {
      return err(new InvalidIdError("ApprovalRequestId", id));
    }
    return ok(new ApprovalRequestId(id));
  }

  /**
   * @method fromStringUnsafe
   * @description Creates an ApprovalRequestId without validation (use only when id is known to be valid).
   * @param id - The UUID string
   * @returns A new ApprovalRequestId instance
   */
  static fromStringUnsafe(id: string): ApprovalRequestId {
    return new ApprovalRequestId(id);
  }
}
