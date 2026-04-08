/**
 * @file runCustomReport.test.ts
 * @description Unit tests for RunCustomReportQuery — verifies real data aggregation
 *              and deterministic output (no Math.random).
 * @layer test
 */

import { describe, it, vi, beforeEach } from "vitest";
import assert from "node:assert/strict";
import { RunCustomReportQuery } from "../../../src/application/custom-reports/RunCustomReportQuery.js";
import { ok, err } from "@shared/types";

function makeReportDto(overrides: Record<string, unknown> = {}) {
  return {
    id: "report-001",
    accountId: "acc-001",
    projectId: null,
    name: "Test Report",
    description: null,
    metrics: ["views", "likes"],
    dimensions: ["date"],
    dateRange: "LAST_7_DAYS",
    dateRangeStart: null,
    dateRangeEnd: null,
    chartType: "LINE",
    filters: null,
    isShared: false,
    createdById: "user-001",
    createdAt: new Date("2026-01-01"),
    updatedAt: new Date("2026-01-01"),
    ...overrides,
  };
}

function makeMockRepo(dto = makeReportDto()) {
  return {
    findById: vi.fn().mockResolvedValue(ok(dto)),
    findByAccountId: vi.fn().mockResolvedValue([]),
    save: vi.fn().mockResolvedValue(ok("id")),
    update: vi.fn().mockResolvedValue(ok(undefined)),
    delete: vi.fn().mockResolvedValue(ok(undefined)),
    saveSchedule: vi.fn().mockResolvedValue(ok("id")),
    findSchedulesByReportId: vi.fn().mockResolvedValue([]),
  };
}

function makeMockAnalyticsQuery(summaryRows: unknown[] = []) {
  return {
    findChannelIdsByAccount: vi.fn().mockResolvedValue(["ch-1", "ch-2"]),
    findSummaries: vi.fn().mockResolvedValue(summaryRows),
  };
}

