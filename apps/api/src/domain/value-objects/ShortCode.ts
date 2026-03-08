/**
 * Domain Layer - ShortCode Value Object
 *
 * Part of Sprint 19: Link Tracking Feature
 * Represents a short code for tracked links (like Bitly codes).
 */

import { randomInt } from "node:crypto";
import { type Result, ok, err } from "@shared/types";
import { DomainError } from "../errors/index.js";

// Valid characters for short codes: alphanumeric and hyphens
const SHORT_CODE_REGEX = /^[a-zA-Z0-9-]+$/;
const MIN_LENGTH = 3;
const MAX_LENGTH = 50;
const GENERATED_LENGTH = 8;

// Characters for random code generation (no ambiguous chars like 0/O, 1/l)
const CHARS = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ23456789";

/**
 * Error thrown when a short code is invalid
 */
class InvalidShortCodeError extends DomainError {
  constructor(value: string, reason: string) {
    super(`Invalid short code "${value}": ${reason}`, "INVALID_SHORT_CODE");
  }
}

/**
 * ShortCode Value Object
 *
 * Represents a unique short code for URL shortening.
 * Can be auto-generated or custom (vanity slug).
 */
export class ShortCode {
  private readonly _value: string;

  private constructor(value: string) {
    this._value = value;
  }

  /**
   * Get the short code value
   */
  get value(): string {
    return this._value;
  }

  /**
   * Generate a random short code
   */
  static generate(): ShortCode {
    let code = "";
    for (let i = 0; i < GENERATED_LENGTH; i++) {
      code += CHARS.charAt(randomInt(CHARS.length));
    }
    return new ShortCode(code);
  }

  /**
   * Create a ShortCode from an existing string (validated)
   */
  static fromString(value: string): Result<ShortCode, InvalidShortCodeError> {
    const trimmed = value.trim();

    if (trimmed.length < MIN_LENGTH) {
      return err(new InvalidShortCodeError(value, `must be at least ${MIN_LENGTH} characters`));
    }

    if (trimmed.length > MAX_LENGTH) {
      return err(new InvalidShortCodeError(value, `must be at most ${MAX_LENGTH} characters`));
    }

    if (!SHORT_CODE_REGEX.test(trimmed)) {
      return err(
        new InvalidShortCodeError(value, "can only contain letters, numbers, and hyphens")
      );
    }

    return ok(new ShortCode(trimmed));
  }

  /**
   * Create without validation (use only when value is known to be valid)
   */
  static fromStringUnsafe(value: string): ShortCode {
    return new ShortCode(value);
  }

  /**
   * Check equality
   */
  equals(other: ShortCode): boolean {
    return this._value === other._value;
  }

  /**
   * String representation
   */
  toString(): string {
    return this._value;
  }

  /**
   * JSON serialization
   */
  toJSON(): string {
    return this._value;
  }
}
