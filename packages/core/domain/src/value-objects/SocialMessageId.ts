/**
 * @file SocialMessageId.ts
 * @description Strongly-typed identifier for SocialMessage aggregates.
 * @layer domain
 */
import { type Result, ok, err } from "@shared/types";
import { InvalidIdError } from "../errors/index.js";
import { EntityId } from "./EntityId.js";

export class SocialMessageId extends EntityId {
  protected readonly entityType = "SocialMessageId";

  private constructor(value: string) {
    super(value);
  }

  /**
   * @method generate
   * @description Creates a new SocialMessageId with a freshly generated UUID.
   * @returns A new SocialMessageId instance
   */
  static generate(): SocialMessageId {
    return new SocialMessageId(EntityId.generateUUID());
  }

  /**
   * @method fromString
   * @description Creates a SocialMessageId from an existing string, validating UUID format.
   * @param id - The UUID string to parse
   * @returns Result containing SocialMessageId on success, InvalidIdError on failure
   */
  static fromString(id: string): Result<SocialMessageId, InvalidIdError> {
    if (!id || id.trim().length === 0) {
      return err(new InvalidIdError("SocialMessageId", id));
    }
    if (!EntityId.isValidUUID(id)) {
      return err(new InvalidIdError("SocialMessageId", id));
    }
    return ok(new SocialMessageId(id));
  }

  /**
   * @method fromStringUnsafe
   * @description Creates a SocialMessageId without validation (use only when id is known to be valid).
   * @param id - The UUID string
   * @returns A new SocialMessageId instance
   */
  static fromStringUnsafe(id: string): SocialMessageId {
    return new SocialMessageId(id);
  }
}
