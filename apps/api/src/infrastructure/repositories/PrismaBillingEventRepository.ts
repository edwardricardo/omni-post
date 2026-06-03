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

  /**
   * @method markProcessed
   * @description Atomic compare-and-swap: sets processed=true only if the
   *   row currently has processed=false. Returns `{ claimed: true }` if this
   *   call was the first to flip the flag (caller should run the side-effect
   *   handler). Returns `{ claimed: false }` if another concurrent webhook
   *   delivery already claimed the event (caller MUST skip the handler to
   *   avoid double side-effects, e.g. double-charge).
   *
   *   Trade-off: if the handler crashes after a successful claim, retry
   *   is not possible without manual intervention because processed=true
   *   blocks reentry. A lease-based pattern (claimedAt with TTL) would
   *   permit retry but requires a schema migration. Accepted limitation.
   */
  async markProcessed(id: string): Promise<Result<{ claimed: boolean }, BillingEventStoreError>> {
    try {
      const result = await this.prisma.billingEvent.updateMany({
        where: { id, processed: false },
        data: { processed: true, processedAt: new Date() },
      });
      return ok({ claimed: result.count > 0 });
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
