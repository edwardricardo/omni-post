/**
 * @file CredentialResolver.ts
 * @description Resolves a channel's plaintext provider credentials by looking up
 *   the persisted (encrypted) envelope from the channel repository, decrypting
 *   it (the repository is supplied with a decryption fn at construction time),
 *   and returning the plaintext credentials object. Provider adapters receive
 *   resolved credentials per-call rather than performing their own DB lookup.
 * @layer infrastructure
 */

import { ok, err, type Result } from "@shared/types";

export interface ChannelCredentialsRepository {
  getChannelsByIds(
    ids: string[]
  ): Promise<Result<Array<{ id: string; credentials: unknown }>, "DATABASE_ERROR">>;
}

export class CredentialResolver {
  constructor(private readonly repo: ChannelCredentialsRepository) {}

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
