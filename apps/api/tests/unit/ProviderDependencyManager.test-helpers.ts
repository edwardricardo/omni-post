import type { RetryPolicy, PublishResult } from "@shared/orchestration";
import type { ProviderId } from "../../src/providers/providerAdapter.interface";

export class MockPrismaClient {}

export class MockRedis {
  private cache = new Map<string, string>();

  async setex(key: string, _ttl: number, value: string): Promise<void> {
    this.cache.set(key, value);
  }

  async get(key: string): Promise<string | null> {
    return this.cache.get(key) || null;
  }

  async del(key: string): Promise<void> {
    this.cache.delete(key);
  }

  clear(): void {
    this.cache.clear();
  }
}

export class MockEventService {
  private events: any[] = [];

  async publish(event: any): Promise<void> {
    this.events.push(event);
  }

  getEvents(): any[] {
    return this.events;
  }

  clear(): void {
    this.events = [];
  }
}

export function createMockRetryPolicy(overrides?: Partial<RetryPolicy>): RetryPolicy {
  return {
    maxAttempts: 3,
    baseDelay: 1000,
    maxDelay: 10000,
    backoffStrategy: "exponential",
    retryableErrors: ["RATE_LIMIT", "NETWORK_ERROR"],
    ...overrides,
  };
}

export function createMockPublishResult(
  providerId: ProviderId,
  status: "success" | "failed" | "skipped" | "cancelled",
  overrides?: Partial<PublishResult>
): PublishResult {
  return {
    providerId,
    status,
    retryCount: 0,
    duration: 1000,
    ...overrides,
  };
}
