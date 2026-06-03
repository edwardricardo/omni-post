/**
 * @file GatewayBillingService.ts
 * @description Manages the lifecycle of payment gateway switches (Stripe ↔ Paddle).
 *   Handles initiation, cancellation, extension, webhook-driven transitions,
 *   admin force-actions, and dunning. All public methods return Result<T, E>.
 *
 *   Framework-free: depends only on @core/domain ports + UoW. The concrete
 *   Prisma adapters live in apps/api/src/infrastructure/repositories/; the
 *   BullMQ job scheduler lives in apps/api/src/billing/GatewaySwitchJobService.ts.
 * @layer application
 */

import { ok, err, type Result } from "@shared/types";
import { createLogger } from "@observability/logger";
import type { AccountBillingRepository } from "@core/domain/repositories/AccountBillingRepository.js";
import type { AccountSubscriptionBillingRepository } from "@core/domain/repositories/AccountSubscriptionBillingRepository.js";
import type {
  GatewaySwitchEventRepository,
  GatewaySwitchEventWithAccount,
  SwitchEventCounts,
} from "@core/domain/repositories/GatewaySwitchEventRepository.js";
import type { BillingEventRepository } from "@core/domain/repositories/BillingEventRepository.js";
import type { InvoiceRepository } from "@core/domain/repositories/InvoiceRepository.js";
import type {
  ProviderBundleReader,
  ProviderBundleSummary,
} from "@core/domain/repositories/ProviderBundleReader.js";
import type { GatewaySwitchJobPort } from "@core/domain/repositories/GatewaySwitchJobPort.js";
import type { AuditEmitterPort } from "@core/domain/repositories/AuditEmitterPort.js";
import type { EmailPort } from "@core/domain/repositories/EmailPort.js";
import type { UnitOfWork } from "@core/domain/repositories/Repository.js";
import type { GatewayAdapterRegistryPort } from "@core/domain/repositories/GatewayAdapterRegistryPort.js";
import type { GatewayProviderType } from "@ports/core";

const logger = createLogger("gateway-billing");

// ─── Error Types ────────────────────────────────────────────────────────────

export type SwitchError =
  | "ACCOUNT_NOT_FOUND"
  | "NO_ACTIVE_SUBSCRIPTION"
  | "SWITCH_ALREADY_PENDING"
  | "SAME_GATEWAY"
  | "SWITCH_NOT_FOUND"
  | "INVALID_STATUS"
  | "OPEN_INVOICE"
  | "MAX_EXTENSION_EXCEEDED"
  | "GATEWAY_ERROR"
  | "DATABASE_ERROR";

// ─── Response Types ─────────────────────────────────────────────────────────

export interface SwitchInitiatedResult {
  switchEventId: string;
  scheduledFor: Date;
  fromGateway: string;
  toGateway: string;
}

export interface ExtendResult {
  newDeadline: Date;
  extendedBy: string;
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function mapGatewayToAdapterProvider(gateway: "STRIPE" | "PADDLE"): GatewayProviderType {
  return gateway === "STRIPE" ? "stripe" : "paddle";
}

function mapAdapterProviderToGateway(provider: GatewayProviderType): "STRIPE" | "PADDLE" {
  return provider === "stripe" ? "STRIPE" : "PADDLE";
}

// ─── Service ────────────────────────────────────────────────────────────────

export class GatewayBillingService {
  constructor(
    private readonly accountRepo: AccountBillingRepository,
    private readonly subscriptionRepo: AccountSubscriptionBillingRepository,
    private readonly switchEventRepo: GatewaySwitchEventRepository,
    private readonly billingEventRepo: BillingEventRepository,
    private readonly invoiceRepo: InvoiceRepository,
    private readonly bundleReader: ProviderBundleReader,
    private readonly registry: GatewayAdapterRegistryPort,
    private readonly switchJobs: GatewaySwitchJobPort,
    private readonly emailPort: EmailPort,
    private readonly auditEmitter: AuditEmitterPort,
    private readonly unitOfWork: UnitOfWork
  ) {}

