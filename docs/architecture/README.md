# Architecture

OmniPost implements a **Hexagonal Architecture (Ports & Adapters) + DDD + CQRS + Event-Driven + Saga** pattern that separates business logic from infrastructure concerns.

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────┐
│                    FRAMEWORKS & DRIVERS (Outer)                      │
│  ┌─────────────────────────────────────────────────────────────┐    │
│  │  Fastify, Next.js, Prisma, Redis, BullMQ, S3, Social APIs   │    │
│  └─────────────────────────────────────────────────────────────┘    │
│                              │                                       │
│  ┌───────────────────────────▼───────────────────────────────────┐  │
│  │              INTERFACE ADAPTERS (Adapters Layer)              │  │
│  │  ┌─────────────┐ ┌─────────────┐ ┌─────────────────────────┐ │  │
│  │  │ Controllers │ │   Gateways  │ │    Presenters          │ │  │
│  │  │ (Routes)    │ │ (Repos)     │ │    (Response Format)   │ │  │
│  │  └─────────────┘ └─────────────┘ └─────────────────────────┘ │  │
│  └───────────────────────────▲───────────────────────────────────┘  │
│                              │                                       │
│  ┌───────────────────────────┼───────────────────────────────────┐  │
│  │              APPLICATION (Use Cases / Ports Layer)            │  │
│  │  ┌─────────────────────────────────────────────────────────┐ │  │
│  │  │  Use Cases: CreatePost, PublishPost, FetchAnalytics     │ │  │
│  │  │  Input Ports: Service interfaces                        │ │  │
│  │  │  Output Ports: Repository interfaces, Provider ports    │ │  │
│  │  └─────────────────────────────────────────────────────────┘ │  │
│  └───────────────────────────▲───────────────────────────────────┘  │
│                              │                                       │
│  ┌───────────────────────────┼───────────────────────────────────┐  │
│  │                    DOMAIN (Entities Layer)                    │  │
│  │  ┌─────────────────────────────────────────────────────────┐ │  │
│  │  │  Entities: Post, Channel, Project, Account, User        │ │  │
│  │  │  Value Objects: PostContent, MediaAttachment, Locale    │ │  │
│  │  │  Domain Services: PublishingRules, ContentValidation    │ │  │
│  │  │  Domain Events: PostCreated, PostPublished              │ │  │
│  │  └─────────────────────────────────────────────────────────┘ │  │
│  └───────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────┘
```

## Current Directory Structure

The codebase uses a **domain-driven + feature-based organization** that aligns with Hexagonal Architecture (Ports & Adapters):

```
apps/api/src/
├── domain/                # DDD domain layer (entities, value objects, aggregates, events, repositories)
├── application/           # Use cases (posts, analytics, events/CQRS, crisis, links)
├── infrastructure/        # Repository implementations, DI container, plugins
├── accounts/              # Account routes + AccountRepository.ts
├── admin/                 # Admin authentication & management
│   └── auth/              # Admin-specific auth (RBAC, MFA)
├── analytics/             # Analytics routes + AnalyticsRepository.ts
├── auth/                  # Auth routes + UserRepository.ts + apiKeyRoutes
├── billing/               # Subscription routes + services
├── channels/              # Channel routes
├── content/               # SyncEngine, ContentVersionManager, ContentTransformer
├── events/                # EventService, EventPublisher, EventStore
├── health/                # healthRoutes.ts
├── links/                 # Link tracking routes
├── middleware/            # autoCacheMiddleware, correlationMiddleware, metricsMiddleware
├── monitoring/            # performanceMonitor, cacheStatsRoutes
├── orchestration/         # ProviderCoordinator, ContentSynchronizer, ConflictResolver
├── posts/                 # postRoutes, postsService, optimizedPostsRoutes
├── projects/              # projectRoutes, ProjectRepository.ts
├── providers/             # providerRoutes, providerRegistry, cachedProviderRoutes
├── saga/                  # SagaManager, SagaIntegration
├── security/              # enhancedValidator, inputValidation, securityHeaders, rateLimit
├── templates/             # templateRoutes, templateService, TemplateHandlers
├── trends/                # trendAnalysisService, TrendReportBuilder
├── types/                 # fastify.d.ts type declarations
├── utils/                 # dbOptimization
├── webhooks/              # webhookHandler, webhookManager, processors/
└── index.ts               # createApp() entry point
```

## Layer Mapping

| Clean Architecture Layer | Current Location                                             |
| ------------------------ | ------------------------------------------------------------ |
| **Domain**               | `domain/`, `events/`                                         |
| **Application**          | `application/`, `orchestration/`, `saga/`                    |
| **Infrastructure**       | `infrastructure/`, `providers/`                              |
| **Interface**            | Domain areas (posts/, auth/, analytics/, etc.) expose routes |

## Target Directory Structure

Future refactoring will consolidate into explicit layers:

```text
apps/api/src/
├── domain/                      # DOMAIN LAYER (Innermost)
│   ├── entities/               # Business entities
│   ├── value-objects/          # Immutable value types
│   ├── events/                 # Domain events
│   ├── services/               # Domain services (pure logic)
│   └── errors/                 # Domain errors
│
├── application/                 # APPLICATION LAYER (Use Cases)
│   ├── use-cases/              # Application use cases
│   ├── ports/                  # Input & Output ports (interfaces)
│   └── dto/                    # Data transfer objects
│
├── infrastructure/              # INFRASTRUCTURE LAYER (Adapters)
│   ├── persistence/            # Database adapters (Prisma)
│   ├── providers/              # Social media adapters
│   ├── queue/                  # Job queue adapters (BullMQ)
│   ├── storage/                # File storage (S3)
│   ├── cache/                  # Redis cache
│   └── ai/                     # AI service adapters
│
├── interfaces/                  # INTERFACE ADAPTERS LAYER
│   ├── http/                   # HTTP routes & controllers
│   ├── middleware/             # Request middleware
│   └── presenters/             # Response formatters
│
└── config/                      # Configuration
```

## Key Design Patterns

### 1. Ports & Adapters (Hexagonal)

Separates core business logic from external systems through interfaces (ports) and implementations (adapters).

**Ports** (`packages/ports/`):

- `RepoPort` - Database repository interface
- `QueuePort` - Job queue interface
- `StoragePort` - File storage interface
- `ProviderAdapter` - Social media provider interface

**Adapters** (`packages/adapters/`):

- `db-prisma` - Prisma implementation
- `queue-bullmq` - BullMQ implementation
- `storage-s3` - S3 implementation
- `cache-redis` - Redis implementation

### 2. Result Pattern (Functional Error Handling)

All operations return typed `Result<T, E>` instead of throwing exceptions:

```typescript
type Result<T, E> = { ok: true; value: T } | { ok: false; error: E };

