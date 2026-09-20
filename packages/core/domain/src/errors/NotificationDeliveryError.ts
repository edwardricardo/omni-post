/**
 * @file NotificationDeliveryError.ts
 * @description The failure of an ANNOUNCEMENT, as distinct from the failure of a
 *   business rule. Every other member of this hierarchy says the domain refused
 *   something; this one says the domain was right and the outside world would not
 *   carry the message — a mail provider refusing, a preference store unreachable.
 *
 *   It exists because the alternative was worse in both directions: reusing
 *   `InvariantViolationError` would claim an invariant broke when none did, and
 *   swallowing the failure (what the email path did before) lets a caller record a
 *   delivery that never happened. The `cause` is kept because the only useful thing
 *   an operator can do with a transport failure is read what the transport said.
 * @layer domain
 */

import { DomainError } from "./DomainError.js";

export class NotificationDeliveryError extends DomainError {
  /** Which medium refused — `email`, and later any other named transport. */
  public readonly medium: string;
  /**
   * What the transport itself reported, kept verbatim.
   *
   * `override` because `Error` itself declares `cause?: unknown` from ES2022 onward;
   * narrowing it to an `Error` is the point — an operator reading a delivery failure
   * wants the provider's own message, not an unknown.
   */
  public override readonly cause?: Error;

  constructor(medium: string, message: string, cause?: Error) {
    super(`${medium} delivery failed: ${message}`, "NOTIFICATION_DELIVERY_FAILED");
    this.medium = medium;
    if (cause !== undefined) this.cause = cause;
  }

  override toJSON(): Record<string, unknown> {
    return {
      ...super.toJSON(),
      medium: this.medium,
      ...(this.cause !== undefined && { cause: this.cause.message }),
    };
  }
}
