/**
 * @file index.ts
 * @description Public entry point for the Instagram provider — exports the class-based
 *              InstagramAdapter and its shared instance.
 * @layer infrastructure
 */

// Export class and instance
export { InstagramAdapter, instagramAdapter } from "./InstagramAdapter.js";

// Default export
import { instagramAdapter } from "./InstagramAdapter.js";
export default instagramAdapter;
