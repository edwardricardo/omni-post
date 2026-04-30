/**
 * @file index.ts
 * @description Public entry point for the Instagram provider — exports the
 *              class-based InstagramAdapter, the API client + media processor
 *              (consumed by the worker that lives in `apps/workers/`), and the
 *              shared adapter instance.
 * @layer infrastructure
 */

// Export class and instance
export { InstagramAdapter, instagramAdapter } from "./InstagramAdapter.js";

// Lower-level building blocks reused by the worker entry point in apps/workers
export { InstagramApiClient } from "./apiClient.js";
export type { InstagramCredentials } from "./apiClient.js";
export { InstagramMediaProcessor } from "./mediaProcessor.js";

// Default export
import { instagramAdapter } from "./InstagramAdapter.js";
export default instagramAdapter;
