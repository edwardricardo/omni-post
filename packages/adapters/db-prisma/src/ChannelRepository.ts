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
import { setTenantGuc } from "@infra/prisma/extensions/tenantGuc.js";
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
    async getChannelsByIds(
      ids: string[],
      accountId: string
    ): Promise<Result<Channel[], "DATABASE_ERROR">> {
      try {
        // Bind the RLS GUC and scope the lookup by the caller's tenant in the
        // same transaction: the explicit `accountId` predicate is today's active
        // isolation (the worker role bypasses RLS), and `setTenantGuc` keeps the
        // path correct under a future NOBYPASSRLS role without a second change.
        const channels = await prisma.$transaction(async (tx) => {
          await setTenantGuc(tx, accountId);
          return tx.channel.findMany({
            where: { id: { in: ids }, accountId },
          });
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

    async getChannelOwnerAccountId(
      channelId: string
    ): Promise<Result<string | null, "DATABASE_ERROR">> {
      try {
        // Selects the tenant column ONLY — never the encrypted credential
        // envelope — so the deploy-compat fallback cannot leak plaintext.
        const row = await prisma.channel.findUnique({
          where: { id: channelId },
          select: { accountId: true },
        });
        return ok(row?.accountId ?? null);
      } catch (error) {
        logger.error({ err: error }, "getChannelOwnerAccountId error");
        return err("DATABASE_ERROR");
      }
    },
  };
}
