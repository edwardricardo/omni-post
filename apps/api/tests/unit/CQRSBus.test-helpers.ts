/**
 * @file CQRSBus.test-helpers.ts
 * @description Test helpers for cqrsbus test helpers
 * @layer infrastructure
 */
import type { DomainEvent } from "@shared/events";
import type {
  Command,
  CommandHandler,
  CommandResult,
  Query,
  QueryHandler,
  QueryResult,
} from "@shared/cqrs";

export class MockRedis {
  private store = new Map<string, string>();
  private ttls = new Map<string, number>();

  async ping(): Promise<string> {
    return "PONG";
  }

  async get(key: string): Promise<string | null> {
    return this.store.get(key) || null;
  }

  async setex(key: string, ttl: number, value: string): Promise<string> {
    this.store.set(key, value);
    this.ttls.set(key, ttl);
    return "OK";
  }

  async keys(pattern: string): Promise<string[]> {
    const regex = new RegExp(pattern.replace(/\*/g, ".*"));
    return Array.from(this.store.keys()).filter((key) => regex.test(key));
  }

  async del(...keys: string[]): Promise<number> {
    let count = 0;
    for (const key of keys) {
      if (this.store.delete(key)) {
        this.ttls.delete(key);
        count++;
      }
    }
    return count;
  }

  clear(): void {
    this.store.clear();
    this.ttls.clear();
  }
}

export class MockEventService {
  public events: DomainEvent[] = [];
  private healthy = true;

  async publishEvents(events: DomainEvent[]): Promise<void> {
    this.events.push(...events);
  }

  async healthCheck(): Promise<{ ok: boolean; value: { status: string } }> {
    return {
      ok: true,
      value: { status: this.healthy ? "healthy" : "unhealthy" },
    };
  }

  setHealthy(healthy: boolean): void {
    this.healthy = healthy;
  }

  reset(): void {
    this.events = [];
    this.healthy = true;
  }
}

export class TestCommandHandler implements CommandHandler {
  readonly commandType = "test.command";
  public callCount = 0;
  public shouldFail = false;
  public shouldGenerateEvents = false;

  async handle(command: Command): Promise<CommandResult> {
    this.callCount++;

    if (this.shouldFail) {
      throw new Error("Command execution failed");
    }

    const result: CommandResult<{ success: boolean; timestamp: Date }> = {
      success: true,
      data: {
        success: true,
        timestamp: new Date(),
      },
    };

    if (this.shouldGenerateEvents) {
      result.events = [
        {
          id: "event-1",
          type: "test.event",
          version: 1,
          timestamp: new Date(),
          aggregateId: command.aggregateId,
          aggregateType: command.aggregateType,
          data: { message: "Test event" },
          metadata: { source: "test" },
        },
      ];
    }

    return result;
  }

  reset(): void {
    this.callCount = 0;
    this.shouldFail = false;
    this.shouldGenerateEvents = false;
  }
}

export class TestQueryHandler implements QueryHandler {
  readonly queryType = "test.query";
  public callCount = 0;
  public shouldFail = false;

  async handle(_query: Query): Promise<QueryResult<{ data: string; timestamp: Date }>> {
    this.callCount++;

    if (this.shouldFail) {
      throw new Error("Query execution failed");
    }

    return {
      success: true,
      data: {
        data: "test data",
        timestamp: new Date(),
      },
    };
  }

  reset(): void {
    this.callCount = 0;
    this.shouldFail = false;
  }
}

export function makeCommand(overrides: Partial<{ type: string; id: string }> = {}) {
  return {
    id: overrides.id ?? "cmd-1",
    type: overrides.type ?? "test.command",
    aggregateId: "agg-1",
    aggregateType: "Test",
    data: {},
    metadata: {
      correlationId: "corr-1",
      source: "test",
    },
    timestamp: new Date(),
  };
}

export function makeQuery(overrides: Partial<{ type: string; cacheKey?: string }> = {}) {
  return {
    id: "qry-1",
    type: overrides.type ?? "test.query",
    data: {},
    metadata: {
      correlationId: "corr-1",
      source: "test",
      ...(overrides.cacheKey !== undefined && { cacheKey: overrides.cacheKey }),
    },
    timestamp: new Date(),
  };
}
