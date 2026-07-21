/**
 * @file orchestration.ts
 * @description TypeScript types for multi-provider content synchronization
 *              and orchestration (plans, executions, conflicts, sync configs).
 * @layer domain
 */

import type { CanonicalPost, Result } from "./types.js";
import type { ProviderId } from "./providers/providerConfig.js";

// Core Orchestration Types
export type OrchestrationStatus =
  "pending" | "planning" | "executing" | "completed" | "failed" | "cancelled" | "rollback";

export type PublishingStrategy =
  "SIMULTANEOUS" | "SEQUENTIAL" | "DEPENDENCY_BASED" | "OPTIMIZED_TIMING";

export type ConflictResolutionStrategy =
  "FAIL_FAST" | "BEST_EFFORT" | "ROLLBACK_ON_FAILURE" | "CONTINUE_ON_ERROR";

export type SyncMode = "REAL_TIME" | "BATCH" | "SCHEDULED" | "ON_DEMAND";

// Content Versioning
export interface ContentVersion {
  id: string;
  postId: string;
  version: number;
  content: CanonicalPost;
  adaptations: Record<ProviderId, CanonicalPost>;
  createdAt: Date;
  createdBy: string;
  changelog?: string;
  isActive: boolean;
}

export interface VersionDiff {
  field: string;
  oldValue: unknown;
  newValue: unknown;
  changeType: "added" | "modified" | "removed";
}

// Platform-Specific Content Adaptation
export interface PlatformAdaptation {
  providerId: ProviderId;
  originalContent: CanonicalPost;
  adaptedContent: CanonicalPost;
  adaptationRules: AdaptationRule[];
  confidence: number; // 0-1 score
  warnings: string[];
  requiresManualReview: boolean;
}

export interface AdaptationRule {
  ruleId: string;
  type: "text_length" | "media_format" | "hashtag_limit" | "mention_format" | "custom";
  description: string;
  applied: boolean;
  transformedValue?: unknown;
}

// Provider Dependencies and Coordination
export interface ProviderDependency {
  providerId: ProviderId;
  dependsOn: ProviderId[];
  delayAfterDependency?: number; // milliseconds
  condition?: DependencyCondition;
  retryPolicy?: RetryPolicy;
}

export interface DependencyCondition {
  type: "success" | "completion" | "custom";
  customCheck?: (result: PublishResult) => boolean;
}

export interface RetryPolicy {
  maxAttempts: number;
  baseDelay: number; // milliseconds
  maxDelay: number;
  backoffStrategy: "linear" | "exponential" | "fixed";
  retryableErrors: string[];
}

// Publishing Orchestration
export interface OrchestrationPlan {
  id: string;
  postId: string;
  projectId: string;
  strategy: PublishingStrategy;
  conflictResolution: ConflictResolutionStrategy;
  providers: ProviderId[];
  dependencies: ProviderDependency[];
  timing: TimingConfiguration;
  rollbackPlan?: RollbackPlan;
  estimatedDuration: number; // milliseconds
  createdAt: Date;
  createdBy: string;
}

export interface TimingConfiguration {
  startTime?: Date;
  providerDelays?: Record<ProviderId, number>; // milliseconds between providers
  optimalWindows?: Record<ProviderId, TimeWindow[]>;
  timezone: string;
  respectRateLimits: boolean;
}

export interface TimeWindow {
  start: Date;
  end: Date;
  score: number; // 0-1, optimal timing score
  reason: string;
}

// Execution and Results
export interface OrchestrationExecution {
  id: string;
  planId: string;
  status: OrchestrationStatus;
  startedAt: Date;
  completedAt?: Date;
  results: Record<ProviderId, PublishResult>;
  conflicts: OrchestrationConflict[];
  metrics: ExecutionMetrics;
  errors: OrchestrationError[];
}

export interface PublishResult {
  providerId: ProviderId;
  status: "success" | "failed" | "skipped" | "cancelled";
  providerPostId?: string;
  url?: string;
  publishedAt?: Date;
  error?: string;
  retryCount: number;
  duration: number; // milliseconds
  metadata?: Record<string, unknown>;
}

export interface OrchestrationConflict {
  id: string;
  type: "rate_limit" | "content_validation" | "dependency_failure" | "timing_conflict" | "custom";
  providerId: ProviderId;
  description: string;
  severity: "low" | "medium" | "high" | "critical";
  resolution?: ConflictResolution;
  resolvedAt?: Date;
  autoResolved: boolean;
}

