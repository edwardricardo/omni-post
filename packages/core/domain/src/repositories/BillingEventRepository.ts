/**
 * @file BillingEventRepository.ts
 * @description Persistence port for the `BillingEvent` idempotency log
 *   (one row per inbound webhook from Stripe/Paddle). Used by
 *   `GatewayBillingService` to dedupe concurrent webhook deliveries.
 *
 *   Port-level error type is a string union (canon for @core/domain
 *   repository ports).
 * @layer domain
 */

import { type Result } from "@shared/types";
import type { AccountGatewayProvider } from "./AccountBillingRepository.js";

export type BillingEventStoreError = "DATABASE_ERROR";

/** Lightweight projection used by the idempotency check. */
export interface BillingEventStatusRow {
  id: string;
  processed: boolean;
}

/** Input shape for the upsert when a new event is seen. */
export interface BillingEventUpsert {
  gatewayEventId: string;
  gatewayProvider: AccountGatewayProvider;
  /** Domain event type (e.g. "payment_failed"). */
  eventType: string;
  /** Raw provider event type for traceability. */
  rawEventType: string;
  payload: object;
}

export interface BillingEventRepository {
  /**
   * Look up an event by its provider id. Returns `null` when the event
   * has not been seen before.
   */
  findByGatewayEventId(
    gatewayEventId: string
  ): Promise<Result<BillingEventStatusRow | null, BillingEventStoreError>>;

  /**
   * Insert a new event row (or no-op if the unique `gatewayEventId` already
   * exists). Returns the upserted row's `id`.
   */
  upsertNew(input: BillingEventUpsert): Promise<Result<{ id: string }, BillingEventStoreError>>;

  markProcessed(id: string): Promise<Result<void, BillingEventStoreError>>;

  markError(id: string, error: string): Promise<Result<void, BillingEventStoreError>>;
}
