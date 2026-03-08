import type { TestContext } from "node:test";
import { DomainEvent, EventHandler } from "@shared/events";

export class MockFastify {
  private routes = new Map<string, any>();
  private hooks: Array<{ event: string; handler: Function }> = [];
  public prisma: any;

  constructor(t: TestContext) {
    this.prisma = new MockPrisma(t);
  }

  post(path: string, handler: Function): void {
    this.routes.set(`POST:${path}`, handler);
  }

  put(path: string, handler: Function): void {
    this.routes.set(`PUT:${path}`, handler);
  }

  get(path: string, handler: Function): void {
    this.routes.set(`GET:${path}`, handler);
  }

  addHook(event: string, handler: Function): void {
    this.hooks.push({ event, handler });
  }

  async callRoute(method: string, path: string, request: any, reply: any): Promise<any> {
    const route = this.routes.get(`${method}:${path}`);
    if (!route) {
      throw new Error(`Route not found: ${method} ${path}`);
    }
    return await route(request, reply);
  }

  hasRoute(method: string, path: string): boolean {
    return this.routes.has(`${method}:${path}`);
  }

  getHooks(event: string): Function[] {
    return this.hooks.filter((h) => h.event === event).map((h) => h.handler);
  }
}

export class MockPrisma {
  public post: any;

  constructor(t: TestContext) {
    this.post = {
      create: t.mock.fn(async (args: any) => ({
        id: "post-123",
        projectId: args.data.projectId,
        status: args.data.status,
        scheduledAt: args.data.scheduledAt,
        createdAt: new Date(),
        updatedAt: new Date(),
        contents: [
          {
            id: "content-123",
            locale: "en",
            title: args.data.contents?.create?.title,
            body: args.data.contents?.create?.body,
            tags: args.data.contents?.create?.tags || [],
          },
        ],
      })),
      findUnique: t.mock.fn(async (args: any) => ({
        id: args.where.id,
        projectId: "project-456",
        status: "DRAFT",
        scheduledAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        contents: [
          {
            id: "content-123",
            locale: "en",
            title: "Test Post",
            body: "Test content",
            tags: [],
          },
        ],
      })),
      update: t.mock.fn(async (args: any) => ({
        id: args.where.id,
        projectId: "project-456",
        status: args.data.status || "DRAFT",
        scheduledAt: args.data.scheduledAt || null,
        createdAt: new Date(),
        updatedAt: new Date(),
        contents: [
          {
            id: "content-123",
            locale: "en",
            title: "Updated Post",
            body: "Updated content",
            tags: [],
          },
        ],
      })),
    };
  }
}

export class MockEventService {
  private publishedEvents: DomainEvent[] = [];
  private handlers = new Map<string, Set<EventHandler>>();
  private shouldFailPublish = false;

  async publishEvent(event: DomainEvent): Promise<void> {
    if (this.shouldFailPublish) {
      throw new Error("Failed to publish event");
    }
    this.publishedEvents.push(event);
  }

  async publishEvents(events: DomainEvent[]): Promise<void> {
    if (this.shouldFailPublish) {
      throw new Error("Failed to publish events");
    }
    this.publishedEvents.push(...events);
  }

  registerHandler(eventType: string, handler: EventHandler): void {
    if (!this.handlers.has(eventType)) {
      this.handlers.set(eventType, new Set());
    }
    this.handlers.get(eventType)!.add(handler);
  }

  async getAggregateEvents(
    _aggregateType: string,
    _aggregateId: string
  ): Promise<{ ok: boolean; value?: any[]; error?: string }> {
    return {
      ok: true,
      value: this.publishedEvents.map((event, index) => ({
        id: event.id,
        type: event.type,
        timestamp: event.timestamp,
        data: event.data,
        metadata: event.metadata,
        sequence: index + 1,
      })),
    };
  }

  async getEventsByType(
    _eventType: string,
    _fromDate?: Date
  ): Promise<{ ok: boolean; value?: any[]; error?: string }> {
    return {
      ok: true,
      value: this.publishedEvents.map((event, index) => ({
        id: event.id,
        type: event.type,
        timestamp: event.timestamp,
        data: event.data,
        metadata: event.metadata,
        sequence: index + 1,
      })),
    };
  }

  async healthCheck(): Promise<any> {
    return {
      status: "healthy",
      details: {
        eventStore: true,
        eventPublisher: true,
      },
    };
  }

  async getStatistics(): Promise<any> {
    return {
      totalEvents: this.publishedEvents.length,
      eventsByType: {},
    };
  }

  async initialize(): Promise<void> {}

  async shutdown(): Promise<void> {}

  getPublishedEvents(): DomainEvent[] {
    return this.publishedEvents;
  }

  clearPublishedEvents(): void {
    this.publishedEvents = [];
  }

  setFailPublish(shouldFail: boolean): void {
    this.shouldFailPublish = shouldFail;
  }

  getHandlers(eventType: string): Set<EventHandler> | undefined {
    return this.handlers.get(eventType);
  }
}
