/**
 * @file BillingService.ts
 * @description Service for billing events, change type detection, and billing calculations.
 *   Uses price comparison instead of legacy tier hierarchy.
 * @layer application
 */

import { AuditableService } from "../../services/AuditableService.js";
import type { BillingEvent } from "./types.js";
import { createLogger } from "../../lib/logger.js";

const log = createLogger("billing");

export type ChangeType = "UPGRADE" | "DOWNGRADE" | "LATERAL";

export class BillingService extends AuditableService {
  constructor() {
    super("BillingService");
  }

  /**
   * @method getChangeType
   * @description Determines whether a subscription change is an upgrade, downgrade, or lateral move by comparing prices or legacy tier strings.
   * @param from - Current price or tier name
   * @param to - Target price or tier name
   * @returns The change type: UPGRADE, DOWNGRADE, or LATERAL
   */
  getChangeType(from: number | string, to: number | string): ChangeType {
    if (typeof from === "string" && typeof to === "string") {
      // Legacy tier comparison — to be removed when all callers use prices
      const tierOrder: Record<string, number> = { BASIC: 1, PRO: 2, ENTERPRISE: 3 };
      const fromVal = tierOrder[from] ?? 0;
      const toVal = tierOrder[to] ?? 0;
      if (toVal > fromVal) return "UPGRADE";
      if (toVal < fromVal) return "DOWNGRADE";
      return "LATERAL";
    }
    const fromPrice = Number(from);
    const toPrice = Number(to);
    if (toPrice > fromPrice) return "UPGRADE";
    if (toPrice < fromPrice) return "DOWNGRADE";
    return "LATERAL";
  }

  /**
   * @method logBillingEvent
   * @description Persists a billing event with a generated ID and timestamp, and records an audit trail entry.
   * @param event - Billing event data excluding auto-generated id and timestamp
   * @returns void
   */
  async logBillingEvent(event: Omit<BillingEvent, "id" | "timestamp">): Promise<void> {
    const billingEvent: BillingEvent = {
      id: crypto.randomUUID(),
      timestamp: new Date(),
      ...event,
      currency: event.currency || "USD",
    };

    log.info({ billingEvent }, "Billing event logged");

    if (event.processedBy) {
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
   * @method calculateNextBillingDate
   * @description Calculates the next billing date by advancing one month or one year from the given date.
   * @param billingCycle - Whether billing is monthly or yearly
   * @param fromDate - Starting date for the calculation (defaults to now)
   * @returns The next billing date
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
   * @method calculateBillingAmount
   * @description Returns the applicable billing amount based on the selected billing cycle.
   * @param monthlyPrice - The plan's monthly price
   * @param yearlyPrice - The plan's yearly price
   * @param billingCycle - Whether billing is monthly or yearly
   * @returns The billing amount for the selected cycle
   */
  calculateBillingAmount(
    monthlyPrice: number,
    yearlyPrice: number,
    billingCycle: "monthly" | "yearly"
  ): number {
    return billingCycle === "yearly" ? yearlyPrice : monthlyPrice;
  }
}
