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

const EVENT_TYPE = "ChannelAuthFailed" as const;
const AGGREGATE_TYPE = "Channel" as const;

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
   */
  async record(channelId: string, provider: string, reason: string): Promise<void> {
    const detectedAt = new Date();
    await this.prisma.$transaction(async (tx) => {
      await tx.channel.update({
        where: { id: channelId },
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
  }
}
