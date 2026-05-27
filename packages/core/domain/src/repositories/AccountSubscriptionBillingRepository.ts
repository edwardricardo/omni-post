/**
 * @file AccountSubscriptionBillingRepository.ts
 * @description Read/write port over the billing-specific operations on the
 *   `AccountSubscription` row (status transitions, gateway routing, dunning).
 *   Carved out so `GatewayBillingService` can drive subscription state
 *   without coupling to Prisma. Sibling of `AccountBillingRepository`.
 *
 *   Port-level error type is a string union (canon for @core/domain
 *   repository ports — see `PlatformCredentialRepository`).
 * @layer domain
 */

import { type Result } from "@shared/types";
import type { AccountGatewayProvider } from "./AccountBillingRepository.js";

/** Mirrors `enum SubscriptionStatus` in the Prisma schema. */
export type SubscriptionBillingStatus =
  | "TRIALING"
  | "ACTIVE"
  | "PAST_DUE"
  | "CANCELED"
  | "GRANDFATHERED";

/** Failure modes for subscription billing reads + writes. */
export type SubscriptionBillingStoreError = "DATABASE_ERROR";

/**
 * Projection of the `AccountSubscription` row covering every column the
 * gateway-billing flow touches.
 */
export interface AccountSubscriptionBillingFields {
  id: string;
  accountId: string;
  status: SubscriptionBillingStatus;
  cancelAtPeriodEnd: boolean;
  currentPeriodEnd: Date | null;
  bundleId: string | null;
  gatewayProvider: AccountGatewayProvider;
  gatewaySubscriptionId: string | null;
  externalSubscriptionId: string | null;
  /** Social providers included in the subscription (drives token-budget multiplier). */
  providers: string[];
  /** Number of accounts the subscription covers (drives token-budget multiplier). */
  accountCount: number;
}

/**
 * Writable subset of the subscription billing fields. Each optional key,
 * when present, is written to the row; absent keys are left untouched.
 */
export interface AccountSubscriptionBillingUpdate {
  status?: SubscriptionBillingStatus;
  cancelAtPeriodEnd?: boolean;
  gatewayProvider?: AccountGatewayProvider;
  gatewaySubscriptionId?: string | null;
}

export interface AccountSubscriptionBillingRepository {
  /**
   * Return the first subscription with status ACTIVE or TRIALING for the
   * account, or `null` if none exists.
   */
  findActiveOrTrialingByAccount(
    accountId: string
  ): Promise<Result<AccountSubscriptionBillingFields | null, SubscriptionBillingStoreError>>;

  /**
   * Return the most recently created subscription for the account
   * (any status), or `null` if none exists.
   */
  findLatestByAccount(
    accountId: string
  ): Promise<Result<AccountSubscriptionBillingFields | null, SubscriptionBillingStoreError>>;

  /**
   * Return the first subscription with the given status for the account,
   * or `null` if none matches.
   */
  findByAccountAndStatus(
    accountId: string,
    status: SubscriptionBillingStatus
  ): Promise<Result<AccountSubscriptionBillingFields | null, SubscriptionBillingStoreError>>;

  /** Apply a partial update to a single subscription row. */
  update(
    subscriptionId: string,
    fields: AccountSubscriptionBillingUpdate
  ): Promise<Result<void, SubscriptionBillingStoreError>>;

  /**
   * Apply the same partial update to EVERY subscription belonging to
   * the account. Used by `forceComplete` / `forceSuspend` to converge
   * all rows onto the post-switch state.
   */
  updateAllForAccount(
    accountId: string,
    fields: AccountSubscriptionBillingUpdate
  ): Promise<Result<void, SubscriptionBillingStoreError>>;
}
