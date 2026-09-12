/**
 * @file analyticsRoutes.characterization.test.ts
 * @description Characterization net for the CUSTOMER analytics routes — the three
 *              handlers that read the database directly: GET /analytics/dashboard,
 *              GET /export and GET /analytics/project/:projectId. It exists to make
 *              "zero observable behaviour change" checkable while the data-access
 *              seam behind those handlers moves from a injected Prisma client to
 *              ports, and it drives the requests through the REAL route plugin and
 *              the REAL container so the suite text is identical on both sides of
 *              that move (a handler-direct harness would have to be edited when the
 *              constructor arity changes, which is exactly the property to avoid).
 *
 *              Assertions pin SHAPE, never arithmetic. The handlers carry known
 *              reporting defects (per-channel double counting, bounded reads
 *              reported as totals, permanently blank CSV columns, hard-coded zero
 *              fields); reproducing them is the point, declaring their output
 *              "expected" is not — a value assertion here would have to be edited
 *              by whoever eventually repairs them.
 *
 *              This file lives in its own directory on purpose: the suite named
 *              `tests/unit/analyticsRoutes.test.ts` imports the ADMIN routes file
 *              of the same basename, so a same-directory neighbour would be one
 *              rename away from re-creating that test-subject mismatch.
 * @layer infrastructure
 */

import { describe, it, beforeAll, afterAll, expect, vi } from "vitest";
import type { FastifyInstance } from "fastify";

// The principal the mocked middleware binds. Hoisted so the `vi.mock` factory
// below (which vitest lifts above every import) can read it. The accountId is a
// fixed constant and is deliberately NOT derived from the request: a double that
// echoed the query back as the principal would make every ownership check pass by
// construction, and every 403 branch here would then prove nothing.
const { CUSTOMER_PRINCIPAL } = vi.hoisted(() => ({
  CUSTOMER_PRINCIPAL: {
    id: "customer-user-analytics",
    accountId: "c0000000-0000-4000-8000-0000000000a1",
    roleId: "customer-role-owner",
    roleName: "OWNER",
    permissions: ["analytics:read", "analytics:export"] as readonly string[],
  },
}));

vi.mock("../../../src/auth/customerAuthMiddleware.js", () => ({
  requireClientAuth: async (request: { customerUser?: unknown }) => {
    request.customerUser = { ...CUSTOMER_PRINCIPAL };
  },
}));

vi.mock("../../../src/lib/logger.js", async (importOriginal) => {
  const original = await importOriginal<Record<string, unknown>>();
  const noop = vi.fn();
  const noopLogger = {
    info: noop,
    warn: noop,
    error: noop,
    debug: noop,
    trace: noop,
    fatal: noop,
    child: () => noopLogger,
  };
  return {
    ...original,
    logger: noopLogger,
    httpLogger: noopLogger,
    dbLogger: noopLogger,
    queueLogger: noopLogger,
    authLogger: noopLogger,
    cacheLogger: noopLogger,
    providerLogger: noopLogger,
    webhookLogger: noopLogger,
    createLogger: () => noopLogger,
  };
});

import {
  createMockPrismaModule,
  createStore,
  buildModelMock,
  matchesWhere,
  type ModelStore,
} from "../helpers/mockPrisma.js";

// ---------------------------------------------------------------------------
// Prisma semantics the shared mock helper does not implement
// ---------------------------------------------------------------------------

type Row = Record<string, unknown>;

/**
 * Project a row the way a scalar `select` does. The shared helper's include
 * resolver treats only RELATION selects as includes and returns every column for
 * a scalar one, so without this the narrow channel projection would be invisible:
 * the credential columns it exists to strip would ride along regardless.
 *
 * Keys keep the row's own order rather than the select's, so the projection is
 * sensitive to WHICH columns a select names and indifferent to the order it names
 * them in — response key order is decided by the payload builder, not by the
 * select literal, and that is what the byte-identity layer pins.
 */
