/**
 * @file PrismaBillingEventRepository.ts
 * @description Prisma adapter implementing `BillingEventRepository`.
 *   Persists `BillingEvent` rows for webhook idempotency.
 * @layer infrastructure
 */
import { ok, err, type Result } from "@shared/types";
import type { PrismaClient } from "@infra/prisma";
import type {
  BillingEventRepository,
  BillingEventStatusRow,
  BillingEventStoreError,
  BillingEventUpsert,
} from "@core/domain/repositories/BillingEventRepository.js";

export class PrismaBillingEventRepository implements BillingEventRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async findByGatewayEventId(
    gatewayEventId: string
  ): Promise<Result<BillingEventStatusRow | null, BillingEventStoreError>> {
    try {
      const row = await this.prisma.billingEvent.findUnique({
        where: { gatewayEventId },
        select: { id: true, processed: true },
      });
      return ok(row);
    } catch {
      return err("DATABASE_ERROR");
    }
  }

  async upsertNew(
    input: BillingEventUpsert
  ): Promise<Result<{ id: string }, BillingEventStoreError>> {
    try {
      const row = await this.prisma.billingEvent.upsert({
        where: { gatewayEventId: input.gatewayEventId },
        create: {
          gatewayEventId: input.gatewayEventId,
          gatewayProvider: input.gatewayProvider,
          eventType: input.eventType,
          rawEventType: input.rawEventType,
          payload: input.payload,
          processed: false,
        },
        update: {},
        select: { id: true },
      });
      return ok({ id: row.id });
    } catch {
      return err("DATABASE_ERROR");
    }
  }

  async markProcessed(id: string): Promise<Result<void, BillingEventStoreError>> {
    try {
      await this.prisma.billingEvent.update({
        where: { id },
        data: { processed: true, processedAt: new Date() },
      });
      return ok(undefined);
    } catch {
      return err("DATABASE_ERROR");
    }
  }

  async markError(id: string, error: string): Promise<Result<void, BillingEventStoreError>> {
    try {
      await this.prisma.billingEvent.update({
        where: { id },
        data: { error },
      });
      return ok(undefined);
    } catch {
      return err("DATABASE_ERROR");
    }
  }
}
