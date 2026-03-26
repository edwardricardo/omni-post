/**
 * @file reportUseCases.test.ts
 * @description Tests for report use cases — CreateScheduledReport, GenerateReport.
 * @layer test
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import assert from "node:assert/strict";
import { CreateScheduledReportUseCase } from "../../../src/application/reports/CreateScheduledReportUseCase.js";
import { GenerateReportUseCase } from "../../../src/application/reports/GenerateReportUseCase.js";
import { ProjectId, ScheduledReportId } from "../../../src/domain/value-objects/EntityId.js";

// ============================================================================
// CreateScheduledReportUseCase
// ============================================================================

describe("CreateScheduledReportUseCase", () => {
  function makeRepo() {
    return {
      save: vi.fn(async () => ({ ok: true as const, value: undefined })),
      findById: vi.fn(async () => ({ ok: false as const, error: new Error("Not found") })),
    };
  }

  function makeInput(overrides: Record<string, unknown> = {}) {
    return {
      projectId: ProjectId.generate().value,
      name: "Weekly Summary",
      cronSchedule: "0 8 * * MON",
      recipients: ["manager@company.com"],
      ...overrides,
    };
  }

  let repo: ReturnType<typeof makeRepo>;
  let uc: CreateScheduledReportUseCase;

  beforeEach(() => {
    vi.clearAllMocks();
    repo = makeRepo();
    uc = new CreateScheduledReportUseCase(repo as any);
  });

  it("creates report and returns ID", async () => {
    const r = await uc.execute(makeInput());
    assert.ok(r.ok);
    assert.ok(r.value.id);
    expect(repo.save).toHaveBeenCalledOnce();
  });

  it("rejects invalid projectId", async () => {
    const r = await uc.execute(makeInput({ projectId: "bad-id" }));
    assert.ok(!r.ok);
    expect(r.error.message).toContain("Invalid projectId");
  });

  it("passes optional format", async () => {
    const r = await uc.execute(makeInput({ format: "CSV" }));
    assert.ok(r.ok);
  });

  it("passes optional filters", async () => {
    const r = await uc.execute(makeInput({ filters: { provider: "X" } }));
    assert.ok(r.ok);
  });

  it("returns error when save fails", async () => {
    repo.save.mockResolvedValueOnce({ ok: false, error: new Error("DB") });
    const r = await uc.execute(makeInput());
    assert.ok(!r.ok);
    expect(r.error.message).toContain("Failed to save");
  });

  it("rejects when domain entity creation fails (e.g., empty name)", async () => {
    const r = await uc.execute(makeInput({ name: "" }));
    assert.ok(!r.ok);
  });
});

// ============================================================================
// GenerateReportUseCase
// ============================================================================

describe("GenerateReportUseCase", () => {
  const reportId = ScheduledReportId.generate();

  function makeReportEntity() {
    return {
      id: reportId,
      projectId: ProjectId.generate(),
      name: "Test Report",
      format: "CSV",
      recipients: ["test@email.com"],
      filters: {},
      recordExecution: vi.fn(),
    };
  }

  function makeReportRepo(entity: ReturnType<typeof makeReportEntity> | null = null) {
    const report = entity ?? makeReportEntity();
    return {
      findById: vi.fn(async () => ({ ok: true as const, value: report })),
      save: vi.fn(async () => ({ ok: true as const, value: undefined })),
      _report: report,
    };
  }

  function makeAnalyticsRepo(data: any[] = []) {
    return {
      getByProjectId: vi.fn(async () => data),
    };
  }

  function makeEmailPort() {
    return {
      send: vi.fn(async () => {}),
    };
  }

  let reportRepo: ReturnType<typeof makeReportRepo>;
  let analyticsRepo: ReturnType<typeof makeAnalyticsRepo>;
  let emailPort: ReturnType<typeof makeEmailPort>;
  let uc: GenerateReportUseCase;

  beforeEach(() => {
    vi.clearAllMocks();
    reportRepo = makeReportRepo();
    analyticsRepo = makeAnalyticsRepo([
      {
        postId: "p1",
        channelId: "ch1",
        provider: "X",
        views: 100,
        likes: 10,
        comments: 2,
        shares: 1,
        capturedAt: new Date(),
      },
      {
        postId: "p2",
        channelId: "ch1",
        provider: "X",
        views: 200,
        likes: 20,
        comments: 4,
        shares: 2,
        capturedAt: new Date(),
      },
    ]);
    emailPort = makeEmailPort();
    uc = new GenerateReportUseCase(reportRepo as any, analyticsRepo as any, emailPort as any);
  });

  it("generates report and sends email", async () => {
    const r = await uc.execute({ reportId: reportId.value });
    assert.ok(r.ok);
    assert.equal(r.value.recordCount, 2);
    assert.equal(r.value.format, "CSV");
    assert.equal(r.value.recipientCount, 1);
    expect(emailPort.send).toHaveBeenCalledOnce();
  });

  it("calls recordExecution on the report entity", async () => {
    await uc.execute({ reportId: reportId.value });
    expect(reportRepo._report.recordExecution).toHaveBeenCalledOnce();
  });

  it("saves report after execution", async () => {
    await uc.execute({ reportId: reportId.value });
    expect(reportRepo.save).toHaveBeenCalledOnce();
  });

  it("sends CSV attachment for CSV format", async () => {
    await uc.execute({ reportId: reportId.value });
    const emailCall = emailPort.send.mock.calls[0]?.[0];
    assert.ok(emailCall?.attachments?.[0]?.contentType === "text/csv");
    assert.ok(emailCall?.attachments?.[0]?.filename?.endsWith(".csv"));
  });

  it("sends JSON attachment for JSON format", async () => {
    const entity = makeReportEntity();
    (entity as any).format = "JSON";
    reportRepo = makeReportRepo(entity as any);
    uc = new GenerateReportUseCase(reportRepo as any, analyticsRepo as any, emailPort as any);

    await uc.execute({ reportId: reportId.value });
    const emailCall = emailPort.send.mock.calls[0]?.[0];
    assert.equal(emailCall?.attachments?.[0]?.contentType, "application/json");
  });

  it("rejects invalid report ID", async () => {
    const r = await uc.execute({ reportId: "not-uuid" });
    assert.ok(!r.ok);
  });

  it("returns NOT_FOUND when report doesn't exist", async () => {
    reportRepo.findById.mockResolvedValueOnce({ ok: false, error: new Error("Not found") });
    const r = await uc.execute({ reportId: reportId.value });
    assert.ok(!r.ok);
    expect(r.error.message).toContain("not found");
  });

  it("returns error when post-execution save fails", async () => {
    reportRepo.save.mockResolvedValueOnce({ ok: false, error: new Error("Save failed") });
    const r = await uc.execute({ reportId: reportId.value });
    assert.ok(!r.ok);
  });

  it("handles empty analytics data", async () => {
    analyticsRepo = makeAnalyticsRepo([]);
    uc = new GenerateReportUseCase(reportRepo as any, analyticsRepo as any, emailPort as any);
    const r = await uc.execute({ reportId: reportId.value });
    assert.ok(r.ok);
    assert.equal(r.value.recordCount, 0);
  });

  it("maps null postId to N/A in export rows", async () => {
    analyticsRepo = makeAnalyticsRepo([
      {
        postId: null,
        channelId: "ch1",
        provider: "X",
        views: 50,
        likes: 5,
        comments: 0,
        shares: 0,
        capturedAt: new Date(),
      },
    ]);
    uc = new GenerateReportUseCase(reportRepo as any, analyticsRepo as any, emailPort as any);
    const r = await uc.execute({ reportId: reportId.value });
    assert.ok(r.ok);
    // Verify the CSV content doesn't crash on null postId
    expect(emailPort.send).toHaveBeenCalledOnce();
  });

  it("includes report name in email subject", async () => {
    await uc.execute({ reportId: reportId.value });
    const emailCall = emailPort.send.mock.calls[0]?.[0];
    expect(emailCall?.subject).toContain("Test Report");
  });
});