  /**
   * @method initiateGatewaySwitch
   * @description Schedule a gateway switch at the end of the current billing period.
   *   Marks the current subscription for cancel-at-period-end on the source gateway,
   *   creates a GatewaySwitchEvent record, and updates the account pending fields.
   */
  async initiateGatewaySwitch(
    accountId: string,
    newProvider: GatewayProviderType,
    requestedByUserId?: string
  ): Promise<Result<SwitchInitiatedResult, SwitchError>> {
    try {
      const accountResult = await this.accountRepo.findById(accountId);
      if (!accountResult.ok) return err("DATABASE_ERROR");
      const account = accountResult.value;
      if (!account) return err("ACCOUNT_NOT_FOUND");

      const targetGateway = mapAdapterProviderToGateway(newProvider);
      if (account.gatewayProvider === targetGateway) return err("SAME_GATEWAY");
      if (account.pendingGatewaySwitch) return err("SWITCH_ALREADY_PENDING");

      const subResult = await this.subscriptionRepo.findActiveOrTrialingByAccount(accountId);
      if (!subResult.ok) return err("DATABASE_ERROR");
      const subscription = subResult.value;
      if (!subscription) return err("NO_ACTIVE_SUBSCRIPTION");

      let switchDate: Date;
      const externalSubId =
        subscription.gatewaySubscriptionId ?? subscription.externalSubscriptionId;

      if (externalSubId) {
        const currentAdapter = this.registry.getAdapter(
          mapGatewayToAdapterProvider(account.gatewayProvider)
        );
        const details = await currentAdapter.getSubscriptionDetails({
          externalSubscriptionId: externalSubId,
        });
        switchDate = details.currentPeriodEnd;

        await currentAdapter.cancelAtPeriodEnd({ externalSubscriptionId: externalSubId });
      } else {
        switchDate =
          subscription.currentPeriodEnd ?? new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
      }

      const fromGateway = account.gatewayProvider;
      let switchEventId = "";

      await this.unitOfWork.executeInTransaction(async () => {
        const created = await this.switchEventRepo.create({
          accountId,
          fromGateway,
          toGateway: targetGateway,
          scheduledFor: switchDate,
          status: "SCHEDULED",
        });
        if (!created.ok) throw new Error("DATABASE_ERROR");
        switchEventId = created.value.id;

        const accUpdate = await this.accountRepo.updateBillingFields(accountId, {
          pendingGatewayProvider: targetGateway,
          pendingGatewaySwitch: true,
          gatewaySwitchAt: switchDate,
        });
        if (!accUpdate.ok) throw new Error("DATABASE_ERROR");

        const subUpdate = await this.subscriptionRepo.update(subscription.id, {
          cancelAtPeriodEnd: true,
        });
        if (!subUpdate.ok) throw new Error("DATABASE_ERROR");
      });

      await this.auditEmitter.emit({
        action: "GATEWAY_SWITCH_INITIATED",
        category: "BILLING",
        resourceType: "account",
        resourceId: accountId,
        userId: requestedByUserId ?? accountId,
        details: {
          from: fromGateway,
          to: targetGateway,
          scheduledFor: switchDate.toISOString(),
        },
        success: true,
      });

      return ok({
        switchEventId,
        scheduledFor: switchDate,
        fromGateway,
        toGateway: targetGateway,
      });
    } catch (error) {
      logger.error({ err: error, accountId }, "Failed to initiate gateway switch");
      return err("DATABASE_ERROR");
    }
  }

  /**
   * @method cancelPendingSwitch
   * @description Cancel a SCHEDULED gateway switch. Reactivates the subscription
   *   on the current gateway and clears pending fields.
   */
  async cancelPendingSwitch(accountId: string): Promise<Result<{ cancelled: true }, SwitchError>> {
    try {
      const accountResult = await this.accountRepo.findById(accountId);
      if (!accountResult.ok) return err("DATABASE_ERROR");
      const account = accountResult.value;
      if (!account) return err("ACCOUNT_NOT_FOUND");
      if (!account.pendingGatewaySwitch) return err("SWITCH_NOT_FOUND");

      const switchEventResult = await this.switchEventRepo.findLatestByAccountAndStatus(accountId, [
        "SCHEDULED",
      ]);
      if (!switchEventResult.ok) return err("DATABASE_ERROR");
      const switchEvent = switchEventResult.value;
      if (!switchEvent) return err("SWITCH_NOT_FOUND");

      const subResult = await this.subscriptionRepo.findActiveOrTrialingByAccount(accountId);
      if (!subResult.ok) return err("DATABASE_ERROR");
      const subscription = subResult.value;

      const externalSubId =
        subscription?.gatewaySubscriptionId ?? subscription?.externalSubscriptionId;
      if (externalSubId) {
        const currentAdapter = this.registry.getAdapter(
          mapGatewayToAdapterProvider(account.gatewayProvider)
        );
        await currentAdapter.reactivateSubscription({
          externalSubscriptionId: externalSubId,
        });
      }

      await this.unitOfWork.executeInTransaction(async () => {
        const accUpdate = await this.accountRepo.updateBillingFields(accountId, {
          pendingGatewayProvider: null,
          pendingGatewaySwitch: false,
          gatewaySwitchAt: null,
        });
        if (!accUpdate.ok) throw new Error("DATABASE_ERROR");

        if (subscription) {
          const subUpdate = await this.subscriptionRepo.update(subscription.id, {
            cancelAtPeriodEnd: false,
          });
          if (!subUpdate.ok) throw new Error("DATABASE_ERROR");
        }

        const switchUpdate = await this.switchEventRepo.update(switchEvent.id, {
          status: "CANCELLED",
          cancelledAt: new Date(),
        });
        if (!switchUpdate.ok) throw new Error("DATABASE_ERROR");
      });

      await this.switchJobs.cancelJobs(accountId);

      return ok({ cancelled: true });
    } catch (error) {
      logger.error({ err: error, accountId }, "Failed to cancel pending gateway switch");
      return err("DATABASE_ERROR");
    }
  }

