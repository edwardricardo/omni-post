/**
 * @file templateAnalytics.ts
 * @description Template analytics service. Methods throw `notImplemented`
 *              until the analytics event pipeline is wired up. Routes that
 *              call these surface 501 responses to the client.
 * @layer infrastructure
 */
import { AppError } from "@shared/types";

interface TemplateAnalyticsFilters {
  startDate?: Date;
  endDate?: Date;
  templateIds?: string[];
}

interface TemplateUsageEvent {
  action: "VIEW" | "USE" | "COMPILE" | "LIKE" | "SHARE";
  timestamp: Date;
  context?: Record<string, unknown>;
  variantId?: string;
}

export const templateAnalytics = {
  async getTemplateAnalytics(_projectId: string, _filters?: TemplateAnalyticsFilters) {
    throw AppError.notImplemented("Template analytics aggregation not yet implemented");
  },

  async trackTemplateUsage(_projectId: string, _templateId: string, _event: TemplateUsageEvent) {
    throw AppError.notImplemented("Template usage tracking not yet implemented");
  },

  async getABTestResults(_projectId: string, _testId: string) {
    throw AppError.notImplemented("Template A/B test results not yet implemented");
  },
};
