/**
 * @file ChannelRepository.ts
 * @description Prisma-backed repository for Channel entities — retrieves channels by ids and
 *              maps Prisma rows to the domain Channel shape. Channel credentials are stored
 *              as an encrypted envelope; the caller injects a `decryptCredentials` callback
 *              so this package stays free of any specific crypto-service implementation.
 * @layer infrastructure
 */
import { ok, err, type Result } from "@shared/types";
import type { Channel } from "@ports/core";
import type { PrismaClient } from "@infra/prisma";
import { mapProviderFromDB } from "./mappers.js";
import { createLogger } from "@observability/logger";

const logger = createLogger("adapter:db-prisma:channel");

/**
 * Shape of the encrypted credentials envelope persisted on the Channel row.
 * Mirrors the four columns added by the Channel.credentials encryption migration.
 */
export interface EncryptedChannelCredentialsEnvelope {
  credentialsCiphertext: string;
  credentialsIv: string;
  credentialsAuthTag: string;
  credentialsKeyVersion: number;
}

export interface CreateChannelRepositoryOptions {
  /**
   * Decryption callback supplied by the application composition root. It must
   * unwrap the persisted envelope into the plaintext credentials object that
   * provider adapters consume. When omitted (e.g. tests that do not exercise
   * credentials), `getChannelsByIds` returns an empty credentials object.
   */
  decryptCredentials?: (envelope: EncryptedChannelCredentialsEnvelope) => Record<string, unknown>;
}

export function createChannelRepository(
  options: CreateChannelRepositoryOptions = {},
  prisma: PrismaClient
) {
  const { decryptCredentials } = options;
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
          credentials: decryptCredentials
            ? decryptCredentials({
                credentialsCiphertext: ch.credentialsCiphertext,
                credentialsIv: ch.credentialsIv,
                credentialsAuthTag: ch.credentialsAuthTag,
                credentialsKeyVersion: ch.credentialsKeyVersion,
              })
            : {},
        }));

        return ok(mapped);
      } catch (error) {
        logger.error({ err: error }, "getChannelsByIds error");
        return err("DATABASE_ERROR");
      }
    },
  };
}