  /**
   * @method extendSwitchDeadline
   * @description Extend the checkout window for a PENDING_CHECKOUT switch.
   *   Admin-only action with max 72h extension.
   */
  async extendSwitchDeadline(
    accountId: string,
    extraHours: number,
    adminUserId: string
  ): Promise<Result<ExtendResult, SwitchError>> {
    try {
      if (extraHours > 72) return err("MAX_EXTENSION_EXCEEDED");

      const switchEventResult = await this.switchEventRepo.findLatestByAccountAndStatus(accountId, [
        "PENDING_CHECKOUT",
      ]);
      if (!switchEventResult.ok) return err("DATABASE_ERROR");
      const switchEvent = switchEventResult.value;
      if (!switchEvent) return err("SWITCH_NOT_FOUND");

      const base = switchEvent.extendedUntil ?? switchEvent.scheduledFor;
      const newDeadline = new Date(base.getTime() + extraHours * 60 * 60 * 1000);

      const update = await this.switchEventRepo.update(switchEvent.id, {
        extendedUntil: newDeadline,
        extendedBy: adminUserId,
      });
      if (!update.ok) return err("DATABASE_ERROR");

      await this.switchJobs.rescheduleJobs(accountId, newDeadline);

      return ok({ newDeadline, extendedBy: adminUserId });
    } catch (error) {
      logger.error({ err: error, accountId }, "Failed to extend switch deadline");
      return err("DATABASE_ERROR");
    }
  }

  /**
   * @method handleSubscriptionCanceled
   * @description Called by the webhook handler when a subscription is canceled at period end.
   *   Detects whether this is a gateway-switch cancellation or a regular cancellation.
   */
  async handleSubscriptionCanceled(accountId: string): Promise<Result<void, SwitchError>> {
    try {
      const accountResult = await this.accountRepo.findById(accountId);
      if (!accountResult.ok) return err("DATABASE_ERROR");
      const account = accountResult.value;
      if (!account) return err("ACCOUNT_NOT_FOUND");

      if (!account.pendingGatewaySwitch || !account.pendingGatewayProvider) {
        // Regular cancellation — send notification email.
        if (account.email) {
          const subResult = await this.subscriptionRepo.findLatestByAccount(accountId);
          const accessUntil =
            subResult.ok && subResult.value?.currentPeriodEnd
              ? (subResult.value.currentPeriodEnd.toISOString().split("T")[0] ?? "N/A")
              : "N/A";
          await this.emailPort
            .send({
              to: [account.email],
              subject: "Your subscription has been cancelled",
              body: `Your subscription has been cancelled. You will have access until ${accessUntil}.`,
            })
            .catch((e) => logger.warn({ err: e }, "Failed to send cancellation email"));
        }
        return ok(undefined);
      }

      const switchEventResult = await this.switchEventRepo.findLatestByAccountAndStatus(accountId, [
        "SCHEDULED",
      ]);
      if (!switchEventResult.ok) return err("DATABASE_ERROR");
      const switchEvent = switchEventResult.value;
      if (!switchEvent) return ok(undefined);

      const subResult = await this.subscriptionRepo.findLatestByAccount(accountId);
      if (!subResult.ok) return err("DATABASE_ERROR");
      const subscription = subResult.value;

      // Transition: SCHEDULED → PENDING_CHECKOUT
      await this.unitOfWork.executeInTransaction(async () => {
        const switchUpdate = await this.switchEventRepo.update(switchEvent.id, {
          status: "PENDING_CHECKOUT",
        });
        if (!switchUpdate.ok) throw new Error("DATABASE_ERROR");

        if (subscription) {
          const subUpdate = await this.subscriptionRepo.update(subscription.id, {
            status: "CANCELED",
          });
          if (!subUpdate.ok) throw new Error("DATABASE_ERROR");
        }
      });

      await this.switchJobs.startCheckoutWindow(accountId, switchEvent.id);

      if (account.email) {
        await this.emailPort.send({
          to: [account.email],
          subject: "Complete your payment gateway switch",
          body: `Your billing period has ended. Please complete your subscription setup on ${account.pendingGatewayProvider} within 48 hours.`,
        });
      }

      return ok(undefined);
    } catch (error) {
      logger.error(
        { err: error, accountId },
        "Failed to handle subscription canceled for gateway switch"
      );
      return err("DATABASE_ERROR");
    }
  }

