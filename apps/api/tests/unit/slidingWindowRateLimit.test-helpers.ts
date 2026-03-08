/**
 * Shared test helpers for SlidingWindowRateLimit tests
 */

import type { FastifyRequest } from "fastify";

// Track all limiter instances for cleanup (exported so each file can push to it)
export const limiterInstances: import("../../src/security/slidingWindowRateLimit.js").SlidingWindowRateLimit[] =
  [];

// ============================================================================
// Mock Redis Client (Enhanced)
// ============================================================================

export class MockRedis {
  private data: Map<string, Array<{ score: number; member: string }>> = new Map();
  private keyValues: Map<string, string> = new Map();
  private ttls: Map<string, number> = new Map();
  public shouldFail = false;
  private eventHandlers: Map<string, Function[]> = new Map();

  on(event: string, handler: Function) {
    if (!this.eventHandlers.has(event)) {
      this.eventHandlers.set(event, []);
    }
    this.eventHandlers.get(event)?.push(handler);
  }

  async get(key: string): Promise<string | null> {
    if (this.shouldFail) return null; // Fail gracefully for get operations
    return this.keyValues.get(key) || null;
  }

  async setex(key: string, seconds: number, value: string): Promise<string> {
    if (this.shouldFail) throw new Error("Redis error");
    this.keyValues.set(key, value);
    this.ttls.set(key, seconds);
    return "OK";
  }

  async incr(key: string): Promise<number> {
    if (this.shouldFail) throw new Error("Redis error");
    const current = parseInt(this.keyValues.get(key) || "0");
    const newValue = current + 1;
    this.keyValues.set(key, newValue.toString());
    return newValue;
  }

  async expire(key: string, seconds: number): Promise<number> {
    if (this.shouldFail) throw new Error("Redis error");
    this.ttls.set(key, seconds);
    return 1;
  }

  pipeline() {
    const commands: Array<() => Promise<any>> = [];

    return {
      zremrangebyscore: (key: string, min: number, max: number) => {
        commands.push(async () => {
          if (this.shouldFail) throw new Error("Redis error");
          const items = this.data.get(key) || [];
          const filtered = items.filter((item) => item.score < min || item.score > max);
          this.data.set(key, filtered);
          return ["OK", items.length - filtered.length];
        });
        return this;
      },
      zadd: (key: string, score: number, member: string) => {
        commands.push(async () => {
          if (this.shouldFail) throw new Error("Redis error");
          const items = this.data.get(key) || [];
          items.push({ score, member });
          this.data.set(key, items);
          return ["OK", 1];
        });
        return this;
      },
      zcount: (key: string, min: number, max: number) => {
        commands.push(async () => {
          if (this.shouldFail) throw new Error("Redis error");
          const items = this.data.get(key) || [];
          const count = items.filter((item) => item.score >= min && item.score <= max).length;
          return ["OK", count];
        });
        return this;
      },
      zrange: (key: string, start: number, stop: number) => {
        commands.push(async () => {
          if (this.shouldFail) throw new Error("Redis error");
          const items = this.data.get(key) || [];
          const sortedMembers = items.sort((a, b) => a.score - b.score).map((item) => item.member);

          let result: string[] = [];
          if (start === 0 && stop === 0) {
            result = sortedMembers.slice(0, 1);
          } else if (start === -1 && stop === -1) {
            result = sortedMembers.slice(-1);
          }
          return ["OK", result];
        });
        return this;
      },
      expire: (key: string, seconds: number) => {
        commands.push(async () => {
          if (this.shouldFail) throw new Error("Redis error");
          this.ttls.set(key, seconds);
          return ["OK", 1];
        });
        return this;
      },
      exec: async () => {
        if (this.shouldFail) return null;
        const results = [];
        for (const cmd of commands) {
          results.push(await cmd());
        }
        return results;
      },
    };
  }

  async zrem(key: string, member: string) {
    if (this.shouldFail) throw new Error("Redis error");
    const items = this.data.get(key) || [];
    const filtered = items.filter((item) => item.member !== member);
    this.data.set(key, filtered);
    return items.length - filtered.length;
  }

  // Test helpers
  clear() {
    this.data.clear();
    this.keyValues.clear();
    this.ttls.clear();
  }

  setFailure(shouldFail: boolean) {
    this.shouldFail = shouldFail;
  }

  getKeyCount(key: string): number {
    return (this.data.get(key) || []).length;
  }
}

// ============================================================================
// Mock API Metrics
// ============================================================================

export class MockApiMetrics {
  public metrics = {
    rateLimitBlocked: {
      inc: (_labels: any) => {},
    },
    rateLimitRequests: {
      inc: (_labels: any) => {},
    },
    rateLimitErrors: {
      inc: (_labels: any) => {},
    },
  };
}

// ============================================================================
// Mock Fastify Request
// ============================================================================

export function createMockRequest(url: string, options: any = {}): FastifyRequest {
  return {
    url,
    headers: options.headers || {},
    socket: { remoteAddress: options.ip || "127.0.0.1" },
    routeOptions: { url },
  } as any;
}
