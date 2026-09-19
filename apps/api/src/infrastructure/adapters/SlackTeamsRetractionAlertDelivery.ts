/**
 * @file SlackTeamsRetractionAlertDelivery.ts
 * @description Carries an urgent retraction alert to the team channels a project has
 *   configured.
 *
 *   This is the SHARED kind of medium, and the difference is not cosmetic: a Slack or
 *   Teams config addresses a channel many people read, it exists only because the
 *   customer created it, and so the config itself IS the customer's stipulation for
 *   that destination. No member's per-type preference is consulted, the alert goes out
 *   even when the project has no members at all, and deactivating the config is the
 *   only way to switch it off.
 *
 *   The fan-out asks for EVERY active config rather than the filtered set, because the
 *   config's `events` filter predates this event name — filtering would make the alert
 *   invisible on every destination that exists today.
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
import type { ExternalNotifierPort } from "@core/domain/repositories/ExternalNotifierPort.js";

/** The event name the webhook payload announces. */
const RETRACTION_PENDING_EVENT = "post.retraction_pending";

export class SlackTeamsRetractionAlertDelivery implements RetractionAlertDelivery {
  readonly medium = ALERT_MEDIA.SLACK_TEAMS;
  readonly kind = ALERT_MEDIUM_KINDS.SHARED;

  constructor(private readonly notifier: ExternalNotifierPort) {}

  /**
   * @method deliver
   * @description Announces the alert to every active destination of the project, in
   *   ONE fan-out — calling it per destination would multiply the message.
   * @param alert - The resolved alert view
   * @param targets - The destinations whose ledger rows the caller claimed
   * @returns ok when at least one destination took it, err when every one refused
   */
  async deliver(
    alert: RetractionAlertView,
    targets: readonly AlertTarget[]
  ): Promise<Result<AlertDeliveryOutcome, string>> {
    if (targets.length === 0) return ok({});

    const result = await this.notifier.broadcast(
      alert.projectId,
      RETRACTION_PENDING_EVENT,
      {
        title: alert.title,
        message: alert.body,
        event: RETRACTION_PENDING_EVENT,
        projectId: alert.projectId,
        // Identities only. A webhook payload leaves this application, so the channel's
        // name is as far as it goes — never a credential, a token or a webhook url.
        metadata: {
          postId: alert.postId,
          channelId: alert.channelId,
          channelName: alert.channelName,
          alertKey: alert.alertKey,
          liveFragmentCount: String(alert.liveFragments.length),
          ...(alert.actionWindowEndsAt !== undefined && {
            actionWindowEndsAt: alert.actionWindowEndsAt,
          }),
        },
      },
      { toEveryActiveConfig: true }
    );

    if (!result.ok) return err(result.error.message);

    // Partial success is success: a shared channel that refused must not suppress the
    // one that accepted, and the refusal is already counted by the fan-out.
    if (result.value.sent === 0 && result.value.failed > 0) {
      return err(`every destination refused the alert (${result.value.failed} failed)`);
    }

    return ok({});
  }
}
