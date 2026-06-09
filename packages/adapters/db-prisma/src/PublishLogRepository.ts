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
        };

        return ok(result);
      } catch (error) {
        logger.error({ err: error }, "getLogByDedupeKey error");
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
        }));

        return ok(mapped);
      } catch (error) {
        logger.error({ err: error }, "listLogs error");
        return err("DATABASE_ERROR");
      }
    },
  };
}
