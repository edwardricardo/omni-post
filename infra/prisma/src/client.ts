/**
 * @file client.ts
 * @description Production PrismaClient singleton wired to the PrismaPg adapter,
 *              with lazy initialization, connection pool tuning, health checks,
 *              and a boot-time auth-failure verifier. Re-exports every model
 *              type, enum, and the `Prisma` namespace from the generated client
 *              so downstream code imports from `@infra/prisma` uniformly.
 * @layer infrastructure
 */
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
  Role,
  RolePermission,
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
  ContentTemplate,
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
  ProviderPricingTier,
  AccountPricingTier,
  ProviderBundle,
} from "../generated/prisma/client/client.js";

// Re-export all enums (used as values: Provider.X, etc.)
export {
  Provider,
  LogStatus,
  MediaKind,
  ThreadStrategy,
  TweetStatus,
  VersionChangeType,
  StoryProjectStatus,
  StoryStatus,
  VideoProcessingStatus,
  SegmentStatus,
  InstagramContentType,
  WebhookEventType,
  WebhookProcessingStatus,
  ABTestStatus,
  TemplateUsageAction,
  TemplateComponentType,
  TemplatePermission,
  TemplateCollaboratorRole,
  CredentialGroup,
  AccountCredentialGroup,
} from "../generated/prisma/client/client.js";

// Re-export the $Enums namespace.
export { $Enums } from "../generated/prisma/client/client.js";

const g = globalThis as unknown as {
  prisma?: InstanceType<typeof PrismaClient>;
  prismaConnectionCount?: number;
};

/**
 * Session parameters sent in the connection STARTUP packet, so they are in
 * force before the first statement of the first transaction.
 *
 * `timezone=UTC` is load-bearing, not hygiene, and it guards two distinct
 * defects — the loud one and the silent one.
 *
 * LOUD. PostgreSQL evaluates `timestamptz + interval '1 year'` in the SESSION
 * time zone, and the `DeletionRecord_retainUntil_floor` CHECK constraint is
 * written in exactly that form. The application computes the same value with
 * `setUTCFullYear`, which is always UTC. Let the two disagree and the database
 * rejects a retention deadline the application computed correctly: measured
 * against this schema, a session on `America/New_York` refuses 248 of the
 * ~35 000 hourly instants swept over 2026-2029 at a one-year window. A GDPR
 * erasure aborts with a constraint violation that surfaces as a 500.
 *
 * SILENT, and far wider. The driver's `timestamptz` round-trip is session-
 * relative too: on a session set to `America/New_York`, `SELECT timestamptz
 * '2027-03-08 08:00:00+00'` comes back to JavaScript as `2027-03-08T03:00:00Z`
 * — the same wall clock, relabelled as UTC, five hours wrong. That is not
 * specific to deletion. EVERY `timestamptz` the application reads would be off
 * by the session offset: scheduled publish times, analytics windows, retention
 * deadlines, saga timeouts. No error is raised anywhere. The CHECK constraint
 * above is simply the one place the drift happens to be audible.
 *
 * Nothing else pinned it. The invariant held only because the containers happen
 * to run `Etc/UTC`; a server-side `timezone` in `postgresql.conf`, an
 * `ALTER ROLE ... SET timezone`, or a managed provider that defaults to a
 * regional zone would have broken both silently, in production only.
 *
 * Both PrismaClient construction sites — this one and `createTestPrismaClient`
 * — apply this constant, so tests exercise the same session the API writes in.
 * Duplicate `-c` settings are last-wins, which is what lets a test simulate a
 * hostile server default and still prove the pin overrides it.
 */
export const PG_SESSION_OPTIONS = "-c timezone=UTC";