  /**
   * @method handleCheckoutCompleted
   * @description Called when a checkout is completed on the new gateway.
   *   Completes the switch, updates account/subscription, and cancels pending jobs.
   */
  async handleCheckoutCompleted(
    accountId: string,
    newGatewayCustomerId: string,
    newGatewaySubscriptionId: string
  ): Promise<Result<void, SwitchError>> {
    try {
      const accountResult = await this.accountRepo.findById(accountId);
      if (!accountResult.ok) return err("DATABASE_ERROR");
      const account = accountResult.value;
      if (!account) return err("ACCOUNT_NOT_FOUND");

      const switchEventResult = await this.switchEventRepo.findLatestByAccountAndStatus(accountId, [
        "PENDING_CHECKOUT",
      ]);
      if (!switchEventResult.ok) return err("DATABASE_ERROR");
      const switchEvent = switchEventResult.value;
      if (!switchEvent) return ok(undefined); // No pending switch — normal checkout

      const targetGateway = switchEvent.toGateway;

      await this.unitOfWork.executeInTransaction(async () => {
        const accUpdate = await this.accountRepo.updateBillingFields(accountId, {
          gatewayProvider: targetGateway,
          gatewayCustomerId: newGatewayCustomerId,
          pendingGatewayProvider: null,
          pendingGatewaySwitch: false,
          gatewaySwitchAt: null,
        });
        if (!accUpdate.ok) throw new Error("DATABASE_ERROR");

        const subUpdate = await this.subscriptionRepo.updateAllForAccount(accountId, {
          gatewayProvider: targetGateway,
          gatewaySubscriptionId: newGatewaySubscriptionId,
          status: "ACTIVE",
          cancelAtPeriodEnd: false,
        });
        if (!subUpdate.ok) throw new Error("DATABASE_ERROR");

        const switchUpdate = await this.switchEventRepo.update(switchEvent.id, {
          status: "COMPLETED",
          completedAt: new Date(),
        });
        if (!switchUpdate.ok) throw new Error("DATABASE_ERROR");
      });

      await this.auditEmitter.emit({
        action: "GATEWAY_SWITCH_COMPLETED",
        category: "BILLING",
        resourceType: "account",
        resourceId: accountId,
        userId: accountId,
        details: {
          from: switchEvent.fromGateway,
          to: targetGateway,
          switchEventId: switchEvent.id,
        },
        success: true,
      });

      await this.switchJobs.cancelJobs(accountId);

      return ok(undefined);
    } catch (error) {
      logger.error(
        { err: error, accountId },
        "Failed to handle checkout completed for gateway switch"
      );
      return err("DATABASE_ERROR");
    }
  }

  /**
   * @method forceComplete
   * @description Admin action to force-complete a PENDING_CHECKOUT switch.
   */
  async forceComplete(
    switchEventId: string,
    adminUserId: string
  ): Promise<Result<void, SwitchError>> {
    try {
      const switchEventResult = await this.switchEventRepo.findById(switchEventId);
      if (!switchEventResult.ok) return err("DATABASE_ERROR");
      const switchEvent = switchEventResult.value;
      if (!switchEvent) return err("SWITCH_NOT_FOUND");
      if (switchEvent.status !== "PENDING_CHECKOUT") return err("INVALID_STATUS");

      await this.unitOfWork.executeInTransaction(async () => {
        const switchUpdate = await this.switchEventRepo.update(switchEventId, {
          status: "COMPLETED",
          completedAt: new Date(),
        });
        if (!switchUpdate.ok) throw new Error("DATABASE_ERROR");

        const accUpdate = await this.accountRepo.updateBillingFields(switchEvent.accountId, {
          gatewayProvider: switchEvent.toGateway,
          pendingGatewayProvider: null,
          pendingGatewaySwitch: false,
          gatewaySwitchAt: null,
        });
        if (!accUpdate.ok) throw new Error("DATABASE_ERROR");
      });

      await this.auditEmitter.emit({
        action: "GATEWAY_SWITCH_FORCE_COMPLETED",
        category: "BILLING",
        resourceType: "account",
        resourceId: switchEvent.accountId,
        userId: adminUserId,
        details: {
          switchEventId,
          from: switchEvent.fromGateway,
          to: switchEvent.toGateway,
        },
        success: true,
      });

      await this.switchJobs.cancelJobs(switchEvent.accountId);

      return ok(undefined);
    } catch (error) {
      logger.error({ err: error, switchEventId }, "Failed to force-complete gateway switch");
      return err("DATABASE_ERROR");
    }
  }

