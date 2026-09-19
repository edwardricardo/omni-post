/**
 * @file AlertMedium.ts
 * @description The closed set of media an urgent alert can travel on, and the two
 *   KINDS of medium — because the kind decides who is allowed to switch it off. A
 *   per-member medium addresses one person and answers to that person's per-type
 *   preference; a shared destination addresses a channel many people read and answers
 *   only to the existence of an active config. Collapsing the two would make one of
 *   them wrong: consult a preference for a shared destination and a team channel goes
 *   silent because nobody enabled a type for it; skip the preference for a per-member
 *   medium and an opt-out stops meaning anything.
 *
 *   It lives in the domain rather than beside the delivery port because the ledger
 *   port here records a claim per medium, and `packages/ports` already depends on this
 *   package — the reverse direction would be a cycle.
 * @layer domain
 */

export const ALERT_MEDIA = {
  IN_APP: "in-app",
  EMAIL: "email",
  SLACK_TEAMS: "slack-teams",
  SMS: "sms",
  PUSH: "push",
} as const;

export type AlertMedium = (typeof ALERT_MEDIA)[keyof typeof ALERT_MEDIA];

export const ALERT_MEDIUM_KINDS = {
  PER_MEMBER: "per-member",
  SHARED: "shared",
} as const;

export type AlertMediumKind = (typeof ALERT_MEDIUM_KINDS)[keyof typeof ALERT_MEDIUM_KINDS];

/**
 * How a medium that was NOT delivered is reported. The three not-delivered values are
 * kept apart deliberately: "the customer turned it off", "the customer never set this
 * destination up" and "this application cannot reach that medium at all" call for three
 * different answers, and a single "not delivered" would hide which one happened.
 */
export const ALERT_DELIVERY_RESULTS = {
  DELIVERED: "delivered",
  FAILED: "failed",
  SUPPRESSED_BY_PREFERENCE: "suppressed-by-preference",
  NO_ACTIVE_CONFIG: "no-active-config",
  UNAVAILABLE: "unavailable",
} as const;

export type AlertDeliveryResult =
  (typeof ALERT_DELIVERY_RESULTS)[keyof typeof ALERT_DELIVERY_RESULTS];

/** One line of the per-raise delivery report: which medium, which target, what happened. */
export interface AlertDeliveryReportEntry {
  readonly medium: AlertMedium;
  readonly target?: string;
  readonly result: AlertDeliveryResult;
}

export type AlertDeliveryReport = readonly AlertDeliveryReportEntry[];
