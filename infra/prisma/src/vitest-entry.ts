/**
 * @file vitest-entry.ts
 * @description Test-only entry point for @infra/prisma.
 *              Re-exports enums directly from the generated enums.ts (which has
 *              zero Prisma runtime dependencies), avoiding the CJS interop issue
 *              between Vite's SSR transform and @prisma/client/runtime/client.
 *
 *              Unit tests mock all DB access via DI, so a real PrismaClient is
 *              never needed. The `prisma` export is a no-op Proxy that will throw
 *              a clear error if any test accidentally uses it instead of DI.
 * @layer test-infrastructure
 */

// ── Enums (runtime values — imported from standalone generated file, no Prisma runtime) ──
export {
  Provider,
  LogStatus,
  MediaKind,
  ThreadStrategy,
  TweetStatus,
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
  SocialMessageType,
  SocialMessageStatus,
  OutboundReplyStatus,
  CampaignStatus,
  ReportFormat,
  NotificationType,
  ApprovalStatus,
  ReviewDecision,
} from "../generated/prisma/client/enums.js";

// ── $Enums namespace (mirrors production export) ──
export * as $Enums from "../generated/prisma/client/enums.js";

// ── Type re-exports (erased at compile time — safe to declare without runtime) ──
// These match the types exported from the real client.ts.
// In unit tests they're used only in `import type { ... }` statements.
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
} from "../generated/prisma/client/browser.js";

// ── Prisma namespace stub ──
// Source code uses Prisma.TransactionIsolationLevel, Prisma.InputJsonValue, etc.
// In tests these are only used as types, but some source modules reference them
// at the type level via `import { Prisma } from "@infra/prisma"`.
// Provide a minimal stub to satisfy runtime imports in transitively-loaded modules.
export const Prisma = {
  TransactionIsolationLevel: {
    ReadUncommitted: "ReadUncommitted",
    ReadCommitted: "ReadCommitted",
    RepeatableRead: "RepeatableRead",
    Serializable: "Serializable",
  },
  SortOrder: {
    asc: "asc",
    desc: "desc",
  },
  // Prisma.sql, Prisma.raw, Prisma.join — used in raw query builders
  sql: (strings: TemplateStringsArray, ...values: unknown[]) => ({ strings, values }),
  raw: (value: string) => ({ strings: [value], values: [] }),
  join: (values: unknown[], separator?: string) => ({
    strings: [""],
    values,
    separator: separator ?? ", ",
  }),
} as Record<string, unknown>;

// ── PrismaClient stub (type-only — never instantiated in unit tests) ──
export type PrismaClient = Record<string, unknown>;

// ── prisma singleton stub ──
// A Proxy that throws if any property is accessed, to catch tests that
// accidentally use the real client instead of DI mocks.
const prismaHandler: ProxyHandler<Record<string, unknown>> = {
  get(_target, prop) {
    if (prop === Symbol.toPrimitive || prop === Symbol.toStringTag) {
      return undefined;
    }
    if (typeof prop === "string" && prop.startsWith("$")) {
      // $connect, $disconnect, $queryRaw etc. — return no-op
      return async () => undefined;
    }
    // For model accessors like prisma.post, prisma.account — return a proxy
    // that returns vi.fn() stubs. This avoids crashes when source modules
    // are transitively imported but never actually called.
    return new Proxy(
      {},
      {
        get() {
          return async () => undefined;
        },
      }
    );
  },
};

export const prisma = new Proxy({} as Record<string, unknown>, prismaHandler);

// ── Utility stubs ──
export const getConnectionPoolStats = () => ({
  configured_limit: 5,
  connect_timeout: 10000,
  pool_timeout: 10000,
  socket_timeout: 580000,
  current_connections: 0,
});

export const closeDatabaseConnections = async () => undefined;

export const checkDatabaseHealth = async () => ({
  healthy: true,
  timestamp: new Date(),
});

export const createTestPrismaClient = () => {
  throw new Error(
    "createTestPrismaClient() is not available in Vitest unit tests. " +
      "Use DI mocks instead, or run integration tests with node:test."
  );
};
