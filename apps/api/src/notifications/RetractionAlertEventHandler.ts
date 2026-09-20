/**
 * @file RetractionAlertEventHandler.ts
 * @description Bridges the two retraction-alert domain events, dispatched from the
 *              outbox, into the use cases that deliver and withdraw the alert.
 *
 *              It binds the TENANT from the event's own payload, the way the triage
 *              dispatch handler does, and it FAILS CLOSED when that payload carries no
 *              account. Running unbound would not raise an error — row security would
 *              simply answer every read with nothing, so the alert would be built from
 *              an empty context and delivered to nobody, silently. A refusal that says
 *              so in the log is the only version of that outcome anyone can act on.
 *
 *              It separates the two ways processing can end badly, because they need
 *              opposite answers:
 *
 *              - a payload that does not NAME what it needs (tenant, alert key, channel,
 *                project) is refused and logged. A redelivery of the same malformed
 *                bytes would be refused identically, so retrying it buys nothing;
 *              - a FAILURE while processing propagates, so the outbox redelivers. The
 *                use case turns any internal throw into an `err`, and logging that and
 *                returning would let the relay mark the event published — the record's
 *                obligation would stand while nothing was ever delivered and nothing
 *                would ever try again. Redelivery is safe because the ledger claim of a
 *                target that was reached collides, and the claim of one that was not has
 *                already been released.
 *
 *              Neither propagation rolls the record back: it committed in its own
 *              transaction and stays the truth. What retries is the ANNOUNCEMENT.
 * @layer infrastructure
 */

import type { DomainEvent, DomainEventHandler } from "@core/domain/events/DomainEvent.js";
import { ALERT_DELIVERY_RESULTS } from "@core/domain/value-objects/AlertMedium.js";
import type {
  RaiseRetractionAlertUseCase,
  ResolveRetractionAlertUseCase,
} from "@core/notifications/index.js";
import { readAlertFragments } from "@core/notifications/readAlertFragments.js";
import { withTenantContext } from "../security/tenantContext.js";
import { createLogger } from "../lib/logger.js";
import {
  recordAlertDelivery,
  recordAlertRefused,
  recordAlertWithoutRecipient,
} from "../metrics/retractionAlertMetrics.js";
import type { RetractionAlertContextAdapter } from "../infrastructure/adapters/RetractionAlertContextAdapter.js";

const logger = createLogger("retraction-alert-handler");

const RAISED = "PostChannelRetractionAlertRaised";
const RESOLVED = "PostChannelRetractionAlertResolved";

/**
 * Domain event types this handler subscribes to. Boot wiring iterates this array and
 * registers the handler for each entry, mirroring the triage dispatch convention.
 */
export const RETRACTION_ALERT_HANDLED_EVENT_TYPES: ReadonlyArray<string> = Object.freeze([
  RAISED,
  RESOLVED,
]);

const asString = (value: unknown): string | undefined =>
  typeof value === "string" && value.length > 0 ? value : undefined;

export class RetractionAlertEventHandler implements DomainEventHandler<DomainEvent> {
  constructor(
    private readonly raiseAlert: RaiseRetractionAlertUseCase,
    private readonly resolveAlert: ResolveRetractionAlertUseCase,
    private readonly context: RetractionAlertContextAdapter
  ) {}

  /**
   * @method handle
   * @description Routes the two alert events to their use cases under the payload's
   *   tenant. Refuses a payload that names too little to act on; propagates a failure
   *   to act so the outbox redelivers.
   * @param event - The outbox-reconstructed domain event
   */
  async handle(event: DomainEvent): Promise<void> {
    if (event.eventType !== RAISED && event.eventType !== RESOLVED) return;

    const payload = (event.metadata?.payload as Record<string, unknown> | undefined) ?? {};
    const accountId = asString(payload.accountId);
    const alertKey = asString(payload.alertKey);

    if (accountId === undefined || alertKey === undefined) {
      recordAlertRefused(accountId === undefined ? "missing-tenant" : "missing-alert-key");
      logger.error(
        {
          eventId: event.eventId,
          eventType: event.eventType,
          hasAccountId: accountId !== undefined,
          hasAlertKey: alertKey !== undefined,
        },
        "Retraction alert event is missing its tenant or its alert key — refusing to " +
          "process it unbound, which would read an empty context and reach nobody"
      );
      return;
    }

    await withTenantContext({ accountId }, async () => {
      if (event.eventType === RESOLVED) {
        await this.resolve(event, alertKey, payload);
        return;
      }
      await this.raise(event, alertKey, accountId, payload);
    });
  }