  /**
   * @method forceSuspend
   * @description Admin action to force-suspend a PENDING_CHECKOUT switch.
   */
  async forceSuspend(
    switchEventId: string,
    adminUserId: string
  ): Promise<Result<void, SwitchError>> {
    try {
      const switchEventResult = await this.switchEventRepo.findById(switchEventId);
      if (!switchEventResult.ok) return err("DATABASE_ERROR");
      const switchEvent = switchEventResult.value;
      if (!switchEvent) return err("SWITCH_NOT_FOUND");
      if (switchEvent.status !== "PENDING_CHECKOUT") return err("INVALID_STATUS");

      await this.unitOfWork.executeInTransaction(async () => {
        const subUpdate = await this.subscriptionRepo.updateAllForAccount(switchEvent.accountId, {
          status: "CANCELED",
        });
        if (!subUpdate.ok) throw new Error("DATABASE_ERROR");

        const switchUpdate = await this.switchEventRepo.update(switchEventId, {
          status: "SUSPENDED",
          suspendedAt: new Date(),
        });
        if (!switchUpdate.ok) throw new Error("DATABASE_ERROR");
      });

      await this.auditEmitter.emit({
        action: "GATEWAY_SWITCH_FORCE_SUSPENDED",
        category: "BILLING",
        resourceType: "account",
        resourceId: switchEvent.accountId,
        userId: adminUserId,
        details: {
          switchEventId,
          reason: "Admin forced suspension",
        },
        success: true,
      });

      await this.switchJobs.cancelJobs(switchEvent.accountId);

      // Notify account
      const accountResult = await this.accountRepo.findById(switchEvent.accountId);
      if (accountResult.ok && accountResult.value?.email) {
        await this.emailPort.send({
          to: [accountResult.value.email],
          subject: "Account suspended — gateway switch incomplete",
          body: "Your account has been suspended because the gateway switch was not completed in time. Please contact support.",
        });
      }

      return ok(undefined);
    } catch (error) {
      logger.error({ err: error, switchEventId }, "Failed to force-suspend gateway switch");
      return err("DATABASE_ERROR");
    }
  }

  /**
   * @method getAccountSwitchStatus
   * @description Returns the current gateway switch status for an account.
   */
  async getAccountSwitchStatus(accountId: string): Promise<
    Result<
      {
        gatewayProvider: string;
        pendingSwitch: {
          id: string;
          toGateway: string;
          status: string;
          scheduledFor: Date;
          extendedUntil: Date | null;
        } | null;
      },
      SwitchError
    >
  > {
    try {
      const accountResult = await this.accountRepo.findById(accountId);
      if (!accountResult.ok) return err("DATABASE_ERROR");
      const account = accountResult.value;
      if (!account) return err("ACCOUNT_NOT_FOUND");

      let pendingSwitch: {
        id: string;
        toGateway: string;
        status: string;
        scheduledFor: Date;
        extendedUntil: Date | null;
      } | null = null;

      if (account.pendingGatewaySwitch) {
        const switchEventResult = await this.switchEventRepo.findLatestByAccountAndStatus(
          accountId,
          ["SCHEDULED", "PENDING_CHECKOUT"]
        );
        if (!switchEventResult.ok) return err("DATABASE_ERROR");
        const switchEvent = switchEventResult.value;
        if (switchEvent) {
          pendingSwitch = {
            id: switchEvent.id,
            toGateway: switchEvent.toGateway,
            status: switchEvent.status,
            scheduledFor: switchEvent.scheduledFor,
            extendedUntil: switchEvent.extendedUntil,
          };
        }
      }

      return ok({
        gatewayProvider: account.gatewayProvider,
        pendingSwitch,
      });
    } catch (error) {
      logger.error({ err: error, accountId }, "Failed to get account switch status");
      return err("DATABASE_ERROR");
    }
  }

