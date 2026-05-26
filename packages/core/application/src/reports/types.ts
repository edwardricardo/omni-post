/**
 * @file types.ts
 * @description Input and output DTOs for Scheduled Report use cases.
 * @layer application
 */

export interface CreateScheduledReportInput {
  projectId: string;
  name: string;
  cronSchedule: string;
  format?: string;
  recipients: string[];
  filters?: Record<string, unknown>;
}

export interface UpdateScheduledReportInput {
  reportId: string;
  cronSchedule?: string;
  recipients?: string[];
  isActive?: boolean;
}

export interface DeleteScheduledReportInput {
  reportId: string;
}

export interface ListScheduledReportsInput {
  projectId: string;
}

export interface GenerateReportInput {
  reportId: string;
}

export interface CreateScheduledReportOutput {
  id: string;
}
