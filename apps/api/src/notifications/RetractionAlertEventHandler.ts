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
 *              Delivery failures do NOT propagate. The record that raised this alert is
 *              already committed and is the truth; the alert is its announcement, and
 *              throwing here would make the relay retry a fan-out whose claims have
 *              already been taken, which delivers nothing and retries forever.
 * @layer infrastructure
 */

import type { DomainEvent, DomainEventHandler } from "@core/domain/events/DomainEvent.js";
import type {
  RaiseRetractionAlertUseCase,
  ResolveRetractionAlertUseCase,
} from "@core/notifications/index.js";
import type { AlertFragmentView } from "@ports/core";
import { withTenantContext } from "../security/tenantContext.js";
import { createLogger } from "../lib/logger.js";
import {
  recordAlertDelivery,
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

/**
 * @function readFragments
 * @description Reads the live-fragment array out of an untyped outbox payload. A
 *   malformed entry is DROPPED rather than failing the alert: the customer still needs
 *   to know that content is live, and naming three of four fragments beats naming none.
 * @param value - The payload's `liveFragments` field, whatever it turned out to be
 * @returns The entries that parse as fragment references
 */
function readFragments(value: unknown): AlertFragmentView[] {
  if (!Array.isArray(value)) return [];
  const fragments: AlertFragmentView[] = [];
  for (const entry of value) {
    if (entry === null || typeof entry !== "object") continue;
    const candidate = entry as Record<string, unknown>;
    const externalId = asString(candidate.externalId);
    if (typeof candidate.index !== "number" || externalId === undefined) continue;
    const url = asString(candidate.url);
    fragments.push({ index: candidate.index, externalId, ...(url !== undefined && { url }) });
  }
  return fragments;
}

export class RetractionAlertEventHandler implements DomainEventHandler<DomainEvent> {
  constructor(
    private readonly raiseAlert: RaiseRetractionAlertUseCase,
    private readonly resolveAlert: ResolveRetractionAlertUseCase,
    private readonly context: RetractionAlertContextAdapter
  ) {}

  /**
   * @method handle
   * @description Routes the two alert events to their use cases under the payload's
   *   tenant. Never throws.
   * @param event - The outbox-reconstructed domain event
   */
  async handle(event: DomainEvent): Promise<void> {
    if (event.eventType !== RAISED && event.eventType !== RESOLVED) return;

    const payload = (event.metadata?.payload as Record<string, unknown> | undefined) ?? {};
    const accountId = asString(payload.accountId);
    const alertKey = asString(payload.alertKey);

    if (accountId === undefined || alertKey === undefined) {
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
    const projectId = asString(payload.projectId) ?? "";
    const channelId = asString(payload.channelId);
    if (channelId === undefined) {
      logger.error({ eventId: event.eventId, alertKey }, "Retraction alert names no channel");
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
      liveFragments: readFragments(payload.liveFragments),
      cause: asString(payload.cause) ?? "NO_CAPABILITY",
      ...(actionWindowEndsAt !== undefined && { actionWindowEndsAt }),
      ...(supersededAlertKey !== undefined && { supersededAlertKey }),
    });

    if (!result.ok) {
      logger.error(
        { eventId: event.eventId, alertKey, error: result.error.message },
        "Retraction alert could not be delivered"
      );
      return;
    }

    for (const entry of result.value.report) {
      recordAlertDelivery(entry.medium, entry.result);
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
        "Retraction alert could not be resolved — a stale alert may still be standing"
      );
      return;
    }

    logger.info(
      { eventId: event.eventId, alertKey, deleted: result.value.deletedNotifications },
      "Retraction alert resolved"
    );
  }
}