export interface ConflictResolution {
  strategy: "retry" | "skip" | "adapt_content" | "reschedule" | "manual";
  parameters?: Record<string, unknown>;
  appliedAt: Date;
  result: "resolved" | "failed" | "pending";
}

export interface ExecutionMetrics {
  totalDuration: number;
  successfulProviders: number;
  failedProviders: number;
  retries: number;
  conflictsEncountered: number;
  conflictsResolved: number;
  averageProviderLatency: number;
  throughput: number; // posts per minute
}

export interface OrchestrationError {
  id: string;
  type: "validation" | "dependency" | "provider" | "network" | "timeout" | "system";
  message: string;
  stack?: string;
  providerId?: ProviderId;
  retryable: boolean;
  occurredAt: Date;
  context?: Record<string, unknown>;
}

// Rollback and Recovery
export interface RollbackPlan {
  id: string;
  triggerConditions: RollbackTrigger[];
  actions: RollbackAction[];
  maxRollbackTime: number; // milliseconds
  priority: "low" | "medium" | "high";
}

export interface RollbackTrigger {
  type: "failure_threshold" | "critical_provider_failure" | "manual" | "timeout";
  threshold?: number; // for failure_threshold
  criticalProviders?: ProviderId[]; // for critical_provider_failure
}

export interface RollbackAction {
  providerId: ProviderId;
  action: "delete_post" | "unpublish" | "mark_draft" | "revert_content" | "custom";
  parameters?: Record<string, unknown>;
  timeout: number; // milliseconds
}

// Content Synchronization
export interface SyncConfiguration {
  mode: SyncMode;
  sources: ProviderId[];
  targets: ProviderId[];
  syncRules: SyncRule[];
  conflictResolution: SyncConflictResolution;
  batchSize?: number;
  interval?: number; // for scheduled sync, in milliseconds
}

export interface SyncRule {
  id: string;
  type: "content" | "media" | "analytics" | "engagement" | "custom";
  direction: "bidirectional" | "source_to_target" | "target_to_source";
  filters?: SyncFilter[];
  transformations?: SyncTransformation[];
  schedule?: SyncSchedule;
}

export interface SyncFilter {
  field: string;
  operator: "equals" | "not_equals" | "contains" | "gt" | "lt" | "in" | "regex";
  value: unknown;
}

export interface SyncTransformation {
  field: string;
  transformer: string;
  parameters?: Record<string, unknown>;
}

export interface SyncSchedule {
  cron: string;
  timezone: string;
  enabled: boolean;
}

export interface SyncConflictResolution {
  strategy: "source_wins" | "target_wins" | "timestamp_wins" | "manual" | "merge";
  customResolver?: string;
}

// Analytics Aggregation
export interface AnalyticsAggregation {
  id: string;
  postId: string;
  timeframe: {
    start: Date;
    end: Date;
  };
  providers: ProviderId[];
  metrics: AggregatedMetrics;
  rawData: Record<ProviderId, unknown>;
  aggregatedAt: Date;
  version: number;
}

export interface AggregatedMetrics {
  engagement: {
    totalLikes: number;
    totalComments: number;
    totalShares: number;
    totalReactions: number;
    engagementRate: number;
  };
  reach: {
    totalImpressions: number;
    totalReach: number;
    uniqueViews: number;
  };
  performance: {
    averageCTR: number;
    bestPerformingProvider: ProviderId;
    crossPlatformViralityScore: number;
  };
  trends: {
    growthRate: number;
    velocityScore: number;
    peakEngagementTime: Date;
  };
}

