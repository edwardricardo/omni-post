# CQRS Integration Guide

## Overview

Command Query Responsibility Segregation (CQRS) is a fundamental architectural pattern in our Phase 2 implementation that separates read and write operations. This guide provides detailed information on how CQRS is implemented and integrated throughout the system.

## Architecture Components

### Command Side (Write Operations)

#### Command Bus

**Location**: `apps/api/src/cqrs/CommandBus.ts`

The CommandBus is responsible for routing commands to their appropriate handlers and managing the execution pipeline.

```typescript
interface CommandBus {
  execute<T extends Command>(command: T): Promise<CommandResult>;
  register<T extends Command>(commandType: string, handler: CommandHandler<T>): void;
}

// Usage example
const result = await commandBus.execute({
  id: "cmd-123",
  type: "post.create",
  aggregateId: "post-456",
  aggregateType: "Post",
  data: {
    title: "My Post",
    content: "Post content...",
    channelIds: ["channel-1", "channel-2"],
  },
  metadata: {
    userId: "user-789",
    correlationId: "corr-abc",
  },
  timestamp: new Date(),
});
```

#### Command Handlers

**Location**: `apps/api/src/cqrs/commands/`

Each command handler implements business logic for a specific command type:

```typescript
export class CreatePostCommandHandler implements CommandHandler<CreatePostCommand> {
  constructor(
    private postRepository: PostRepository,
    private eventStore: EventStore,
    private logger: Logger
  ) {}

  async handle(command: CreatePostCommand): Promise<CommandResult> {
    try {
      // 1. Validate command
      const validation = await this.validate(command);
      if (!validation.isValid) {
        return { success: false, error: validation.error };
      }

      // 2. Load aggregate (if updating)
      const post = new Post(command.aggregateId);

      // 3. Execute business logic
      const events = post.create({
        title: command.data.title,
        content: command.data.content,
        channelIds: command.data.channelIds,
        userId: command.metadata.userId,
      });

      // 4. Persist events
      await this.eventStore.append(command.aggregateId, events, command.expectedVersion);

      // 5. Publish domain events
      for (const event of events) {
        await this.eventPublisher.publish(event);
      }

      return {
        success: true,
        aggregateId: command.aggregateId,
        version: post.getVersion(),
        events: events.length,
      };
    } catch (error) {
      this.logger.error("Command execution failed", { command, error });
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  }
}
```

### Query Side (Read Operations)

#### Query Bus

**Location**: `apps/api/src/cqrs/QueryBus.ts`

The QueryBus routes queries to optimized read models:

```typescript
interface QueryBus {
  execute<T extends Query, R>(query: T): Promise<QueryResult<R>>;
  register<T extends Query, R>(queryType: string, handler: QueryHandler<T, R>): void;
}

// Usage example
const result = await queryBus.execute({
  type: "posts.getByProject",
  projectId: "proj-123",
  filters: {
    status: "PUBLISHED",
    dateRange: {
      from: new Date("2024-01-01"),
      to: new Date("2024-12-31"),
    },
  },
  pagination: {
    page: 1,
    limit: 20,
  },
  sort: {
    field: "publishedAt",
    direction: "DESC",
  },
});
```

#### Query Handlers

**Location**: `apps/api/src/cqrs/queries/`

Query handlers access optimized read models:

```typescript
export class GetPostsByProjectQueryHandler
  implements QueryHandler<GetPostsByProjectQuery, PostSummary[]>
{
  constructor(
    private readModelRepository: ReadModelRepository,
    private cache: IntelligentCache,
    private logger: Logger
  ) {}

  async handle(query: GetPostsByProjectQuery): Promise<QueryResult<PostSummary[]>> {
    try {
      // 1. Generate cache key
      const cacheKey = this.generateCacheKey(query);

      // 2. Try cache first
      const cached = await this.cache.get(cacheKey);
      if (cached) {
        return { success: true, data: cached, fromCache: true };
      }

      // 3. Query read model
      const posts = await this.readModelRepository.findPosts({
        projectId: query.projectId,
        filters: query.filters,
        pagination: query.pagination,
        sort: query.sort,
      });

      // 4. Transform to response format
      const summaries = posts.map((post) => ({
        id: post.id,
        title: post.title,
        status: post.status,
        publishedAt: post.publishedAt,
        channelCount: post.channels.length,
        metrics: {
          views: post.analytics?.totalViews || 0,
          engagement: post.analytics?.totalEngagement || 0,
        },
      }));

      // 5. Cache the result
      await this.cache.set(cacheKey, summaries, {
        ttl: 300,
        tags: [`project:${query.projectId}`, "posts"],
      });

      return { success: true, data: summaries, fromCache: false };
    } catch (error) {
      this.logger.error("Query execution failed", { query, error });
      return {
        success: false,
        error: error instanceof Error ? error.message : "Query failed",
      };
    }
  }
}
```

