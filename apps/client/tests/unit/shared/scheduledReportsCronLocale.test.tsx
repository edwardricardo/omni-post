/**
 * @file scheduledReportsCronLocale.test.tsx
 * @description Pins the schedule the scheduled-reports table shows for each report's cron
 *   expression: in the language of the active UI locale, on a 12-hour clock, and the raw
 *   expression when it cannot be read.
 * @layer infrastructure
 */
import { describe, expect, it, vi } from "vitest";
import { screen } from "@testing-library/react";
import { renderInLocale, type TestLocale } from "../../intl-test-utils";
import { ScheduledReportsList } from "@/components/analytics/ScheduledReportsList";
import type { ScheduledReport } from "@/hooks/api/useReports";

const reports = vi.hoisted(() => ({ list: [] as ScheduledReport[] }));

vi.mock("@/hooks/api/useReports", () => ({
  useReports: () => ({ data: reports.list, isLoading: false, error: null, refetch: vi.fn() }),
  useDeleteReport: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useGenerateReport: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));

function makeReport(cronSchedule: string): ScheduledReport {
  return {
    id: "report-1",
    projectId: "project-1",
    name: "Monthly summary",
    cronSchedule,
    format: "PDF",
    recipients: ["ana@example.com"],
    filters: {},
    isActive: true,
    lastRunAt: null,
    nextRunAt: null,
    createdAt: "2026-10-01T00:00:00.000Z",
    updatedAt: "2026-10-01T00:00:00.000Z",
  };
}

function renderReports(locale: TestLocale, cronSchedule: string) {
  reports.list = [makeReport(cronSchedule)];
  return renderInLocale(
    locale,
    <ScheduledReportsList projectId="project-1" onCreateClick={vi.fn()} />
  );
}

describe("ScheduledReportsList schedule", () => {
  it("describes the cron in Spanish on the es interface", () => {
    renderReports("es", "0 14 * * 1");

    expect(screen.getByText("A las 02:00 PM, s\u00F3lo el lunes")).toBeInTheDocument();
  });

  it("describes the cron in English on a 12-hour clock on the en interface", () => {
    renderReports("en", "0 14 * * 1");

    expect(screen.getByText("At 02:00 PM, only on Monday")).toBeInTheDocument();
  });

  it.each<TestLocale>(["en", "es"])(
    "shows an unreadable cron as typed on the %s interface",
    (locale) => {
      renderReports(locale, "not a cron");

      expect(screen.getByTitle("not a cron")).toHaveTextContent("not a cron");
    }
  );
});
