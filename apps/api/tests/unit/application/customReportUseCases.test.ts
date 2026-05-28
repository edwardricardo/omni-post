/**
 * @file customReportUseCases.test.ts
 * @description Unit tests for Custom Report use cases and queries.
 *   Covers creation, listing, scheduling, and report execution.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import assert from "node:assert/strict";
import { ok, err } from "@shared/types";
import { CreateCustomReportUseCase } from "@core/custom-reports/CreateCustomReportUseCase.js";
import { ListCustomReportsQuery } from "@core/custom-reports/ListCustomReportsQuery.js";
import { GetCustomReportQuery } from "@core/custom-reports/GetCustomReportQuery.js";
import { RunCustomReportQuery } from "@core/custom-reports/RunCustomReportQuery.js";
import { ScheduleCustomReportUseCase } from "@core/custom-reports/ScheduleCustomReportUseCase.js";
import { DeleteCustomReportUseCase } from "@core/custom-reports/DeleteCustomReportUseCase.js";
import { UpdateCustomReportUseCase } from "@core/custom-reports/UpdateCustomReportUseCase.js";
import { EntityNotFoundError } from "@core/domain/errors/index.js";
import type {
  CustomReportRepository,
  CustomReportDto,
} from "@core/domain/repositories/CustomReportRepository.js";

// ============================================================================
// Mock Factory
// ============================================================================

function makeReportDto(overrides?: Partial<CustomReportDto>): CustomReportDto {
  return {
    id: "report-001",
    accountId: "acc-001",
    projectId: null,
    name: "Test Report",
    description: null,
    metrics: ["impressions", "engagement_rate"],
    dimensions: ["date"],
    dateRange: "LAST_30_DAYS",
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

function makeMockRepo(): CustomReportRepository {
  return {
    save: vi.fn().mockResolvedValue(ok("report-new-id")),
    update: vi.fn().mockResolvedValue(ok(undefined)),
    findById: vi.fn().mockResolvedValue(ok(makeReportDto())),
    findByAccountId: vi.fn().mockResolvedValue([makeReportDto()]),
    delete: vi.fn().mockResolvedValue(ok(undefined)),
    saveSchedule: vi.fn().mockResolvedValue(ok("schedule-001")),
    findSchedulesByReportId: vi.fn().mockResolvedValue([]),
  };
}

// ============================================================================
// Tests
// ============================================================================

describe("CreateCustomReportUseCase", () => {
  let repo: ReturnType<typeof makeMockRepo>;
  let useCase: CreateCustomReportUseCase;

  beforeEach(() => {
    vi.clearAllMocks();
    repo = makeMockRepo();
    useCase = new CreateCustomReportUseCase(repo);
  });

  it("creates report successfully with valid input", async () => {
    const result = await useCase.execute({
      accountId: "acc-001",
      name: "Weekly Report",
      metrics: ["impressions", "engagement_rate"],
      dimensions: ["date", "platform"],
      createdById: "user-001",
    });

    assert.ok(result.ok, "Should succeed");
    expect(result.value.id).toBe("report-new-id");
    expect(repo.save).toHaveBeenCalledOnce();
  });

  it("rejects invalid metrics", async () => {
    const result = await useCase.execute({
      accountId: "acc-001",
      name: "Bad Report",
      metrics: ["not_a_real_metric"],
      dimensions: ["date"],
      createdById: "user-001",
    });

    assert.ok(!result.ok, "Should fail with invalid metrics");
    expect(result.error.code).toBe("VALIDATION_FAILED");
    expect(result.error.message).toContain("Unknown metrics");
    expect(repo.save).not.toHaveBeenCalled();
  });

  it("rejects empty name", async () => {
    const result = await useCase.execute({
      accountId: "acc-001",
      name: "",
      metrics: ["impressions"],
      dimensions: ["date"],
      createdById: "user-001",
    });

    assert.ok(!result.ok, "Should fail with empty name");
    expect(result.error.code).toBe("VALIDATION_FAILED");
  });

  it("handles repository save failure", async () => {
    repo.save = vi.fn().mockResolvedValue(err(new Error("DB error")));

    const result = await useCase.execute({
      accountId: "acc-001",
      name: "Report",
      metrics: ["impressions"],
      dimensions: ["date"],
      createdById: "user-001",
    });

    assert.ok(!result.ok, "Should fail on save error");
    expect(result.error.code).toBe("INTERNAL_ERROR");
  });

  it("accepts all optional fields", async () => {
    const result = await useCase.execute({
      accountId: "acc-001",
      name: "Full Report",
      metrics: ["impressions"],
      dimensions: ["date"],
      createdById: "user-001",
      projectId: "proj-001",
      description: "A description",
      dateRange: "LAST_7_DAYS",
      chartType: "BAR",
      filters: { platform: "twitter" },
      isShared: true,
    });

    assert.ok(result.ok, "Should succeed with all optional fields");
  });
});

describe("ListCustomReportsQuery", () => {
  let repo: ReturnType<typeof makeMockRepo>;
  let query: ListCustomReportsQuery;

  beforeEach(() => {
    vi.clearAllMocks();
    repo = makeMockRepo();
    query = new ListCustomReportsQuery(repo);
  });

  it("returns reports for account", async () => {
    const reports = [makeReportDto(), makeReportDto({ id: "report-002", name: "Second" })];
    repo.findByAccountId = vi.fn().mockResolvedValue(reports);

    const result = await query.execute({ accountId: "acc-001" });

    assert.ok(result.ok, "Should succeed");
    expect(result.value).toHaveLength(2);
    expect(repo.findByAccountId).toHaveBeenCalledWith("acc-001");
  });

  it("returns empty array when no reports exist", async () => {
    repo.findByAccountId = vi.fn().mockResolvedValue([]);

    const result = await query.execute({ accountId: "acc-001" });

    assert.ok(result.ok, "Should succeed");
    expect(result.value).toHaveLength(0);
  });

  it("handles repository error", async () => {
    repo.findByAccountId = vi.fn().mockRejectedValue(new Error("DB error"));

    const result = await query.execute({ accountId: "acc-001" });

    assert.ok(!result.ok, "Should fail on error");
    expect(result.error.code).toBe("INTERNAL_ERROR");
  });
});

describe("GetCustomReportQuery", () => {
  let repo: ReturnType<typeof makeMockRepo>;
  let query: GetCustomReportQuery;

  beforeEach(() => {
    vi.clearAllMocks();
    repo = makeMockRepo();
    query = new GetCustomReportQuery(repo);
  });

  it("returns report for matching account", async () => {
    const result = await query.execute({ reportId: "report-001", accountId: "acc-001" });

    assert.ok(result.ok, "Should succeed");
    expect(result.value.id).toBe("report-001");
  });

  it("returns not found for missing report", async () => {
    repo.findById = vi
      .fn()
      .mockResolvedValue(err(new EntityNotFoundError("CustomReport", "missing")));

    const result = await query.execute({ reportId: "missing", accountId: "acc-001" });

    assert.ok(!result.ok, "Should fail");
    expect(result.error.code).toBe("NOT_FOUND");
  });

  it("allows access to shared reports from different account", async () => {
    repo.findById = vi.fn().mockResolvedValue(ok(makeReportDto({ isShared: true })));

    const result = await query.execute({ reportId: "report-001", accountId: "other-acc" });

    assert.ok(result.ok, "Should succeed for shared report");
  });

  it("denies access to private report from different account", async () => {
    const result = await query.execute({ reportId: "report-001", accountId: "other-acc" });

    assert.ok(!result.ok, "Should fail for private report");
    expect(result.error.code).toBe("FORBIDDEN");
  });
});

describe("RunCustomReportQuery", () => {
  let repo: ReturnType<typeof makeMockRepo>;
  let analyticsQuery: {
    findChannelIdsByAccount: ReturnType<typeof vi.fn>;
    findSummaries: ReturnType<typeof vi.fn>;
  };
  let query: RunCustomReportQuery;

  beforeEach(() => {
    vi.clearAllMocks();
    repo = makeMockRepo();
    analyticsQuery = {
      findChannelIdsByAccount: vi.fn().mockResolvedValue(["ch-1", "ch-2"]),
      findSummaries: vi.fn().mockResolvedValue([
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
      ]),
    };
    query = new RunCustomReportQuery(repo, analyticsQuery);
  });

  it("returns chart data structure", async () => {
    const result = await query.execute({ reportId: "report-001", accountId: "acc-001" });

    assert.ok(result.ok, "Should succeed");
    expect(result.value.reportId).toBe("report-001");
    expect(result.value.hasData).toBe(true);
    expect(Array.isArray(result.value.labels)).toBe(true);
    expect(result.value.labels.length).toBeGreaterThan(0);
    expect(Array.isArray(result.value.datasets)).toBe(true);
    expect(result.value.datasets.length).toBe(2);
    for (const dataset of result.value.datasets) {
      expect(typeof dataset.label).toBe("string");
      expect(Array.isArray(dataset.data)).toBe(true);
      expect(dataset.data.length).toBe(result.value.labels.length);
    }
  });

  it("returns not found for missing report", async () => {
    repo.findById = vi
      .fn()
      .mockResolvedValue(err(new EntityNotFoundError("CustomReport", "missing")));

    const result = await query.execute({ reportId: "missing", accountId: "acc-001" });

    assert.ok(!result.ok, "Should fail");
    expect(result.error.code).toBe("NOT_FOUND");
  });

  it("generates labels based on platform dimension", async () => {
    repo.findById = vi.fn().mockResolvedValue(ok(makeReportDto({ dimensions: ["platform"] })));
    analyticsQuery.findSummaries.mockResolvedValue([
      {
        date: new Date("2026-03-01"),
        provider: "X",
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
        provider: "INSTAGRAM",
        channelId: "ch-2",
        postId: null,
        views: 200,
        likes: 20,
        comments: 10,
        shares: 4,
        records: 1,
      },
    ]);

    const result = await query.execute({ reportId: "report-001", accountId: "acc-001" });

    assert.ok(result.ok, "Should succeed");
    expect(result.value.labels).toContain("X");
    expect(result.value.labels).toContain("INSTAGRAM");
  });

  it("denies access to private report from different account", async () => {
    const result = await query.execute({ reportId: "report-001", accountId: "other-acc" });

    assert.ok(!result.ok, "Should fail for different account");
    expect(result.error.code).toBe("FORBIDDEN");
  });
});

describe("ScheduleCustomReportUseCase", () => {
  let repo: ReturnType<typeof makeMockRepo>;
  let useCase: ScheduleCustomReportUseCase;

  beforeEach(() => {
    vi.clearAllMocks();
    repo = makeMockRepo();
    useCase = new ScheduleCustomReportUseCase(repo);
  });

  it("creates schedule successfully", async () => {
    const result = await useCase.execute({
      reportId: "report-001",
      accountId: "acc-001",
      cronExpression: "0 9 * * 1",
      recipients: ["user@example.com"],
    });

    assert.ok(result.ok, "Should succeed");
    expect(result.value.id).toBe("schedule-001");
    expect(repo.saveSchedule).toHaveBeenCalledWith(
      expect.objectContaining({
        reportId: "report-001",
        cronExpression: "0 9 * * 1",
        timezone: "UTC",
        format: "PDF",
        recipients: ["user@example.com"],
      })
    );
  });

  it("rejects invalid cron expression", async () => {
    const result = await useCase.execute({
      reportId: "report-001",
      accountId: "acc-001",
      cronExpression: "not a cron",
      recipients: ["user@example.com"],
    });

    assert.ok(!result.ok, "Should fail with invalid cron");
    expect(result.error.code).toBe("VALIDATION_FAILED");
    expect(result.error.message).toContain("Invalid cron expression");
  });

  it("rejects empty recipients", async () => {
    const result = await useCase.execute({
      reportId: "report-001",
      accountId: "acc-001",
      cronExpression: "0 9 * * 1",
      recipients: [],
    });

    assert.ok(!result.ok, "Should fail with no recipients");
    expect(result.error.code).toBe("VALIDATION_FAILED");
    expect(result.error.message).toContain("recipient");
  });

  it("rejects invalid format", async () => {
    const result = await useCase.execute({
      reportId: "report-001",
      accountId: "acc-001",
      cronExpression: "0 9 * * 1",
      format: "INVALID",
      recipients: ["user@example.com"],
    });

    assert.ok(!result.ok, "Should fail with invalid format");
    expect(result.error.code).toBe("VALIDATION_FAILED");
    expect(result.error.message).toContain("Invalid report format");
  });

  it("accepts all valid formats", async () => {
    for (const format of ["CSV", "JSON", "PDF", "XLSX", "XML"]) {
      repo.saveSchedule = vi.fn().mockResolvedValue(ok("schedule-id"));
      const result = await useCase.execute({
        reportId: "report-001",
        accountId: "acc-001",
        cronExpression: "0 9 * * 1",
        format,
        recipients: ["user@example.com"],
      });

      assert.ok(result.ok, `Should accept format: ${format}`);
    }
  });

  it("returns not found for missing report", async () => {
    repo.findById = vi
      .fn()
      .mockResolvedValue(err(new EntityNotFoundError("CustomReport", "missing")));

    const result = await useCase.execute({
      reportId: "missing",
      accountId: "acc-001",
      cronExpression: "0 9 * * 1",
      recipients: ["user@example.com"],
    });

    assert.ok(!result.ok, "Should fail");
    expect(result.error.code).toBe("NOT_FOUND");
  });

  it("denies access to report from different account", async () => {
    const result = await useCase.execute({
      reportId: "report-001",
      accountId: "other-acc",
      cronExpression: "0 9 * * 1",
      recipients: ["user@example.com"],
    });

    assert.ok(!result.ok, "Should fail for different account");
    expect(result.error.code).toBe("FORBIDDEN");
  });

  it("uses custom timezone", async () => {
    const result = await useCase.execute({
      reportId: "report-001",
      accountId: "acc-001",
      cronExpression: "0 9 * * 1",
      timezone: "America/New_York",
      recipients: ["user@example.com"],
    });

    assert.ok(result.ok, "Should succeed");
    expect(repo.saveSchedule).toHaveBeenCalledWith(
      expect.objectContaining({ timezone: "America/New_York" })
    );
  });
});

describe("DeleteCustomReportUseCase", () => {
  let repo: ReturnType<typeof makeMockRepo>;
  let useCase: DeleteCustomReportUseCase;

  beforeEach(() => {
    vi.clearAllMocks();
    repo = makeMockRepo();
    useCase = new DeleteCustomReportUseCase(repo);
  });

  it("deletes report owned by account", async () => {
    const result = await useCase.execute({ reportId: "report-001", accountId: "acc-001" });

    assert.ok(result.ok, "Should succeed");
    expect(repo.delete).toHaveBeenCalledWith("report-001");
  });

  it("returns not found for missing report", async () => {
    repo.findById = vi
      .fn()
      .mockResolvedValue(err(new EntityNotFoundError("CustomReport", "missing")));

    const result = await useCase.execute({ reportId: "missing", accountId: "acc-001" });

    assert.ok(!result.ok, "Should fail");
    expect(result.error.code).toBe("NOT_FOUND");
  });

  it("denies access to report from different account", async () => {
    const result = await useCase.execute({ reportId: "report-001", accountId: "other-acc" });

    assert.ok(!result.ok, "Should fail for different account");
    expect(result.error.code).toBe("FORBIDDEN");
    expect(repo.delete).not.toHaveBeenCalled();
  });
});

describe("UpdateCustomReportUseCase", () => {
  let repo: ReturnType<typeof makeMockRepo>;
  let useCase: UpdateCustomReportUseCase;

  beforeEach(() => {
    vi.clearAllMocks();
    repo = makeMockRepo();
    useCase = new UpdateCustomReportUseCase(repo);
  });

  it("updates report name successfully", async () => {
    const result = await useCase.execute({
      reportId: "report-001",
      accountId: "acc-001",
      name: "Updated Name",
    });

    assert.ok(result.ok, "Should succeed");
    expect(repo.update).toHaveBeenCalledWith(
      "report-001",
      expect.objectContaining({ name: "Updated Name" })
    );
  });

  it("denies access to report from different account", async () => {
    const result = await useCase.execute({
      reportId: "report-001",
      accountId: "other-acc",
      name: "Hack",
    });

    assert.ok(!result.ok, "Should fail");
    expect(result.error.code).toBe("FORBIDDEN");
    expect(repo.update).not.toHaveBeenCalled();
  });

  it("rejects invalid metrics on update", async () => {
    const result = await useCase.execute({
      reportId: "report-001",
      accountId: "acc-001",
      metrics: ["fake_metric"],
    });

    assert.ok(!result.ok, "Should fail with invalid metrics");
    expect(result.error.code).toBe("VALIDATION_FAILED");
    expect(repo.update).not.toHaveBeenCalled();
  });

  it("returns not found for missing report", async () => {
    repo.findById = vi
      .fn()
      .mockResolvedValue(err(new EntityNotFoundError("CustomReport", "missing")));

    const result = await useCase.execute({
      reportId: "missing",
      accountId: "acc-001",
      name: "Updated",
    });

    assert.ok(!result.ok, "Should fail");
    expect(result.error.code).toBe("NOT_FOUND");
  });
});