function applyScalarSelect(record: Row, select?: Record<string, boolean>): Row {
  if (!select) return { ...record };
  const projected: Row = {};
  for (const key of Object.keys(record)) {
    if (select[key] === true) projected[key] = record[key];
  }
  return projected;
}

/** Sort rows by a single-field Prisma `orderBy`. Dates compare by value. */
function applyOrderBy(rows: Row[], orderBy?: Record<string, "asc" | "desc">): Row[] {
  const [field, direction] = Object.entries(orderBy ?? {})[0] ?? [];
  if (!field) return rows;
  return [...rows].sort((a, b) => {
    const left = a[field] as never;
    const right = b[field] as never;
    if (left === right) return 0;
    const comparison = left < right ? -1 : 1;
    return direction === "desc" ? -comparison : comparison;
  });
}

/**
 * `findMany` carrying the two semantics the shared helper lacks: a nested to-one
 * relation filter (`post: { projectId, deletedAt: null }`) resolved against the
 * post store, and scalar select projection. Flat `where`, `orderBy` and `take`
 * follow the rules the helper already implements.
 *
 * `include` is deliberately ignored. The dashboard's analytics read carries
 * `include: { post: { select: { id: true } } }` today and the handler never reads
 * the joined post (it reads the scalar `postId`), so honouring the include could
 * only add a key nothing consumes — and dropping the include is one of the two
 * call-shape deltas the port swap makes. Ignoring it is what lets one suite
 * answer for both sides of that swap.
 */
function storeBackedFindMany(store: ModelStore<Row>, postStore?: ModelStore<Row>) {
  return vi.fn(
    async (
      args: {
        where?: Row;
        orderBy?: Record<string, "asc" | "desc">;
        take?: number;
        select?: Record<string, boolean>;
      } = {}
    ) => {
      let rows = store.all();
      if (args.where) {
        const { post: postWhere, ...scalar } = args.where as { post?: Row } & Row;
        rows = rows.filter((row) => matchesWhere(row, scalar));
        if (postWhere !== undefined) {
          // A to-one relation filter is an inner join: a row whose foreign key is
          // null has no related post and can never satisfy it.
          rows = rows.filter((row) => {
            const parentId = row.postId;
            const parent = typeof parentId === "string" ? postStore?.get(parentId) : undefined;
            return parent !== undefined && matchesWhere(parent, postWhere);
          });
        }
      }
      rows = applyOrderBy(rows, args.orderBy);
      if (typeof args.take === "number") rows = rows.slice(0, args.take);
      return rows.map((row) => applyScalarSelect(row, args.select));
    }
  );
}

// ---------------------------------------------------------------------------
// Mock setup — must come BEFORE any import of the code under test
// ---------------------------------------------------------------------------

const { mockPrisma, stores } = createMockPrismaModule();

// The shared helper declares eleven models and has no catch-all, so every model
// these handlers touch is absent and would throw on first access. Each is named
// one by one rather than proxied: a model that is reached but this list forgets
// must surface as a failure instead of being papered over.
const postStore = createStore<Row>();
const channelStore = createStore<Row>();
const analyticsStore = createStore<Row>();
const threadStore = createStore<Row>();

Object.assign(mockPrisma.prisma, {
  post: { ...buildModelMock(postStore), findMany: storeBackedFindMany(postStore) },
  channel: { ...buildModelMock(channelStore), findMany: storeBackedFindMany(channelStore) },
  analytics: {
    ...buildModelMock(analyticsStore),
    findMany: storeBackedFindMany(analyticsStore, postStore),
  },
  thread: { ...buildModelMock(threadStore), findMany: storeBackedFindMany(threadStore, postStore) },
});

vi.mock("@infra/prisma", async (importOriginal) => {
  const original = await importOriginal<Record<string, unknown>>();
  return { ...original, prisma: mockPrisma.prisma };
});

// ---------------------------------------------------------------------------
// Import the code under test after the mocks
// ---------------------------------------------------------------------------

