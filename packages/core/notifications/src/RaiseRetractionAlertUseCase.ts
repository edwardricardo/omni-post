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
import type {
  AlertDeliveryOutcome,
  AlertFragmentView,
  AlertTarget,
  RetractionAlertDelivery,
} from "@ports/core";
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

/**
 * What became of ONE claimed target, for the targets that are not plain deliveries.
 * `reached: false` releases the claim and reports a failure; `suppressed` keeps it and
 * reports the recipient's own answer. A target with no verdict was delivered.
 */
interface TargetVerdict {
  reached?: false;
  suppressed?: true;
  reason: string;
}

/** What a member's own per-type row says when it silences the alert. */
const PREFERENCE_IS_OFF = "the recipient's per-type preference is off";

/** What a project with no destination of this kind says: nobody turned anything off. */
const NO_DESTINATION_IS_SET_UP = "the project has no active destination of this kind";

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
   * @method attempt
   * @description Calls one medium and answers in the shape the protocol needs, whatever
   *   the medium actually did. The port forbids throwing, but a claim is already in the
   *   ledger by the time `deliver` runs: an implementation that breaks that rule would
   *   otherwise abort the whole fan-out, leave its claim standing and skip every medium
   *   after it — a permanently unreachable target for a raise that reported nothing.
   *   The rule is therefore enforced here rather than trusted.
   * @param adapter - The medium being asked to deliver
   * @param alert - The resolved alert view
   * @param targets - The targets whose rows were claimed for this call
   * @returns The medium's own answer, or `err` carrying what it threw
   */
  private async attempt(
    adapter: RetractionAlertDelivery,
    alert: RetractionAlertView,
    targets: readonly AlertTarget[]
  ): Promise<Result<AlertDeliveryOutcome, string>> {
    try {
      return await adapter.deliver(alert, targets);
    } catch (error: unknown) {
      return err(
        `${adapter.medium} threw instead of reporting a failure: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
  }

  /**
   * @method settle
   * @description Gives back the claim of every target this delivery did not reach, and
   *   answers what became of each one — with the medium's own reason attached.
   *
   *   The claim is taken BEFORE the send so two concurrent deliveries of one event
   *   cannot both send. Keeping a claim after a send that produced nothing turns that
   *   guard into a permanent loss: the redelivery collides with a row for a message
   *   nobody received.
   *
   *   So the rule is ONE, not a list of exceptions: **a claim is kept only where a
   *   durable artifact exists for it.** A DELIVERED target keeps its claim, because
   *   releasing it would let a redelivery send the alert twice. Everything else — a
   *   failure, and a target the medium declined to send to — releases, because nothing
   *   was written and nothing is owed. Releasing a suppressed target is what lets a
   *   member who re-enables the type be reached by the next redelivery instead of
   *   staying blocked by a row that records a message that never existed; and it is
   *   safe for the same reason it is right, since a redelivery either suppresses again
   *   (nothing sent twice) or delivers once (and the artifact then holds the claim).
   * @param adapter - The medium that was asked to deliver
   * @param alert - The resolved alert view
   * @param claimed - Every target whose row this run claimed
   * @param outcome - What the medium answered
   * @returns One verdict per target that is not a plain delivery, with its reason
   */
  private async settle(
    adapter: RetractionAlertDelivery,
    alert: RetractionAlertView,
    claimed: readonly AlertTarget[],
    outcome: Result<AlertDeliveryOutcome, string>
  ): Promise<ReadonlyMap<string, TargetVerdict>> {
    const verdicts = new Map<string, TargetVerdict>();

    if (outcome.ok) {
      for (const failure of outcome.value.failedTargets ?? []) {
        verdicts.set(failure.targetId, { reached: false, reason: failure.reason });
      }
      for (const suppression of outcome.value.suppressedTargets ?? []) {
        verdicts.set(suppression.targetId, { suppressed: true, reason: suppression.reason });
      }
    } else {
      // `err` means NO target was reached, so the whole claimed set goes back and every
      // line carries the one reason the medium gave.
      for (const target of claimed) {
        verdicts.set(target.id, { reached: false, reason: outcome.error });
      }
    }

    // A verdict exists only where nothing was delivered — a failure or a suppression —
    // so its presence IS the release condition. A delivered target has none and keeps
    // its claim.
    for (const target of claimed) {
      if (!verdicts.has(target.id)) continue;
      await this.ledger.release({
        alertKey: alert.alertKey,
        medium: adapter.medium,
        target: target.id,
      });
    }

    return verdicts;
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
          reason: PREFERENCE_IS_OFF,
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

      const delivered = await this.attempt(adapter, alert, [recipient.target]);
      const verdict = (await this.settle(adapter, alert, [recipient.target], delivered)).get(
        recipient.target.id
      );

      // Only a real delivery has a notification to attach. A suppressed target wrote no
      // row, so there is no id, and a failed one has already given its claim back.
      if (verdict === undefined && delivered.ok && delivered.value.notificationId !== undefined) {
        await this.ledger.attachNotification({
          alertKey: alert.alertKey,
          target: recipient.target.id,
          notificationId: delivered.value.notificationId,
        });
      }

      entries.push(this.entryFor(adapter, recipient.target.id, verdict));
    }

    return entries;
  }

  /**
   * @method entryFor
   * @description Turns one target's verdict into its line of the report. ONE mapping
   *   for both kinds of medium, so "suppressed" cannot come to mean one thing on the
   *   per-member path and another on the shared one.
   * @param adapter - The medium the line is about
   * @param targetId - The target the line is about
   * @param verdict - What became of it; absent means it was reached
   * @returns The report line, carrying the medium's own reason when there is one
   */
  private entryFor(
    adapter: RetractionAlertDelivery,
    targetId: string,
    verdict: TargetVerdict | undefined
  ): AlertDeliveryReportEntry {
    if (verdict === undefined) {
      return { medium: adapter.medium, target: targetId, result: ALERT_DELIVERY_RESULTS.DELIVERED };
    }
    return {
      medium: adapter.medium,
      target: targetId,
      result:
        verdict.suppressed === true
          ? ALERT_DELIVERY_RESULTS.SUPPRESSED_BY_PREFERENCE
          : ALERT_DELIVERY_RESULTS.FAILED,
      reason: verdict.reason,
    };
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
      // Both exits below name the PROJECT and say why. Neither has a config to name —
      // that is exactly what happened — but a line carrying neither target nor reason
      // reaches an operator as a warning about a whole project's shared destinations
      // that says neither which project nor what went wrong.
      return [
        {
          medium: adapter.medium,
          target: projectId,
          result: ALERT_DELIVERY_RESULTS.FAILED,
          reason: configsResult.error.message,
        },
      ];
    }

    const active = configsResult.value.filter((config) => config.isActive);
    if (active.length === 0) {
      // Distinct from "suppressed": nobody turned this off, there is simply no
      // destination of this kind set up for the project.
      return [
        {
          medium: adapter.medium,
          target: projectId,
          result: ALERT_DELIVERY_RESULTS.NO_ACTIVE_CONFIG,
          reason: NO_DESTINATION_IS_SET_UP,
        },
      ];
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

    // ONE call with the destinations this run CLAIMED — not "every active config": the
    // medium delivers to exactly the ids handed to it, so a redelivery that claimed
    // only the destination a previous run missed reaches that one alone. Its answer is
    // PER DESTINATION — an `err` means none was reached, while `ok` may still name the
    // ones that were not. Collapsing that into a single verdict is what used to leave a
    // refused channel claimed, unreachable and counted as delivered.
    const delivered = await this.attempt(adapter, alert, claimed);
    const verdicts = await this.settle(adapter, alert, claimed, delivered);

    return claimed.map((target) => this.entryFor(adapter, target.id, verdicts.get(target.id)));
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
