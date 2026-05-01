/**
 * @file handleProviderAuthError.ts
 * @description Shared helper used by sync workers when a provider returns
 *              an AUTH error from one of its calls. Records the failure
 *              (which flips `Channel.needsReauth` and emits a
 *              `ChannelAuthFailed` outbox event) and then throws so BullMQ
 *              marks the job as failed.
 *
 *              Exported so worker entry points stay thin and the AUTH path
 *              is unit-testable in isolation.
 * @layer infrastructure
 */

import type { ChannelAuthFailureRecorder } from "../services/ChannelAuthFailureRecorder.js";

/**
 * Record the auth failure and throw. Returns `never` — the throw is the
 * post-condition. Recorder errors propagate (deliberate: if we cannot
 * persist the state, surfacing the failure beats silent swallowing).
 */
export async function handleProviderAuthError(
  recorder: ChannelAuthFailureRecorder,
  channelId: string,
  provider: string,
  context: string
): Promise<never> {
  await recorder.record(channelId, provider, context);
  throw new Error(`AUTH error for channel ${channelId} (${provider}): ${context}`);
}
