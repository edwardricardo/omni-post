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

/** One target a delivery did NOT reach, while it reached others in the same call. */
export interface AlertTargetFailure {
  targetId: string;
  reason: string;
}

/**
 * One target a medium DELIBERATELY did not send to — the recipient's own answer, not a
 * transport failure. It is its own state rather than a delivery because a delivery
 * counts a customer as reached who was never written to, and because the two carry
 * different telemetry: "the customer turned it off" is not "the transport broke".
 */
export interface AlertTargetSuppression {
  targetId: string;
  reason: string;
}

/**
 * What a delivery produced.
 *
 * `notificationId` is filled by the in-app medium alone: the notification it created
 * has to reach the ledger so resolution can delete exactly that row later.
 *
 * `failedTargets` is how a medium handed SEVERAL targets says that it reached some and
 * not others. Absent or empty means every target passed in was reached — a partial
 * result reported as plain `ok` would leave the unreached targets' ledger claims
 * standing, and a claim that is never released is an alert nobody can ever be sent
 * again.
 *
 * `suppressedTargets` names the targets the medium deliberately did not send to. They
 * are neither reached nor failed: the caller reports the customer's own answer rather
 * than a transport verdict, and — like a failure — releases their claims, because
 * nothing was written for them.
 *
 * Both carry a `reason`. It is the only place a human learns WHY a customer was not
 * reached, so it is a sentence, not a code.
 */
export interface AlertDeliveryOutcome {
  notificationId?: string;
  failedTargets?: readonly AlertTargetFailure[];
  suppressedTargets?: readonly AlertTargetSuppression[];
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
   * @description Delivers the alert to the given targets.
   *
   *   **The contract, in four rules, because the caller claimed a ledger row for every
   *   target before calling and releases exactly the ones this answer says were not
   *   reached.**
   *
   *   1. It MUST NOT throw. A transport failure is `err(reason)`, so that one medium
   *      failing neither suppresses the others nor rolls back the recorded outcome that
   *      raised the alert. The caller treats a thrown value as `err` anyway — the rule
   *      is enforced at the seam rather than trusted — but an implementation that
   *      throws has already lost the reason a human would need.
   *   2. `err` means NO target was reached. `ok` with `failedTargets` means the named
   *      ones were not and the rest were. `ok` with none means all were.
   *   3. A target is "reached" once a durable artifact the customer can read exists for
   *      it — the in-app notification row, the accepted webhook. A live push that fails
   *      on top of a stored row is a degraded push, counted where it happens, never a
   *      failed delivery: releasing that claim would make the redelivery create a
   *      SECOND row, and an alert that arrives twice is the defect the ledger exists to
   *      prevent.
   *   4. A target the medium DECLINED to send to is neither reached nor failed, and it
   *      says so with `suppressedTargets`. A medium that applies the recipient's own
   *      preference itself has this case, and a bare `ok` for it is the worst of the
   *      three readings: the caller counts a customer as reached who was never written
   *      to. Suppressed means nothing was sent and nothing is owed, so the claim is
   *      RELEASED and a later redelivery re-evaluates the preference — which is what
   *      lets a member who switches the type back on be reached, rather than being
   *      blocked forever by a row recording a message that never existed. Releasing is
   *      safe by rule 3: with no durable artifact, a redelivery either suppresses again
   *      (nothing sent twice) or delivers once, and the artifact then holds the claim.
   * @param alert - The resolved alert view
   * @param targets - The targets whose ledger rows this caller already claimed
   * @returns ok with the delivery's outcome, or err naming why nothing went out
   */
  deliver(
    alert: RetractionAlertView,
    targets: readonly AlertTarget[]
  ): Promise<Result<AlertDeliveryOutcome, string>>;
}
