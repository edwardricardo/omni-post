import pino from "pino";

/**
 * Shared logger factory for all packages in the omni-post monorepo.
 *
 * Usage:
 *   import { createLogger } from "@observability/logger";
 *   const logger = createLogger("adapter:db-prisma");
 *
 * Log level is controlled by the LOG_LEVEL environment variable (default: "info").
 */

const LOG_LEVEL = process.env.LOG_LEVEL || "info";

export function createLogger(name: string): pino.Logger {
  return pino({
    name,
    level: LOG_LEVEL,
    ...(process.env.NODE_ENV !== "production" && {
      transport: {
        target: "pino/file",
        options: { destination: 1 }, // stdout
      },
    }),
  });
}

export type { Logger } from "pino";
