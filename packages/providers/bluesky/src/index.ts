/**
 * @file index.ts
 * @description Bluesky provider package barrel export. Composition root constructs
 *   the adapter via `createBlueskyAdapter({ logger })`.
 * @layer infrastructure
 */

export {
  BlueskyAdapter,
  createBlueskyAdapter,
  type BlueskyAdapterDeps,
  type BlueskyClientFactory,
  type BlueskyProviderCredentials,
} from "./BlueskyAdapter.js";
export { BlueskyClient } from "./BlueskyClient.js";
export type { BlueskyCredentials, BlueskySession, BlueskyPostResult } from "./BlueskyClient.js";
