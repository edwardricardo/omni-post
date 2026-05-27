/**
 * @file PrismaInvoiceRepository.ts
 * @description Prisma adapter implementing `InvoiceRepository`. Used by
 *   `GatewayBillingService` to upsert invoice rows from inbound
 *   payment-failed / payment-succeeded webhooks.
 * @layer infrastructure
 */
import { ok, err, type Result } from "@shared/types";
import type { PrismaClient } from "@infra/prisma";
import type {
  InvoiceCreate,
  InvoiceRepository,
  InvoiceStoreError,
  InvoiceUpdate,
} from "@core/domain/repositories/InvoiceRepository.js";

export class PrismaInvoiceRepository implements InvoiceRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async upsertByGatewayInvoiceId(
    gatewayInvoiceId: string,
    create: InvoiceCreate,
    update: InvoiceUpdate
  ): Promise<Result<void, InvoiceStoreError>> {
    try {
      await this.prisma.invoice.upsert({
        where: { gatewayInvoiceId },
        create: {
          accountId: create.accountId,
          gatewayProvider: create.gatewayProvider,
          gatewayInvoiceId: create.gatewayInvoiceId,
          status: create.status,
          amountDue: create.amountDue,
          ...(create.amountPaid !== undefined && { amountPaid: create.amountPaid }),
          currency: create.currency,
          periodStart: create.periodStart,
          periodEnd: create.periodEnd,
          ...(create.paidAt !== undefined && { paidAt: create.paidAt }),
          ...(create.hostedUrl !== undefined && { hostedUrl: create.hostedUrl }),
          ...(create.pdfUrl !== undefined && { pdfUrl: create.pdfUrl }),
          ...(create.attemptCount !== undefined && { attemptCount: create.attemptCount }),
        },
        update: {
          ...(update.status !== undefined && { status: update.status }),
          ...(update.amountPaid !== undefined && { amountPaid: update.amountPaid }),
          ...(update.paidAt !== undefined && { paidAt: update.paidAt }),
          ...(update.hostedUrl !== undefined && { hostedUrl: update.hostedUrl }),
          ...(update.pdfUrl !== undefined && { pdfUrl: update.pdfUrl }),
          ...(update.attemptCount !== undefined && { attemptCount: update.attemptCount }),
        },
      });
      return ok(undefined);
    } catch {
      return err("DATABASE_ERROR");
    }
  }
}
