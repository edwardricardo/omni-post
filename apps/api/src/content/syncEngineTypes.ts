/**
 * SyncEngine — Type definitions
 *
 * All interfaces and type aliases used by the Sync Engine system.
 */

import type { SyncConfiguration } from "@shared/orchestration";
import type { ProviderId } from "../providers/providerAdapter.interface";

export interface SyncChannel {
  id: string;
  name: string;
  sourceProvider: ProviderId;
  targetProvider: ProviderId;
  bidirectional: boolean;
  enabled: boolean;
  lastSyncAt?: Date;
  configuration: SyncConfiguration;
  healthStatus: "healthy" | "degraded" | "failed";
  errorCount: number;
  successRate: number;
}

export interface SyncTransaction {
  id: string;
  channelId: string;
  postId: string;
  direction: "source_to_target" | "target_to_source" | "bidirectional";
  status: "pending" | "processing" | "completed" | "failed" | "rolled_back";
  startedAt: Date;
  completedAt?: Date;
  changes: SyncChange[];
  conflicts: SyncConflict[];
  rollbackPlan?: SyncRollbackPlan;
}

export interface SyncChange {
  id: string;
  field: string;
  operation: "create" | "update" | "delete";
  oldValue: any;
  newValue: any;
  providerId: ProviderId;
  timestamp: Date;
  checksum: string;
}

export interface SyncConflict {
  id: string;
  type:
    | "concurrent_modification"
    | "schema_mismatch"
    | "validation_failure"
    | "dependency_violation";
  field: string;
  sourceValue: any;
  targetValue: any;
  resolution?: "source_wins" | "target_wins" | "merge" | "manual";
  resolvedValue?: any;
  severity: "low" | "medium" | "high" | "critical";
}

export interface SyncRollbackPlan {
  id: string;
  transactionId: string;
  rollbackActions: SyncRollbackAction[];
  createdAt: Date;
  executedAt?: Date;
  status: "ready" | "executing" | "completed" | "failed";
}

export interface SyncRollbackAction {
  providerId: ProviderId;
  operation: "restore_content" | "delete_content" | "revert_changes";
  targetField: string;
  rollbackValue: any;
  order: number;
}

export interface SyncMetrics {
  totalTransactions: number;
  successfulSyncs: number;
  failedSyncs: number;
  conflictsDetected: number;
  conflictsResolved: number;
  averageSyncTime: number;
  dataTransferred: number; // bytes
  lastSyncDuration: number;
}

export interface RealtimeSyncEvent {
  id: string;
  type: "content_changed" | "sync_started" | "sync_completed" | "conflict_detected" | "sync_failed";
  postId: string;
  providerId: ProviderId;
  timestamp: Date;
  data: any;
  metadata?: Record<string, any>;
}
