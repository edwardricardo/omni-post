/**
 * @file index.ts
 * @description Public entry point for the TikTok provider — exports the class-based
 *              TikTokAdapter and its shared instance.
 * @layer infrastructure
 */

// Export class and instance
export { TikTokAdapter, tiktokAdapter } from "./TikTokAdapter.js";

// Default export
import { tiktokAdapter } from "./TikTokAdapter.js";
export default tiktokAdapter;
