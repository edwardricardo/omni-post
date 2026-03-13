/**
 * @file reportGenerationWorker.ts
 * @description BullMQ worker that handles scheduled report generation jobs:
 *              - check-due-reports: runs every 15 minutes to find and enqueue due reports
 *              - generate-report: generates a single report (analytics fetch + email delivery)
 *
 *              Registers a repeatable cron job on startup for the due-report scanner.
 * @layer infrastructure (worker process)
 */

import dotenv from "dotenv";
dotenv.config({ path: "../../.env" });

import { Worker, Queue } from "bullmq";
import type { Job } from "bullmq";
import Redis from "ioredis";
import pino from "pino";
import client from "prom-client";
import http from "http";
import { prisma } from "@infra/prisma";
import { QUEUE_NAMES } from "@adapters/queue-bullmq";
import { exportToCSV, type ColumnDefinition } from "@packages/api-common";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const QUEUE_NAME = QUEUE_NAMES.REPORT_GENERATION;

interface CheckDueReportsJobData {
  type: "check-due-reports";
}

interface GenerateReportJobData {
  type: "generate-report";
  reportId: string;
}

type ReportJobData = CheckDueReportsJobData | GenerateReportJobData;

// ---------------------------------------------------------------------------
// Logger & Metrics
// ---------------------------------------------------------------------------

const logger = pino({ level: process.env.LOG_LEVEL ?? "info" });

const registry = new client.Registry();
client.collectDefaultMetrics({ register: registry });

const jobsProcessed = new client.Counter({
  name: "report_generation_jobs_processed_total",
  help: "Total number of report generation jobs processed",
  labelNames: ["type", "status"] as const,
  registers: [registry],
});

const jobDuration = new client.Histogram({
  name: "report_generation_job_duration_seconds",
  help: "Duration of report generation jobs in seconds",
  labelNames: ["type"] as const,
  buckets: [0.5, 1, 5, 10, 30, 60],
  registers: [registry],
});

const reportsGenerated = new client.Counter({
  name: "reports_generated_total",
  help: "Total reports successfully generated and delivered",
  registers: [registry],
});

// ---------------------------------------------------------------------------
// Analytics export helpers
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Job handlers
// ---------------------------------------------------------------------------

/**
 * Scans for due reports and enqueues individual generation jobs for each.
 */
async function checkDueReports(queue: Queue): Promise<void> {
  const now = new Date();
  const dueReports = await prisma.scheduledReport.findMany({
    where: {
      isActive: true,
      nextRunAt: { lte: now },
    },
    orderBy: { nextRunAt: "asc" },
  });

  logger.info({ count: dueReports.length }, "Found due reports");

  for (const report of dueReports) {
    await queue.add(
      "generate-report",
      { type: "generate-report" as const, reportId: report.id },
      { jobId: `report-${report.id}-${now.getTime()}` }
    );
    logger.info({ reportId: report.id, name: report.name }, "Enqueued report generation");
  }
}

/**
 * Generates a single report: fetches analytics, formats, sends email, updates metadata.
 */
async function generateReport(reportId: string): Promise<void> {
  // 1. Load report
  const report = await prisma.scheduledReport.findUnique({
    where: { id: reportId },
  });

  if (!report) {
    logger.warn({ reportId }, "Report not found, skipping");
    return;
  }

  if (!report.isActive) {
    logger.info({ reportId }, "Report is inactive, skipping");
    return;
  }

  // 2. Parse filters
  const filters =
    report.filters !== null && typeof report.filters === "object" && !Array.isArray(report.filters)
      ? (report.filters as Record<string, unknown>)
      : {};

  // 3. Fetch analytics data
  const whereClause: Record<string, unknown> = {
    channel: { projectId: report.projectId },
  };

  if (filters.startDate) {
    whereClause.capturedAt = {
      ...(whereClause.capturedAt as Record<string, unknown> | undefined),
      gte: new Date(filters.startDate as string),
    };
  }
  if (filters.endDate) {
    whereClause.capturedAt = {
      ...(whereClause.capturedAt as Record<string, unknown> | undefined),
      lte: new Date(filters.endDate as string),
    };
  }
  if (filters.provider) {
    whereClause.provider = filters.provider;
  }

  const analyticsData = await prisma.analytics.findMany({
    where: whereClause,
    orderBy: { capturedAt: "desc" },
    take: 10000,
  });

  // 4. Transform to export rows
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

  // 5. Format output
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

  // 6. Send email via Resend (if configured)
  const resendApiKey = process.env.RESEND_API_KEY;
  const fromAddress = process.env.RESEND_FROM_ADDRESS ?? "reports@omnipost.app";

  if (resendApiKey && report.recipients.length > 0) {
    try {
      const emailPayload: Record<string, unknown> = {
        from: fromAddress,
        to: report.recipients,
        subject: `OmniPost Report: ${report.name}`,
        text: [
          `Your scheduled report "${report.name}" is ready.`,
          "",
          `Records: ${exportRows.length}`,
          `Format: ${report.format}`,
          `Generated: ${new Date().toISOString()}`,
        ].join("\n"),
        attachments: [
          {
            filename,
            content: Buffer.from(fileContent).toString("base64"),
            content_type: contentType,
          },
        ],
      };

      const response = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${resendApiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(emailPayload),
      });

      if (!response.ok) {
        const errorBody = await response.text();
        logger.error({ reportId, status: response.status, errorBody }, "Resend API error");
      } else {
        logger.info({ reportId, recipients: report.recipients.length }, "Report email sent");
      }
    } catch (emailError: unknown) {
      const msg = emailError instanceof Error ? emailError.message : String(emailError);
      logger.error({ reportId, error: msg }, "Failed to send report email");
    }
  } else {
    logger.warn({ reportId }, "No RESEND_API_KEY configured or no recipients, skipping email");
  }

  // 7. Update report metadata: lastRunAt + compute nextRunAt
  const now = new Date();
  const nextRunAt = computeNextRun(report.cronSchedule, now);

  await prisma.scheduledReport.update({
    where: { id: reportId },
    data: {
      lastRunAt: now,
      nextRunAt,
    },
  });

  reportsGenerated.inc();
  logger.info(
    { reportId, records: exportRows.length, format: report.format },
    "Report generated successfully"
  );
}