const Fastify = (await import("fastify")).default;
const { analyticsRoutes } = await import("../../../src/analytics/analyticsRoutes.js");
const { setupContainer } = await import("../../../src/infrastructure/container/setup.js");
const { TOKENS } = await import("../../../src/infrastructure/container/types.js");
const { prisma } = await import("@infra/prisma");
const { NoopBackgroundTaskScheduler } = await import("@observability/background-scheduler");
const { InMemoryCacheAdapter } = await import("@adapters/cache-redis");

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/** Frozen clock. The handlers derive their capture-time lower bound from `now`,
 *  and the export stamps `new Date()` into its payload, so a moving clock would
 *  make both the window filter and the byte-identity goldens irreproducible. */
const FROZEN_NOW = new Date("2026-03-15T12:00:00.000Z");

/** Deterministic UUID-shaped fixture id. `IdSchema` validates UUIDs, and these
 *  ids appear verbatim in the goldens, so they must not be random. */
function fixtureId(suffix: number): string {
  return `00000000-0000-4000-8000-${String(suffix).padStart(12, "0")}`;
}

interface ProjectFixture {
  projectId: string;
  liveChannelIds: string[];
  liveChannelHandles: string[];
}

/**
 * Seed one self-contained project. Every request in this file uses its own slot,
 * so no two requests can share the dashboard's `projectId`+`timeRange` cache key —
 * defence in depth behind the fact that the unit app never registers the global
 * caching middleware at all.
 *
 * Column order is meaningful: the export emits several of these rows verbatim,
 * and JSON key order is part of what the byte-identity layer pins.
 */