### Event Store

**Location**: `apps/api/src/cqrs/EventStore.ts`

The Event Store provides event persistence and retrieval:

```typescript
export class EventStore {
  async append(
    aggregateId: string,
    events: DomainEvent[],
    expectedVersion?: number
  ): Promise<void> {
    return this.db.$transaction(async (tx) => {
      // 1. Check version for optimistic concurrency
      if (expectedVersion !== undefined) {
        const currentVersion = await this.getVersion(aggregateId, tx);
        if (currentVersion !== expectedVersion) {
          throw new ConcurrencyError(
            `Expected version ${expectedVersion}, but current version is ${currentVersion}`
          );
        }
      }

      // 2. Insert events
      for (let i = 0; i < events.length; i++) {
        const event = events[i];
        await tx.eventStore.create({
          data: {
            aggregateId,
            aggregateType: event.aggregateType,
            eventType: event.type,
            eventData: event.data,
            eventMetadata: event.metadata,
            eventVersion: (expectedVersion || 0) + i + 1,
            timestamp: event.timestamp,
          },
        });
      }
    });
  }

  async getEvents(aggregateId: string, fromVersion?: number): Promise<DomainEvent[]> {
    const records = await this.db.eventStore.findMany({
      where: {
        aggregateId,
        ...(fromVersion && { eventVersion: { gte: fromVersion } }),
      },
      orderBy: { eventVersion: "asc" },
    });

    return records.map((record) => ({
      id: record.id,
      aggregateId: record.aggregateId,
      aggregateType: record.aggregateType,
      type: record.eventType,
      data: record.eventData,
      metadata: record.eventMetadata,
      version: record.eventVersion,
      timestamp: record.timestamp,
    }));
  }
}
```

## Fastify Integration

### Route Integration

**Location**: `apps/api/src/cqrs/CQRSIntegration.ts`

CQRS is seamlessly integrated with Fastify routes using TypeScript generics:

```typescript
// Command endpoint
export const createCommandRoute = <TCommand extends Command, TResult>(
  fastify: FastifyInstance,
  opts: {
    method: "POST" | "PUT" | "PATCH" | "DELETE";
    url: string;
    commandType: string;
    schema?: FastifySchema;
    preHandler?: preHandlerAsyncHookHandler[];
  }
) => {
  fastify.route<{
    Body: Omit<TCommand, "id" | "timestamp">;
    Reply: CommandResult<TResult>;
  }>({
    method: opts.method,
    url: opts.url,
    schema: opts.schema,
    preHandler: opts.preHandler,
    handler: async (request, reply) => {
      try {
        const command: TCommand = {
          id: generateCommandId(),
          timestamp: new Date(),
          ...request.body,
        } as TCommand;

        const result = await commandBus.execute(command);

        if (result.success) {
          reply.status(200).send(result);
        } else {
          reply.status(400).send(result);
        }
      } catch (error) {
        fastify.log.error("Command route error", { error });
        reply.status(500).send({
          success: false,
          error: "Internal server error",
        });
      }
    },
  });
};

// Query endpoint
export const createQueryRoute = <TQuery extends Query, TResult>(
  fastify: FastifyInstance,
  opts: {
    method: "GET";
    url: string;
    queryType: string;
    schema?: FastifySchema;
    preHandler?: preHandlerAsyncHookHandler[];
  }
) => {
  fastify.route<{
    Querystring: Omit<TQuery, "type">;
    Reply: QueryResult<TResult>;
  }>({
    method: "GET",
    url: opts.url,
    schema: opts.schema,
    preHandler: opts.preHandler,
    handler: async (request, reply) => {
      try {
        const query: TQuery = {
          type: opts.queryType,
          ...request.query,
        } as TQuery;

        const result = await queryBus.execute(query);

        if (result.success) {
          reply.status(200).send(result);
        } else {
          reply.status(400).send(result);
        }
      } catch (error) {
        fastify.log.error("Query route error", { error });
        reply.status(500).send({
          success: false,
          error: "Internal server error",
        });
      }
    },
  });
};
```

