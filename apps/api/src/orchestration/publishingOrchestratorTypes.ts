/**
 * @file publishingOrchestratorTypes.ts
 * @description Internal interfaces used by PublishingOrchestrator and its sub-modules.
 * @layer infrastructure
 */

import { PrismaClient } from "@infra/prisma";
import Redis from "ioredis";
import { OrchestrationConfig } from "@shared/orchestration";
import { EventService } from "../events/EventService";

export interface OrchestrationDependencies {
  prisma: PrismaClient;
  redis: Redis;
  eventService: EventService;
  config?: Partial<OrchestrationConfig>;
}