function seedProject(slot: number): ProjectFixture {
  const base = slot * 100;
  const projectId = fixtureId(base);

  stores.project.add({
    id: projectId,
    accountId: CUSTOMER_PRINCIPAL.accountId,
    name: `Fixture Project ${slot}`,
    deletedAt: null,
    createdAt: new Date("2026-01-05T09:00:00.000Z"),
    updatedAt: new Date("2026-01-05T09:00:00.000Z"),
  });

  // Two channels on ONE provider plus a third on another: the dashboard groups
  // analytics by provider and then maps over CHANNELS, so the two same-provider
  // channels each report the whole provider's metrics.
  const channelSeeds = [
    { suffix: base + 1, provider: "X", handle: "@alpha", deletedAt: null },
    { suffix: base + 2, provider: "X", handle: "@beta", deletedAt: null },
    { suffix: base + 3, provider: "INSTAGRAM", handle: "@gamma", deletedAt: null },
    {
      suffix: base + 4,
      provider: "X",
      handle: "@ghost",
      deletedAt: new Date("2026-02-01T00:00:00.000Z"),
    },
  ];
  for (const seed of channelSeeds) {
    channelStore.add({
      id: fixtureId(seed.suffix),
      projectId,
      provider: seed.provider,
      handle: seed.handle,
      deletedAt: seed.deletedAt,
      // Real columns on the channel table. They are seeded because the narrow
      // projection's whole purpose is that they cannot reach a tenant-downloadable
      // payload, and a fixture without them could not tell whether it does.
      credentialsCiphertext: `ciphertext-${seed.suffix}`,
      credentialsIv: `iv-${seed.suffix}`,
      credentialsAuthTag: `tag-${seed.suffix}`,
      credentialsKeyVersion: 3,
    });
  }

  const livePostId = fixtureId(base + 11);
  const draftPostId = fixtureId(base + 12);
  const deletedPostId = fixtureId(base + 13);
  const postSeeds = [
    {
      id: livePostId,
      status: "PUBLISHED",
      scheduledAt: new Date("2026-03-09T08:00:00.000Z"),
      publishedAt: new Date("2026-03-09T08:05:00.000Z"),
      createdAt: new Date("2026-03-08T08:00:00.000Z"),
      deletedAt: null,
    },
    {
      id: draftPostId,
      status: "DRAFT",
      scheduledAt: null,
      publishedAt: null,
      createdAt: new Date("2026-03-07T08:00:00.000Z"),
      deletedAt: null,
    },
    {
      id: deletedPostId,
      status: "PUBLISHED",
      scheduledAt: new Date("2026-03-06T08:00:00.000Z"),
      publishedAt: new Date("2026-03-06T08:05:00.000Z"),
      createdAt: new Date("2026-03-06T08:00:00.000Z"),
      deletedAt: new Date("2026-03-10T00:00:00.000Z"),
    },
  ];
  for (const seed of postSeeds) {
    postStore.add({
      id: seed.id,
      projectId,
      status: seed.status,
      scheduledAt: seed.scheduledAt,
      publishedAt: seed.publishedAt,
      createdAt: seed.createdAt,
      deletedAt: seed.deletedAt,
    });
  }

  // Exactly the nine columns of the analytics table, in table order.
  const analyticsSeeds = [
    {
      suffix: base + 21,
      postId: livePostId,
      channel: base + 1,
      provider: "X",
      views: 100,
      likes: 10,
      comments: 5,
      shares: 2,
      capturedAt: "2026-03-14T10:00:00.000Z",
    },
    {
      suffix: base + 22,
      postId: livePostId,
      channel: base + 3,
      provider: "INSTAGRAM",
      views: 50,
      likes: 4,
      comments: 1,
      shares: 1,
      capturedAt: "2026-03-13T10:00:00.000Z",
    },
    {
      suffix: base + 23,
      postId: draftPostId,
      channel: base + 2,
      provider: "X",
      views: 40,
      likes: 3,
      comments: 2,
      shares: 0,
      capturedAt: "2026-03-12T10:00:00.000Z",
    },
    // Hangs off a soft-deleted post — must never surface.
    {
      suffix: base + 24,
      postId: deletedPostId,
      channel: base + 1,
      provider: "X",
      views: 999,
      likes: 99,
      comments: 9,
      shares: 9,
      capturedAt: "2026-03-11T10:00:00.000Z",
    },
    // Null post foreign key — excluded by the relation filter, not by the window.
    {
      suffix: base + 25,
      postId: null,
      channel: base + 1,
      provider: "X",
      views: 777,
      likes: 77,
      comments: 7,
      shares: 7,
      capturedAt: "2026-03-10T10:00:00.000Z",
    },
    // Inside the 30-day window, outside the 7-day one.
    {
      suffix: base + 26,
      postId: livePostId,
      channel: base + 1,
      provider: "X",
      views: 20,
      likes: 1,
      comments: 0,
      shares: 0,
      capturedAt: "2026-03-01T10:00:00.000Z",
    },
  ];
  for (const seed of analyticsSeeds) {
    analyticsStore.add({
      id: fixtureId(seed.suffix),
      postId: seed.postId,
      channelId: fixtureId(seed.channel),
      provider: seed.provider,
      views: seed.views,
      likes: seed.likes,
      comments: seed.comments,
      shares: seed.shares,
      capturedAt: new Date(seed.capturedAt),
    });
  }

  threadStore.add({
    id: fixtureId(base + 31),
    postId: livePostId,
    strategy: "SEQUENTIAL",
    createdAt: new Date("2026-03-08T09:00:00.000Z"),
  });
  // Hangs off a soft-deleted post — must never surface.
  threadStore.add({
    id: fixtureId(base + 32),
    postId: deletedPostId,
    strategy: "PARALLEL",
    createdAt: new Date("2026-03-06T09:00:00.000Z"),
  });

  return {
    projectId,
    liveChannelIds: [base + 1, base + 2, base + 3].map(fixtureId),
    liveChannelHandles: ["@alpha", "@beta", "@gamma"],
  };
}

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