### Route Registration Example

```typescript
// Register post management routes
export async function registerPostRoutes(fastify: FastifyInstance) {
  // Create post command
  createCommandRoute<CreatePostCommand, CreatePostResult>(fastify, {
    method: "POST",
    url: "/api/posts",
    commandType: "post.create",
    schema: {
      body: {
        type: "object",
        required: ["aggregateId", "data"],
        properties: {
          aggregateId: { type: "string" },
          data: {
            type: "object",
            required: ["title", "content", "channelIds"],
            properties: {
              title: { type: "string", maxLength: 200 },
              content: { type: "string", maxLength: 10000 },
              channelIds: {
                type: "array",
                items: { type: "string" },
                minItems: 1,
              },
            },
          },
        },
      },
    },
    preHandler: [authenticate, authorize(["post:create"])],
  });

  // Get posts query
  createQueryRoute<GetPostsByProjectQuery, PostSummary[]>(fastify, {
    method: "GET",
    url: "/api/projects/:projectId/posts",
    queryType: "posts.getByProject",
    schema: {
      params: {
        type: "object",
        required: ["projectId"],
        properties: {
          projectId: { type: "string" },
        },
      },
      querystring: {
        type: "object",
        properties: {
          status: { type: "string", enum: ["DRAFT", "SCHEDULED", "PUBLISHED"] },
          page: { type: "integer", minimum: 1, default: 1 },
          limit: { type: "integer", minimum: 1, maximum: 100, default: 20 },
        },
      },
    },
    preHandler: [authenticate, authorize(["post:read"])],
  });
}
```

## Read Model Projections

### Event Handlers for Projections

**Location**: `apps/api/src/cqrs/projections/`

Read models are updated through event handlers:

```typescript
export class PostProjectionHandler {
  constructor(
    private readModelDb: PrismaClient,
    private logger: Logger
  ) {}

  @EventHandler("post.created")
  async handlePostCreated(event: PostCreatedEvent): Promise<void> {
    await this.readModelDb.postReadModel.create({
      data: {
        id: event.aggregateId,
        title: event.data.title,
        content: event.data.content,
        status: "DRAFT",
        userId: event.data.userId,
        projectId: event.data.projectId,
        createdAt: event.timestamp,
        updatedAt: event.timestamp,
        channels: {
          create: event.data.channelIds.map((channelId) => ({
            channelId,
            status: "PENDING",
          })),
        },
      },
    });
  }

  @EventHandler("post.published")
  async handlePostPublished(event: PostPublishedEvent): Promise<void> {
    await this.readModelDb.postReadModel.update({
      where: { id: event.aggregateId },
      data: {
        status: "PUBLISHED",
        publishedAt: event.timestamp,
        updatedAt: event.timestamp,
      },
    });

    // Update channel statuses
    await this.readModelDb.postChannelReadModel.updateMany({
      where: {
        postId: event.aggregateId,
        channelId: { in: event.data.successfulChannels },
      },
      data: { status: "PUBLISHED" },
    });

    await this.readModelDb.postChannelReadModel.updateMany({
      where: {
        postId: event.aggregateId,
        channelId: { in: event.data.failedChannels },
      },
      data: { status: "FAILED" },
    });
  }
}
```

## Performance Optimizations

### Caching Integration

CQRS queries automatically integrate with the intelligent caching system:

```typescript
// Cache configuration for different query types
const QUERY_CACHE_CONFIG = {
  "posts.getByProject": {
    ttl: 300, // 5 minutes
    tags: (query: GetPostsByProjectQuery) => [`project:${query.projectId}`, "posts"],
  },
  "analytics.getPostMetrics": {
    ttl: 900, // 15 minutes
    tags: (query: GetPostMetricsQuery) => [`post:${query.postId}`, "analytics"],
  },
};
```

### Batch Operations

For high-throughput scenarios, batch command processing is supported:

