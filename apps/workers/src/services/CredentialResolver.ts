/**
 * @file CredentialResolver.ts
 * @description Resolves a channel's provider credentials by looking up the
 *   persisted (encrypted) envelope from the channel repository, decrypting it,
 *   and returning the plaintext credentials object. The repository is supplied
 *   at construction time with the decryption function it needs, so this class
 *   stays free of crypto concerns. Provider adapters receive resolved
 *   credentials per-call rather than performing their own DB lookup.
 * @layer infrastructure
 */

import { ok, err, type Result } from "@shared/types";

/**
 * Minimal port the resolver consumes. Concrete implementations
 * (e.g. `createPrismaRepoAdapter` from `@adapters/db-prisma`) already satisfy
 * this contract by returning channels with the credentials field decrypted.
 */
export interface ChannelCredentialsRepository {
  getChannelsByIds(
    ids: string[]
  ): Promise<Result<Array<{ id: string; credentials: unknown }>, "DATABASE_ERROR">>;
}

/**
 * @class CredentialResolver
 * @description Orchestrates channel-credentials retrieval. Returns `err("AUTH")`
 *   for any failure path so callers can map uniformly to a HTTP 401 / publish
 *   AUTH error without leaking lookup details.
 */
export class CredentialResolver {
  constructor(private readonly repo: ChannelCredentialsRepository) {}

  /**
   * @method resolve
   * @description Resolve plaintext credentials for the given channel id.
   *   Returns `err("AUTH")` when the channel does not exist, the repository
   *   lookup fails, or the credentials field is empty.
   */
  async resolve(channelId: string): Promise<Result<unknown, "AUTH">> {
    try {
      const result = await this.repo.getChannelsByIds([channelId]);
      if (!result.ok) {
        return err("AUTH");
      }
      const channel = result.value[0];
      if (!channel || channel.credentials === undefined || channel.credentials === null) {
        return err("AUTH");
      }
      return ok(channel.credentials);
    } catch {
      return err("AUTH");
    }
  }
}
