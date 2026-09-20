/**
 * @file InAppRetractionAlertDelivery.ts
 * @description Carries an urgent retraction alert to the dashboard: one notification
 *   row per recipient, pushed to any open session in realtime.
 *
 *   It returns the created notification's id because the delivery ledger has to hold
 *   it — resolving this alert later deletes exactly the notifications it created, and
 *   without the id resolution would have to guess from a recipient query, which
 *   membership drift makes wrong in both directions.
 *
 *   The notification use case applies the recipient's per-type preference itself, and
 *   that second check is kept deliberately: this adapter is not the only caller, and a
 *   skipped row is reported as "no id" rather than as a failure.
 *
 *   **The STORED ROW is the delivery; the live push is an accelerator.** The dashboard
 *   reads the row, resolution deletes the row, and the confirm-manual-retraction act
 *   sits beside it — so a push that fails costs immediacy, not the alert. Reporting it
 *   as a failed delivery would make the caller release its ledger claim, and the next
 *   delivery of the event would then create a SECOND row for the same alert. It is
 *   counted and logged instead, which is what keeps a run of them visible.
 * @layer infrastructure
 */

import { type Result, ok, err } from "@shared/types";
import {
  ALERT_MEDIA,
  ALERT_MEDIUM_KINDS,
  type AlertDeliveryOutcome,
  type AlertTarget,
  type RetractionAlertDelivery,
  type RetractionAlertView,
} from "@ports/core";
import type { CreateNotificationUseCase } from "@core/notifications/CreateNotificationUseCase.js";
import { NOTIFICATION_TYPES } from "@core/domain/value-objects/NotificationType.js";
import { createLogger } from "../../lib/logger.js";
import { recordAlertRealtimePushFailed } from "../../metrics/retractionAlertMetrics.js";

const logger = createLogger("retraction-alert-in-app");

/**
 * The realtime push seam. Structural on purpose: the broadcaster owns a Redis
 * connection, and this adapter needs one method from it.
 */
export interface RealtimeNotificationPublisher {
  broadcast(
    notification: {
      id: string;
      type: string;
      title: string;
      body: string;
      resourceType?: string;
      resourceId?: string;
      createdAt: string;
    },
    recipientId: string
  ): Promise<void>;
}

export class InAppRetractionAlertDelivery implements RetractionAlertDelivery {
  readonly medium = ALERT_MEDIA.IN_APP;
  readonly kind = ALERT_MEDIUM_KINDS.PER_MEMBER;

  constructor(
    private readonly createNotification: CreateNotificationUseCase,
    private readonly realtime: RealtimeNotificationPublisher
  ) {}

  /**
   * @method deliver
   * @description Creates the in-app alert for ONE recipient and pushes it live.
   * @param alert - The resolved alert view
   * @param targets - Exactly one member; the caller sends per-member media one at a time
   * @returns ok with the notification id when a row was created, err naming the failure
   */
  async deliver(
    alert: RetractionAlertView,
    targets: readonly AlertTarget[]
  ): Promise<Result<AlertDeliveryOutcome, string>> {
    const target = targets[0];
    if (target === undefined) return ok({});

    const created = await this.createNotification.execute({
      recipientId: target.id,
      type: NOTIFICATION_TYPES.PUBLICATION_RETRACTION_PENDING,
      title: alert.title,
      body: alert.body,
      resourceType: "post",
      resourceId: alert.postId,
      metadata: alert.metadata,
    });

    if (!created.ok) return err(created.error.message);

    // An empty id is the notification use case's own preference check having skipped the
    // row. It is SAID rather than left as a bare `ok`: no notification exists for this
    // member, so reporting a plain success would count a customer as reached who was
    // never written to. It is not a failure either — the answer is the member's own —
    // and because nothing was written, the caller releases the claim: a member who
    // switches the type back on is then reached by the next redelivery.
    if (created.value.id === "") {
      return ok({
        suppressedTargets: [
          { targetId: target.id, reason: "the recipient's per-type preference is off" },
        ],
      });
    }

    try {
      await this.realtime.broadcast(
        {
          id: created.value.id,
          type: NOTIFICATION_TYPES.PUBLICATION_RETRACTION_PENDING,
          title: alert.title,
          body: alert.body,
          resourceType: "post",
          resourceId: alert.postId,
          createdAt: new Date().toISOString(),
        },
        target.id
      );
    } catch (error: unknown) {
      recordAlertRealtimePushFailed();
      logger.warn(
        {
          alertKey: alert.alertKey,
          recipientId: target.id,
          notificationId: created.value.id,
          reason: error instanceof Error ? error.message : String(error),
        },
        "Retraction alert stored but not pushed live — the customer sees it on their next " +
          "page load, and the alert is NOT retried because the row it created already exists"
      );
    }

    return ok({ notificationId: created.value.id });
  }
}
