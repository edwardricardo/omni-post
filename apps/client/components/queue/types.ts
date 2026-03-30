/**
 * @file types.ts
 * @description TypeScript type definitions for the publishing queue, including QueueItem,
 * QueueStats, QueueFilter, view types, and priority/status enumerations.
 */

export interface QueueItem {
  id: string;
  content: {
    text: string;
    title?: string;
    media?: Array<{
      id: string;
      type: "image" | "video" | "gif";
      url: string;
      alt?: string;
    }>;
  };
  providers: string[];
  scheduledFor?: Date;
  status: "draft" | "queued" | "processing" | "published" | "failed" | "cancelled" | "retrying";
  priority: "low" | "medium" | "high" | "urgent";
  progress?: number;
  error?: string;
  attempts: number;
  maxAttempts: number;
  createdAt: Date;
  updatedAt: Date;
  publishedAt?: Date;
  metadata?: {
    adaptations?: Record<string, any>;
    originalContent?: any;
    retryReason?: string;
    estimatedTime?: number;
  };
}

export interface QueueStats {
  total: number;
  queued: number;
  processing: number;
  published: number;
  failed: number;
  avgProcessingTime: number;
  successRate: number;
}

export interface QueueFilter {
  status?: QueueItem["status"][];
  priority?: QueueItem["priority"][];
  providers?: string[];
  dateRange?: {
    start: Date;
    end: Date;
  };
}

export interface PublishingQueueManagerProps {
  accountId: string;
  projectId: string;
  onQueueUpdate?: (stats: QueueStats) => void;
  onItemUpdate?: (item: QueueItem) => void;
  onError?: (error: string) => void;
}

export type ViewType = "list" | "details" | "analytics";