```typescript
export class BatchCommandProcessor {
  async executeBatch(commands: Command[]): Promise<BatchCommandResult> {
    const results: CommandResult[] = [];
    const events: DomainEvent[] = [];

    await this.db.$transaction(async (tx) => {
      for (const command of commands) {
        try {
          const result = await this.executeInTransaction(command, tx);
          results.push(result);
          events.push(...(result.events || []));
        } catch (error) {
          results.push({
            success: false,
            error: error instanceof Error ? error.message : "Batch execution failed",
          });
        }
      }
    });

    // Publish all events after successful transaction
    for (const event of events) {
      await this.eventPublisher.publish(event);
    }

    return {
      total: commands.length,
      successful: results.filter((r) => r.success).length,
      failed: results.filter((r) => !r.success).length,
      results,
    };
  }
}
```

## Testing CQRS Components

### Command Handler Testing

```typescript
import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { mock } from "node:test";

describe("CreatePostCommandHandler", () => {
  let handler: CreatePostCommandHandler;
  let mockRepository: PostRepository;
  let mockEventStore: EventStore;

  beforeEach(() => {
    mockRepository = createMockRepository();
    mockEventStore = createMockEventStore();
    handler = new CreatePostCommandHandler(mockRepository, mockEventStore, logger);
  });

  it("should create post successfully", async () => {
    const command: CreatePostCommand = {
      id: "cmd-123",
      type: "post.create",
      aggregateId: "post-456",
      data: {
        title: "Test Post",
        content: "Content...",
        channelIds: ["channel-1"],
      },
      timestamp: new Date(),
    };

    const result = await handler.handle(command);

    assert.ok(result.success, "Command should succeed");
    assert.strictEqual(result.success, true);
  });
});
```

### Query Handler Testing

```typescript
import { describe, it } from "node:test";
import assert from "node:assert/strict";

describe("GetPostsByProjectQueryHandler", () => {
  it("should return cached results when available", async () => {
    const cachedData = [{ id: "post-1", title: "Cached Post" }];
    mockCache.get = async () => cachedData;

    const query: GetPostsByProjectQuery = {
      type: "posts.getByProject",
      projectId: "proj-123",
    };

    const result = await handler.handle(query);

    assert.ok(result.success, "Query should succeed");
    assert.deepStrictEqual(result.data, cachedData);
    assert.strictEqual(result.fromCache, true);
  });
});
```

## Monitoring and Metrics

### Command Metrics

Track command execution performance and success rates:

```typescript
// Command execution metrics
const commandExecutionTime = new prometheus.Histogram({
  name: "cqrs_command_execution_duration_seconds",
  help: "Time spent executing CQRS commands",
  labelNames: ["command_type", "status"],
});

const commandExecutionCount = new prometheus.Counter({
  name: "cqrs_command_executions_total",
  help: "Total number of CQRS command executions",
  labelNames: ["command_type", "status"],
});
```

### Query Metrics

Track query performance and cache hit rates:

```typescript
// Query execution metrics
const queryExecutionTime = new prometheus.Histogram({
  name: "cqrs_query_execution_duration_seconds",
  help: "Time spent executing CQRS queries",
  labelNames: ["query_type", "cache_hit"],
});

const queryCacheHitRate = new prometheus.Gauge({
  name: "cqrs_query_cache_hit_rate",
  help: "Cache hit rate for CQRS queries",
  labelNames: ["query_type"],
});
```

## Best Practices

### Command Design

1. **Idempotency**: Commands should be idempotent where possible
2. **Validation**: Always validate commands before execution
3. **Atomic Operations**: Keep command operations atomic
4. **Event Sourcing**: Generate meaningful domain events

### Query Optimization

1. **Denormalization**: Design read models for query efficiency
2. **Indexing**: Index frequently queried fields
3. **Caching**: Cache expensive or frequently accessed queries
4. **Pagination**: Always implement pagination for list queries

### Error Handling

1. **Graceful Degradation**: Handle failures gracefully
2. **Retry Logic**: Implement retry logic for transient failures
3. **Logging**: Log all errors with sufficient context
4. **Monitoring**: Monitor success rates and performance

This CQRS integration provides a robust foundation for scalable read/write operations while maintaining clear separation of concerns and high performance.
