/**
 * @file types.ts
 * @description Public types for the billing module — gateway switch flow,
 *              plan listings, and invoice history.
 * @layer infrastructure
 */

export type GatewayProvider = "stripe" | "paddle";

export type PendingSwitchStatus = "SCHEDULED" | "PENDING_CHECKOUT" | "COMPLETED" | "CANCELLED";

export interface PendingSwitch {
  id: string;
  toGateway: GatewayProvider;
  status: PendingSwitchStatus;
  scheduledFor: string;
  extendedUntil: string;
}

export interface GatewayStatusDto {
  gatewayProvider: GatewayProvider;
  pendingSwitch: PendingSwitch | null;
}

export interface InitiateGatewaySwitchResult {
  switchEventId: string;
  scheduledFor: string;
  fromGateway: GatewayProvider;
  toGateway: GatewayProvider;
}

export interface BillingPlan {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  providers: string[];
  pricePerAccountMonth: number;
  sortOrder: number;
}

export interface InvoiceDto {
  id: string;
  status: string;
  amountDue: number;
  amountPaid: number;
  currency: string;
  periodStart: string;
  periodEnd: string;
  paidAt: string | null;
  hostedUrl: string | null;
  pdfUrl: string | null;
  gatewayProvider: string;
  createdAt: string;
}

export interface InvoicesPage {
  invoices: InvoiceDto[];
  total: number;
  page: number;
  limit: number;
}