// Connection pool configuration. Defaults derive from CPU count + NODE_ENV;
// each value is overridable via env so ops can tune for cloud topology
// without a code change. Idle timeout sits just below the typical cloud LB
// 10-minute idle cutoff so Postgres recycles connections before the LB
// silently drops them.
const getConnectionPoolConfig = () => {
  const isProduction = process.env.NODE_ENV === "production";
  const cpuCount = cpus().length;

  const defaultMax = isProduction
    ? Math.max(cpuCount * 2, 10) // Production: 2x CPU cores, minimum 10
    : Math.min(cpuCount + 2, 8); // Development: CPU + 2, maximum 8

  const parsePositiveInt = (raw: string | undefined, fallback: number): number => {
    if (!raw) return fallback;
    const n = Number(raw);
    return Number.isFinite(n) && n > 0 ? Math.trunc(n) : fallback;
  };

  return {
    max: parsePositiveInt(process.env.DB_POOL_SIZE, defaultMax),
    connectionTimeoutMillis: parsePositiveInt(process.env.DB_CONNECTION_TIMEOUT, 10_000),
    idleTimeoutMillis: parsePositiveInt(process.env.DB_IDLE_TIMEOUT, 580_000),
  };
};

// Create Prisma client with pg adapter (Prisma 7 requirement)
const createPrismaClient = () => {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL environment variable is required");
  }

  const poolConfig = getConnectionPoolConfig();

  // `options` sits AFTER the pool spread so a future pool key cannot silently
  // displace the session pin; see PG_SESSION_OPTIONS for why it is load-bearing.
  const adapter = new PrismaPg({ connectionString, ...poolConfig, options: PG_SESSION_OPTIONS });

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

/**
 * @function getConnectionPoolStats
 * @description Returns the configured pool size + current open-connection count.
 * @returns Snapshot with `configured_limit`, `connect_timeout`, `pool_timeout`,
 *          `socket_timeout`, and `current_connections`.
 */
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

/**
 * @function closeDatabaseConnections
 * @description Disconnects the PrismaClient if it was ever initialized. Safe to
 *              call during shutdown even when the singleton was never resolved.
 * @returns Resolves after `$disconnect()` completes (or immediately if unused).
 */
export const closeDatabaseConnections = async () => {
  if (!g.prisma) return; // Never initialized, nothing to close
  try {
    await g.prisma.$disconnect();
    console.log("Database connections closed gracefully");
  } catch (error) {
    console.error("Error closing database connections:", error);
  }
};

/**
 * @function checkDatabaseHealth
 * @description Runs `SELECT 1` against the configured database and reports the
 *              outcome. Used by `/health` endpoints to surface DB liveness.
 * @returns `{ healthy, timestamp }` on success, `{ healthy: false, error, timestamp }` on failure.
 */
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

/**
 * Boot-time fail-fast Prisma auth verification.
 *
 * Runs `SELECT 1` against `DATABASE_URL` and throws a descriptive error if
 * authentication fails (Postgres SQLSTATE 28P01). The most common cause of
 * 28P01 in dev is a stale Postgres volume: when `POSTGRES_PASSWORD` is
 * rotated in `.env` without a `docker compose down -v`, the container init
 * script does NOT re-apply the password (Postgres only initializes on a
 * fresh data dir). The container env says X, the volume says Y, the app
 * sends X, Postgres rejects with 28P01.
 *
 * Call this once during boot so a misconfigured environment fails immediately
 * instead of spamming auth-failure logs from BackgroundTaskScheduler tasks.
 */
export const verifyDatabaseAuth = async (): Promise<void> => {
  try {
    await prisma.$queryRaw`SELECT 1`;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const code =
      error && typeof error === "object" && "code" in error ? String(error.code) : undefined;
    const isAuthFailure =
      code === "P1000" ||
      message.includes("Authentication failed") ||
      message.includes("28P01") ||
      message.includes("password authentication failed");

    if (isAuthFailure) {
      throw new Error(
        "Database authentication failed (Postgres 28P01). The most common " +
          "cause in dev is a stale Postgres volume holding a password that " +
          "no longer matches the one in .env. Resolve with:\n" +
          "    docker compose down -v && pnpm db:up && pnpm db:migrate && pnpm db:seed\n" +
          `Original error: ${message}`
      );
    }
    throw error;
  }
};
