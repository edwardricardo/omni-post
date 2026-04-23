/**
 * @file ChannelRepository.ts
 * @description Prisma-backed repository for Channel entities — retrieves channels by ids and
 *              maps Prisma rows to the domain Channel shape.
 * @layer infrastructure
 */
import { ok, err, type Result } from "@shared/types";
import type { Channel } from "@ports/core";
import { prisma } from "@infra/prisma";
import { mapProviderFromDB } from "./mappers.js";
import { createLogger } from "@observability/logger";

const logger = createLogger("adapter:db-prisma:channel");

export function createChannelRepository() {
  return {
    async getChannelsByIds(ids: string[]): Promise<Result<Channel[], "DATABASE_ERROR">> {
      try {
        const channels = await prisma.channel.findMany({
          where: { id: { in: ids } },
        });

        const mapped = channels.map((ch) => ({
          id: ch.id,
          projectId: ch.projectId,
          provider: mapProviderFromDB(ch.provider),
          handle: ch.handle,
          credentials: ch.credentials as Record<string, unknown>,
        }));

        return ok(mapped);
      } catch (error) {
        logger.error({ err: error }, "getChannelsByIds error");
        return err("DATABASE_ERROR");
      }
    },
  };
}
