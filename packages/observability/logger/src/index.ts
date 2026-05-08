/**
 * @file index.ts
 * @description Shared logger factory creating namespaced Pino loggers for all monorepo packages,
 *              honouring the LOG_LEVEL environment variable.
 * @layer infrastructure
 */
import pino from "pino";

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
