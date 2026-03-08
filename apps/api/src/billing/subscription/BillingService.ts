import type { SubscriptionTier } from "@shared/types";
import { AuditableService } from "../../services/AuditableService";
import type { BillingEvent } from "./types";
import { createLogger } from "../../lib/logger.js";

const log = createLogger("billing");

/**
 * Service responsible for billing events, invoices, and payment logic
 */
export class BillingService extends AuditableService {
  constructor() {
    super("BillingService");
  }

  /**
   * Get change type for billing events
   */
  getChangeType(fromTier: SubscriptionTier, toTier: SubscriptionTier): BillingEvent["type"] {
    const tierOrder = { BASIC: 1, PRO: 2, ENTERPRISE: 3 };
    return tierOrder[toTier] > tierOrder[fromTier] ? "UPGRADE" : "DOWNGRADE";
  }

  /**
   * Log billing event with audit trail
   */
  async logBillingEvent(event: Omit<BillingEvent, "id" | "timestamp">): Promise<void> {
    const billingEvent: BillingEvent = {
      id: crypto.randomUUID(),
      timestamp: new Date(),
      ...event,
      currency: event.currency || "USD",
    };

    // In a real implementation, this would be stored in a billing_events table
    log.info({ billingEvent }, "Billing event logged");

    // Use logAccountAction for billing events
    if (event.processedBy) {
      // Convert BillingEvent to plain object for details
      const eventDetails: Record<string, unknown> = {
        type: billingEvent.type,
        fromTier: billingEvent.fromTier,
        toTier: billingEvent.toTier,
        amount: billingEvent.amount,
        currency: billingEvent.currency,
        reason: billingEvent.reason,
        metadata: billingEvent.metadata,
      };

      await this.logAccountAction(event.processedBy, {
        accountId: event.accountId,
        action: `BILLING_${event.type}`,
        category: "ACCOUNT",
        severity: "MEDIUM",
        details: eventDetails,
      });
    }
  }

  /**
   * Calculate next billing date
   */
  calculateNextBillingDate(billingCycle: "monthly" | "yearly", fromDate: Date = new Date()): Date {
    const nextBilling = new Date(fromDate);

    if (billingCycle === "yearly") {
      nextBilling.setFullYear(nextBilling.getFullYear() + 1);
    } else {
      nextBilling.setMonth(nextBilling.getMonth() + 1);
    }

    return nextBilling;
  }

  /**
   * Calculate billing amount based on plan and cycle
   */
  calculateBillingAmount(
    monthlyPrice: number,
    yearlyPrice: number,
    billingCycle: "monthly" | "yearly"
  ): number {
    return billingCycle === "yearly" ? yearlyPrice : monthlyPrice;
  }
}

export const billingService = new BillingService();
