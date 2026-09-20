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
 *   The fan-out names the destinations the CALLER CLAIMED rather than asking for every
 *   active config. Both halves of that sentence are load-bearing. It bypasses the
 *   config's `events` filter, which predates this event name, so filtering would make
 *   the alert invisible on every destination that exists today; and it is scoped to the
 *   claimed ids, so a redelivery that claimed only the destination a previous run
 *   missed reaches THAT destination and not the ones already told. Re-querying every
 *   active config on a retry would deliver the alert twice to the channels that already
 *   had it — buying the retry with the duplicate the ledger exists to prevent.
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
   * @description Announces the alert to exactly the claimed destinations, in ONE
   *   fan-out — calling it per destination would multiply the message.
   * @param alert - The resolved alert view
   * @param targets - The destinations whose ledger rows the caller claimed
   * @returns ok NAMING every destination it did not reach, err when it reached none
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
      { toConfigIds: targets.map((target) => target.id) }
    );

    if (!result.ok) return err(result.error.message);

    const { sentConfigIds, failedConfigs } = result.value;

    // Unreached is DERIVED from what was reached, never assembled from the refusals.
    // That is what makes the third case — a config deactivated or deleted between the
    // claim and this fan-out, which neither took the message nor refused it — come out
    // as unreached instead of silently counting as delivered. It also means an id the
    // fan-out reports that this call never claimed cannot enter the answer at all.
    const reached = new Set(sentConfigIds);
    const refusals = new Map(failedConfigs.map((failure) => [failure.id, failure.reason]));
    const unreached = targets.filter((target) => !reached.has(target.id));

    if (reached.size === 0) {
      return err(`every destination refused the alert (${unreached.length} unreached)`);
    }

    // Partial success is success FOR THE DESTINATIONS THAT TOOK IT, and a named failure
    // for the ones that did not: the caller releases exactly those claims, so the next
    // delivery of this event reaches the unreached channel and nothing else.
    //
    // A refusal carries the DESTINATION'S OWN words, not a sentence written here. The
    // reason is the only thing that reaches the operator's warning, and "the destination
    // refused the alert" says nothing they did not already know from the counter — while
    // "403 invalid_token" tells them to rotate a webhook and "channel_not_found" tells
    // them the channel is gone. The other case keeps its specific sentence, because
    // there no refusal happened for anyone to quote.
    return ok({
      failedTargets: unreached.map((target) => ({
        targetId: target.id,
        reason:
          refusals.get(target.id) ??
          "the destination is no longer an active config of this project",
      })),
    });
  }
}
