/**
 * @file TeamMemberId.ts
 * @description Strongly-typed identifier for TeamMember entities.
 * @layer domain
 */
import { type Result, ok, err } from "@shared/types";
import { InvalidIdError } from "../errors/index.js";
import { EntityId } from "./EntityId.js";

export class TeamMemberId extends EntityId {
  protected readonly entityType = "TeamMemberId";

  private constructor(value: string) {
    super(value);
  }

  /**
   * @method generate
   * @description Creates a new TeamMemberId with a freshly generated UUID.
   * @returns A new TeamMemberId instance
   */
  static generate(): TeamMemberId {
    return new TeamMemberId(EntityId.generateUUID());
  }

  /**
   * @method fromString
   * @description Creates a TeamMemberId from an existing string, validating UUID format.
   * @param id - The UUID string to parse
   * @returns Result containing TeamMemberId on success, InvalidIdError on failure
   */
  static fromString(id: string): Result<TeamMemberId, InvalidIdError> {
    if (!id || id.trim().length === 0) {
      return err(new InvalidIdError("TeamMemberId", id));
    }
    if (!EntityId.isValidUUID(id)) {
      return err(new InvalidIdError("TeamMemberId", id));
    }
    return ok(new TeamMemberId(id));
  }

  /**
   * @method fromStringUnsafe
   * @description Creates a TeamMemberId without validation (use only when id is known to be valid).
   * @param id - The UUID string
   * @returns A new TeamMemberId instance
   */
  static fromStringUnsafe(id: string): TeamMemberId {
    return new TeamMemberId(id);
  }
}