describe("RunCustomReportQuery", () => {
  let repo: ReturnType<typeof makeMockRepo>;
  let analyticsQuery: ReturnType<typeof makeMockAnalyticsQuery>;

  beforeEach(() => {
    vi.clearAllMocks();
    repo = makeMockRepo();
    analyticsQuery = makeMockAnalyticsQuery();
  });

  it("aggregates real data by date dimension", async () => {
    const rows = [
      {
        date: new Date("2026-03-01"),
        provider: "INSTAGRAM",
        channelId: "ch-1",
        postId: null,
        views: 100,
        likes: 10,
        comments: 5,
        shares: 2,
        records: 1,
      },
      {
        date: new Date("2026-03-02"),
        provider: "INSTAGRAM",
        channelId: "ch-1",
        postId: null,
        views: 200,
        likes: 20,
        comments: 10,
        shares: 4,
        records: 1,
      },
      {
        date: new Date("2026-03-03"),
        provider: "INSTAGRAM",
        channelId: "ch-1",
        postId: null,
        views: 150,
        likes: 15,
        comments: 8,
        shares: 3,
        records: 1,
      },
    ];
    analyticsQuery = makeMockAnalyticsQuery(rows);

    const query = new RunCustomReportQuery(repo as never, analyticsQuery);
    const result = await query.execute({ reportId: "report-001", accountId: "acc-001" });

    assert.ok(result.ok);
    assert.strictEqual(result.value.hasData, true);
    assert.strictEqual(result.value.labels.length, 3);
    assert.strictEqual(result.value.datasets.length, 2);

    const viewsDataset = result.value.datasets.find((d) => d.label === "views");
    assert.ok(viewsDataset);
    assert.deepStrictEqual(viewsDataset.data, [100, 200, 150]);
  });

  it("aggregates by platform dimension", async () => {
    const rows = [
      {
        date: new Date("2026-03-01"),
        provider: "INSTAGRAM",
        channelId: "ch-1",
        postId: null,
        views: 100,
        likes: 10,
        comments: 5,
        shares: 2,
        records: 1,
      },
      {
        date: new Date("2026-03-01"),
        provider: "X",
        channelId: "ch-2",
        postId: null,
        views: 300,
        likes: 30,
        comments: 15,
        shares: 6,
        records: 1,
      },
      {
        date: new Date("2026-03-02"),
        provider: "INSTAGRAM",
        channelId: "ch-1",
        postId: null,
        views: 200,
        likes: 20,
        comments: 10,
        shares: 4,
        records: 1,
      },
    ];
    analyticsQuery = makeMockAnalyticsQuery(rows);
    repo = makeMockRepo(makeReportDto({ dimensions: ["platform"] }));

    const query = new RunCustomReportQuery(repo as never, analyticsQuery);
    const result = await query.execute({ reportId: "report-001", accountId: "acc-001" });

    assert.ok(result.ok);
    assert.strictEqual(result.value.labels.length, 2);
    assert.ok(result.value.labels.includes("INSTAGRAM"));
    assert.ok(result.value.labels.includes("X"));

    const viewsDataset = result.value.datasets.find((d) => d.label === "views");
    assert.ok(viewsDataset);
    const igIndex = result.value.labels.indexOf("INSTAGRAM");
    assert.strictEqual(viewsDataset.data[igIndex], 300);
  });

  it("returns hasData: false when no analytics data exists", async () => {
    analyticsQuery = makeMockAnalyticsQuery([]);

    const query = new RunCustomReportQuery(repo as never, analyticsQuery);
    const result = await query.execute({ reportId: "report-001", accountId: "acc-001" });

    assert.ok(result.ok);
    assert.strictEqual(result.value.hasData, false);
    assert.deepStrictEqual(result.value.labels, []);
    assert.deepStrictEqual(result.value.datasets, []);
  });

  it("returns hasData: false when account has no channels", async () => {
    analyticsQuery.findChannelIdsByAccount.mockResolvedValue([]);

    const query = new RunCustomReportQuery(repo as never, analyticsQuery);
    const result = await query.execute({ reportId: "report-001", accountId: "acc-001" });

    assert.ok(result.ok);
    assert.strictEqual(result.value.hasData, false);
  });

  it("never returns Math.random() values — results are deterministic", async () => {
    const rows = [
      {
        date: new Date("2026-03-01"),
        provider: "INSTAGRAM",
        channelId: "ch-1",
        postId: null,
        views: 42,
        likes: 7,
        comments: 3,
        shares: 1,
        records: 1,
      },
    ];
    analyticsQuery = makeMockAnalyticsQuery(rows);

    const query = new RunCustomReportQuery(repo as never, analyticsQuery);
    const r1 = await query.execute({ reportId: "report-001", accountId: "acc-001" });
    const r2 = await query.execute({ reportId: "report-001", accountId: "acc-001" });

    assert.ok(r1.ok);
    assert.ok(r2.ok);
    assert.deepStrictEqual(r1.value.datasets, r2.value.datasets);
  });

  it("rejects access to non-shared reports from different account", async () => {
    const query = new RunCustomReportQuery(repo as never, analyticsQuery);
    const result = await query.execute({ reportId: "report-001", accountId: "other-acc" });

    assert.ok(!result.ok);
    assert.ok(result.error.message.includes("Access denied"));
  });

  it("allows access to shared reports from different account", async () => {
    repo = makeMockRepo(makeReportDto({ isShared: true }));
    const rows = [
      {
        date: new Date("2026-03-01"),
        provider: "X",
        channelId: "ch-1",
        postId: null,
        views: 50,
        likes: 5,
        comments: 1,
        shares: 0,
        records: 1,
      },
    ];
    analyticsQuery = makeMockAnalyticsQuery(rows);

    const query = new RunCustomReportQuery(repo as never, analyticsQuery);
    const result = await query.execute({ reportId: "report-001", accountId: "other-acc" });

    assert.ok(result.ok);
    assert.strictEqual(result.value.hasData, true);
  });

  it("returns NOT_FOUND when report does not exist", async () => {
    repo.findById.mockResolvedValue(err({ name: "EntityNotFoundError", message: "Not found" }));

    const query = new RunCustomReportQuery(repo as never, analyticsQuery);
    const result = await query.execute({ reportId: "nope", accountId: "acc-001" });

    assert.ok(!result.ok);
    assert.ok(result.error.message.includes("not found"));
  });
});
