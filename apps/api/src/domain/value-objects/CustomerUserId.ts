/**
 * @file CustomerUserId.ts
 * @description Strongly-typed UUID identifier for CustomerUser entities — the
 *   customer-side users with email/password authentication, distinct from AdminUser.
 * @layer domain
 */
import { type Result, ok, err } from "@shared/types";
import { InvalidIdError } from "../errors/index.js";
import { EntityId } from "./EntityId.js";

export class CustomerUserId extends EntityId {
  protected readonly entityType = "CustomerUserId";

  private constructor(value: string) {
    super(value);
  }

  /**
   * @method generate
   * @description Creates a new CustomerUserId with a freshly generated UUID v4.
   * @returns A new CustomerUserId instance
   */
  static generate(): CustomerUserId {
    return new CustomerUserId(EntityId.generateUUID());
  }

  /**
   * @method fromString
   * @description Creates a CustomerUserId from an existing string, validating
   *   UUID v4 format.
   * @param id - The UUID string to parse
   * @returns Result containing CustomerUserId on success, InvalidIdError on failure
   */
  static fromString(id: string): Result<CustomerUserId, InvalidIdError> {
    if (!id || id.trim().length === 0) {
      return err(new InvalidIdError("CustomerUserId", id));
    }
    if (!EntityId.isValidUUID(id)) {
      return err(new InvalidIdError("CustomerUserId", id));
    }
    return ok(new CustomerUserId(id));
  }

  /**
   * @method fromStringUnsafe
   * @description Creates a CustomerUserId without validation (only when id is
   *   known-good — e.g. fresh from the database).
   * @param id - The UUID string
   * @returns A new CustomerUserId instance
   */
  static fromStringUnsafe(id: string): CustomerUserId {
    return new CustomerUserId(id);
  }
}
