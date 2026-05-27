/**
 * @file InvoiceRepository.ts
 * @description Persistence port for the `Invoice` row written by inbound
 *   webhook handlers when a payment-failed / payment-succeeded event lands.
 *   Used by `GatewayBillingService.handlePaymentFailed` and
 *   `handlePaymentSucceeded` to materialise the invoice idempotently
 *   (by `gatewayInvoiceId`).
 *
 *   Port-level error type is a string union (canon for @core/domain
 *   repository ports).
 * @layer domain
 */

import { type Result } from "@shared/types";
import type { AccountGatewayProvider } from "./AccountBillingRepository.js";

export type InvoiceStoreError = "DATABASE_ERROR";

/** Mirrors the `InvoiceStatus` enum we actually write from GBS. */
export type InvoiceWriteStatus = "PAYMENT_FAILED" | "PAID";

/** Fields used at create-time on a brand-new invoice row. */
export interface InvoiceCreate {
  accountId: string;
  gatewayProvider: AccountGatewayProvider;
  gatewayInvoiceId: string;
  status: InvoiceWriteStatus;
  amountDue: number;
  amountPaid?: number;
  currency: string;
  periodStart: Date;
  periodEnd: Date;
  paidAt?: Date;
  hostedUrl?: string;
  pdfUrl?: string;
  attemptCount?: number;
}

/** Fields applied on the update branch of the upsert. */
export interface InvoiceUpdate {
  status?: InvoiceWriteStatus;
  amountPaid?: number;
  paidAt?: Date;
  hostedUrl?: string;
  pdfUrl?: string;
  attemptCount?: number;
}

export interface InvoiceRepository {
  /**
   * Upsert by `gatewayInvoiceId` (the unique column shared between
   * provider gateways). `create` runs when the row doesn't exist;
   * `update` runs when it does.
   */
  upsertByGatewayInvoiceId(
    gatewayInvoiceId: string,
    create: InvoiceCreate,
    update: InvoiceUpdate
  ): Promise<Result<void, InvoiceStoreError>>;
}
