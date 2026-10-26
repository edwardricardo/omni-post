/**
 * @file cardDatesLocaleFormatting.test.tsx
 * @description Pins the medium date (day, abbreviated month, year) that the template,
 *   automation and campaign cards and the scheduled-reports table show to the active UI locale:
 *   Spanish under `es`, and under `en` the English text they had when they named `en-US`. Also
 *   pins the automation card's success rate before its first run. Dates are built from local
 *   wall-clock parts, so the assertions hold in any time zone the suite runs in.
 * @layer infrastructure
 */
import { describe, expect, it, vi } from "vitest";
import { screen } from "@testing-library/react";
import { renderInLocale, type TestLocale } from "../../intl-test-utils";
import { TemplateCard } from "@/components/content/templates/TemplateCard";
import { AutomationCard } from "@/components/content/templates/AutomationCard";
import type { AutomationTemplate, ContentTemplate } from "@/components/content/templates/types";
import { CampaignCard } from "@/components/campaigns/CampaignCard";
import type { CampaignAnalyticsDto, CampaignDto } from "@/hooks/api/useCampaigns";
import { ScheduledReportsList } from "@/components/analytics/ScheduledReportsList";
import type { ScheduledReport } from "@/hooks/api/useReports";

const reports = vi.hoisted(() => ({ list: [] as ScheduledReport[] }));

vi.mock("@/hooks/api/useCampaigns", () => ({
  useCampaignAnalytics: () => ({ data: undefined }),
}));

vi.mock("@/hooks/api/useReports", () => ({
  useReports: () => ({ data: reports.list, isLoading: false, error: null, refetch: vi.fn() }),
  useDeleteReport: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useGenerateReport: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));

/** Thursday 29 October 2026 and the Thursday before, at 14:07 in the suite's zone. */
const OCT_29 = new Date(2026, 9, 29, 14, 7).toISOString();
const OCT_22 = new Date(2026, 9, 22, 14, 7).toISOString();
const OCT_31 = new Date(2026, 9, 31, 14, 7).toISOString();

function makeTemplate(updatedAt: string): ContentTemplate {
  return {
    id: "template-1",
    name: "Product launch",
    description: "Announces a release",
    category: "marketing",
    content: { text: "We just shipped something new", variables: [] },
    platforms: ["x"],
    tags: [],
    metadata: {
      author: { id: "user-1", name: "Ana" },
      createdAt: updatedAt,
      updatedAt,
      usage: { count: 3 },
    },
    isPublic: false,
    isFavorite: false,
  };
}

function makeAutomation(
  stats: AutomationTemplate["stats"],
  runs: Pick<AutomationTemplate, "nextRun" | "lastRun"> = {}
): AutomationTemplate {
  return {
    id: "automation-1",
    name: "Weekly recap",
    description: "Posts the week's highlights",
    trigger: { type: "schedule", config: {} },
    templateId: "template-1",
    variableMapping: {},
    platforms: ["x"],
    isActive: true,
    stats,
    ...runs,
  };
}

function makeCampaign(startDate: string, endDate: string): CampaignDto {
  return {
    id: "campaign-1",
    projectId: "project-1",
    name: "Autumn sale",
    description: null,
    status: "ACTIVE",
    startDate,
    endDate,
    utmSource: null,
    utmMedium: null,
    createdAt: startDate,
    updatedAt: startDate,
  };
}

const NO_ANALYTICS: CampaignAnalyticsDto = {
  campaignId: "campaign-1",
  totalPosts: 0,
  totalViews: 0,
  totalLikes: 0,
  totalComments: 0,
  totalShares: 0,
  totalEngagement: 0,
  avgEngagementRate: 0,
};

function makeReport(lastRunAt: string): ScheduledReport {
  return {
    id: "report-1",
    projectId: "project-1",
    name: "Monthly summary",
    cronSchedule: "0 9 1 * *",
    format: "PDF",
    recipients: ["ana@example.com"],
    filters: {},
    isActive: true,
    lastRunAt,
    nextRunAt: null,
    createdAt: lastRunAt,
    updatedAt: lastRunAt,
  };
}

function renderTemplateCard(locale: TestLocale) {
  return renderInLocale(
    locale,
    <TemplateCard
      template={makeTemplate(OCT_29)}
      onUse={vi.fn()}
      onEdit={vi.fn()}
      onDuplicate={vi.fn()}
      onDelete={vi.fn()}
    />
  );
}

function renderAutomationCard(locale: TestLocale) {
  return renderInLocale(
    locale,
    <AutomationCard
      automation={makeAutomation(
        { totalRuns: 4, successfulRuns: 3, failedRuns: 1 },
        { nextRun: OCT_29, lastRun: OCT_22 }
      )}
      onToggle={vi.fn()}
    />
  );
}

function renderCampaignCard(locale: TestLocale) {
  return renderInLocale(
    locale,
    <CampaignCard
      campaign={makeCampaign(OCT_29, OCT_31)}
      onClick={vi.fn()}
      analytics={NO_ANALYTICS}
    />
  );
}

function renderReports(locale: TestLocale) {
  reports.list = [makeReport(OCT_29)];
  return renderInLocale(
    locale,
    <ScheduledReportsList projectId="project-1" onCreateClick={vi.fn()} />
  );
}

describe("TemplateCard last update", () => {
  it("shows the date in Spanish on the es interface", () => {
    renderTemplateCard("es");

    expect(screen.getByText("29 oct 2026")).toBeInTheDocument();
  });

  it("keeps the English date on the en interface", () => {
    renderTemplateCard("en");

    expect(screen.getByText("Oct 29, 2026")).toBeInTheDocument();
  });
});

describe("AutomationCard runs", () => {
  it("shows the next and last run in Spanish on the es interface", () => {
    renderAutomationCard("es");

    expect(screen.getByText("29 oct 2026")).toBeInTheDocument();
    expect(screen.getByText("22 oct 2026")).toBeInTheDocument();
  });

  it("keeps the English next and last run on the en interface", () => {
    renderAutomationCard("en");

    expect(screen.getByText("Oct 29, 2026")).toBeInTheDocument();
    expect(screen.getByText("Oct 22, 2026")).toBeInTheDocument();
  });

  it("shows the success rate of the runs so far", () => {
    renderAutomationCard("en");

    expect(screen.getByText("75%")).toBeInTheDocument();
  });

  it("shows a dash for the success rate before the first run, never NaN", () => {
    renderInLocale(
      "en",
      <AutomationCard
        automation={makeAutomation({ totalRuns: 0, successfulRuns: 0, failedRuns: 0 })}
        onToggle={vi.fn()}
      />
    );

    expect(screen.queryByText(/NaN/)).toBeNull();
    expect(screen.getByText("—")).toBeInTheDocument();
  });
});

describe("CampaignCard date range", () => {
  it("shows the start and end dates in Spanish on the es interface", () => {
    renderCampaignCard("es");

    expect(screen.getByText("29 oct 2026 - 31 oct 2026")).toBeInTheDocument();
  });

  it("keeps the English start and end dates on the en interface", () => {
    renderCampaignCard("en");

    expect(screen.getByText("Oct 29, 2026 - Oct 31, 2026")).toBeInTheDocument();
  });
});

describe("ScheduledReportsList last run", () => {
  it("shows the last run in Spanish on the es interface", () => {
    renderReports("es");

    expect(screen.getByText("29 oct 2026")).toBeInTheDocument();
  });

  it("keeps the English last run on the en interface", () => {
    renderReports("en");

    expect(screen.getByText("Oct 29, 2026")).toBeInTheDocument();
  });
});
