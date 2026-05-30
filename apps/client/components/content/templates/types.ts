/**
 * @file types.ts
 * @description TypeScript type definitions for the templates section, including ContentTemplate,
 * AutomationTemplate, tab options, filter options, sort options, and view mode types.
 * @layer infrastructure
 */

export interface ContentTemplate {
  id: string;
  name: string;
  description: string;
  category: string;
  content: {
    text: string;
    variables: Array<{
      name: string;
      type: "text" | "number" | "date" | "url" | "hashtags" | "mentions";
      placeholder: string;
      required: boolean;
      defaultValue?: string;
    }>;
    media?: Array<{
      type: "image" | "video";
      placeholder: string;
      required: boolean;
      dimensions?: { width: number; height: number };
    }>;
  };
  platforms: string[];
  tags: string[];
  metadata: {
    author: {
      id: string;
      name: string;
      avatar?: string;
    };
    createdAt: string;
    updatedAt: string;
    usage: {
      count: number;
      lastUsed?: string;
    };
    performance?: {
      avgEngagement: number;
      avgReach: number;
      successRate: number;
    };
  };
  isPublic: boolean;
  isFavorite: boolean;
  automationRules?: Array<{
    id: string;
    name: string;
    trigger: "schedule" | "keyword" | "event" | "performance";
    condition: string;
    action: "create_post" | "suggest_content" | "auto_populate";
    isActive: boolean;
  }>;
}

export interface AutomationTemplate {
  id: string;
  name: string;
  description: string;
  trigger: {
    type: "schedule" | "keyword" | "event" | "performance";
    config: Record<string, unknown>;
  };
  templateId: string;
  variableMapping: Record<string, string>;
  platforms: string[];
  isActive: boolean;
  lastRun?: string;
  nextRun?: string;
  stats: {
    totalRuns: number;
    successfulRuns: number;
    failedRuns: number;
  };
}

export interface ContentTemplatesProps {
  projectId: string;
  onTemplateSelect?: (template: ContentTemplate) => void;
  onTemplateCreate?: () => void;
  onTemplateEdit?: (templateId: string) => void;
  onTemplateDelete?: (templateId: string) => void;
  onTemplateUse?: (templateId: string, variables: Record<string, unknown>) => void;
  onAutomationCreate?: (automation: Partial<AutomationTemplate>) => void;
  onAutomationToggle?: (automationId: string, active: boolean) => void;
  showAutomation?: boolean;
  maxTemplates?: number;
}

export interface FilterOptions {
  category?: string;
  platform?: string;
  author?: string;
  performance?: "high" | "medium" | "low";
}

export type SortOption = "newest" | "oldest" | "popular" | "performance";
export type ViewMode = "grid" | "list";
export type TabOption = "templates" | "automation";
