/**
 * @file EventService.initialize.test.ts
 * @description Pins that initializing the event service leaves no event behind: nothing is appended
 *              to the event store and nothing is published, so a freshly migrated database holds no
 *              row of the application after the API boots, while a caller can still publish once
 *              the service is initialized.
 * @layer infrastructure
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@infra/prisma";
import type { Redis } from "ioredis";
import type { BackgroundTaskScheduler } from "@observability/background-scheduler";

const store = vi.hoisted(() => ({ append: vi.fn() }));
const publisher = vi.hoisted(() => ({
  publish: vi.fn(),
  subscribe: vi.fn(),
  unsubscribe: vi.fn(),
  shutdown: vi.fn(),
}));

vi.mock("../../src/events/EventStore.js", () => ({
  PostgreSQLEventStore: class {
    append = store.append;
  },
}));

vi.mock("../../src/events/EventPublisher.js", () => ({
  RedisEventPublisher: class {
    publish = publisher.publish;
    subscribe = publisher.subscribe;
    unsubscribe = publisher.unsubscribe;
    shutdown = publisher.shutdown;
  },
}));

import { EventService, createUserActionEvent } from "../../src/events/EventService.js";

/**
 * Builds an event service over the doubles above; the prisma, redis and scheduler it is given are
 * never used, because the store and the publisher that would use them are replaced.
 */
function makeService(): EventService {
  return new EventService({
    prisma: {} as unknown as PrismaClient,
    redis: {} as unknown as Redis,
    scheduler: {} as unknown as BackgroundTaskScheduler,
  });
}

describe("EventService.initialize", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    store.append.mockResolvedValue(undefined);
    publisher.publish.mockResolvedValue(undefined);
  });

  it("returns ok and appends and publishes no event when the service initializes", async () => {
    const result = await makeService().initialize();

    expect(result.ok).toBe(true);
    expect(store.append).not.toHaveBeenCalled();
    expect(publisher.publish).not.toHaveBeenCalled();
  });

  it("appends and publishes a caller's event once the service is initialized", async () => {
    const service = makeService();
    await service.initialize();
    const event = createUserActionEvent("user-123", "login", "Session", "session-456");

    const result = await service.publishEvent(event);

    expect(result.ok).toBe(true);
    expect(store.append).toHaveBeenCalledExactlyOnceWith("User:user-123", [event]);
    expect(publisher.publish).toHaveBeenCalledExactlyOnceWith(event);
  });
});
