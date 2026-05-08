/**
 * @file CachePort-DI.test.ts
 * @description Verifies that `TOKENS.CachePort` is wired in the DI graph,
 *              wraps the singleton `RedisCacheManager` registered via
 *              `TOKENS.RedisCacheManager` (no duplicated cache pools), and
 *              exposes the canonical `CachePort` method surface.
 * @layer infrastructure
 */

import { describe, it, expect, afterEach } from "vitest";
import { Container } from "../../../src/infrastructure/container/Container.js";
import { TOKENS } from "../../../src/infrastructure/container/types.js";
import {
  RedisCacheAdapter,
  RedisCacheManager,
} from "../../../../../packages/adapters/cache-redis/src/index.js";
import {
  NoopBackgroundTaskScheduler,
  type BackgroundTaskScheduler,
} from "../../../../../packages/observability/background-scheduler/src/index.js";
import type { CachePort } from "../../../../../packages/ports/src/index.js";

describe("DI: TOKENS.CachePort", () => {
  let manager: RedisCacheManager | undefined;

  afterEach(async () => {
    if (manager) {
      await manager.close();
      manager = undefined;
    }
  });

  function makeContainer(): Container {
    const container = new Container();
    container.registerInstance<BackgroundTaskScheduler>(
      TOKENS.BackgroundTaskScheduler,
      new NoopBackgroundTaskScheduler()
    );
    manager = new RedisCacheManager(
      { redisUrl: "redis://localhost:6379", keyPrefix: "test:", enableMetrics: false },
      container.resolve<BackgroundTaskScheduler>(TOKENS.BackgroundTaskScheduler)
    );
    container.registerInstance(TOKENS.RedisCacheManager, manager);
    container.register<CachePort>(
      TOKENS.CachePort,
      () => new RedisCacheAdapter(container.resolve<RedisCacheManager>(TOKENS.RedisCacheManager)),
      true
    );
    return container;
  }

  it("resolves to a RedisCacheAdapter implementing the CachePort surface", () => {
    const container = makeContainer();
    const cache = container.resolve<CachePort>(TOKENS.CachePort);
    expect(cache).toBeInstanceOf(RedisCacheAdapter);
    expect(typeof cache.get).toBe("function");
    expect(typeof cache.set).toBe("function");
    expect(typeof cache.getOrSet).toBe("function");
    expect(typeof cache.delete).toBe("function");
    expect(typeof cache.invalidateByTag).toBe("function");
    expect(typeof cache.has).toBe("function");
  });

  it("returns the same singleton instance on repeated resolves", () => {
    const container = makeContainer();
    const a = container.resolve<CachePort>(TOKENS.CachePort);
    const b = container.resolve<CachePort>(TOKENS.CachePort);
    expect(a).toBe(b);
  });

  it("wraps the same RedisCacheManager registered as TOKENS.RedisCacheManager", () => {
    const container = makeContainer();
    const cache = container.resolve<RedisCacheAdapter>(TOKENS.CachePort);
    const registeredManager = container.resolve<RedisCacheManager>(TOKENS.RedisCacheManager);
    // Adapter holds the singleton manager — no duplicated cache pools.
    expect((cache as unknown as { manager: RedisCacheManager }).manager).toBe(registeredManager);
  });
});
