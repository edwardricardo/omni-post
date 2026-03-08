/**
 * @file logger.ts
 * @description Re-exports the shared logger from @shared/types.
 * Consumers import from "@/lib/logger" as before — no change required at call sites.
 */
export { createLogger } from "@shared/types/logger";
