/**
 * @file webhookPrismaFake.ts
 * @description Builds an in-memory PrismaClient fake for webhook unit tests: the
 *   shared mock-prisma base plus the channel/post/publishLog/analytics models the
 *   webhook processors touch, and a compound-key (provider_eventId) findUnique
 *   override for webhookEvent dedup. Injected into the webhook classes via the
 *   constructor (DI) instead of module-mocking @infra/prisma.
 * @layer infrastructure
 */

import { vi } from "vitest";
import type { PrismaClient } from "@infra/prisma";
import {
  createMockPrismaModule,
  createStore,
  buildModelMock,
  type ModelStore,
  type MockPrismaStores,
} from "./mockPrisma.js";

type Store = ModelStore<Record<string, unknown>>;

export interface WebhookPrismaFake {
  /** The fake client, shaped as PrismaClient, to pass into a webhook constructor. */
  prisma: PrismaClient;
  /** Backing stores for direct seeding / assertions in tests. */
  stores: MockPrismaStores & {
    channel: Store;
    post: Store;
    publishLog: Store;
    analytics: Store;
    instagramAnalytics: Store;
  };
}

/**
 * @function makeWebhookPrismaFake
 * @description Creates a fresh in-memory webhook PrismaClient fake plus its stores.
 * @returns { prisma, stores } — inject `prisma`, seed/assert through `stores`.
 */
export function makeWebhookPrismaFake(): WebhookPrismaFake {
  const { prisma, stores } = createMockPrismaModule();

  const channel = createStore<Record<string, unknown>>();
  const post = createStore<Record<string, unknown>>();
  const publishLog = createStore<Record<string, unknown>>();
  const analytics = createStore<Record<string, unknown>>();
  const instagramAnalytics = createStore<Record<string, unknown>>();

  // webhookEvent dedup uses the compound unique key provider_eventId. The
  // in-memory matcher only understands flat fields, so expand it here.
  const webhookEventMock = prisma.webhookEvent;
  const originalFindUnique = webhookEventMock.findUnique;
  webhookEventMock.findUnique = vi.fn(async (args: { where: Record<string, unknown> }) => {
    const where = args.where;
    if (where && typeof where.provider_eventId === "object" && where.provider_eventId !== null) {
      const compound = where.provider_eventId as Record<string, unknown>;
      const expandedWhere = { ...where, ...compound };
      delete expandedWhere.provider_eventId;
      return originalFindUnique({ ...args, where: expandedWhere });
    }
    return originalFindUnique(args);
  });

  const extended = {
    ...prisma,
    channel: buildModelMock(channel),
    post: buildModelMock(post),
    publishLog: buildModelMock(publishLog),
    analytics: buildModelMock(analytics),
    instagramAnalytics: buildModelMock(instagramAnalytics),
  };

  return {
    prisma: extended as unknown as PrismaClient,
    stores: { ...stores, channel, post, publishLog, analytics, instagramAnalytics },
  };
}
