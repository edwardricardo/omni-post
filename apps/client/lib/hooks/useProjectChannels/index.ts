/**
 * @file index.ts
 * @description Barrel for the project-scoped channels hook module — re-exports
 *              the public types, query hooks, and mutation hooks.
 * @layer infrastructure
 */

export type { ChannelProvider, ChannelStatus, ProjectChannel } from "./types";
export { useProjectChannels } from "./queries";
export { useSetPrimaryChannel } from "./mutations";
