/**
 * @file abTestTypes.ts
 * @description TypeScript interfaces and helper utilities for A/B tests, test results, and the ABTestManager component props.
 */

import { ABTestConfig } from "@/lib/templates/templateEngine";

export interface ABTest {
  id: string;
  templateId: string;
  name: string;
  description?: string;
  config: ABTestConfig;
  status: "draft" | "running" | "paused" | "completed" | "stopped";
  startDate?: Date;
  endDate?: Date;
  createdAt: Date;
  updatedAt: Date;
  results?: ABTestResults;
}

export interface ABTestResults {
  totalViews: number;
  totalConversions: number;
  overallConversionRate: number;
  variants: Array<{
    variantId: string;
    views: number;
    conversions: number;
    conversionRate: number;
    confidence: number;
    isWinner?: boolean;
    isStatisticallySignificant?: boolean;
  }>;
  winnerVariantId?: string;
  confidenceLevel: number;
  recommendedAction: "continue" | "stop" | "extend" | "implement_winner";
}

export interface ABTestManagerProps {
  templates: import("@/lib/templates/templateEngine").Template[];
  onTestCreate?: (test: Omit<ABTest, "id" | "status" | "createdAt" | "updatedAt">) => Promise<void>;
  onTestUpdate?: (test: ABTest) => Promise<void>;
  onTestDelete?: (testId: string) => Promise<void>;
  onTestStart?: (testId: string) => Promise<void>;
  onTestPause?: (testId: string) => Promise<void>;
  onTestStop?: (testId: string) => Promise<void>;
  tests?: ABTest[];
  allowManagement?: boolean;
}

export function getStatusColor(status: ABTest["status"]) {
  switch (status) {
    case "running":
      return "bg-green-500";
    case "paused":
      return "bg-yellow-500";
    case "completed":
      return "bg-blue-500";
    case "stopped":
      return "bg-red-500";
    default:
      return "bg-gray-500";
  }
}
