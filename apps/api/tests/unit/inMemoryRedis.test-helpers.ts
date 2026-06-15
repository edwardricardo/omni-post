/**
 * @file inMemoryRedis.test-helpers.ts
 * @description In-memory ioredis stand-in for unit tests. Unit tests must not
 *   open real sockets (vitest.config provides no REDIS_URL by design); modules
 *   that consume a raw ioredis client (auditLogger, bruteForceProtection,
 *   autoCacheMiddleware) get this fake instead. Implements only the command
 *   surface those modules + their test setup use: strings (get/set/setex/
 *   del/exists/incr/expire/ttl/keys-glob), sorted sets (zadd/zcard/
 *   zremrangebyrank), transactional multi(), and lifecycle (quit/ping).
 *   Interim per maintainer decision — full test reclassification is tracked
 *   separately.
 * @layer infrastructure
 */
import type { Redis } from "ioredis";

interface ZMember {
  score: number;
  value: string;
}

function globToRegExp(pattern: string): RegExp {
  // Redis KEYS glob: * -> .*, ? -> ., escape regex metachars otherwise.
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`^${escaped.replace(/\*/g, ".*").replace(/\?/g, ".")}$`);
}

class InMemoryRedis {
  private strings = new Map<string, string>();
  private zsets = new Map<string, ZMember[]>();
  private expiry = new Map<string, number>(); // key -> epoch ms

  private isExpired(key: string): boolean {
    const exp = this.expiry.get(key);
    if (exp !== undefined && exp <= Date.now()) {
      this.strings.delete(key);
      this.zsets.delete(key);
      this.expiry.delete(key);
      return true;
    }
    return false;
  }

  async get(key: string): Promise<string | null> {
    if (this.isExpired(key)) return null;
    return this.strings.get(key) ?? null;
  }

  async set(key: string, value: string | number): Promise<"OK"> {
    this.strings.set(key, String(value));
    this.expiry.delete(key);
    return "OK";
  }

  async setex(key: string, seconds: number, value: string | number): Promise<"OK"> {
    this.strings.set(key, String(value));
    this.expiry.set(key, Date.now() + seconds * 1000);
    return "OK";
  }

  async del(...keys: string[]): Promise<number> {
    let n = 0;
    for (const k of keys) {
      if (this.strings.delete(k) || this.zsets.delete(k)) n++;
      this.expiry.delete(k);
    }
    return n;
  }

  async exists(...keys: string[]): Promise<number> {
    let n = 0;
    for (const k of keys) {
      if (this.isExpired(k)) continue;
      if (this.strings.has(k) || this.zsets.has(k)) n++;
    }
    return n;
  }

  async incr(key: string): Promise<number> {
    if (this.isExpired(key)) this.strings.delete(key);
    const next = Number(this.strings.get(key) ?? "0") + 1;
    this.strings.set(key, String(next));
    return next;
  }

  async expire(key: string, seconds: number): Promise<number> {
    if (!this.strings.has(key) && !this.zsets.has(key)) return 0;
    this.expiry.set(key, Date.now() + seconds * 1000);
    return 1;
  }

  async ttl(key: string): Promise<number> {
    if (this.isExpired(key)) return -2;
    if (!this.strings.has(key) && !this.zsets.has(key)) return -2;
    const exp = this.expiry.get(key);
    if (exp === undefined) return -1;
    return Math.max(0, Math.ceil((exp - Date.now()) / 1000));
  }

  async keys(pattern: string): Promise<string[]> {
    const re = globToRegExp(pattern);
    const out: string[] = [];
    for (const k of [...this.strings.keys(), ...this.zsets.keys()]) {
      if (!this.isExpired(k) && re.test(k)) out.push(k);
    }
    return out;
  }

  async zadd(key: string, score: number, value: string): Promise<number> {
    this.isExpired(key);
    const arr = this.zsets.get(key) ?? [];
    const existing = arr.find((m) => m.value === value);
    if (existing) {
      existing.score = score;
      this.zsets.set(key, arr);
      return 0;
    }
    arr.push({ score, value });
    arr.sort((a, b) => a.score - b.score);
    this.zsets.set(key, arr);
    return 1;
  }

  async zcard(key: string): Promise<number> {
    if (this.isExpired(key)) return 0;
    return this.zsets.get(key)?.length ?? 0;
  }

  async zremrangebyrank(key: string, start: number, stop: number): Promise<number> {
    const arr = this.zsets.get(key);
    if (!arr || arr.length === 0) return 0;
    const len = arr.length;
    const s = start < 0 ? Math.max(0, len + start) : Math.min(start, len);
    const e = stop < 0 ? len + stop : Math.min(stop, len - 1);
    if (s > e) return 0;
    const removed = arr.splice(s, e - s + 1).length;
    this.zsets.set(key, arr);
    return removed;
  }

  multi(): InMemoryMulti {
    return new InMemoryMulti(this);
  }

  async ping(): Promise<"PONG"> {
    return "PONG";
  }

  async quit(): Promise<"OK"> {
    return "OK";
  }

  async flushall(): Promise<"OK"> {
    this.strings.clear();
    this.zsets.clear();
    this.expiry.clear();
    return "OK";
  }

  on(): this {
    return this;
  }
  once(): this {
    return this;
  }
  off(): this {
    return this;
  }
}

type QueuedOp = () => Promise<unknown>;

class InMemoryMulti {
  private ops: QueuedOp[] = [];
  constructor(private readonly redis: InMemoryRedis) {}

  setex(key: string, seconds: number, value: string | number): this {
    this.ops.push(() => this.redis.setex(key, seconds, value));
    return this;
  }
  set(key: string, value: string | number): this {
    this.ops.push(() => this.redis.set(key, value));
    return this;
  }
  del(...keys: string[]): this {
    this.ops.push(() => this.redis.del(...keys));
    return this;
  }
  incr(key: string): this {
    this.ops.push(() => this.redis.incr(key));
    return this;
  }
  expire(key: string, seconds: number): this {
    this.ops.push(() => this.redis.expire(key, seconds));
    return this;
  }
  zadd(key: string, score: number, value: string): this {
    this.ops.push(() => this.redis.zadd(key, score, value));
    return this;
  }
  zcard(key: string): this {
    this.ops.push(() => this.redis.zcard(key));
    return this;
  }

  async exec(): Promise<Array<[Error | null, unknown]>> {
    const results: Array<[Error | null, unknown]> = [];
    for (const op of this.ops) {
      try {
        results.push([null, await op()]);
      } catch (err) {
        results.push([err instanceof Error ? err : new Error(String(err)), null]);
      }
    }
    return results;
  }
}

/**
 * @method createInMemoryRedis
 * @description Build an in-memory ioredis stand-in for unit tests.
 * @returns An object implementing the ioredis command subset used by the
 *   audit/brute-force/cache modules, typed as `Redis` for drop-in injection.
 */
export function createInMemoryRedis(): Redis {
  return new InMemoryRedis() as unknown as Redis;
}
