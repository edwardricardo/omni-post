/**
 * @file RetractionAlertDeliveryPort.ts
 * @description Technology-free port for delivering ONE urgent retraction alert on ONE
 *   medium. Every medium implements the same three-line contract, so adding SMS later
 *   is one adapter and one registration rather than a branch inside the use case — and
 *   a medium with no adapter in the tree is visible as an absence rather than as
 *   silence.
 *
 *   The medium vocabulary itself lives in `@core/domain`: the delivery ledger records a
 *   claim per medium and this package already depends on the domain, so defining it
 *   here would invert that dependency. It is re-exported so callers have one import.
 * @layer domain
 */

import type { Result } from "@shared/types";
import type { AlertMedium, AlertMediumKind } from "@core/domain/value-objects/AlertMedium.js";

export {
  ALERT_MEDIA,
  ALERT_MEDIUM_KINDS,
  ALERT_DELIVERY_RESULTS,
} from "@core/domain/value-objects/AlertMedium.js";
export type {
  AlertMedium,
  AlertMediumKind,
  AlertDeliveryResult,
  AlertDeliveryReport,
  AlertDeliveryReportEntry,
} from "@core/domain/value-objects/AlertMedium.js";

/**
 * Who a delivery is for. `id` is the ledger key — a member id for a per-member medium,
 * an external-config id for a shared destination. The contact details ride along so a
 * medium does not have to look up what the caller already resolved; they are optional
 * because a shared destination has none.
 */
export interface AlertTarget {
  id: string;
  email?: string;
  displayName?: string;
}

/** One fragment of the post that is still live on the provider. */
export interface AlertFragmentView {
  index: number;
  externalId: string;
  url?: string;
}

/**
 * Everything a medium needs to render the alert, resolved ONCE by the caller so the
 * three media say the same thing. It carries identities and human-readable text only:
 * no credentials, no tokens, no provider secrets.
 */
export interface RetractionAlertView {
  alertKey: string;
  postId: string;
  projectId: string;
  accountId: string;
  accountName: string;
  channelId: string;
  channelName: string;
  provider: string;
  postExcerpt: string;
  liveFragments: readonly AlertFragmentView[];
  cause: string;
  actionWindowEndsAt?: string;
  title: string;
  body: string;
  metadata: Record<string, unknown>;
}

/**
 * What a delivery produced. Only the in-app medium fills it: the notification it
 * created has to reach the ledger so resolution can delete exactly that row later.
 */
export interface AlertDeliveryOutcome {
  notificationId?: string;
}

/**
 * @interface RetractionAlertDelivery
 * @description One medium's delivery seam. `kind` is not decoration: the caller sends
 *   a per-member medium one target at a time, so each member's outcome is its own line
 *   in the report, and hands a shared destination every claimed target at once, so the
 *   fan-out happens once per alert rather than once per config.
 */
export interface RetractionAlertDelivery {
  readonly medium: AlertMedium;
  readonly kind: AlertMediumKind;

  /**
   * @method deliver
   * @description Delivers the alert to the given targets. Never throws: a transport
   *   failure is an `err` with a human-readable reason, because one medium failing must
   *   not suppress the others and must not roll back the recorded outcome that raised
   *   the alert.
   * @param alert - The resolved alert view
   * @param targets - The targets whose ledger rows this caller already claimed
   * @returns ok with the delivery's outcome, or err naming why it did not go out
   */
  deliver(
    alert: RetractionAlertView,
    targets: readonly AlertTarget[]
  ): Promise<Result<AlertDeliveryOutcome, string>>;
}