  /**
   * @method createCheckoutSession
   * @description Creates a checkout session on the specified gateway.
   *   If the account has no gateway customer, creates one first.
   */
  async createCheckoutSession(
    accountId: string,
    gatewayProvider: GatewayProviderType,
    successUrl: string,
    cancelUrl: string
  ): Promise<Result<{ url: string }, SwitchError>> {
    try {
      const accountResult = await this.accountRepo.findById(accountId);
      if (!accountResult.ok) return err("DATABASE_ERROR");
      const account = accountResult.value;
      if (!account) return err("ACCOUNT_NOT_FOUND");

      const adapter = this.registry.getAdapter(gatewayProvider);
      const targetGateway = mapAdapterProviderToGateway(gatewayProvider);

      let customerId = account.gatewayCustomerId;
      if (!customerId || account.gatewayProvider !== targetGateway) {
        if (!account.email) return err("ACCOUNT_NOT_FOUND");
        const customerResult = await adapter.createCustomer({
          email: account.email,
          name: account.name,
          metadata: { accountId },
        });
        customerId = customerResult.externalCustomerId;

        const upd = await this.accountRepo.updateBillingFields(accountId, {
          gatewayCustomerId: customerId,
          gatewayProvider: targetGateway,
        });
        if (!upd.ok) return err("DATABASE_ERROR");
      }

      const session = await adapter.createCheckoutSession({
        externalCustomerId: customerId,
        successUrl,
        cancelUrl,
        metadata: { accountId },
      });

      return ok({ url: session.url });
    } catch (error) {
      logger.error({ err: error, accountId }, "Failed to create checkout session");
      return err("GATEWAY_ERROR");
    }
  }

