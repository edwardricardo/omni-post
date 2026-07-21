/**
 * @file GatewaySwitchEventRepository.ts
 * @description Persistence port for the `GatewaySwitchEvent` aggregate
 *   (one row per Stripe ↔ Paddle migration request). Used by
 *   `GatewayBillingService` to drive the switch lifecycle:
 *   scheduled → pending-checkout → completed | suspended | cancelled.
 *
 *   Port-level error type is a string union (canon for @core/domain
 *   repository ports — see `PlatformCredentialRepository`).
 * @layer domain
 */

import { type Result } from "@shared/types";
import type { AccountGatewayProvider } from "./AccountBillingRepository.js";

/** Mirrors `enum SwitchStatus` in the Prisma schema. */
export type SwitchStatus =
  "SCHEDULED" | "PENDING_CHECKOUT" | "COMPLETED" | "CANCELLED" | "SUSPENDED" | "EXPIRED";

/** Failure modes for switch-event reads + writes. */
export type SwitchEventStoreError = "NOT_FOUND" | "DATABASE_ERROR";

/** Core projection used inside the service (no joins). */
export interface GatewaySwitchEventFields {
  id: string;
  accountId: string;
  fromGateway: AccountGatewayProvider;
  toGateway: AccountGatewayProvider;
  scheduledFor: Date;
  extendedUntil: Date | null;
  extendedBy: string | null;
  status: SwitchStatus;
  completedAt: Date | null;
  cancelledAt: Date | null;
  suspendedAt: Date | null;
  reminderSentAt: Date | null;
  createdAt: Date;
}

/** Joined projection used by admin list/detail endpoints. */
export interface GatewaySwitchEventWithAccount extends GatewaySwitchEventFields {
  account: {
    id: string;
    name: string;
    email: string | null;
  };
}

/** Filter shape accepted by `listWithAccount`. */
export interface SwitchEventListFilters {
  status?: SwitchStatus;
  page: number;
  limit: number;
}

/** Counts surface populated alongside the page result. */
export interface SwitchEventCounts {
  total: number;
  scheduled: number;
  pendingCheckout: number;
  suspended: number;
  completed30d: number;
}

export interface SwitchEventCreate {
  accountId: string;
  fromGateway: AccountGatewayProvider;
  toGateway: AccountGatewayProvider;
  scheduledFor: Date;
  status: SwitchStatus;
}

export interface SwitchEventUpdate {
  status?: SwitchStatus;
  completedAt?: Date | null;
  cancelledAt?: Date | null;
  suspendedAt?: Date | null;
  extendedUntil?: Date | null;
  extendedBy?: string | null;
  reminderSentAt?: Date | null;
}

export interface GatewaySwitchEventRepository {
  create(
    input: SwitchEventCreate
  ): Promise<Result<GatewaySwitchEventFields, SwitchEventStoreError>>;

  findById(id: string): Promise<Result<GatewaySwitchEventFields | null, SwitchEventStoreError>>;

  /**
   * Return the most recently created event for the account whose status
   * is one of `statusIn` (and equals `status` when only one is provided).
   */
  findLatestByAccountAndStatus(
    accountId: string,
    statusIn: readonly SwitchStatus[]
  ): Promise<Result<GatewaySwitchEventFields | null, SwitchEventStoreError>>;

  update(id: string, fields: SwitchEventUpdate): Promise<Result<void, SwitchEventStoreError>>;

  /**
   * Paginated list with account join + counts (admin dashboard).
   */
  listWithAccount(
    filters: SwitchEventListFilters
  ): Promise<
    Result<
      { events: GatewaySwitchEventWithAccount[]; counts: SwitchEventCounts },
      SwitchEventStoreError
    >
  >;

  findByIdWithAccount(
    id: string
  ): Promise<Result<GatewaySwitchEventWithAccount | null, SwitchEventStoreError>>;
}
