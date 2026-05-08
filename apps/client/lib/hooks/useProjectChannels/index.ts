/**
 * @file index.ts
 * @description Barrel for the project-scoped channels hook module — re-exports
 *              the public types, query hooks, and mutation hooks.
 * @layer infrastructure
 */

export type { ChannelProvider, ChannelStatus, ProjectChannel } from "./types";
export type { ConnectBlueskyInput, ConnectBlueskyResult } from "./api";
export { useProjectChannels } from "./queries";
export { useConnectBluesky, useDisconnectChannel, useSetPrimaryChannel } from "./mutations";
