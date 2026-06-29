/**
 * @file PublishLogRepository.ts
 * @description Prisma-backed repository for PublishLog entities — upserts by dedupe key,
 *              lists with filter criteria, and maps provider enums to/from DB form.
 * @layer infrastructure
 */
import { ok, err, type Result } from "@shared/types";
import type { PublishLog, LogPublishInput, ListLogsQuery } from "@ports/core";
import type { PrismaClient } from "@infra/prisma";
import { mapProviderFromDB, mapProviderToDB } from "./mappers.js";
import { createLogger } from "@observability/logger";

const logger = createLogger("adapter:db-prisma:publish-log");

export function createPublishLogRepository(prisma: PrismaClient) {
  return {
    async logPublish(input: LogPublishInput): Promise<Result<PublishLog, "DATABASE_ERROR">> {
      try {
        const log = await prisma.publishLog.upsert({
          where: { dedupeKey: input.dedupeKey },
          update: {
            status: input.status,
            payload: JSON.parse(JSON.stringify(input.payload)),
          },
          create: {
            postId: input.postId,
            provider: mapProviderToDB(input.provider),
            channelId: input.channelId,
            status: input.status,
            payload: JSON.parse(JSON.stringify(input.payload)),
            dedupeKey: input.dedupeKey,
          },
        });

        const result: PublishLog = {
          id: log.id,
          postId: log.postId,
          provider: mapProviderFromDB(log.provider),
          channelId: log.channelId,
          status: log.status as "QUEUED" | "RUNNING" | "OK" | "ERR",
          payload: log.payload as Record<string, unknown>,
          dedupeKey: log.dedupeKey,
          createdAt: log.createdAt,
          providerPostId: log.providerPostId,
        };

        return ok(result);
      } catch (error) {
        logger.error({ err: error }, "logPublish error");
        return err("DATABASE_ERROR");
      }
    },

    async getLogByDedupeKey(
      dedupeKey: string
    ): Promise<Result<PublishLog | null, "DATABASE_ERROR">> {
      try {
        const log = await prisma.publishLog.findUnique({
          where: { dedupeKey },
        });

        if (!log) {
          return ok(null);
        }

        const result: PublishLog = {
          id: log.id,
          postId: log.postId,
          provider: mapProviderFromDB(log.provider),
          channelId: log.channelId,
          status: log.status as "QUEUED" | "RUNNING" | "OK" | "ERR",
          payload: log.payload as Record<string, unknown>,
          dedupeKey: log.dedupeKey,
          createdAt: log.createdAt,
          providerPostId: log.providerPostId,
        };

        return ok(result);
      } catch (error) {
        logger.error({ err: error }, "getLogByDedupeKey error");
        return err("DATABASE_ERROR");
      }
    },

    /**
     * @method recordReceipt
     * @description Persist the provider's post id on the existing publish-log row
     *              (keyed by the deterministic `dedupeKey`) immediately after a
     *              successful provider publish, BEFORE the OK log commits — so a
     *              crash-then-retry in the provider-success -> OK-commit window
     *              confirms the durable receipt instead of re-publishing.
     *              Honest residual: the provider's own commit and this DB write
     *              are NOT atomic. Without provider-native idempotency keys this
     *              NARROWS the double-post window, it does not eliminate it
     *              (at-least-once with a tighter window, not exactly-once).
     *              Typed Prisma `update` (no raw query — fitness #23 safe);
     *              `publishLog` is transitively tenant-scoped via its FK chain,
     *              identical posture to `logPublish`.
     * @param dedupeKey - Deterministic idempotency key identifying the log row.
     * @param providerPostId - The provider's post id from the publish receipt.
     * @returns ok(void) on success, err("DATABASE_ERROR") on failure.
     */
    async recordReceipt(
      dedupeKey: string,
      providerPostId: string
    ): Promise<Result<void, "DATABASE_ERROR">> {
      try {
        await prisma.publishLog.update({
          where: { dedupeKey },
          data: { providerPostId },
        });
        return ok(undefined);
      } catch (error) {
        logger.error({ err: error }, "recordReceipt error");
        return err("DATABASE_ERROR");
      }
    },

    async listLogs(query: ListLogsQuery): Promise<Result<PublishLog[], "DATABASE_ERROR">> {
      try {
        const where: Record<string, unknown> = {};

        if (query.postId) where.postId = query.postId;
        if (query.channelId) where.channelId = query.channelId;
        if (query.provider) where.provider = mapProviderToDB(query.provider);
        if (query.status) where.status = query.status;

        const logs = await prisma.publishLog.findMany({
          where,
          orderBy: { createdAt: "desc" },
          take: query.limit ?? 50,
          skip: query.offset ?? 0,
        });

        const mapped = logs.map((log) => ({
          id: log.id,
          postId: log.postId,
          provider: mapProviderFromDB(log.provider),
          channelId: log.channelId,
          status: log.status as "QUEUED" | "RUNNING" | "OK" | "ERR",
          payload: log.payload as Record<string, unknown>,
          dedupeKey: log.dedupeKey,
          createdAt: log.createdAt,
          providerPostId: log.providerPostId,
        }));

        return ok(mapped);
      } catch (error) {
        logger.error({ err: error }, "listLogs error");
        return err("DATABASE_ERROR");
      }
    },
  };
}
