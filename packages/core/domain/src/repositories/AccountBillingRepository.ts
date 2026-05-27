/**
 * @file AccountBillingRepository.ts
 * @description Read/write port over the billing-specific columns of the
 *   `Account` row (gateway provider state, pending-switch state, external
 *   gateway customer ids, customer email for notifications). Carved out
 *   from the broader `AccountRepository` (which deals in the `Account`
 *   domain entity) so that `GatewayBillingService` can mutate gateway
 *   bookkeeping fields without coupling to Prisma or pulling in the full
 *   entity. The port deals in a small DTO projection that mirrors the
 *   columns GBS actually touches.
 *
 *   Port-level error type is a string union (canon for @core/domain
 *   repository ports — see `PlatformCredentialRepository`).
 * @layer domain
 */

import { type Result } from "@shared/types";

/** Storage gateway identifier as persisted on `Account.gatewayProvider`. */
export type AccountGatewayProvider = "STRIPE" | "PADDLE";

/** Failure modes for billing-field reads + writes. */
export type AccountBillingStoreError = "NOT_FOUND" | "DATABASE_ERROR";

/**
 * Projection of the `Account` row covering every column the gateway-billing
 * flow reads. Returned by `findById` / `findByExternalCustomerId`.
 */
export interface AccountBillingFields {
  id: string;
  email: string | null;
  gatewayProvider: AccountGatewayProvider;
  pendingGatewaySwitch: boolean | null;
  pendingGatewayProvider: AccountGatewayProvider | null;
  pendingSwitchScheduledFor: Date | null;
  pendingSwitchDeadline: Date | null;
  stripeCustomerId: string | null;
  paddleCustomerId: string | null;
  status: string;
}

/**
 * Writable subset of the billing fields. Each optional key, when present,
 * is written to the row; absent keys are left untouched. Setting a key to
 * `null` clears the column (only allowed where the schema permits it).
 */
export interface AccountBillingUpdate {
  gatewayProvider?: AccountGatewayProvider;
  pendingGatewaySwitch?: boolean;
  pendingGatewayProvider?: AccountGatewayProvider | null;
  pendingSwitchScheduledFor?: Date | null;
  pendingSwitchDeadline?: Date | null;
  stripeCustomerId?: string | null;
  paddleCustomerId?: string | null;
  status?: string;
}

export interface AccountBillingRepository {
  /**
   * Read the billing-field projection for a single account. Returns
   * `null` (success-case) when the row does not exist; reserve the
   * `NOT_FOUND` error for cases where a missing row is itself the
   * failure mode.
   */
  findById(
    accountId: string
  ): Promise<Result<AccountBillingFields | null, AccountBillingStoreError>>;

  /**
   * Look up an account by the external customer id stored on either the
   * Stripe or Paddle column. The implementation should match the gateway
   * to the column (`STRIPE` → `stripeCustomerId`, `PADDLE` → `paddleCustomerId`).
   */
  findByExternalCustomerId(
    gateway: AccountGatewayProvider,
    customerId: string
  ): Promise<Result<AccountBillingFields | null, AccountBillingStoreError>>;

  /**
   * Apply a partial update. `NOT_FOUND` if the row does not exist.
   */
  updateBillingFields(
    accountId: string,
    update: AccountBillingUpdate
  ): Promise<Result<void, AccountBillingStoreError>>;
}