// ---------------------------------------------------------------------------
// Cron next-run calculator (simplified)
// ---------------------------------------------------------------------------

function computeNextRun(cronSchedule: string, from: Date): Date {
  const parts = cronSchedule.split(/\s+/);
  const next = new Date(from.getTime());

  const minutePart = parts[0];
  const hourPart = parts[1];

  if (minutePart && hourPart && /^\d+$/.test(minutePart) && /^\d+$/.test(hourPart)) {
    const minute = parseInt(minutePart, 10);
    const hour = parseInt(hourPart, 10);
    next.setMinutes(minute, 0, 0);
    next.setHours(hour);
    if (next.getTime() <= from.getTime()) {
      next.setDate(next.getDate() + 1);
    }
    return next;
  }

  // Fallback: 1 hour from now
  next.setTime(from.getTime() + 60 * 60 * 1000);
  return next;
}

// ---------------------------------------------------------------------------
// Worker setup
// ---------------------------------------------------------------------------

const redisConnection = new Redis(process.env.REDIS_URL || "redis://localhost:6379", {
  maxRetriesPerRequest: null,
  enableReadyCheck: false,
});
redisConnection.on("error", () => {
  // Suppress unhandled errors
});

const queue = new Queue(QUEUE_NAME, { connection: redisConnection });

const worker = new Worker<ReportJobData>(
  QUEUE_NAME,
  async (job: Job<ReportJobData>) => {
    const startTime = Date.now();
    const jobType = job.data.type;

    try {
      logger.info({ jobType, jobId: job.id }, "Processing report job");

      if (jobType === "check-due-reports") {
        await checkDueReports(queue);
      } else if (jobType === "generate-report") {
        const data = job.data as GenerateReportJobData;
        await generateReport(data.reportId);
      }

      const durationSec = (Date.now() - startTime) / 1000;
      jobDuration.observe({ type: jobType }, durationSec);
      jobsProcessed.inc({ type: jobType, status: "success" });

      logger.info({ jobType, durationSec }, "Report job completed");
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      jobsProcessed.inc({ type: jobType, status: "failure" });
      logger.error({ jobType, error: msg }, "Report job failed");

      if (error instanceof Error) {
        // Rethrow to let BullMQ retry

        throw error;
      }

      throw new Error(msg);
    }
  },
  {
    connection: redisConnection,
    concurrency: 3,
  }
);

// ---------------------------------------------------------------------------
// Startup: register repeatable cron job
// ---------------------------------------------------------------------------

async function start(): Promise<void> {
  // Check for due reports every 15 minutes
  await queue.upsertJobScheduler(
    "check-due-reports-scheduler",
    { every: 15 * 60 * 1000 },
    { name: "check-due-reports", data: { type: "check-due-reports" as const } }
  );

  logger.info("Report generation worker started. Checking for due reports every 15 minutes.");

  // Health & metrics endpoint
  const metricsPort = Number(process.env.REPORT_WORKER_METRICS_PORT ?? 9101);
  http
    .createServer(async (req, res) => {
      if (req.url === "/metrics") {
        res.setHeader("Content-Type", registry.contentType);
        res.end(await registry.metrics());
      } else if (req.url === "/health") {
        res.setHeader("Content-Type", "application/json");
        res.end(
          JSON.stringify({
            ok: true,
            timestamp: new Date().toISOString(),
            worker: "report-generation",
          })
        );
      } else {
        res.statusCode = 404;
        res.end();
      }
    })
    .listen(metricsPort, () => {
      logger.info({ metricsPort }, "Report worker metrics server listening");
    });
}

// Graceful shutdown
process.on("SIGTERM", async () => {
  logger.info("SIGTERM received, shutting down report worker");
  await worker.close();
  await queue.close();
  redisConnection.disconnect();
  process.exit(0);
});

start();
