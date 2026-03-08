import { PrismaClient, Prisma } from "../generated/prisma/client/client.js";
import { PrismaPg } from "@prisma/adapter-pg";
import { cpus } from "os";

// Re-export everything from the generated client for downstream consumers.
// This allows the rest of the codebase to import from "@infra/prisma"
// instead of the generated path or "@prisma/client".
export { Prisma } from "../generated/prisma/client/client.js";
export type { PrismaClient } from "../generated/prisma/client/client.js";

// Re-export all model types (used as `type Account`, `type Post`, etc.)
export type {
  Account,
  AdminUser,
  AdminSession,
  AuditLog,
  Project,
  Post,
  PostContent,
  PostMedia,
  Channel,
  PublishLog,
  Analytics,
  Thread,
  Tweet,
  ApiKey,
  ProviderConnection,
  ContentTemplate,
  PublishingQueue,
  ContentVersion,
  InstagramStoryProject,
  InstagramStory,
  VideoProcessingJob,
  VideoSegment,
  InstagramAnalytics,
  SchedulingRule,
  WebhookEvent,
  WebhookSubscription,
  WebhookDeadLetter,
  Template,
  TemplateVersion,
  ABTest,
  TemplateUsageEvent,
  TemplateComponent,
  TemplateComponentUsage,
  TemplateCommit,
  TemplateCollaboration,
  TemplateAnalytics,
} from "../generated/prisma/client/client.js";

// Re-export all enums (used as values: Provider.X, SubscriptionTier.PRO, etc.)
export {
  Provider,
  SubscriptionTier,
  LogStatus,
  MediaKind,
  ThreadStrategy,
  TweetStatus,
  AdminRole,
  ConnectionStatus,
  PublishingStatus,
  VersionChangeType,
  StoryProjectStatus,
  StoryStatus,
  VideoProcessingStatus,
  SegmentStatus,
  InstagramContentType,
  QueuePriority,
  WebhookEventType,
  WebhookProcessingStatus,
  ABTestStatus,
  TemplateUsageAction,
  TemplateComponentType,
  TemplatePermission,
  TemplateCollaboratorRole,
} from "../generated/prisma/client/client.js";

// Also re-export the $Enums namespace for backward compatibility
export { $Enums } from "../generated/prisma/client/client.js";

const g = globalThis as unknown as {
  prisma?: InstanceType<typeof PrismaClient>;
  prismaConnectionCount?: number;
};

// Connection pool configuration based on environment
const getConnectionPoolConfig = () => {
  const isProduction = process.env.NODE_ENV === "production";
  const cpuCount = cpus().length;

  return {
    max: isProduction
      ? Math.max(cpuCount * 2, 10) // Production: 2x CPU cores, minimum 10
      : Math.min(cpuCount + 2, 8), // Development: CPU + 2, maximum 8
    connectionTimeoutMillis: 10000,
    idleTimeoutMillis: 580000, // 9 minutes 40 seconds
  };
};

// Create Prisma client with pg adapter (Prisma 7 requirement)
const createPrismaClient = () => {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL environment variable is required");
  }

  const poolConfig = getConnectionPoolConfig();

  const adapter = new PrismaPg({ connectionString, ...poolConfig });

  const client = new PrismaClient({
    adapter,
    errorFormat: process.env.NODE_ENV === "production" ? "minimal" : "pretty",
    transactionOptions: {
      isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
      maxWait: 5000,
      timeout: 30000,
    },
  });

  return client;
};

// Track connection count for monitoring
if (!g.prismaConnectionCount) {
  g.prismaConnectionCount = 0;
}

/**
 * Resolve the underlying PrismaClient, creating it lazily on first call.
 * The instance is cached on globalThis to survive hot-reloads in development.
 */
const resolvePrisma = (): InstanceType<typeof PrismaClient> => {
  if (!g.prisma) {
    g.prisma = createPrismaClient();
  }
  return g.prisma;
};

/**
 * Lazy-initialized Prisma singleton.
 *
 * Uses a Proxy so that `import { prisma } from "@infra/prisma"` never throws
 * at import time — the actual PrismaClient is created on first property access.
 * This allows unit tests (which mock prisma via DI) to import modules that
 * transitively import this file without requiring DATABASE_URL.
 */
export const prisma = new Proxy({} as InstanceType<typeof PrismaClient>, {
  get(_, prop, receiver) {
    const target = resolvePrisma();
    const value = Reflect.get(target, prop, receiver);
    // Bind methods to the real client so `this` is correct
    return typeof value === "function" ? value.bind(target) : value;
  },
  set(_, prop, value) {
    return Reflect.set(resolvePrisma(), prop, value);
  },
  has(_, prop) {
    return Reflect.has(resolvePrisma(), prop);
  },
  ownKeys() {
    return Reflect.ownKeys(resolvePrisma());
  },
  getOwnPropertyDescriptor(_, prop) {
    return Reflect.getOwnPropertyDescriptor(resolvePrisma(), prop);
  },
});

// Connection pool monitoring utilities
export const getConnectionPoolStats = () => {
  const poolConfig = getConnectionPoolConfig();
  return {
    configured_limit: poolConfig.max,
    connect_timeout: poolConfig.connectionTimeoutMillis,
    pool_timeout: poolConfig.connectionTimeoutMillis,
    socket_timeout: poolConfig.idleTimeoutMillis,
    current_connections: g.prismaConnectionCount || 0,
  };
};

// Graceful shutdown helper — only disconnects if the client was ever initialized
export const closeDatabaseConnections = async () => {
  if (!g.prisma) return; // Never initialized, nothing to close
  try {
    await g.prisma.$disconnect();
    console.log("Database connections closed gracefully");
  } catch (error) {
    console.error("Error closing database connections:", error);
  }
};

// Health check helper
export const checkDatabaseHealth = async () => {
  try {
    await prisma.$queryRaw`SELECT 1 as health_check`;
    return { healthy: true, timestamp: new Date() };
  } catch (error) {
    return {
      healthy: false,
      error: error instanceof Error ? error.message : "Unknown error",
      timestamp: new Date(),
    };
  }
};