async function createTestApp(): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  const container = setupContainer({ prisma: prisma as never });

  // Registering the plugin resolves RealtimeAnalyticsService, and constructing it
  // registers a 30-second metrics poll that would stay live for the whole run; the
  // same resolution reaches the cache port, whose production adapter opens a Redis
  // connection. Both overrides land BEFORE the plugin is registered, while those
  // singletons are still unconstructed — registration is a map write, so the
  // override is clean rather than a second instance racing the first.
  container.registerInstance(TOKENS.BackgroundTaskScheduler, new NoopBackgroundTaskScheduler());
  container.registerInstance(TOKENS.CachePort, new InMemoryCacheAdapter());

  app.decorate("container", container);
  await app.register(analyticsRoutes);
  await app.ready();
  return app;
}

function sortedKeys(value: unknown): string[] {
  return Object.keys(value as object).sort();
}

/** The refusal body, pinned verbatim: the ownership gate answers before the
 *  handler's own not-found branch, so this is what an absent or soft-deleted
 *  project actually produces. */
const ACCESS_DENIED_BODY = '{"ok":false,"error":"Access denied to project"}';

const CSV_HEADER_ROW =
  "Post ID,Post Status,Channel ID,Provider,Channel Handle,Views,Likes,Comments,Shares," +
  "Total Engagement,Engagement Rate (%),Captured At,Published At";

/** The CSV writer emits CRLF, so splitting on "\n" alone would leave the header
 *  row carrying a trailing carriage return and compare unequal to a constant that
 *  looks identical on screen. */
function csvHeaderRowOf(body: string): string {
  return body.split(/\r?\n/)[0] ?? "";
}

const OVERVIEW_KEYS = [
  "avgEngagementRate",
  "growthThisWeek",
  "performanceScore",
  "topPlatform",
  "totalEngagement",
  "totalImpressions",
  "totalPosts",
  "totalReach",
];

const PLATFORM_METRIC_KEYS = [
  "engagementRate",
  "followerCount",
  "growthRate",
  "handle",
  "platformId",
  "platformName",
  "totalClicks",
  "totalEngagement",
  "totalImpressions",
  "totalPosts",
  "totalReach",
];

const ANALYTICS_ROW_KEYS = [
  "capturedAt",
  "channelId",
  "comments",
  "id",
  "likes",
  "postId",
  "provider",
  "shares",
  "views",
];

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

let app: FastifyInstance;
const fixtures: Record<string, ProjectFixture> = {};

