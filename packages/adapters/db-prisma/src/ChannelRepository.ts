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
import { setTenantGuc, SYSTEM_TENANT_SCOPE } from "@infra/prisma/extensions/tenantGuc.js";
import { mapProviderFromDB } from "./mappers.js";
import { createLogger } from "@observability/logger";

const logger = createLogger("adapter:db-prisma:channel");

/**
 * @function isUsableId
 * @description True when an identifier is a non-empty string. Worker callers
 *              cast unvalidated BullMQ JSON, and Prisma silently DROPS an
 *              `undefined` from a `where` clause — so `{ accountId: undefined }`
 *              would widen a tenant-scoped query to every tenant. This runtime
 *              guard is what TypeScript cannot enforce across that boundary.
 * @param value - Candidate identifier from an untyped job payload.
 * @returns Whether the value is safe to use as a query predicate.
 */
function isUsableId(value: string): boolean {
  return typeof value === "string" && value.length > 0;
}

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
      if (!isUsableId(accountId)) {
        logger.error("getChannelsByIds called without a tenant scope");
        return err("DATABASE_ERROR");
      }
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
      if (!isUsableId(channelId)) {
        // A malformed job can never resolve an owner, so this is terminal (no
        // owner) rather than a transient DB fault the caller should retry.
        logger.error("getChannelOwnerAccountId called without a channelId");
        return ok(null);
      }
      try {
        // Bound under the SYSTEM scope, not a tenant scope: this lookup exists
        // to DISCOVER the tenant, so it has none to bind yet — and under a
        // hardened NOBYPASSRLS role an unbound GUC makes the policy hide every
        // row, which would fail every legacy job. Safe because it is a
        // primary-key ownership lookup that selects the `accountId` column ONLY
        // — never the encrypted credential envelope — so it cannot leak
        // plaintext across tenants.
        const row = await prisma.$transaction(async (tx) => {
          await setTenantGuc(tx, SYSTEM_TENANT_SCOPE);
          return tx.channel.findUnique({
            where: { id: channelId },
            select: { accountId: true },
          });
        });
        return ok(row?.accountId ?? null);
      } catch (error) {
        logger.error({ err: error }, "getChannelOwnerAccountId error");
        return err("DATABASE_ERROR");
      }
    },
  };
}
