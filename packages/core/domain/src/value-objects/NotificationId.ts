/**
 * @file NotificationId.ts
 * @description Strongly-typed identifier for Notification entities.
 * @layer domain
 */
import { type Result, ok, err } from "@shared/types";
import { InvalidIdError } from "../errors/index.js";
import { EntityId } from "./EntityId.js";

export class NotificationId extends EntityId {
  protected readonly entityType = "NotificationId";

  private constructor(value: string) {
    super(value);
  }

  /**
   * @method generate
   * @description Creates a new NotificationId with a freshly generated UUID.
   * @returns A new NotificationId instance
   */
  static generate(): NotificationId {
    return new NotificationId(EntityId.generateUUID());
  }

  /**
   * @method fromString
   * @description Creates a NotificationId from an existing string, validating UUID format.
   * @param id - The UUID string to parse
   * @returns Result containing NotificationId on success, InvalidIdError on failure
   */
  static fromString(id: string): Result<NotificationId, InvalidIdError> {
    if (!id || id.trim().length === 0) {
      return err(new InvalidIdError("NotificationId", id));
    }
    if (!EntityId.isValidUUID(id)) {
      return err(new InvalidIdError("NotificationId", id));
    }
    return ok(new NotificationId(id));
  }

  /**
   * @method fromStringUnsafe
   * @description Creates a NotificationId without validation (use only when id is known to be valid).
   * @param id - The UUID string
   * @returns A new NotificationId instance
   */
  static fromStringUnsafe(id: string): NotificationId {
    return new NotificationId(id);
  }
}
