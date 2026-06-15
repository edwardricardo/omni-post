/**
 * @file index.ts
 * @description Barrel for the project-scoped channels hook module — re-exports
 *              the public types, query hooks, and mutation hooks.
 * @layer infrastructure
 */

export type { ChannelProvider, ChannelStatus, ProjectChannel } from "./types.js";
export type { ConnectBlueskyInput, ConnectBlueskyResult } from "./api.js";
export { useProjectChannels } from "./queries.js";
export { useConnectBluesky, useDisconnectChannel, useSetPrimaryChannel } from "./mutations.js";