  /**
   * @method getBillingPortalUrl
   * @description Returns a URL to the gateway's billing portal for managing
   *   subscriptions, payment methods, and invoices.
   */
  async getBillingPortalUrl(
    accountId: string,
    returnUrl: string
  ): Promise<Result<{ url: string }, SwitchError>> {
    try {
      const accountResult = await this.accountRepo.findById(accountId);
      if (!accountResult.ok) return err("DATABASE_ERROR");
      const account = accountResult.value;
      if (!account) return err("ACCOUNT_NOT_FOUND");
      if (!account.gatewayCustomerId) return err("NO_ACTIVE_SUBSCRIPTION");

      const adapter = this.registry.getAdapter(
        mapGatewayToAdapterProvider(account.gatewayProvider)
      );
      const portal = await adapter.createBillingPortalSession({
        externalCustomerId: account.gatewayCustomerId,
        returnUrl,
      });

      return ok({ url: portal.url });
    } catch (error) {
      logger.error({ err: error, accountId }, "Failed to get billing portal URL");
      return err("GATEWAY_ERROR");
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Webhook Event Processing (idempotency + routing)
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * @method resolveAccountIdByCustomer
   * @description Looks up accountId from a gateway customer ID.
   */
  async resolveAccountIdByCustomer(
    gatewayCustomerId: string,
    provider: GatewayProviderType
  ): Promise<string | null> {
    if (!gatewayCustomerId) return null;
    const providerEnum = mapAdapterProviderToGateway(provider);
    const accResult = await this.accountRepo.findByGatewayCustomerId(
      providerEnum,
      gatewayCustomerId
    );
    return accResult.ok && accResult.value ? accResult.value.id : null;
  }

  /**
   * @method checkBillingEventIdempotency
   * @description Returns true if the event was already processed (skip it).
   *   Creates or retrieves the BillingEvent record for tracking.
   */
  async checkBillingEventIdempotency(
    eventId: string,
    provider: GatewayProviderType,
    eventType: string,
    domainEvent: string,
    data: Record<string, unknown>
  ): Promise<{ skip: boolean; recordId: string | null }> {
    const gatewayEventId = eventId || `${provider}-${eventType}-${Date.now()}`;
    const providerEnum = mapAdapterProviderToGateway(provider);

    const existingResult = await this.billingEventRepo.findByGatewayEventId(gatewayEventId);
    if (existingResult.ok && existingResult.value?.processed) {
      return { skip: true, recordId: existingResult.value.id };
    }

    const upsertResult = await this.billingEventRepo.upsertNew({
      gatewayEventId,
      gatewayProvider: providerEnum,
      eventType: domainEvent,
      rawEventType: eventType,
      payload: data as object,
    });
    if (!upsertResult.ok) return { skip: false, recordId: null };

    return { skip: false, recordId: upsertResult.value.id };
  }

  /**
   * @method markBillingEventProcessed
   * @description Atomically claims the BillingEvent for side-effect
   *   processing via CAS on `processed`. Returns `true` when this caller
   *   wins the race (must run the handler). Returns `false` when another
   *   concurrent webhook delivery already claimed it (caller MUST skip).
   *   Closes the TOCTOU window between `checkBillingEventIdempotency` and
   *   the handler invocation that previously allowed double side-effects.
   */
  async markBillingEventProcessed(recordId: string): Promise<boolean> {
    const result = await this.billingEventRepo.markProcessed(recordId);
    return result.ok ? result.value.claimed : false;
  }

  /**
   * @method markBillingEventError
   * @description Records a processing error on a BillingEvent.
   */
  async markBillingEventError(recordId: string, error: string): Promise<void> {
    await this.billingEventRepo.markError(recordId, error);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Query Methods (used by admin routes)
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * @method getAvailablePlans
   * @description Returns active provider bundles for the public plans endpoint.
   */
  async getAvailablePlans(): Promise<ProviderBundleSummary[]> {
    const result = await this.bundleReader.listActive();
    return result.ok ? result.value : [];
  }

  /**
   * @method listGatewaySwitches
   * @description Lists gateway switch events with pagination and stats.
   */
  async listGatewaySwitches(filters: { status?: string; page: number; limit: number }): Promise<{
    events: GatewaySwitchEventWithAccount[];
    total: number;
    page: number;
    limit: number;
    stats: Omit<SwitchEventCounts, "total">;
  }> {
    const status =
      filters.status && filters.status !== "ALL"
        ? (filters.status as
            | "SCHEDULED"
            | "PENDING_CHECKOUT"
            | "COMPLETED"
            | "CANCELLED"
            | "SUSPENDED"
            | "EXPIRED")
        : undefined;
    const result = await this.switchEventRepo.listWithAccount({
      page: filters.page,
      limit: filters.limit,
      ...(status !== undefined && { status }),
    });
    if (!result.ok) {
      return {
        events: [],
        total: 0,
        page: filters.page,
        limit: filters.limit,
        stats: { scheduled: 0, pendingCheckout: 0, suspended: 0, completed30d: 0 },
      };
    }
    const { events, counts } = result.value;
    return {
      events,
      total: counts.total,
      page: filters.page,
      limit: filters.limit,
      stats: {
        scheduled: counts.scheduled,
        pendingCheckout: counts.pendingCheckout,
        suspended: counts.suspended,
        completed30d: counts.completed30d,
      },
    };
  }

  /**
   * @method getGatewaySwitchById
   * @description Returns a single gateway switch event by ID, joined with the
   *   account row. Returns `null` if not found or on error (consumers treat
   *   both the same — a 404 from the route handler).
   */
  async getGatewaySwitchById(id: string): Promise<GatewaySwitchEventWithAccount | null> {
    const result = await this.switchEventRepo.findByIdWithAccount(id);
    return result.ok ? result.value : null;
  }

  // ─── Dunning (Payment Failed / Succeeded) ────────────────────────────

  /**
   * @method handlePaymentFailed
   * @description Handles failed payment webhook. Upserts Invoice, transitions
   *   subscription to PAST_DUE, sends dunning email. On 3rd attempt, cancels.
   */
  async handlePaymentFailed(
    data: Record<string, unknown>,
    gatewayCustomerId: string
  ): Promise<Result<void, SwitchError>> {
    try {
      const provider: "STRIPE" | "PADDLE" = String(data.subscription_id ?? "").startsWith("sub_")
        ? "STRIPE"
        : "PADDLE";
      const accResult = await this.accountRepo.findByGatewayCustomerId(provider, gatewayCustomerId);
      if (!accResult.ok) return err("DATABASE_ERROR");
      const account = accResult.value;
      if (!account) return err("ACCOUNT_NOT_FOUND");

      const invoiceId = String(data.id ?? data.invoice_id ?? "");
      const attemptCount = Number(data.attempt_count ?? data.payment_attempt_number ?? 1);
      const amountDue = Number(data.amount_due ?? data.amount ?? 0) / 100;
      const currency = String(data.currency ?? "usd").toUpperCase();
      const periodStart = data.period_start
        ? new Date(Number(data.period_start) * 1000)
        : new Date();
      const periodEnd = data.period_end ? new Date(Number(data.period_end) * 1000) : new Date();

      if (!invoiceId) return err("DATABASE_ERROR");

      const upsert = await this.invoiceRepo.upsertByGatewayInvoiceId(
        invoiceId,
        {
          accountId: account.id,
          gatewayProvider: provider,
          gatewayInvoiceId: invoiceId,
          status: "PAYMENT_FAILED",
          amountDue,
          currency,
          periodStart,
          periodEnd,
          attemptCount,
        },
        { status: "PAYMENT_FAILED", attemptCount }
      );
      if (!upsert.ok) return err("DATABASE_ERROR");

      const subResult = await this.subscriptionRepo.findLatestByAccount(account.id);
      if (!subResult.ok) return err("DATABASE_ERROR");
      const sub = subResult.value;

      if (attemptCount >= 3) {
        if (sub) {
          const upd = await this.subscriptionRepo.update(sub.id, { status: "CANCELED" });
          if (!upd.ok) return err("DATABASE_ERROR");
        }
      } else if (sub && sub.status !== "PAST_DUE") {
        const upd = await this.subscriptionRepo.update(sub.id, { status: "PAST_DUE" });
        if (!upd.ok) return err("DATABASE_ERROR");
      }

      if (account.email) {
        const isFinal = attemptCount >= 3;
        await this.emailPort
          .send({
            to: [account.email],
            subject: isFinal
              ? "Account suspended — update payment method"
              : `Payment failed — ${currency} ${amountDue.toFixed(2)}`,
            body: isFinal
              ? `Your payment of ${currency} ${amountDue.toFixed(2)} failed after ${attemptCount} attempts. Your account has been suspended.`
              : `Your payment of ${currency} ${amountDue.toFixed(2)} could not be processed (attempt ${attemptCount}). Please update your payment method.`,
          })
          .catch((e) => logger.warn({ err: e }, "Failed to send dunning email"));
      }

      logger.info({ accountId: account.id, attemptCount, invoiceId }, "Payment failed processed");
      return ok(undefined);
    } catch (error) {
      logger.error({ err: error, gatewayCustomerId }, "Failed to handle payment failed");
      return err("DATABASE_ERROR");
    }
  }

  /**
   * @method handlePaymentSucceeded
   * @description Handles successful payment webhook. Upserts Invoice as PAID,
   *   recovers PAST_DUE subscriptions to ACTIVE.
   */
  async handlePaymentSucceeded(
    data: Record<string, unknown>,
    gatewayCustomerId: string
  ): Promise<Result<void, SwitchError>> {
    try {
      const provider: "STRIPE" | "PADDLE" = String(data.subscription_id ?? "").startsWith("sub_")
        ? "STRIPE"
        : "PADDLE";
      const accResult = await this.accountRepo.findByGatewayCustomerId(provider, gatewayCustomerId);
      if (!accResult.ok) return err("DATABASE_ERROR");
      const account = accResult.value;
      if (!account) return err("ACCOUNT_NOT_FOUND");

      const invoiceId = String(data.id ?? data.invoice_id ?? "");
      const amountPaid = Number(data.amount_paid ?? data.amount ?? 0) / 100;
      const currency = String(data.currency ?? "usd").toUpperCase();
      const periodStart = data.period_start
        ? new Date(Number(data.period_start) * 1000)
        : new Date();
      const periodEnd = data.period_end ? new Date(Number(data.period_end) * 1000) : new Date();
      const hostedUrl = data.hosted_invoice_url ? String(data.hosted_invoice_url) : undefined;
      const pdfUrl = data.invoice_pdf ? String(data.invoice_pdf) : undefined;

      if (!invoiceId) return err("DATABASE_ERROR");

      const upsert = await this.invoiceRepo.upsertByGatewayInvoiceId(
        invoiceId,
        {
          accountId: account.id,
          gatewayProvider: provider,
          gatewayInvoiceId: invoiceId,
          status: "PAID",
          amountDue: amountPaid,
          amountPaid,
          currency,
          periodStart,
          periodEnd,
          paidAt: new Date(),
          ...(hostedUrl !== undefined && { hostedUrl }),
          ...(pdfUrl !== undefined && { pdfUrl }),
        },
        {
          status: "PAID",
          amountPaid,
          paidAt: new Date(),
          ...(hostedUrl !== undefined && { hostedUrl }),
          ...(pdfUrl !== undefined && { pdfUrl }),
        }
      );
      if (!upsert.ok) return err("DATABASE_ERROR");

      const subResult = await this.subscriptionRepo.findByAccountAndStatus(account.id, "PAST_DUE");
      if (!subResult.ok) return err("DATABASE_ERROR");
      const sub = subResult.value;
      if (sub) {
        const upd = await this.subscriptionRepo.update(sub.id, { status: "ACTIVE" });
        if (!upd.ok) return err("DATABASE_ERROR");
        logger.info({ accountId: account.id }, "Subscription recovered from PAST_DUE");
      }

      return ok(undefined);
    } catch (error) {
      logger.error({ err: error, gatewayCustomerId }, "Failed to handle payment succeeded");
      return err("DATABASE_ERROR");
    }
  }
}
