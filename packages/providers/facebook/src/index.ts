/**
 * @file index.ts
 * @description Public entry point for the Facebook provider — exports the class-based
 *              FacebookAdapter and its shared instance.
 * @layer infrastructure
 */

// Export class and instance
export { FacebookAdapter, facebookAdapter } from "./FacebookAdapter.js";

// Default export
import { facebookAdapter } from "./FacebookAdapter.js";
export default facebookAdapter;