// Usage
const result = await service.createPost(data);
if (result.ok) {
  console.log(result.value); // Success
} else {
  console.log(result.error); // Failure
}
```

### 3. CQRS (Command Query Responsibility Segregation)

Separates read and write operations:

- **Commands**: `CreatePost`, `UpdatePost`, `PublishPost`
- **Queries**: `GetPost`, `ListPosts`, `SearchPosts` (with caching)

### 4. Repository Pattern

Clean data access abstraction:

```typescript
interface IPostRepository {
  create(data: CreatePostDTO): Promise<Result<Post, DatabaseError>>;
  findById(id: string): Promise<Result<Post | null, DatabaseError>>;
  findByProject(projectId: string): Promise<Result<Post[], DatabaseError>>;
  update(id: string, data: UpdatePostDTO): Promise<Result<Post, DatabaseError>>;
  delete(id: string): Promise<Result<void, DatabaseError>>;
}
```

### 5. Service Layer Pattern

Business logic in dedicated services extending `BaseService`:

```typescript
class PostsService extends BaseService {
  async createPost(dto: CreatePostDTO): Promise<Result<Post, ServiceError>> {
    return this.executeWithErrorHandling(async () => {
      // Business logic here
    });
  }
}
```

### 6. Saga Pattern

For distributed transactions across multiple providers:

- `SagaManager` - Orchestrates long-running transactions
- Supports rollback on partial failures
- Integrates with event system

### 7. Orchestration Pattern

`PublishingOrchestrator` coordinates multi-provider publishing:

- Provider selection
- Content adaptation per platform
- Parallel publishing
- Rollback on failure
- Metrics collection

### 8. Database Access Pattern (Prisma + DI)

The DI container wraps singletons via `registerInstance(TOKENS.X, singleton)`, providing testability through mock injection and centralized lifecycle management. However, **20+ services import `prisma` directly from `@infra/prisma` at module level** rather than receiving it through constructor injection. This is an accepted trade-off:

- The `@infra/prisma` module exports a single shared instance, so direct imports and DI-resolved references point to the same object.
- Full constructor injection would require rewriting ~50 services with no immediate behavioral benefit.
- DI still enables test-time substitution: tests override the container token to inject a mock/stub Prisma client where needed.
- Routes that use DI-resolved repositories (via `container.resolve(TOKENS.PostRepository)`) already achieve full decoupling at the boundary layer.

**Future evolution**: incrementally migrate services to accept `prisma` via constructor parameters as they are refactored, eliminating the direct import path over time.

## Dependency Flow

```
Domain Layer (innermost)
    ↑ depends on nothing
    │
Application Layer
    ↑ depends on Domain
    │
Infrastructure Layer
    ↑ depends on Application (implements ports)
    │
Interface Layer (outermost)
    ↑ depends on Application
```

**Rule**: Dependencies always point inward. Inner layers never know about outer layers.

## Benefits

1. **Testability**: Business logic can be tested without infrastructure
2. **Flexibility**: Easy to swap implementations (e.g., change database)
3. **Maintainability**: Clear separation of concerns
4. **Scalability**: Each layer can evolve independently

## Hexagonal Architecture Status

The codebase achieves **~97% Hexagonal Architecture compliance** (FASE H0-H12 complete):

- **H0**: Repo hygiene, ESLint zero-warnings
- **H1**: Domain types in @shared/types (ProviderName, DomainAnalytics, enums)
- **H2**: 49 Prisma enum/type imports replaced with @shared/types
- **H3**: Port interfaces (AccountRepository, ProjectRepository, ChannelRepository, AnalyticsQueryRepository)
- **H4a/H4b**: @prisma/client centralized through @infra/prisma; 4 Prisma adapters + DI container wired
- **H5**: DI container bootstrapped + 5 routes migrated (postRoutes, providerRoutes, cachedProviderRoutes, linkRoutes, crisisRoutes)
- **H6**: Anti-Corruption Layers — WebhookEventMapper ACL created; provider adapters verified compliant
- **H7**: Legacy src/repositories/ deleted; 0 @prisma/client outside infra; repos migrated to domain areas
- **H8**: All files >800 lines split into focused <500 line files
- **H9**: Test patterns uniform (assert/strict, concurrency:1 for shared mutable state)
- **H10**: Swagger/OpenAPI + API Key management complete
- **H11**: 327/327 source files have JSDoc headers
- **H12**: Soft Delete Universal (deletedAt + hardDelete on Account, Project, Channel, Post)

---

<!-- markdownlint-disable-next-line MD036 -->

_Last updated: February 2026_
