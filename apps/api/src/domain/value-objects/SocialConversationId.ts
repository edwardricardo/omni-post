/**
 * @file SocialConversationId.ts
 * @description Strongly-typed identifier for SocialConversation entities.
 * @layer domain
 */
import { type Result, ok, err } from "@shared/types";
import { InvalidIdError } from "../errors/index.js";
import { EntityId } from "./EntityId.js";

export class SocialConversationId extends EntityId {
  protected readonly entityType = "SocialConversationId";

  private constructor(value: string) {
    super(value);
  }

  /**
   * @method generate
   * @description Creates a new SocialConversationId with a freshly generated UUID.
   * @returns A new SocialConversationId instance
   */
  static generate(): SocialConversationId {
    return new SocialConversationId(EntityId.generateUUID());
  }

  /**
   * @method fromString
   * @description Creates a SocialConversationId from an existing string, validating UUID format.
   * @param id - The UUID string to parse
   * @returns Result containing SocialConversationId on success, InvalidIdError on failure
   */
  static fromString(id: string): Result<SocialConversationId, InvalidIdError> {
    if (!id || id.trim().length === 0) {
      return err(new InvalidIdError("SocialConversationId", id));
    }
    if (!EntityId.isValidUUID(id)) {
      return err(new InvalidIdError("SocialConversationId", id));
    }
    return ok(new SocialConversationId(id));
  }

  /**
   * @method fromStringUnsafe
   * @description Creates a SocialConversationId without validation (use only when id is known to be valid).
   * @param id - The UUID string
   * @returns A new SocialConversationId instance
   */
  static fromStringUnsafe(id: string): SocialConversationId {
    return new SocialConversationId(id);
  }
}
