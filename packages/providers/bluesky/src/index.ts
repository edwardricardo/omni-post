/**
 * @file index.ts
 * @description Bluesky provider package barrel export.
 * @layer infrastructure
 */

export { BlueskyAdapter, blueskyAdapter } from "./BlueskyAdapter.js";
export { BlueskyClient } from "./BlueskyClient.js";
export type { BlueskyCredentials, BlueskySession, BlueskyPostResult } from "./BlueskyClient.js";

export default blueskyAdapter;

import { blueskyAdapter } from "./BlueskyAdapter.js";
