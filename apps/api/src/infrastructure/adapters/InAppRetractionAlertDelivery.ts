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

    // An empty id is the use case's own preference check having skipped the row. Not a
    // failure, and not something to attach to the ledger either.
    if (created.value.id === "") return ok({});

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

    return ok({ notificationId: created.value.id });
  }
}
