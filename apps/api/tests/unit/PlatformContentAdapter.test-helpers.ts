import { createTestPrismaClient } from "@infra/prisma";
import type { PrismaClient } from "@infra/prisma";
import Redis from "ioredis";
import promClient from "prom-client";
import { PlatformContentAdapter } from "../../src/content/PlatformContentAdapter.js";
import { EventService } from "../../src/events/EventService.js";

export interface AdapterState {
  adapter: PlatformContentAdapter;
  prisma: PrismaClient;
  redis: Redis;
  eventService: EventService;
}

export async function createAdapterState(): Promise<AdapterState> {
  const prisma = createTestPrismaClient();
  const redis = new Redis({
    host: process.env.REDIS_HOST || "localhost",
    port: parseInt(process.env.REDIS_PORT || "6379"),
    lazyConnect: true,
    maxRetriesPerRequest: 1,
    enableReadyCheck: false,
  });

  const eventService: Pick<EventService, "publishEvent"> = {
    publishEvent: async () => ({ ok: true as const, value: undefined }),
  };

  const adapter = new PlatformContentAdapter({
    prisma,
    redis,
    eventService: eventService as EventService,
  });

  await adapter.initialize();

  return { adapter, prisma, redis, eventService };
}

export async function destroyAdapterState(state: AdapterState): Promise<void> {
  promClient.register.clear();
  state.redis.disconnect(false);
  await state.prisma.$disconnect();
}
