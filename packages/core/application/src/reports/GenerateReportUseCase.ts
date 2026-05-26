/**
 * @file GenerateReportUseCase.ts
 * @description Generates an analytics report for a scheduled report configuration.
 *   Fetches analytics data, formats as CSV or JSON, sends via email, and records execution.
 * @layer application
 */

import { type Result, ok, err, exportToCSV, type ColumnDefinition } from "@shared/types";
import { type UseCase, UseCaseError, USE_CASE_ERRORS } from "../UseCase.js";
import { type ScheduledReportRepository } from "@core/domain/repositories/ScheduledReportRepository.js";
import { type AnalyticsReadRepositoryPort } from "@core/domain/repositories/AnalyticsReadRepository.js";
import { type EmailPort } from "@core/domain/repositories/EmailPort.js";
import { ScheduledReportId } from "@core/domain/value-objects/EntityId.js";
import { type GenerateReportInput } from "./types.js";

/**
 * Output DTO for a generated report.
 */
export interface GenerateReportOutput {
  reportId: string;
  recipientCount: number;
  format: string;
  recordCount: number;
}

/**
 * Flat row shape used for CSV/JSON export.
 */
interface AnalyticsExportRow {
  postId: string;
  channelId: string;
  provider: string;
  views: number;
  likes: number;
  comments: number;
  shares: number;
  capturedAt: string;
}

/**
 * Column definitions for CSV export of analytics data.
 */
const ANALYTICS_CSV_COLUMNS: ColumnDefinition<AnalyticsExportRow>[] = [
  { key: "postId", header: "Post ID" },
  { key: "channelId", header: "Channel ID" },
  { key: "provider", header: "Provider" },
  { key: "views", header: "Views" },
  { key: "likes", header: "Likes" },
  { key: "comments", header: "Comments" },
  { key: "shares", header: "Shares" },
  { key: "capturedAt", header: "Captured At" },
];

/**
 * @class GenerateReportUseCase
 * @description Generates and delivers an analytics report for a scheduled report.
 *   Loads the report configuration, fetches analytics data, formats the output,
 *   sends it via email, and records the execution timestamp.
 */
export class GenerateReportUseCase implements UseCase<
  GenerateReportInput,
  GenerateReportOutput,
  UseCaseError
> {
  constructor(
    private readonly reportRepository: ScheduledReportRepository,
    private readonly analyticsReadRepository: AnalyticsReadRepositoryPort,
    private readonly emailPort: EmailPort
  ) {}

  /**
   * @method execute
   * @description Generates and delivers the report.
   * @param input - Contains the reportId to generate
   * @returns Result with generation details on success
   */
  async execute(input: GenerateReportInput): Promise<Result<GenerateReportOutput, UseCaseError>> {
    // 1. Load report configuration
    const idResult = ScheduledReportId.fromString(input.reportId);
    if (!idResult.ok) {
      return err(
        new UseCaseError(
          `Invalid report ID: ${input.reportId}`,
          USE_CASE_ERRORS.VALIDATION_FAILED,
          idResult.error
        )
      );
    }

    const findResult = await this.reportRepository.findById(idResult.value);
    if (!findResult.ok) {
      return err(
        new UseCaseError("Scheduled report not found", USE_CASE_ERRORS.NOT_FOUND, findResult.error)
      );
    }

    const report = findResult.value;

    // 2. Fetch analytics data for the project
    const analyticsData = await this.analyticsReadRepository.getByProjectId(
      report.projectId.value,
      {
        ...(report.filters.startDate !== undefined && {
          startDate: new Date(report.filters.startDate as string),
        }),
        ...(report.filters.endDate !== undefined && {
          endDate: new Date(report.filters.endDate as string),
        }),
        ...(report.filters.provider !== undefined && {
          provider: report.filters.provider as string,
        }),
      }
    );

    // 3. Transform to export rows
    const exportRows: AnalyticsExportRow[] = analyticsData.map((record) => ({
      postId: record.postId ?? "N/A",
      channelId: record.channelId,
      provider: record.provider,
      views: record.views ?? 0,
      likes: record.likes ?? 0,
      comments: record.comments ?? 0,
      shares: record.shares ?? 0,
      capturedAt: record.capturedAt.toISOString(),
    }));

    // 4. Format output
    let fileContent: string;
    let contentType: string;
    let fileExtension: string;

    if (report.format === "CSV") {
      fileContent = exportToCSV(exportRows, ANALYTICS_CSV_COLUMNS);
      contentType = "text/csv";
      fileExtension = "csv";
    } else {
      fileContent = JSON.stringify(exportRows, null, 2);
      contentType = "application/json";
      fileExtension = "json";
    }

    const timestamp = new Date()
      .toISOString()
      .replace(/:/g, "-")
      .replace(/\.\d+Z$/, "");
    const filename = `report-${report.name.replace(/\s+/g, "-").toLowerCase()}-${timestamp}.${fileExtension}`;

    // 5. Send via email
    await this.emailPort.send({
      to: report.recipients,
      subject: `OmniPost Report: ${report.name}`,
      body: [
        `Your scheduled report "${report.name}" is ready.`,
        "",
        `Records: ${exportRows.length}`,
        `Format: ${report.format}`,
        `Generated: ${new Date().toISOString()}`,
      ].join("\n"),
      attachments: [
        {
          filename,
          content: fileContent,
          contentType,
        },
      ],
    });

    // 6. Record execution on the entity and persist
    report.recordExecution();
    const saveResult = await this.reportRepository.save(report);
    if (!saveResult.ok) {
      return err(
        new UseCaseError(
          "Failed to update report after execution",
          USE_CASE_ERRORS.INTERNAL_ERROR,
          saveResult.error
        )
      );
    }

    return ok({
      reportId: report.id.value,
      recipientCount: report.recipients.length,
      format: report.format,
      recordCount: exportRows.length,
    });
  }
}