  private async raise(
    event: DomainEvent,
    alertKey: string,
    accountId: string,
    payload: Record<string, unknown>
  ): Promise<void> {
    const postId = asString(payload.postId) ?? event.aggregateId;
    const projectId = asString(payload.projectId);
    const channelId = asString(payload.channelId);
    // ONE refusal rule for the whole payload rather than a refusal for some fields and
    // a default for others. An empty project id is not a neutral default: it finds no
    // member and no active config, so the shared destinations would report "no active
    // config" — a sentence about the customer's setup for a fact about our own payload.
    if (channelId === undefined || projectId === undefined) {
      recordAlertRefused(channelId === undefined ? "missing-channel" : "missing-project");
      logger.error(
        {
          eventId: event.eventId,
          alertKey,
          hasChannelId: channelId !== undefined,
          hasProjectId: projectId !== undefined,
        },
        "Retraction alert names no channel or no project — refusing it rather than " +
          "delivering an alert that cannot say where the content is live"
      );
      return;
    }

    const resolved = await this.context.read({ postId, channelId, accountId });
    const supersededAlertKey = asString(payload.supersededAlertKey);
    const actionWindowEndsAt = asString(payload.actionWindowEndsAt);

    const result = await this.raiseAlert.execute({
      alertKey,
      postId,
      projectId,
      accountId,
      accountName: resolved.accountName,
      channelId,
      channelName: resolved.channelName,
      provider: resolved.provider,
      postExcerpt: resolved.postExcerpt,
      liveFragments: readAlertFragments(payload.liveFragments),
      cause: asString(payload.cause) ?? "NO_CAPABILITY",
      ...(actionWindowEndsAt !== undefined && { actionWindowEndsAt }),
      ...(supersededAlertKey !== undefined && { supersededAlertKey }),
    });

    if (!result.ok) {
      logger.error(
        { eventId: event.eventId, alertKey, error: result.error.message },
        "Retraction alert could not be delivered — propagating so the outbox redelivers it"
      );
      throw result.error;
    }

    for (const entry of result.value.report) {
      recordAlertDelivery(entry.medium, entry.result);
      // The counter says a medium failed; only this line says WHY. A per-raise info log
      // carrying the whole report buries it, and the reason is the one thing an
      // operator needs to tell a mailer outage from a member with no address.
      if (entry.result === ALERT_DELIVERY_RESULTS.FAILED) {
        logger.warn(
          {
            eventId: event.eventId,
            alertKey,
            medium: entry.medium,
            // Spread rather than assigned: a key whose value is undefined reads as a
            // target we failed to RESOLVE, which is a different incident from a line
            // that never had one. An absent key says the second thing and only that.
            ...(entry.target !== undefined && { target: entry.target }),
            ...(entry.reason !== undefined && { reason: entry.reason }),
          },
          "Retraction alert was not delivered on this medium — nothing durable was " +
            "written for it, so a redelivery of this event will try it again"
        );
      }
    }
    if (result.value.recipientCount === 0) {
      recordAlertWithoutRecipient();
      logger.error(
        { eventId: event.eventId, alertKey, postId, channelId },
        "Retraction alert has no customer user to address — content is live on a " +
          "platform and the per-member media reached nobody"
      );
    }

    logger.info(
      {
        eventId: event.eventId,
        alertKey,
        recipients: result.value.recipientCount,
        report: result.value.report,
      },
      "Retraction alert delivered"
    );
  }

  private async resolve(
    event: DomainEvent,
    alertKey: string,
    payload: Record<string, unknown>
  ): Promise<void> {
    const cause = asString(payload.cause);
    const result = await this.resolveAlert.execute({
      alertKey,
      ...(cause !== undefined && { cause }),
    });

    if (!result.ok) {
      logger.error(
        { eventId: event.eventId, alertKey, error: result.error.message },
        "Retraction alert could not be resolved — propagating so the outbox redelivers " +
          "it, because a stale alert that nobody retries keeps asking for an act the " +
          "customer has already performed"
      );
      throw result.error;
    }

    logger.info(
      { eventId: event.eventId, alertKey, deleted: result.value.deletedNotifications },
      "Retraction alert resolved"
    );
  }
}
