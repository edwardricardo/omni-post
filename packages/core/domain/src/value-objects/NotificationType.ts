/**
 * @file NotificationType.ts
 * @description Value object representing the type/category of a notification.
 *   Encapsulates validation and categorization predicates for notification types.
 * @layer domain
 */
import { type Result, ok, err } from "@shared/types";
import { InvalidValueError } from "../errors/index.js";

export const NOTIFICATION_TYPES = {
  APPROVAL_REQUESTED: "APPROVAL_REQUESTED",
  POST_APPROVED: "POST_APPROVED",
  POST_REJECTED: "POST_REJECTED",
  COMMENT_ADDED: "COMMENT_ADDED",
  COMMENT_REPLY: "COMMENT_REPLY",
  MENTION: "MENTION",
  TEAM_INVITE: "TEAM_INVITE",
  INBOX_MESSAGE_RECEIVED: "INBOX_MESSAGE_RECEIVED",
  INBOX_MENTION_RECEIVED: "INBOX_MENTION_RECEIVED",
  PUBLICATION_RETRACTION_PENDING: "PUBLICATION_RETRACTION_PENDING",
} as const;

export type NotificationTypeValue = (typeof NOTIFICATION_TYPES)[keyof typeof NOTIFICATION_TYPES];

const VALID_VALUES = Object.values(NOTIFICATION_TYPES) as readonly string[];

const APPROVAL_TYPES: readonly NotificationTypeValue[] = [
  NOTIFICATION_TYPES.APPROVAL_REQUESTED,
  NOTIFICATION_TYPES.POST_APPROVED,
  NOTIFICATION_TYPES.POST_REJECTED,
];

const COMMENT_TYPES: readonly NotificationTypeValue[] = [
  NOTIFICATION_TYPES.COMMENT_ADDED,
  NOTIFICATION_TYPES.COMMENT_REPLY,
];

const TEAM_TYPES: readonly NotificationTypeValue[] = [NOTIFICATION_TYPES.TEAM_INVITE];

const INBOX_TYPES: readonly NotificationTypeValue[] = [
  NOTIFICATION_TYPES.INBOX_MESSAGE_RECEIVED,
  NOTIFICATION_TYPES.INBOX_MENTION_RECEIVED,
];

/**
 * Types that oblige the customer to act OUTSIDE the product — on a third-party
 * platform — and whose delay has a cost the product cannot undo. Urgency is a RANK
 * so a surface can order these above routine traffic; it is NOT a permission and
 * nothing may read it to bypass the recipient's own choice about the type.
 */
const URGENT_TYPES: readonly NotificationTypeValue[] = [
  NOTIFICATION_TYPES.PUBLICATION_RETRACTION_PENDING,
];

/**
 * @class NotificationType
 * @description Immutable value object encapsulating a notification's type,
 *   with validation on construction and categorization predicates.
 */
export class NotificationType {
  private readonly _value: NotificationTypeValue;

  private constructor(value: NotificationTypeValue) {
    this._value = value;
  }

  /**
   * @method value
   * @description Returns the raw string value of this notification type.
   */
  get value(): NotificationTypeValue {
    return this._value;
  }

  /**
   * @method create
   * @description Creates a NotificationType from a string, validating against allowed values.
   * @param value - The notification type string to parse
   * @returns Result containing NotificationType on success, InvalidValueError on failure
   */
  static create(value: string): Result<NotificationType, InvalidValueError> {
    const upper = value.toUpperCase();
    if (!VALID_VALUES.includes(upper)) {
      return err(
        new InvalidValueError(
          "NotificationType",
          value,
          `Invalid notification type: "${value}". Valid: ${VALID_VALUES.join(", ")}`
        )
      );
    }
    return ok(new NotificationType(upper as NotificationTypeValue));
  }

  /**
   * @method fromString
   * @description Alias for create(). Creates a NotificationType from a string.
   * @param value - The notification type string to parse
   * @returns Result containing NotificationType on success, InvalidValueError on failure
   */
  static fromString(value: string): Result<NotificationType, InvalidValueError> {
    return NotificationType.create(value);
  }

  /**
   * @method isApprovalRelated
   * @description Returns true if this type is related to approval workflows.
   */
  isApprovalRelated(): boolean {
    return APPROVAL_TYPES.includes(this._value);
  }

  /**
   * @method isCommentRelated
   * @description Returns true if this type is related to comments.
   */
  isCommentRelated(): boolean {
    return COMMENT_TYPES.includes(this._value);
  }

  /**
   * @method isTeamRelated
   * @description Returns true if this type is related to team operations.
   */
  isTeamRelated(): boolean {
    return TEAM_TYPES.includes(this._value);
  }

  /**
   * @method isInboxRelated
   * @description Returns true if this type is related to social inbox messages.
   */
  isInboxRelated(): boolean {
    return INBOX_TYPES.includes(this._value);
  }

  /**
   * @method isUrgent
   * @description Returns true when this type ranks above routine notifications.
   *   RANK ONLY: an urgent type is displayed and ordered first, and it never
   *   overrides the recipient's per-type choice about whether to receive it at all.
   */
  isUrgent(): boolean {
    return URGENT_TYPES.includes(this._value);
  }

  /**
   * @method equals
   * @description Value-based equality check.
   * @param other - The NotificationType to compare
   * @returns true if both types have the same value
   */
  equals(other: NotificationType): boolean {
    return this._value === other._value;
  }

  toString(): string {
    return this._value;
  }

  toJSON(): string {
    return this._value;
  }
}
