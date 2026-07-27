/**
 * @file ChannelAuthFailureRecorder.ts
 * @description Service that records a channel's auth-failure state in the
 *              database **and** emits a `ChannelAuthFailed` event via the
 *              outbox — both within a single Prisma transaction so the
 *              event cannot escape without the state change persisting (and
 *              vice versa). Constructible directly from worker entry points
 *              (no DI container needed); workers import this directly.
 *
 *              The OutboxEvent row shape is the contract between this
 *              recorder and `OutboxRelay`/`PrismaOutboxWriter` in apps/api;
 *              both produce rows with `eventType`, `aggregateId`,
 *              `aggregateType`, `payload` (JSONB), `version`, `occurredAt`.
 *              Downstream consumers route by `eventType === "ChannelAuthFailed"`.
 * @layer infrastructure
 */

import { randomUUID } from "node:crypto";
import type { PrismaClient, Prisma } from "@infra/prisma";
import { setTenantGuc } from "@infra/prisma/extensions/tenantGuc.js";

const EVENT_TYPE = "ChannelAuthFailed" as const;
const AGGREGATE_TYPE = "Channel" as const;

/**
 * @function isRecordNotFound
 * @description True when a Prisma error signals "record not found for an
 *              update" (P2025) — the failure a tenant-scoped
 *              `where: { id, accountId }` produces for a channel owned by
 *              another tenant. Duck-typed on `.code` so it holds for both the
 *              real `PrismaClientKnownRequestError` and test doubles.
 * @param error - The caught error to classify.
 * @returns Whether the error is a P2025 not-found.
 */
function isRecordNotFound(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "P2025"
  );
}

export interface ChannelAuthFailureRecorderOptions {
  prisma: PrismaClient;
}

export class ChannelAuthFailureRecorder {
  private readonly prisma: PrismaClient;

  constructor(options: ChannelAuthFailureRecorderOptions) {
    this.prisma = options.prisma;
  }

  /**
   * @method record
   * @description Mark `channelId` as needing reauth and emit a
   *              `ChannelAuthFailed` event to the outbox. Idempotent at the
   *              observable level — calling twice with the same channelId
   *              refreshes `authFailedAt`/`authFailureReason` and emits a
   *              second event (downstream handlers should treat repeated
   *              events as state refreshes, not new failures).
   * @param channelId - Channel whose auth has failed.
   * @param provider - Provider key for the failing channel.
   * @param reason - Human-readable failure reason for the audit trail.
   * @param accountId - Tenant that owns the channel. The update is scoped by
   *                    `{ id, accountId }`; a foreign tenant matches no row
   *                    (P2025) and the call is a no-op.
   */
  async record(
    channelId: string,
    provider: string,
    reason: string,
    accountId: string
  ): Promise<void> {
    const detectedAt = new Date();
    try {
      await this.prisma.$transaction(async (tx) => {
        // Bind the RLS GUC first, then scope the update by { id, accountId } so
        // a caller in the wrong tenant flips no flag and emits no event (D3/D9,
        // 404-equivalent semantics via P2025).
        await setTenantGuc(tx, accountId);
        await tx.channel.update({
          where: { id: channelId, accountId },
          data: {
            needsReauth: true,
            authFailedAt: detectedAt,
            authFailureReason: reason,
          },
        });
        await tx.outboxEvent.create({
          data: {
            id: randomUUID(),
            eventType: EVENT_TYPE,
            aggregateId: channelId,
            aggregateType: AGGREGATE_TYPE,
            payload: {
              channelId,
              provider,
              reason,
              detectedAt: detectedAt.toISOString(),
            } as Prisma.InputJsonValue,
            version: 1,
            occurredAt: detectedAt,
          },
        });
      });
    } catch (error) {
      // Foreign-scope update matched no row: swallow as a no-op. Any other
      // failure (real DB error, transaction rollback) still propagates.
      if (isRecordNotFound(error)) {
        return;
      }
      throw error;
    }
  }
}
