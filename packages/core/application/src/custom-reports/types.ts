/**
 * @file types.ts
 * @description Input and output DTOs for Custom Report use cases.
 * @layer application
 */

export interface CreateCustomReportInput {
  accountId: string;
  projectId?: string;
  name: string;
  description?: string;
  metrics: string[];
  dimensions: string[];
  dateRange?: string;
  dateRangeStart?: string;
  dateRangeEnd?: string;
  chartType?: string;
  filters?: Record<string, unknown>;
  isShared?: boolean;
  createdById: string;
}

export interface CreateCustomReportOutput {
  id: string;
}

export interface UpdateCustomReportInput {
  reportId: string;
  accountId: string;
  name?: string;
  description?: string;
  metrics?: string[];
  dimensions?: string[];
  dateRange?: string;
  dateRangeStart?: string;
  dateRangeEnd?: string;
  chartType?: string;
  filters?: Record<string, unknown>;
  isShared?: boolean;
}

export interface DeleteCustomReportInput {
  reportId: string;
  accountId: string;
}

export interface ListCustomReportsInput {
  accountId: string;
}

export interface GetCustomReportInput {
  reportId: string;
  accountId: string;
}

export interface RunCustomReportInput {
  reportId: string;
  accountId: string;
}

export interface RunCustomReportOutput {
  reportId: string;
  labels: string[];
  datasets: { label: string; data: number[] }[];
  hasData: boolean;
}

export interface ScheduleCustomReportInput {
  reportId: string;
  accountId: string;
  cronExpression: string;
  timezone?: string;
  format?: string;
  recipients: string[];
}

export interface ScheduleCustomReportOutput {
  id: string;
}
