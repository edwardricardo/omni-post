/**
 * @file MentionId.ts
 * @description Strongly-typed identifier for Mention aggregates (brand-listening).
 * @layer domain
 */
import { type Result, ok, err } from "@shared/types";
import { InvalidIdError } from "../errors/index.js";
import { EntityId } from "./EntityId.js";

export class MentionId extends EntityId {
  protected readonly entityType = "MentionId";

  private constructor(value: string) {
    super(value);
  }

  /**
   * @method generate
   * @description Creates a new MentionId with a freshly generated UUID.
   * @returns A new MentionId instance
   */
  static generate(): MentionId {
    return new MentionId(EntityId.generateUUID());
  }

  /**
   * @method fromString
   * @description Creates a MentionId from an existing string, validating UUID format.
   * @param id - The UUID string to parse
   * @returns Result containing MentionId on success, InvalidIdError on failure
   */
  static fromString(id: string): Result<MentionId, InvalidIdError> {
    if (!id || id.trim().length === 0) {
      return err(new InvalidIdError("MentionId", id));
    }
    if (!EntityId.isValidUUID(id)) {
      return err(new InvalidIdError("MentionId", id));
    }
    return ok(new MentionId(id));
  }

  /**
   * @method fromStringUnsafe
   * @description Creates a MentionId without validation (use only when id is known valid).
   * @param id - The UUID string
   * @returns A new MentionId instance
   */
  static fromStringUnsafe(id: string): MentionId {
    return new MentionId(id);
  }
}
