/**
 * @file types.ts
 * @description Public types for the platform settings hook module.
 * @layer infrastructure
 */

export interface SettingsStatus {
  groups: Record<string, boolean>;
  overallHealth: "healthy" | "partial" | "unconfigured";
}

export interface TestResult {
  success: boolean;
  message: string;
  latencyMs?: number;
}

export type GroupCredentials = Record<string, string | null>;