// Content Routing
export interface ContentRoute {
  id: string;
  name: string;
  description: string;
  conditions: RouteCondition[];
  actions: RouteAction[];
  priority: number;
  enabled: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface RouteCondition {
  type: "content_type" | "provider" | "audience_size" | "time_of_day" | "custom";
  operator: "equals" | "not_equals" | "contains" | "gt" | "lt" | "in";
  value: unknown;
  weight?: number; // for scoring
}

export interface RouteAction {
  type: "route_to_provider" | "apply_adaptation" | "schedule_delay" | "skip" | "custom";
  providerId?: ProviderId;
  parameters?: Record<string, unknown>;
}

// Monitoring and Health
export interface OrchestrationHealth {
  status: "healthy" | "degraded" | "unhealthy";
  components: {
    contentManager: ComponentHealth;
    syncEngine: ComponentHealth;
    conflictResolver: ComponentHealth;
    providerCoordinator: ComponentHealth;
    analyticsAggregator: ComponentHealth;
  };
  lastCheck: Date;
  metrics: HealthMetrics;
}

export interface ComponentHealth {
  status: "healthy" | "degraded" | "unhealthy";
  latency?: number;
  errorRate?: number;
  lastError?: string;
  uptime: number;
}

export interface HealthMetrics {
  activeOrchestrations: number;
  queuedExecutions: number;
  failureRate: number;
  averageExecutionTime: number;
  providerAvailability: Record<ProviderId, number>;
}

// API Interfaces
export interface CreateOrchestrationRequest {
  postId: string;
  providers: ProviderId[];
  strategy?: PublishingStrategy;
  conflictResolution?: ConflictResolutionStrategy;
  timing?: Partial<TimingConfiguration>;
  dependencies?: ProviderDependency[];
  rollbackPlan?: Partial<RollbackPlan>;
}

export interface UpdateOrchestrationRequest {
  strategy?: PublishingStrategy;
  conflictResolution?: ConflictResolutionStrategy;
  timing?: Partial<TimingConfiguration>;
  dependencies?: ProviderDependency[];
  providers?: ProviderId[];
}

export interface ExecuteOrchestrationRequest {
  planId: string;
  dryRun?: boolean;
  overrides?: {
    timing?: Partial<TimingConfiguration>;
    conflictResolution?: ConflictResolutionStrategy;
  };
}

export interface SyncContentRequest {
  postId: string;
  configuration: SyncConfiguration;
  dryRun?: boolean;
}

export interface AnalyticsAggregationRequest {
  postIds: string[];
  providers?: ProviderId[];
  timeframe: {
    start: Date;
    end: Date;
  };
  includeRawData?: boolean;
}

// Response Types
export interface OrchestrationResponse {
  success: boolean;
  data?: OrchestrationPlan | OrchestrationExecution;
  errors?: OrchestrationError[];
  warnings?: string[];
  metadata?: {
    estimatedDuration?: number;
    conflictsPredicted?: number;
    optimizationSuggestions?: string[];
  };
}

export interface SyncResponse {
  success: boolean;
  data?: {
    syncedProviders: ProviderId[];
    conflicts: OrchestrationConflict[];
    changes: VersionDiff[];
  };
  errors?: OrchestrationError[];
}

export interface AnalyticsResponse {
  success: boolean;
  data?: AnalyticsAggregation;
  errors?: OrchestrationError[];
}

// Event Types for Event-Driven Architecture
export interface OrchestrationEvent {
  type: OrchestrationEventType;
  orchestrationId: string;
  timestamp: Date;
  data: unknown;
  metadata?: Record<string, unknown>;
}

export type OrchestrationEventType =
  | "ORCHESTRATION_PLANNED"
  | "ORCHESTRATION_STARTED"
  | "ORCHESTRATION_COMPLETED"
  | "ORCHESTRATION_FAILED"
  | "ORCHESTRATION_CANCELLED"
  | "PROVIDER_PUBLISH_STARTED"
  | "PROVIDER_PUBLISH_COMPLETED"
  | "PROVIDER_PUBLISH_FAILED"
  | "CONFLICT_DETECTED"
  | "CONFLICT_RESOLVED"
  | "ROLLBACK_INITIATED"
  | "ROLLBACK_COMPLETED"
  | "SYNC_STARTED"
  | "SYNC_COMPLETED"
  | "ANALYTICS_AGGREGATED";

// Utility Types
export type OrchestrationResult<T> = Result<T, OrchestrationError>;

export type ProviderMap<T> = Record<ProviderId, T>;

export type OptionalFields<T, K extends keyof T> = Omit<T, K> & Partial<Pick<T, K>>;

// Configuration Types
export interface OrchestrationConfig {
  maxConcurrentExecutions: number;
  defaultRetryPolicy: RetryPolicy;
  defaultConflictResolution: ConflictResolutionStrategy;
  healthCheckInterval: number; // milliseconds
  metricsRetention: number; // days
  enableRollback: boolean;
  enableAnalytics: boolean;
  enableSynchronization: boolean;
}