describe("analyticsRoutes (customer) characterization", () => {
  beforeAll(async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(FROZEN_NOW);

    // One slot per request: distinct projectId everywhere, and distinct
    // projectId+timeRange for the two requests that share a handler.
    fixtures.dashboard = seedProject(1);
    fixtures.exportJsonWithPosts = seedProject(2);
    fixtures.exportJsonCoercedFalse = seedProject(3);
    fixtures.exportJsonPostsOff = seedProject(4);
    fixtures.exportCsvWithPosts = seedProject(5);
    fixtures.exportCsvPostsOff = seedProject(6);
    fixtures.projectAnalytics = seedProject(7);

    // A project that exists but is soft-deleted, for the export's absent-project path.
    const deletedProject = seedProject(8);
    stores.project.update(deletedProject.projectId, {
      deletedAt: new Date("2026-03-12T00:00:00.000Z"),
    });
    fixtures.softDeletedProject = deletedProject;

    app = await createTestApp();
  });

  afterAll(async () => {
    await app.close();
    vi.useRealTimers();
  });

  // ── GET /analytics/dashboard ─────────────────────────────────────────────

  it("serves the dashboard with its pinned payload shape", async () => {
    const fixture = fixtures.dashboard!;
    const res = await app.inject({
      method: "GET",
      url: `/analytics/dashboard?projectId=${fixture.projectId}&timeRange=7d`,
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as { ok: boolean; data: Record<string, unknown> };
    expect(body.ok).toBe(true);
    expect(sortedKeys(body.data)).toEqual([
      "dataPoints",
      "overview",
      "platformMetrics",
      "timeRange",
    ]);
    expect(sortedKeys(body.data.overview)).toEqual(OVERVIEW_KEYS);
    expect(body.data.timeRange).toBe("7d");
    // A bounded read's row count, reported as a total — pinned as a number only.
    expect(typeof body.data.dataPoints).toBe("number");

    const platformMetrics = body.data.platformMetrics as Record<string, unknown>[];
    expect(Array.isArray(platformMetrics)).toBe(true);
    // One entry per LIVE channel: the soft-deleted channel never surfaces.
    expect(platformMetrics).toHaveLength(fixture.liveChannelIds.length);
    for (const metric of platformMetrics) {
      expect(sortedKeys(metric)).toEqual(PLATFORM_METRIC_KEYS);
    }
    // Identity passthroughs: channel id and handle cross the handler untouched.
    expect(platformMetrics.map((metric) => metric.platformId)).toEqual(fixture.liveChannelIds);
    expect(platformMetrics.map((metric) => metric.handle)).toEqual(fixture.liveChannelHandles);
  });

  // ── GET /export ──────────────────────────────────────────────────────────

  it("serves the JSON export with posts included", async () => {
    const fixture = fixtures.exportJsonWithPosts!;
    const res = await app.inject({
      method: "GET",
      url: `/export?projectId=${fixture.projectId}&timeRange=30d&format=json&includePosts=true`,
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as { ok: boolean; data: Record<string, unknown> };
    expect(body.ok).toBe(true);
    expect(sortedKeys(body.data)).toEqual([
      "analytics",
      "channels",
      "exportedAt",
      "posts",
      "projectId",
      "projectName",
      "summary",
      "threads",
      "timeRange",
    ]);
    expect(body.data.projectId).toBe(fixture.projectId);
    expect(body.data.timeRange).toBe("30d");

    const posts = body.data.posts as Record<string, unknown>[];
    expect(posts).toHaveLength(2);
    for (const post of posts) {
      expect(sortedKeys(post)).toEqual(["createdAt", "id", "publishedAt", "scheduledAt", "status"]);
    }

    const channels = body.data.channels as Record<string, unknown>[];
    expect(channels).toHaveLength(fixture.liveChannelIds.length);
    for (const channel of channels) {
      expect(sortedKeys(channel)).toEqual(["handle", "id", "provider"]);
    }

    const threads = body.data.threads as Record<string, unknown>[];
    expect(threads).toHaveLength(1);
    expect(sortedKeys(threads[0])).toEqual(["createdAt", "id", "postId", "strategy"]);

    // Row-level shape only. The array's own length is a bounded read's row count,
    // which the summary then reports as a total — not something to pin as correct.
    const analytics = body.data.analytics as Record<string, unknown>[];
    expect(Array.isArray(analytics)).toBe(true);
    for (const entry of analytics) {
      expect(sortedKeys(entry)).toEqual(ANALYTICS_ROW_KEYS);
    }

    expect(sortedKeys(body.data.summary)).toEqual([
      "totalAnalyticsRecords",
      "totalChannels",
      "totalComments",
      "totalLikes",
      "totalPosts",
      "totalShares",
      "totalThreads",
      "totalViews",
    ]);
  });

  it("keeps credential columns out of the export's channel entries", async () => {
    // The hazard site: the export spreads each channel row into a payload the
    // tenant downloads, so a channel read without a narrow projection would hand
    // the caller its own encrypted credentials.
    const fixture = fixtures.exportJsonWithPosts!;
    const res = await app.inject({
      method: "GET",
      url: `/export?projectId=${fixture.projectId}&timeRange=90d&format=json&includePosts=true`,
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as { data: { channels: Record<string, unknown>[] } };
    for (const channel of body.data.channels) {
      expect(Object.keys(channel).filter((key) => /credential/i.test(key))).toEqual([]);
    }
    expect(res.body).not.toMatch(/ciphertext/i);
  });

  it("still includes posts when the export is asked for includePosts=false", async () => {
    // Not the intended behaviour, and pinned because it is the behaviour. The
    // flag is parsed by a coercing boolean, and coercion runs `Boolean(value)`
    // over the raw query string — so the literal "false" is a non-empty string
    // and arrives as true. The section cannot be switched off by the value the
    // API's own documentation implies.
    const fixture = fixtures.exportJsonCoercedFalse!;
    const res = await app.inject({
      method: "GET",
      url: `/export?projectId=${fixture.projectId}&timeRange=30d&format=json&includePosts=false`,
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as { data: Record<string, unknown> };
    expect(sortedKeys(body.data)).toContain("posts");
    expect(body.data.posts).toHaveLength(2);
  });

  it("serves the JSON export with the post section off", async () => {
    // An EMPTY value is the only one the coercing boolean reads as false, so it
    // is the only way to reach the branch through the route.
    const fixture = fixtures.exportJsonPostsOff!;
    const res = await app.inject({
      method: "GET",
      url: `/export?projectId=${fixture.projectId}&timeRange=30d&format=json&includePosts=`,
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as { ok: boolean; data: Record<string, unknown> };
    expect(body.ok).toBe(true);
    expect(sortedKeys(body.data)).toEqual([
      "analytics",
      "channels",
      "exportedAt",
      "projectId",
      "projectName",
      "summary",
      "threads",
      "timeRange",
    ]);
    expect(body.data.posts).toBeUndefined();
  });

  it("serves the CSV export with posts included", async () => {
    const fixture = fixtures.exportCsvWithPosts!;
    const res = await app.inject({
      method: "GET",
      url: `/export?projectId=${fixture.projectId}&timeRange=30d&format=csv&includePosts=true`,
    });

    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toBe("text/csv; charset=utf-8");
    expect(res.headers["content-disposition"]).toMatch(/^attachment; filename="analytics-/);
    expect(csvHeaderRowOf(res.body)).toBe(CSV_HEADER_ROW);
  });

  it("serves the CSV export with the post section off, keeping its blank columns", async () => {
    const fixture = fixtures.exportCsvPostsOff!;
    const res = await app.inject({
      method: "GET",
      url: `/export?projectId=${fixture.projectId}&timeRange=30d&format=csv&includePosts=`,
    });

    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toBe("text/csv; charset=utf-8");
    // The post-derived columns stay in the header even though nothing can fill
    // them once the post read is switched off.
    expect(csvHeaderRowOf(res.body)).toBe(CSV_HEADER_ROW);
  });

  // ── GET /analytics/project/:projectId ────────────────────────────────────

  it("serves the project analytics summary with its pinned payload shape", async () => {
    const fixture = fixtures.projectAnalytics!;
    const res = await app.inject({
      method: "GET",
      url: `/analytics/project/${fixture.projectId}`,
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as { ok: boolean; data: Record<string, unknown> };
    expect(body.ok).toBe(true);
    expect(sortedKeys(body.data)).toEqual([
      "comments",
      "dataPoints",
      "likes",
      "postCount",
      "projectId",
      "shares",
      "views",
    ]);
    expect(body.data.projectId).toBe(fixture.projectId);
    for (const key of ["postCount", "views", "likes", "comments", "shares", "dataPoints"]) {
      expect(typeof body.data[key]).toBe("number");
    }
  });

  // ── The export's absent-project path ─────────────────────────────────────

  it("refuses the export for a project that does not exist", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/export?projectId=${fixtureId(9001)}&timeRange=30d&format=json`,
    });

    expect(res.statusCode).toBe(403);
    expect(res.body).toBe(ACCESS_DENIED_BODY);
  });

  it("refuses the export for a soft-deleted project", async () => {
    // The ownership gate runs first and already filters `deletedAt`, so a
    // soft-deleted project is refused there — the handler's own not-found branch
    // is unreachable through the route, which is why the second project read it
    // guards is redundant.
    const fixture = fixtures.softDeletedProject!;
    const res = await app.inject({
      method: "GET",
      url: `/export?projectId=${fixture.projectId}&timeRange=30d&format=json`,
    });

    expect(res.statusCode).toBe(403);
    expect(res.body).toBe(ACCESS_DENIED_BODY);
  });
});
