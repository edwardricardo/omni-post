/**
 * @file CommentId.ts
 * @description Strongly-typed identifier for PostComment aggregates.
 * @layer domain
 */
import { type Result, ok, err } from "@shared/types";
import { InvalidIdError } from "../errors/index.js";
import { EntityId } from "./EntityId.js";

export class CommentId extends EntityId {
  protected readonly entityType = "CommentId";

  private constructor(value: string) {
    super(value);
  }

  /**
   * @method generate
   * @description Creates a new CommentId with a freshly generated UUID.
   * @returns A new CommentId instance
   */
  static generate(): CommentId {
    return new CommentId(EntityId.generateUUID());
  }

  /**
   * @method fromString
   * @description Creates a CommentId from an existing string, validating UUID format.
   * @param id - The UUID string to parse
   * @returns Result containing CommentId on success, InvalidIdError on failure
   */
  static fromString(id: string): Result<CommentId, InvalidIdError> {
    if (!id || id.trim().length === 0) {
      return err(new InvalidIdError("CommentId", id));
    }
    if (!EntityId.isValidUUID(id)) {
      return err(new InvalidIdError("CommentId", id));
    }
    return ok(new CommentId(id));
  }

  /**
   * @method fromStringUnsafe
   * @description Creates a CommentId without validation (use only when id is known to be valid).
   * @param id - The UUID string
   * @returns A new CommentId instance
   */
  static fromStringUnsafe(id: string): CommentId {
    return new CommentId(id);
  }
}
