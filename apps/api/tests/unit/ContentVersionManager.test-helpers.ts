import type { PrismaClient } from "@infra/prisma";
import type Redis from "ioredis";
import type { EventService } from "../../src/events/EventService";
import type { CanonicalPost } from "@shared/types";
import type { ProviderId } from "../../src/providers/providerAdapter.interface";

export const testPostId = `post_${Date.now()}_${Math.random().toString(36).substring(7)}`;
export const testUserId = `user_${Date.now()}_${Math.random().toString(36).substring(7)}`;

export const testCanonicalPost: CanonicalPost = {
  title: "Test Post Title",
  body: "Test post content body",
  tags: ["test", "content"],
  media: [],
  scheduledAt: new Date(),
  platformSpecific: {},
};

export const testAdaptations: Record<ProviderId, CanonicalPost> = {
  x: {
    ...testCanonicalPost,
    body: "Twitter-specific content (280 chars max)",
  },
  instagram: {
    ...testCanonicalPost,
    body: "Instagram-specific content with hashtags #test",
  },
};

// ─── Mock Types ─────────────────────────────────────────────────────
export type MockRedis = Pick<
  Redis,
  "get" | "setex" | "lpush" | "lrange" | "hset" | "hget" | "hexists"
> & {
  disconnect: () => Promise<void>;
};

export type MockEventService = Pick<EventService, "publishEvent"> & {
  getPublishedEvents: () => any[];
};

export function createMockRedis(): MockRedis {
  const storage = new Map<string, string>();
  const lists = new Map<string, string[]>();
  const hashes = new Map<string, Map<string, string>>();

  return {
    get: async (key: string) => storage.get(key) || null,
    setex: async (key: string, _ttl: number, value: string) => {
      storage.set(key, value);
      return "OK";
    },
    lpush: async (key: string, ...values: string[]) => {
      const list = lists.get(key) || [];
      list.unshift(...values);
      lists.set(key, list);
      return list.length;
    },
    lrange: async (key: string, start: number, stop: number) => {
      const list = lists.get(key) || [];
      return list.slice(start, stop === -1 ? undefined : stop + 1);
    },
    hset: async (key: string, field: string, value: string) => {
      if (!hashes.has(key)) {
        hashes.set(key, new Map());
      }
      const hash = hashes.get(key)!;
      hash.set(field, value);
      return 1;
    },
    hget: async (key: string, field: string) => {
      return hashes.get(key)?.get(field) || null;
    },
    hexists: async (key: string, field: string) => {
      return hashes.get(key)?.has(field) ? 1 : 0;
    },
    disconnect: async () => {},
  };
}

export function createMockEventService(): MockEventService {
  const events: any[] = [];
  return {
    publishEvent: async (event: any) => {
      events.push(event);
      return { ok: true, value: undefined };
    },
    getPublishedEvents: () => events,
  };
}

export function createMockPrisma(): PrismaClient {
  return {} as PrismaClient;
}
