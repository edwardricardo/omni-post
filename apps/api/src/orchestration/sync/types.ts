/**
 * @file types.ts
 * @description Type definitions for content synchronization system.
 * @layer infrastructure
 */

import type { PrismaClient } from "@infra/prisma";
import type { Redis } from "ioredis";
import type { SyncConfiguration, OrchestrationError } from "@shared/types/orchestration.js";
import type { ProviderId } from "../../providers/providerAdapter.interface.js";
import type { EventService } from "../../events/EventService.js";

export interface SyncDependencies {
  prisma: PrismaClient;
  redis: Redis;
  eventService: EventService;
}

export interface SyncJob {
  id: string;
  postId: string;
  configuration: SyncConfiguration;
  status: "pending" | "running" | "completed" | "failed";
  startedAt: Date;
  completedAt?: Date;
  results: SyncJobResult[];
  errors: OrchestrationError[];
}

export interface SyncJobResult {
  providerId: ProviderId;
  direction: "pull" | "push";
  status: "success" | "failed" | "skipped";
  changesApplied: number;
  conflictsDetected: number;
  error?: string;
}

export interface ContentConflict {
  field: string;
  sourceValue: unknown;
  targetValue: unknown;
  conflictType: "modification" | "deletion" | "creation";
  resolution?: ConflictResolution;
}

export interface ConflictResolution {
  strategy: "source_wins" | "target_wins" | "timestamp_wins" | "merge" | "manual";
  resolvedValue: unknown;
  appliedAt: Date;
  rationale?: string;
}
