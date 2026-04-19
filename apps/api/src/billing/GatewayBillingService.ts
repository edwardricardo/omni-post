/**
 * @file GatewayBillingService.ts
 * @description Manages the lifecycle of payment gateway switches (Stripe ↔ Paddle).
 *   Handles initiation, cancellation, extension, webhook-driven transitions,
 *   and admin force-actions. All public methods return Result<T, E>.
 * @layer application
 */

import { ok, err, type Result } from "@shared/types";
import type { PrismaClient } from "@infra/prisma";
import type { IGatewayAdapterRegistry } from "../infrastructure/billing/GatewayAdapterRegistry.js";
import type { GatewaySwitchJobService } from "./GatewaySwitchJobService.js";
import type { EmailPort } from "../domain/repositories/EmailPort.js";
import type { GatewayProviderType } from "@ports/core";
import { logger } from "../lib/logger.js";

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

// ─── Service ────────────────────────────────────────────────────────────────

export class GatewayBillingService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly registry: IGatewayAdapterRegistry,
    private readonly switchJobService: GatewaySwitchJobService,
    private readonly emailPort: EmailPort
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
      const account = await this.prisma.account.findUnique({
        where: { id: accountId },
      });
      if (!account) return err("ACCOUNT_NOT_FOUND");

      const targetGateway = newProvider === "stripe" ? "STRIPE" : "PADDLE";
      if (account.gatewayProvider === targetGateway) return err("SAME_GATEWAY");
      if (account.pendingGatewaySwitch) return err("SWITCH_ALREADY_PENDING");

      const subscription = await this.prisma.accountSubscription.findFirst({
        where: {
          accountId,
          status: { in: ["ACTIVE", "TRIALING"] },
        },
      });
      if (!subscription) return err("NO_ACTIVE_SUBSCRIPTION");

      // Determine the switch date from the gateway
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

        // Mark subscription for cancellation at period end
        await currentAdapter.cancelAtPeriodEnd({
          externalSubscriptionId: externalSubId,
        });
      } else {
        // No external subscription yet — use currentPeriodEnd from DB or 30 days
        switchDate =
          subscription.currentPeriodEnd ?? new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
      }

      // Persist everything in a single transaction
      const fromGateway = account.gatewayProvider;
      const [switchEvent] = await this.prisma.$transaction([
        this.prisma.gatewaySwitchEvent.create({
          data: {
            accountId,
            fromGateway,
            toGateway: targetGateway,
            scheduledFor: switchDate,
            status: "SCHEDULED",
          },
        }),
        this.prisma.account.update({
          where: { id: accountId },
          data: {
            pendingGatewayProvider: targetGateway,
            pendingGatewaySwitch: true,
            gatewaySwitchAt: switchDate,
          },
        }),
        this.prisma.accountSubscription.update({
          where: { id: subscription.id },
          data: { cancelAtPeriodEnd: true },
        }),
        this.prisma.auditLog.create({
          data: {
            action: "GATEWAY_SWITCH_INITIATED",
            resource: "account",
            resourceId: accountId,
            userId: requestedByUserId ?? accountId,
            details: {
              from: fromGateway,
              to: targetGateway,
              scheduledFor: switchDate.toISOString(),
            },
            success: true,
          },
        }),
      ]);

      return ok({
        switchEventId: switchEvent.id,
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
      const account = await this.prisma.account.findUnique({
        where: { id: accountId },
      });
      if (!account) return err("ACCOUNT_NOT_FOUND");
      if (!account.pendingGatewaySwitch) return err("SWITCH_NOT_FOUND");

      const switchEvent = await this.prisma.gatewaySwitchEvent.findFirst({
        where: { accountId, status: "SCHEDULED" },
        orderBy: { createdAt: "desc" },
      });
      if (!switchEvent) return err("SWITCH_NOT_FOUND");

      const subscription = await this.prisma.accountSubscription.findFirst({
        where: {
          accountId,
          status: { in: ["ACTIVE", "TRIALING"] },
        },
      });

      // Reactivate on current gateway
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

      await this.prisma.$transaction([
        this.prisma.account.update({
          where: { id: accountId },
          data: {
            pendingGatewayProvider: null,
            pendingGatewaySwitch: false,
            gatewaySwitchAt: null,
          },
        }),
        ...(subscription
          ? [
              this.prisma.accountSubscription.update({
                where: { id: subscription.id },
                data: { cancelAtPeriodEnd: false },
              }),
            ]
          : []),
        this.prisma.gatewaySwitchEvent.update({
          where: { id: switchEvent.id },
          data: { status: "CANCELLED", cancelledAt: new Date() },
        }),
      ]);

      // Cancel any pending jobs
      await this.switchJobService.cancelJobs(accountId);

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

      const switchEvent = await this.prisma.gatewaySwitchEvent.findFirst({
        where: { accountId, status: "PENDING_CHECKOUT" },
        orderBy: { createdAt: "desc" },
      });
      if (!switchEvent) return err("SWITCH_NOT_FOUND");

      const base = switchEvent.extendedUntil ?? switchEvent.scheduledFor;
      const newDeadline = new Date(base.getTime() + extraHours * 60 * 60 * 1000);

      await this.prisma.gatewaySwitchEvent.update({
        where: { id: switchEvent.id },
        data: { extendedUntil: newDeadline, extendedBy: adminUserId },
      });

      await this.switchJobService.rescheduleJobs(accountId, newDeadline);

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
      const account = await this.prisma.account.findUnique({
        where: { id: accountId },
      });
      if (!account) return err("ACCOUNT_NOT_FOUND");

      if (!account.pendingGatewaySwitch || !account.pendingGatewayProvider) {
        // Not a gateway switch — regular cancellation: send notification email
        if (account.email) {
          const sub = await this.prisma.accountSubscription.findFirst({
            where: { accountId },
            select: { currentPeriodEnd: true, bundleId: true },
          });
          const accessUntil = sub?.currentPeriodEnd
            ? (sub.currentPeriodEnd.toISOString().split("T")[0] ?? "N/A")
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

      const switchEvent = await this.prisma.gatewaySwitchEvent.findFirst({
        where: { accountId, status: "SCHEDULED" },
        orderBy: { createdAt: "desc" },
      });
      if (!switchEvent) return ok(undefined);

      const subscription = await this.prisma.accountSubscription.findFirst({
        where: { accountId },
        orderBy: { createdAt: "desc" },
      });

      // Transition: SCHEDULED → PENDING_CHECKOUT
      await this.prisma.$transaction([
        this.prisma.gatewaySwitchEvent.update({
          where: { id: switchEvent.id },
          data: { status: "PENDING_CHECKOUT" },
        }),
        ...(subscription
          ? [
              this.prisma.accountSubscription.update({
                where: { id: subscription.id },
                data: { status: "CANCELED" },
              }),
            ]
          : []),
      ]);

      // Start 48h checkout window with reminder + suspend jobs
      await this.switchJobService.startCheckoutWindow(accountId, switchEvent.id);

      // Send immediate email notification
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
      const account = await this.prisma.account.findUnique({
        where: { id: accountId },
      });
      if (!account) return err("ACCOUNT_NOT_FOUND");

      const switchEvent = await this.prisma.gatewaySwitchEvent.findFirst({
        where: { accountId, status: "PENDING_CHECKOUT" },
        orderBy: { createdAt: "desc" },
      });

      if (!switchEvent) {
        // No pending switch — this is a normal checkout
        return ok(undefined);
      }

      const targetGateway = switchEvent.toGateway;

      await this.prisma.$transaction([
        this.prisma.account.update({
          where: { id: accountId },
          data: {
            gatewayProvider: targetGateway,
            gatewayCustomerId: newGatewayCustomerId,
            pendingGatewayProvider: null,
            pendingGatewaySwitch: false,
            gatewaySwitchAt: null,
          },
        }),
        this.prisma.accountSubscription.updateMany({
          where: { accountId },
          data: {
            gatewayProvider: targetGateway,
            gatewaySubscriptionId: newGatewaySubscriptionId,
            status: "ACTIVE",
            cancelAtPeriodEnd: false,
          },
        }),
        this.prisma.gatewaySwitchEvent.update({
          where: { id: switchEvent.id },
          data: { status: "COMPLETED", completedAt: new Date() },
        }),
        this.prisma.auditLog.create({
          data: {
            action: "GATEWAY_SWITCH_COMPLETED",
            resource: "account",
            resourceId: accountId,
            userId: accountId,
            details: {
              from: switchEvent.fromGateway,
              to: targetGateway,
              switchEventId: switchEvent.id,
            },
            success: true,
          },
        }),
      ]);

      // Cancel the reminder/suspend jobs
      await this.switchJobService.cancelJobs(accountId);

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
      const switchEvent = await this.prisma.gatewaySwitchEvent.findUnique({
        where: { id: switchEventId },
      });
      if (!switchEvent) return err("SWITCH_NOT_FOUND");
      if (switchEvent.status !== "PENDING_CHECKOUT") return err("INVALID_STATUS");

      await this.prisma.$transaction([
        this.prisma.gatewaySwitchEvent.update({
          where: { id: switchEventId },
          data: { status: "COMPLETED", completedAt: new Date() },
        }),
        this.prisma.account.update({
          where: { id: switchEvent.accountId },
          data: {
            gatewayProvider: switchEvent.toGateway,
            pendingGatewayProvider: null,
            pendingGatewaySwitch: false,
            gatewaySwitchAt: null,
          },
        }),
        this.prisma.auditLog.create({
          data: {
            action: "GATEWAY_SWITCH_FORCE_COMPLETED",
            resource: "account",
            resourceId: switchEvent.accountId,
            userId: adminUserId,
            details: {
              switchEventId,
              from: switchEvent.fromGateway,
              to: switchEvent.toGateway,
            },
            success: true,
          },
        }),
      ]);

      await this.switchJobService.cancelJobs(switchEvent.accountId);

      return ok(undefined);
    } catch (error) {
      logger.error({ err: error, switchEventId }, "Failed to force-complete gateway switch");
      return err("DATABASE_ERROR");
    }
  }

  /**
   * @method forceSuspend
   * @description Admin action to force-suspend a PENDING_CHECKOUT switch.
   *   Uses the existing suspension mechanism.
   */
  async forceSuspend(
    switchEventId: string,
    adminUserId: string
  ): Promise<Result<void, SwitchError>> {
    try {
      const switchEvent = await this.prisma.gatewaySwitchEvent.findUnique({
        where: { id: switchEventId },
      });
      if (!switchEvent) return err("SWITCH_NOT_FOUND");
      if (switchEvent.status !== "PENDING_CHECKOUT") return err("INVALID_STATUS");

      await this.prisma.$transaction([
        this.prisma.accountSubscription.updateMany({
          where: { accountId: switchEvent.accountId },
          data: { status: "CANCELED" },
        }),
        this.prisma.gatewaySwitchEvent.update({
          where: { id: switchEventId },
          data: { status: "SUSPENDED", suspendedAt: new Date() },
        }),
        this.prisma.auditLog.create({
          data: {
            action: "GATEWAY_SWITCH_FORCE_SUSPENDED",
            resource: "account",
            resourceId: switchEvent.accountId,
            userId: adminUserId,
            details: {
              switchEventId,
              reason: "Admin forced suspension",
            },
            success: true,
          },
        }),
      ]);

      await this.switchJobService.cancelJobs(switchEvent.accountId);

      // Notify account
      const account = await this.prisma.account.findUnique({
        where: { id: switchEvent.accountId },
        select: { email: true },
      });
      if (account?.email) {
        await this.emailPort.send({
          to: [account.email],
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
   *   Used by client billing UI to determine which state to render.
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
      const account = await this.prisma.account.findUnique({
        where: { id: accountId },
        select: {
          gatewayProvider: true,
          pendingGatewaySwitch: true,
        },
      });
      if (!account) return err("ACCOUNT_NOT_FOUND");

      let pendingSwitch = null;
      if (account.pendingGatewaySwitch) {
        const switchEvent = await this.prisma.gatewaySwitchEvent.findFirst({
          where: {
            accountId,
            status: { in: ["SCHEDULED", "PENDING_CHECKOUT"] },
          },
          orderBy: { createdAt: "desc" },
        });
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
      const account = await this.prisma.account.findUnique({
        where: { id: accountId },
      });
      if (!account) return err("ACCOUNT_NOT_FOUND");

      const adapter = this.registry.getAdapter(gatewayProvider);
      const targetGateway = gatewayProvider === "stripe" ? "STRIPE" : "PADDLE";

      // Get or create gateway customer
      let customerId = account.gatewayCustomerId;
      if (!customerId || account.gatewayProvider !== targetGateway) {
        const customerResult = await adapter.createCustomer({
          email: account.email,
          name: account.name,
          metadata: { accountId },
        });
        customerId = customerResult.externalCustomerId;

        await this.prisma.account.update({
          where: { id: accountId },
          data: {
            gatewayCustomerId: customerId,
            gatewayProvider: targetGateway,
          },
        });
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
      const account = await this.prisma.account.findUnique({
        where: { id: accountId },
      });
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
    const providerEnum = provider === "stripe" ? "STRIPE" : "PADDLE";
    const account = await this.prisma.account.findFirst({
      where: {
        gatewayCustomerId,
        gatewayProvider: providerEnum as "STRIPE" | "PADDLE",
      },
      select: { id: true },
    });
    return account?.id ?? null;
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
    const providerEnum = provider === "stripe" ? ("STRIPE" as const) : ("PADDLE" as const);

    const existing = await this.prisma.billingEvent.findUnique({
      where: { gatewayEventId },
      select: { id: true, processed: true },
    });

    if (existing?.processed) {
      return { skip: true, recordId: existing.id };
    }

    const record = await this.prisma.billingEvent.upsert({
      where: { gatewayEventId },
      create: {
        gatewayEventId,
        gatewayProvider: providerEnum,
        eventType: domainEvent,
        rawEventType: eventType,
        payload: data as object,
        processed: false,
      },
      update: {},
    });

    return { skip: false, recordId: record.id };
  }

  /**
   * @method markBillingEventProcessed
   * @description Marks a BillingEvent as successfully processed.
   */
  async markBillingEventProcessed(recordId: string): Promise<void> {
    await this.prisma.billingEvent.update({
      where: { id: recordId },
      data: { processed: true, processedAt: new Date() },
    });
  }

  /**
   * @method markBillingEventError
   * @description Records a processing error on a BillingEvent.
   */
  async markBillingEventError(recordId: string, error: string): Promise<void> {
    await this.prisma.billingEvent.update({
      where: { id: recordId },
      data: { error },
    });
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Query Methods (used by admin routes)
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * @method getAvailablePlans
   * @description Returns active provider bundles for the public plans endpoint.
   */
  async getAvailablePlans() {
    const plans = await this.prisma.providerBundle.findMany({
      where: { isActive: true },
      orderBy: { sortOrder: "asc" },
      select: {
        id: true,
        name: true,
        slug: true,
        description: true,
        providers: true,
        pricePerAccountMonth: true,
        sortOrder: true,
      },
    });
    return plans.map((p) => ({
      ...p,
      pricePerAccountMonth: Number(p.pricePerAccountMonth),
    }));
  }

  /**
   * @method listGatewaySwitches
   * @description Lists gateway switch events with pagination and stats.
   */
  async listGatewaySwitches(filters: { status?: string; page: number; limit: number }) {
    const where: Record<string, unknown> =
      filters.status && filters.status !== "ALL" ? { status: filters.status } : {};
    const offset = (filters.page - 1) * filters.limit;

    const [events, total, scheduled, pendingCheckout, suspended, completed30d] = await Promise.all([
      this.prisma.gatewaySwitchEvent.findMany({
        where,
        include: {
          account: { select: { id: true, name: true, email: true } },
        },
        orderBy: { createdAt: "desc" },
        skip: offset,
        take: filters.limit,
      }),
      this.prisma.gatewaySwitchEvent.count({ where }),
      this.prisma.gatewaySwitchEvent.count({
        where: { status: "SCHEDULED" },
      }),
      this.prisma.gatewaySwitchEvent.count({
        where: { status: "PENDING_CHECKOUT" },
      }),
      this.prisma.gatewaySwitchEvent.count({
        where: { status: "SUSPENDED" },
      }),
      this.prisma.gatewaySwitchEvent.count({
        where: {
          status: "COMPLETED",
          completedAt: {
            gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
          },
        },
      }),
    ]);

    return {
      events,
      total,
      page: filters.page,
      limit: filters.limit,
      stats: { scheduled, pendingCheckout, suspended, completed30d },
    };
  }

  /**
   * @method getGatewaySwitchById
   * @description Returns a single gateway switch event by ID.
   */
  async getGatewaySwitchById(id: string) {
    return this.prisma.gatewaySwitchEvent.findUnique({
      where: { id },
      include: {
        account: { select: { id: true, name: true, email: true } },
      },
    });
  }

  // ─── Dunning (Payment Failed / Succeeded) ────────────────────────────

  /**
   * @method handlePaymentFailed
   * @description Handles failed payment webhook. Upserts Invoice, transitions
   *   subscription to PAST_DUE, sends dunning email. On 3rd attempt, cancels.
   * @param data - Raw webhook event data
   * @param gatewayCustomerId - Gateway customer ID to look up account
   */
  async handlePaymentFailed(
    data: Record<string, unknown>,
    gatewayCustomerId: string
  ): Promise<Result<void, SwitchError>> {
    try {
      const account = await this.prisma.account.findFirst({
        where: { gatewayCustomerId },
        select: { id: true, name: true, email: true },
      });
      if (!account) return err("ACCOUNT_NOT_FOUND");

      const invoiceId = String(data.id ?? data.invoice_id ?? "");
      const attemptCount = Number(data.attempt_count ?? data.payment_attempt_number ?? 1);
      const amountDue = Number(data.amount_due ?? data.amount ?? 0) / 100;
      const currency = String(data.currency ?? "usd").toUpperCase();
      const periodStart = data.period_start
        ? new Date(Number(data.period_start) * 1000)
        : new Date();
      const periodEnd = data.period_end ? new Date(Number(data.period_end) * 1000) : new Date();
      const gatewayProvider = String(data.subscription_id ?? "").startsWith("sub_")
        ? "STRIPE"
        : "PADDLE";

      if (!invoiceId) return err("DATABASE_ERROR");

      // Upsert Invoice (idempotent by gatewayInvoiceId)
      await this.prisma.invoice.upsert({
        where: { gatewayInvoiceId: invoiceId },
        create: {
          accountId: account.id,
          gatewayProvider: gatewayProvider as "STRIPE" | "PADDLE",
          gatewayInvoiceId: invoiceId,
          status: "PAYMENT_FAILED",
          amountDue,
          currency,
          periodStart,
          periodEnd,
          attemptCount,
        },
        update: { status: "PAYMENT_FAILED", attemptCount },
      });

      const sub = await this.prisma.accountSubscription.findFirst({
        where: { accountId: account.id },
      });

      if (attemptCount >= 3) {
        // Final attempt — cancel subscription
        if (sub) {
          await this.prisma.accountSubscription.update({
            where: { id: sub.id },
            data: { status: "CANCELED" },
          });
        }
      } else if (sub && sub.status !== "PAST_DUE") {
        await this.prisma.accountSubscription.update({
          where: { id: sub.id },
          data: { status: "PAST_DUE" },
        });
      }

      // Send dunning email
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
   * @param data - Raw webhook event data
   * @param gatewayCustomerId - Gateway customer ID
   */
  async handlePaymentSucceeded(
    data: Record<string, unknown>,
    gatewayCustomerId: string
  ): Promise<Result<void, SwitchError>> {
    try {
      const account = await this.prisma.account.findFirst({
        where: { gatewayCustomerId },
        select: { id: true },
      });
      if (!account) return err("ACCOUNT_NOT_FOUND");

      const invoiceId = String(data.id ?? data.invoice_id ?? "");
      const amountPaid = Number(data.amount_paid ?? data.amount ?? 0) / 100;
      const currency = String(data.currency ?? "usd").toUpperCase();
      const periodStart = data.period_start
        ? new Date(Number(data.period_start) * 1000)
        : new Date();
      const periodEnd = data.period_end ? new Date(Number(data.period_end) * 1000) : new Date();
      const hostedUrl = data.hosted_invoice_url ? String(data.hosted_invoice_url) : null;
      const pdfUrl = data.invoice_pdf ? String(data.invoice_pdf) : null;
      const gatewayProvider = String(data.subscription_id ?? "").startsWith("sub_")
        ? "STRIPE"
        : "PADDLE";

      if (!invoiceId) return err("DATABASE_ERROR");

      await this.prisma.invoice.upsert({
        where: { gatewayInvoiceId: invoiceId },
        create: {
          accountId: account.id,
          gatewayProvider: gatewayProvider as "STRIPE" | "PADDLE",
          gatewayInvoiceId: invoiceId,
          status: "PAID",
          amountDue: amountPaid,
          amountPaid,
          currency,
          periodStart,
          periodEnd,
          paidAt: new Date(),
          ...(hostedUrl && { hostedUrl }),
          ...(pdfUrl && { pdfUrl }),
        },
        update: {
          status: "PAID",
          amountPaid,
          paidAt: new Date(),
          ...(hostedUrl && { hostedUrl }),
          ...(pdfUrl && { pdfUrl }),
        },
      });

      // Recover PAST_DUE → ACTIVE
      const sub = await this.prisma.accountSubscription.findFirst({
        where: { accountId: account.id, status: "PAST_DUE" },
      });
      if (sub) {
        await this.prisma.accountSubscription.update({
          where: { id: sub.id },
          data: { status: "ACTIVE" },
        });
        logger.info({ accountId: account.id }, "Subscription recovered from PAST_DUE");
      }

      return ok(undefined);
    } catch (error) {
      logger.error({ err: error, gatewayCustomerId }, "Failed to handle payment succeeded");
      return err("DATABASE_ERROR");
    }
  }
}
