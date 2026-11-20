/**
 * @file index.ts
 * @description The error module's names a route imports: `sendProblem`, the one function a route
 *   answers a failure through, and `AppError`.
 * @layer infrastructure
 */

export {
  // Base error class with factory methods
  AppError,
} from "./AppError.js";
export { sendProblem } from "./sendProblem.js";
