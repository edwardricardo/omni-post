import type { PrismaClient } from "@infra/prisma";
import type Redis from "ioredis";
import type { EventService } from "../../src/events/EventService.js";
import type { CanonicalPost } from "@shared/types";
import type { ProviderId, ProviderAdapter } from "../../src/providers/providerAdapter.interface.js";

export interface MockProviderAdapter extends ProviderAdapter {
  healthCheck(): Promise<{ ok: boolean; value?: { latency?: number } }>;
  render(content: CanonicalPost): { ok: boolean; value?: any; error?: string };
  publish(params: any): Promise<{ ok: boolean; value?: any; error?: string }>;
}

export function createMockPrisma(): PrismaClient {
  return {} as PrismaClient;
}

export function createMockRedis(): Redis {
  const storage = new Map<string, string>();
  return {
    setex: async (key: string, _ttl: number, value: string) => {
      storage.set(key, value);
      return "OK";
    },
    get: async (key: string) => storage.get(key) || null,
    del: async (key: string) => {
      storage.delete(key);
      return 1;
    },
  } as any;
}

export function createMockEventService(): EventService {
  const handlers = new Map<string, any>();
  return {
    publishEvent: async (_event: any) => {},
    registerHandler: (eventType: string, handler: any) => {
      handlers.set(eventType, handler);
    },
    getHandler: (eventType: string) => handlers.get(eventType),
  } as any;
}

export function createMockProviderAdapter(
  providerId: ProviderId,
  options: {
    healthy?: boolean;
    latency?: number;
    shouldFail?: boolean;
    renderFails?: boolean;
  } = {}
): MockProviderAdapter {
  const { healthy = true, latency = 100, shouldFail = false, renderFails = false } = options;

  return {
    healthCheck: async () => ({
      ok: healthy,
      ...(healthy && latency !== undefined ? { value: { latency } } : {}),
    }),
    render: (content: CanonicalPost) => {
      if (renderFails) {
        return { ok: false, error: "Render failed" };
      }
      return { ok: true, value: { text: content.text } };
    },
    publish: async (_params: any) => {
      if (shouldFail) {
        return { ok: false, error: "Publish failed" };
      }
      return {
        ok: true,
        value: {
          providerPostId: `${providerId}-post-123`,
          publishedAt: new Date(),
          url: `https://${providerId}.com/post/123`,
        },
      };
    },
  } as MockProviderAdapter;
}

export function createMockCanonicalPost(): CanonicalPost {
  return {
    id: "post-123",
    text: "Test post content",
    media: [],
    scheduledAt: new Date(),
    metadata: {},
  };
}

export const mockProviders = new Map<ProviderId, any>();
export const mockAdapters = new Map<ProviderId, MockProviderAdapter>();

export function setupMockProviders(
  providers: Array<{ id: ProviderId; adapter: MockProviderAdapter }>
) {
  mockProviders.clear();
  mockAdapters.clear();
  providers.forEach(({ id, adapter }) => {
    mockProviders.set(id, {
      id,
      name: id.charAt(0).toUpperCase() + id.slice(1),
      version: "1.0.0",
      capabilities: [],
    });
    mockAdapters.set(id, adapter);
  });
}
