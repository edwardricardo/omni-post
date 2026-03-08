import { TrendAnalysisService } from "../../src/trends/trendAnalysisService.js";
import type { PrismaClient } from "@infra/prisma";
import type { FastifyLoggerInstance } from "fastify";

// Minimal PrismaClient stub for pure unit tests (service generates synthetic data)
export function createMockPrisma(): PrismaClient {
  return {} as PrismaClient;
}

// Type-safe logger mock matching FastifyLoggerInstance interface
const noOp = () => {};
export function createMockLogger(): FastifyLoggerInstance {
  const logger: Pick<
    FastifyLoggerInstance,
    "info" | "warn" | "error" | "debug" | "fatal" | "trace" | "child"
  > = {
    info: noOp,
    warn: noOp,
    error: noOp,
    debug: noOp,
    fatal: noOp,
    trace: noOp,
    child: () => createMockLogger(),
  };
  return logger as FastifyLoggerInstance;
}

export function createService(): TrendAnalysisService {
  return new TrendAnalysisService(createMockPrisma(), createMockLogger());
}
