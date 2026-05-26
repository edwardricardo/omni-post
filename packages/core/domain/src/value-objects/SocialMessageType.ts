/**
 * @file SocialMessageType.ts
 * @description Value object representing the type of a social inbox message.
 *   Encapsulates validation and categorization predicates.
 * @layer domain
 */
import { type Result, ok, err } from "@shared/types";
import { InvalidValueError } from "../errors/index.js";

export const SOCIAL_MESSAGE_TYPES = {
  COMMENT: "COMMENT",
  MENTION: "MENTION",
  DIRECT_MESSAGE: "DIRECT_MESSAGE",
  REPLY: "REPLY",
} as const;

export type SocialMessageTypeValue =
  (typeof SOCIAL_MESSAGE_TYPES)[keyof typeof SOCIAL_MESSAGE_TYPES];

const VALID_VALUES = Object.values(SOCIAL_MESSAGE_TYPES) as readonly string[];

/**
 * @class SocialMessageType
 * @description Immutable value object representing a social message's type,
 *   with validation on construction and categorization predicates.
 */
export class SocialMessageType {
  private readonly _value: SocialMessageTypeValue;

  private constructor(value: SocialMessageTypeValue) {
    this._value = value;
  }

  /**
   * @method value
   * @description Returns the raw string value of this message type.
   */
  get value(): SocialMessageTypeValue {
    return this._value;
  }

  /**
   * @method create
   * @description Creates a SocialMessageType from a string, validating against allowed values.
   * @param value - The message type string to parse
   * @returns Result containing SocialMessageType on success, InvalidValueError on failure
   */
  static create(value: string): Result<SocialMessageType, InvalidValueError> {
    const upper = value.toUpperCase();
    if (!VALID_VALUES.includes(upper)) {
      return err(
        new InvalidValueError(
          "SocialMessageType",
          value,
          `Invalid message type: "${value}". Valid: ${VALID_VALUES.join(", ")}`
        )
      );
    }
    return ok(new SocialMessageType(upper as SocialMessageTypeValue));
  }

  /**
   * @method fromString
   * @description Alias for create(). Creates a SocialMessageType from a string.
   * @param value - The message type string to parse
   * @returns Result containing SocialMessageType on success, InvalidValueError on failure
   */
  static fromString(value: string): Result<SocialMessageType, InvalidValueError> {
    return SocialMessageType.create(value);
  }

  /** Factory: COMMENT */
  static comment(): SocialMessageType {
    return new SocialMessageType(SOCIAL_MESSAGE_TYPES.COMMENT);
  }

  /** Factory: MENTION */
  static mention(): SocialMessageType {
    return new SocialMessageType(SOCIAL_MESSAGE_TYPES.MENTION);
  }

  /** Factory: DIRECT_MESSAGE */
  static directMessage(): SocialMessageType {
    return new SocialMessageType(SOCIAL_MESSAGE_TYPES.DIRECT_MESSAGE);
  }

  /** Factory: REPLY */
  static reply(): SocialMessageType {
    return new SocialMessageType(SOCIAL_MESSAGE_TYPES.REPLY);
  }

  /**
   * @method isComment
   * @description Returns true if this is a comment type.
   */
  isComment(): boolean {
    return this._value === SOCIAL_MESSAGE_TYPES.COMMENT;
  }

  /**
   * @method isMention
   * @description Returns true if this is a mention type.
   */
  isMention(): boolean {
    return this._value === SOCIAL_MESSAGE_TYPES.MENTION;
  }

  /**
   * @method isDirectMessage
   * @description Returns true if this is a direct message type.
   */
  isDirectMessage(): boolean {
    return this._value === SOCIAL_MESSAGE_TYPES.DIRECT_MESSAGE;
  }

  /**
   * @method isReply
   * @description Returns true if this is a reply type.
   */
  isReply(): boolean {
    return this._value === SOCIAL_MESSAGE_TYPES.REPLY;
  }

  /**
   * @method requiresResponse
   * @description Returns true if this type typically requires a response (mention or DM).
   */
  requiresResponse(): boolean {
    return (
      this._value === SOCIAL_MESSAGE_TYPES.MENTION ||
      this._value === SOCIAL_MESSAGE_TYPES.DIRECT_MESSAGE
    );
  }

  /**
   * @method equals
   * @description Value-based equality check.
   * @param other - The SocialMessageType to compare
   * @returns true if both types have the same value
   */
  equals(other: SocialMessageType): boolean {
    return this._value === other._value;
  }

  toString(): string {
    return this._value;
  }

  toJSON(): string {
    return this._value;
  }
}
