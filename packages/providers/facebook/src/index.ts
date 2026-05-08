/**
 * @file index.ts
 * @description Facebook provider package barrel export. Composition root constructs
 *   the adapter via `createFacebookAdapter({ logger })`.
 * @layer infrastructure
 */

export {
  FacebookAdapter,
  createFacebookAdapter,
  type FacebookAdapterDeps,
  type FacebookApiClientFactory,
} from "./FacebookAdapter.js";
export { FacebookApiClient } from "./apiClient.js";
export type { FacebookCredentials } from "./apiClient.js";
