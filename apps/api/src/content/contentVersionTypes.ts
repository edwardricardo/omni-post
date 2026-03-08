/**
 * Content Version Types
 *
 * Shared interfaces and types for the content versioning system,
 * including branch management, merge requests, and conflict resolution.
 */

import type { CanonicalPost } from "@shared/types";
import type { ProviderId } from "../providers/providerAdapter.interface";

export interface VersionBranch {
  id: string;
  name: string;
  postId: string;
  baseVersionId: string;
  headVersionId: string;
  isActive: boolean;
  createdAt: Date;
  createdBy: string;
  description?: string;
  mergeable: boolean;
  conflictsWith: string[];
}

export interface MergeRequest {
  id: string;
  sourceBranch: string;
  targetBranch: string;
  postId: string;
  status: "pending" | "approved" | "rejected" | "merged" | "conflicted";
  conflicts: VersionConflict[];
  resolutions: ConflictResolution[];
  requestedBy: string;
  requestedAt: Date;
  reviewedBy?: string;
  reviewedAt?: Date;
  mergedAt?: Date;
}

export interface VersionConflict {
  id: string;
  field: string;
  baseValue: unknown;
  sourceValue: unknown;
  targetValue: unknown;
  conflictType: "content" | "structure" | "metadata" | "adaptation";
  severity: "low" | "medium" | "high";
  autoResolvable: boolean;
}

export interface ConflictResolution {
  conflictId: string;
  strategy: "use_source" | "use_target" | "merge" | "custom";
  resolvedValue: unknown;
  reasoning: string;
  resolvedBy: string;
  resolvedAt: Date;
}

export interface VersionMetadata {
  tags: string[];
  category: string;
  priority: number;
  approvalStatus: "draft" | "pending_review" | "approved" | "rejected";
  reviewComments: string[];
  performanceMetrics?: {
    engagementScore: number;
    reachScore: number;
    conversionScore: number;
  };
  experimentData?: {
    variantId: string;
    testGroup: string;
    metrics: Record<string, number>;
  };
}

export interface VersionSnapshot {
  id: string;
  versionId: string;
  content: CanonicalPost;
  adaptations: Record<ProviderId, CanonicalPost>;
  metadata: VersionMetadata;
  checksum: string;
  size: number;
  createdAt: Date;
}
