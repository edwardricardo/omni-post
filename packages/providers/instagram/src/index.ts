/**
 * @file index.ts
 * @description Instagram provider package barrel export. Composition root
 *   constructs the adapter via `createInstagramAdapter({ logger })`. Lower-level
 *   building blocks (API client, media processor) are also exported for the
 *   worker entry point in `apps/workers/`.
 * @layer infrastructure
 */

export {
  InstagramAdapter,
  createInstagramAdapter,
  type InstagramAdapterDeps,
  type InstagramApiClientFactory,
} from "./InstagramAdapter.js";

export { InstagramApiClient } from "./apiClient.js";
export type { InstagramCredentials } from "./apiClient.js";
export { InstagramMediaProcessor } from "./mediaProcessor.js";
