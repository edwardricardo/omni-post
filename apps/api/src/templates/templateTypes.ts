/**
 * Template Types
 *
 * Type definitions for the template system including templates, variables,
 * variants, A/B testing configuration, versioning, and query interfaces.
 * Shared across TemplateService, TemplateVersionService, and TemplateABTestService.
 *
 * @module templates/templateTypes
 */

export interface Template {
  id: string;
  name: string;
  description?: string;
  category: string;
  content: string;
  variables: TemplateVariable[];
  platforms: string[];
  variants?: TemplateVariant[];
  tags?: string[];
  version?: number;
  createdAt?: Date;
  updatedAt?: Date;
}

export interface TemplateVariable {
  name: string;
  type: "string" | "number" | "boolean" | "date" | "array" | "object";
  description?: string;
  required?: boolean;
  defaultValue?: unknown;
  options?: string[];
}

export interface TemplateVariant {
  id: string;
  name: string;
  content: string;
  weight?: number;
}

export interface ABTestConfig {
  enabled: boolean;
  variants: TemplateVariant[];
  trafficSplit?: number[];
  startDate?: Date;
  endDate?: Date;
}

export interface TemplateVersion {
  id: string;
  templateId: string;
  version: number;
  content: string;
  variables: string[];
  platforms: string[];
  tags: string[];
  changeLog: string;
  author: {
    id: string;
    name: string;
    avatar?: string;
  };
  createdAt: Date;
  isActive: boolean;
  parentVersionId?: string;
  branchName?: string;
  commitMessage?: string;
}

export interface ABTest {
  id: string;
  name: string;
  description?: string;
  templateId: string;
  config: ABTestConfig;
  status: "DRAFT" | "RUNNING" | "PAUSED" | "COMPLETED" | "STOPPED";
  startDate?: Date;
  endDate?: Date;
  createdAt: Date;
  updatedAt: Date;
}

export interface TemplateFilters {
  category?: string;
  platform?: string;
  tags?: string[];
  search?: string;
}

export interface PaginationOptions {
  limit: number;
  offset: number;
}
