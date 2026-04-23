/**
 * @file index.ts
 * @description Public entry point for the YouTube provider — exports the class-based
 *              YouTubeAdapter and its shared instance.
 * @layer infrastructure
 */

// Export class and instance
export { YouTubeAdapter, youtubeAdapter } from "./YouTubeAdapter.js";

// Default export
import { youtubeAdapter } from "./YouTubeAdapter.js";
export default youtubeAdapter;
