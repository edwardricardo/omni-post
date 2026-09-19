/**
 * @file RaiseRetractionAlertUseCase.ts
 * @description Delivers ONE urgent retraction alert across every medium the customer
 *   chose, and reports per medium and per target what happened to it.
 *
 *   Three rules shape the whole file and none of them is interchangeable:
 *   - a PER-MEMBER medium answers to the member's per-type preference, the same one
 *     answer on every such medium, so an opt-out silences in-app and email together;
 *   - a SHARED destination answers ONLY to the existence of an active config — no
 *     member preference is consulted for it, it is delivered even when nobody has the
 *     type on and even when the project has no members, and deactivating the config is
 *     its only off switch;
 *   - nothing is delivered twice. Every target is CLAIMED in the ledger first, so a
 *     redelivered event collides and sends nothing, which is what keeps an alert that
 *     obliges a manual act worth reading.
 *
 *   Delivery is best-effort per medium and never fails the raise: the recorded outcome
 *   is the truth, and this is its announcement.
 * @layer application
 */

import { type Result, ok, err } from "@shared/types";
import { type UseCase, UseCaseError, USE_CASE_ERRORS } from "@core/application/UseCase.js";
import type { CustomerUserRepository } from "@core/domain/repositories/CustomerUserRepository.js";
import type { NotificationPreferenceRepository } from "@core/domain/repositories/NotificationRepository.js";
import type { ExternalNotificationConfigRepository } from "@core/domain/repositories/ExternalNotificationConfigRepository.js";
import type { RetractionAlertDeliveryLedger } from "@core/domain/repositories/RetractionAlertDeliveryLedger.js";
import {
  ALERT_MEDIA,
  ALERT_MEDIUM_KINDS,
  ALERT_DELIVERY_RESULTS,
  type AlertMedium,
  type AlertDeliveryReportEntry,
  type AlertDeliveryReport,
} from "@core/domain/value-objects/AlertMedium.js";
import { NOTIFICATION_TYPES } from "@core/domain/value-objects/NotificationType.js";
import type { AlertFragmentView, AlertTarget, RetractionAlertDelivery } from "@ports/core";
import type { RetractionAlertView } from "@ports/core";
import { isTypeEnabled } from "./isTypeEnabled.js";
import { buildRetractionAlertMessage } from "./retractionAlertMessage.js";
import type { ResolveRetractionAlertUseCase } from "./ResolveRetractionAlertUseCase.js";

/** Everything the alert event carried, plus the names the handler resolved for it. */
export interface RaiseRetractionAlertInput {
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
  supersededAlertKey?: string;
}

/** What went out, and how many people were behind the per-member half of it. */
export interface RaiseRetractionAlertOutput {
  report: AlertDeliveryReport;
  recipientCount: number;
}

/** A per-member recipient, resolved once and reused by every per-member medium. */
interface Recipient {
  target: AlertTarget;
  typeOn: boolean;
}

/** The media this application could in principle carry the alert on. */
const EVERY_MEDIUM: readonly AlertMedium[] = [
  ALERT_MEDIA.IN_APP,
  ALERT_MEDIA.EMAIL,
  ALERT_MEDIA.SLACK_TEAMS,
  ALERT_MEDIA.SMS,
  ALERT_MEDIA.PUSH,
];

/**
 * @class RaiseRetractionAlertUseCase
 * @description Fans one retraction alert out over the registered media, claiming each
 *   target in the ledger before it delivers.
 */
export class RaiseRetractionAlertUseCase implements UseCase<
  RaiseRetractionAlertInput,
  RaiseRetractionAlertOutput,
  UseCaseError
