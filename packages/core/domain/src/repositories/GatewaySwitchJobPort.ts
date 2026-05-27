/**
 * @file GatewaySwitchJobPort.ts
 * @description Port abstracting the BullMQ-backed job scheduler that drives
 *   the gateway-switch lifecycle (reminder emails, suspend deadlines,
 *   checkout-window timers). Lets `GatewayBillingService` orchestrate
 *   scheduled side-effects without coupling to BullMQ or Redis.
 *
 *   The concrete adapter (`GatewaySwitchJobService`) wraps BullMQ
 *   `Queue` and lives in `apps/api/src/billing/`.
 * @layer domain
 */

export interface GatewaySwitchJobPort {
  /**
   * Schedule the 48-hour pending-checkout window for the given switch:
   * a reminder email at T+24h plus an automatic suspend job at T+48h.
   */
  startCheckoutWindow(accountId: string, switchEventId: string): Promise<void>;

  /**
   * Cancel any pending reminder/suspend jobs scoped to the account.
   * Idempotent.
   */
  cancelJobs(accountId: string): Promise<void>;

  /**
   * Re-schedule the suspend job to the new deadline (e.g. after an admin
   * grants an extension). Idempotent.
   */
  rescheduleJobs(accountId: string, newDeadline: Date): Promise<void>;
}
