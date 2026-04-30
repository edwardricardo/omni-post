/**
 * @file channelCredentialsRepository.ts
 * @description Port abstracting how `AbstractProviderAdapter` reads channel
 *              credentials from persistence. The concrete implementation is
 *              wired by the application entry points (workers / api), keeping
 *              the providers package itself free of any persistence import.
 * @layer infrastructure
 */

import { err, ok, type Result } from "@shared/types";

/**
 * Minimal contract a credential repository must satisfy. Only the bulk lookup
 * is needed because the original implementation already used the bulk method
 * (`getChannelsByIds([channelId])`), so the surface stays narrow.
 */
export interface ChannelCredentialsRepository {
  /**
   * @method getChannelsByIds
   * @description Resolve the persisted credentials JSON for one or more channels.
   *   Returns the raw JSON blob — adapter-specific parsing happens in the
   *   provider's `validateCredentialStructure`. Errors collapse into the
   *   `DATABASE_ERROR` discriminant; the caller maps that to `"AUTH"`.
   */
  getChannelsByIds(
    ids: string[]
  ): Promise<Result<Array<{ id: string; credentials: unknown }>, "DATABASE_ERROR">>;
}

let injectedRepo: ChannelCredentialsRepository | null = null;

/**
 * @method setChannelCredentialsRepository
 * @description App-startup hook used by `apps/workers/src/*Worker.ts` and
 *   `apps/api/src/index.ts` to wire the Prisma-backed adapter. Calling it more
 *   than once replaces the previous value (last-write-wins is intentional —
 *   tests reset it between runs). Leaving it unset disables DB credential
 *   lookup; providers then fall back to `getCredentialsFromEnvironment()`.
 */
export function setChannelCredentialsRepository(repo: ChannelCredentialsRepository | null): void {
  injectedRepo = repo;
}

/**
 * @method resolveChannelCredentials
 * @description Internal helper used by `AbstractProviderAdapter`. Returns the
 *   raw credentials blob for the given channel id, or an error if no repo is
 *   wired, the channel does not exist, or the lookup itself fails. The error
 *   discriminant is always `"AUTH"` so callers can fall through to env-based
 *   credentials uniformly.
 */
export async function resolveChannelCredentials(
  channelId: string
): Promise<Result<unknown, "AUTH">> {
  if (!injectedRepo) {
    return err("AUTH");
  }
  try {
    const result = await injectedRepo.getChannelsByIds([channelId]);
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