> {
  constructor(
    private readonly customerUsers: CustomerUserRepository,
    private readonly preferences: NotificationPreferenceRepository,
    private readonly externalConfigs: ExternalNotificationConfigRepository,
    private readonly ledger: RetractionAlertDeliveryLedger,
    private readonly media: readonly RetractionAlertDelivery[],
    private readonly resolveSuperseded: ResolveRetractionAlertUseCase
  ) {}

  /**
   * @method execute
   * @description Resolves any superseded alert, then delivers this one on every
   *   registered medium, claiming each target first.
   * @param input - The alert's facts and the names the handler resolved
   * @returns The per-medium, per-target report and the recipient count
   */
  async execute(
    input: RaiseRetractionAlertInput
  ): Promise<Result<RaiseRetractionAlertOutput, UseCaseError>> {
    try {
      // FIRST, before any claim: a superseded alert names a different live-fragment
      // set, so leaving it standing would ask the customer to remove content that is
      // already gone while the new alert asks for the rest.
      if (input.supersededAlertKey !== undefined) {
        await this.resolveSuperseded.execute({ alertKey: input.supersededAlertKey });
      }

      const recipients = await this.resolveRecipients(input);
      const alert = this.buildView(input);
      const report: AlertDeliveryReportEntry[] = [];

      for (const medium of EVERY_MEDIUM) {
        const adapter = this.media.find((candidate) => candidate.medium === medium);
        if (adapter === undefined) {
          // Not "failed" and not "off": there is no adapter for this medium in the
          // tree at all, and saying so is how the gap stays visible.
          report.push({ medium, result: ALERT_DELIVERY_RESULTS.UNAVAILABLE });
          continue;
        }

        if (adapter.kind === ALERT_MEDIUM_KINDS.SHARED) {
          report.push(...(await this.deliverShared(adapter, alert, input.projectId)));
          continue;
        }

        report.push(...(await this.deliverPerMember(adapter, alert, recipients)));
      }

      return ok({ report, recipientCount: recipients.length });
    } catch (error: unknown) {
      return err(
        new UseCaseError(
          `Failed to raise retraction alert ${input.alertKey}`,
          USE_CASE_ERRORS.INTERNAL_ERROR,
          error instanceof Error ? error : undefined
        )
      );
    }
  }

  /**
   * @method resolveRecipients
   * @description Finds the people this alert addresses and reads each one's per-type
   *   answer once. The project's members come first; an account-wide fallback covers a
   *   project nobody has been assigned to, which would otherwise strand the alert.
   */
  private async resolveRecipients(input: RaiseRetractionAlertInput): Promise<Recipient[]> {
    const byProject = await this.customerUsers.findByProjectId(input.projectId);
    const users =
      byProject.length > 0 ? byProject : await this.customerUsers.findByAccountId(input.accountId);

    const recipients: Recipient[] = [];
    for (const user of users) {
      const prefs = await this.preferences.findByMember(user.id);
      recipients.push({
        target: { id: user.id, email: user.email },
        typeOn: isTypeEnabled(prefs, NOTIFICATION_TYPES.PUBLICATION_RETRACTION_PENDING),
      });
    }
    return recipients;
  }

  /**
   * @method deliverPerMember
   * @description Delivers to each member individually, so one member's opt-out or one
   *   member's transport failure is its own line in the report rather than a verdict
   *   about everybody.
   */
  private async deliverPerMember(
    adapter: RetractionAlertDelivery,
    alert: RetractionAlertView,
    recipients: readonly Recipient[]
  ): Promise<AlertDeliveryReportEntry[]> {
    const entries: AlertDeliveryReportEntry[] = [];

    for (const recipient of recipients) {
      if (!recipient.typeOn) {
        entries.push({
          medium: adapter.medium,
          target: recipient.target.id,
          result: ALERT_DELIVERY_RESULTS.SUPPRESSED_BY_PREFERENCE,
        });
        continue;
      }

      const claim = await this.ledger.claim({
        alertKey: alert.alertKey,
        medium: adapter.medium,
        target: recipient.target.id,
      });
      // A collision means an earlier delivery of this same alert already reached this
      // target. Reporting nothing is deliberate: the report describes what THIS run
      // did, and a line saying "delivered" would double-count an alert that went out
      // once.
      if (!claim.claimed) continue;

      const delivered = await adapter.deliver(alert, [recipient.target]);
      if (!delivered.ok) {
        entries.push({
          medium: adapter.medium,
          target: recipient.target.id,
          result: ALERT_DELIVERY_RESULTS.FAILED,
        });
        continue;
      }

      if (delivered.value.notificationId !== undefined) {
        await this.ledger.attachNotification({
          alertKey: alert.alertKey,
          target: recipient.target.id,
          notificationId: delivered.value.notificationId,
        });
      }

      entries.push({
        medium: adapter.medium,
        target: recipient.target.id,
        result: ALERT_DELIVERY_RESULTS.DELIVERED,
      });
    }

    return entries;
  }

  /**
   * @method deliverShared
   * @description Delivers to every ACTIVE config of the project. No member preference
   *   is consulted here and the config's own events filter is not applied: the filter
   *   predates this event type, so honouring it would make the alert invisible on every
   *   config that exists today.
   */
  private async deliverShared(
    adapter: RetractionAlertDelivery,
    alert: RetractionAlertView,
    projectId: string
  ): Promise<AlertDeliveryReportEntry[]> {
    const configsResult = await this.externalConfigs.findByProjectId(projectId);
    if (!configsResult.ok) {
      return [{ medium: adapter.medium, result: ALERT_DELIVERY_RESULTS.FAILED }];
    }

    const active = configsResult.value.filter((config) => config.isActive);
    if (active.length === 0) {
      // Distinct from "suppressed": nobody turned this off, there is simply no
      // destination of this kind set up for the project.
      return [{ medium: adapter.medium, result: ALERT_DELIVERY_RESULTS.NO_ACTIVE_CONFIG }];
    }

    const claimed: AlertTarget[] = [];
    for (const config of active) {
      const claim = await this.ledger.claim({
        alertKey: alert.alertKey,
        medium: adapter.medium,
        target: config.id,
      });
      if (claim.claimed) claimed.push({ id: config.id, displayName: config.label });
    }

    if (claimed.length === 0) return [];

    // ONE call with every claimed destination: the shared fan-out reaches the
    // project's configs itself, so calling it per config would multiply the message.
    const delivered = await adapter.deliver(alert, claimed);
    const result = delivered.ok ? ALERT_DELIVERY_RESULTS.DELIVERED : ALERT_DELIVERY_RESULTS.FAILED;

    return claimed.map((target) => ({ medium: adapter.medium, target: target.id, result }));
  }

  /**
   * @method buildView
   * @description Renders the message once so every medium says the same thing.
   */
  private buildView(input: RaiseRetractionAlertInput): RetractionAlertView {
    const message = buildRetractionAlertMessage(input);
    return {
      alertKey: input.alertKey,
      postId: input.postId,
      projectId: input.projectId,
      accountId: input.accountId,
      accountName: input.accountName,
      channelId: input.channelId,
      channelName: input.channelName,
      provider: input.provider,
      postExcerpt: input.postExcerpt,
      liveFragments: input.liveFragments.map((fragment) => ({ ...fragment })),
      cause: input.cause,
      ...(input.actionWindowEndsAt !== undefined && {
        actionWindowEndsAt: input.actionWindowEndsAt,
      }),
      title: message.title,
      body: message.body,
      metadata: message.metadata,
    };
  }
}
