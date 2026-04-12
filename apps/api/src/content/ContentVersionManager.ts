/**
 * @file ContentVersionManager.ts
 * @description Facade orchestrating the content versioning system: version CRUD,
 *              branch management, diff calculation, and merge operations.
 * @layer infrastructure
 */

import { randomUUID } from "node:crypto";
import { PrismaClient } from "@infra/prisma";
import Redis from "ioredis";
import { ContentVersion, VersionDiff, OrchestrationResult } from "@shared/orchestration";
import type { CanonicalPost } from "@shared/types";
import type { ProviderId } from "../providers/providerAdapter.interface";
import { EventService } from "../events/EventService";

import { VersionController } from "./VersionController";
import { DiffCalculator } from "./DiffCalculator";
import { BranchManager } from "./BranchManager";
import { MergeManager } from "./MergeManager";

// Re-export all shared types so existing imports continue to work
export type {
  VersionBranch,
  MergeRequest,
  VersionConflict,
  ConflictResolution,
  VersionMetadata,
  VersionSnapshot,
} from "./contentVersionTypes";

export class ContentVersionManager {
  private versionController: VersionController;
  private diffCalculator: DiffCalculator;
  private branchManager: BranchManager;
  private mergeManager: MergeManager;

  constructor(dependencies: { prisma: PrismaClient; redis: Redis; eventService: EventService }) {
    this.versionController = new VersionController(dependencies);
    this.diffCalculator = new DiffCalculator();
    this.branchManager = new BranchManager(dependencies);
    this.mergeManager = new MergeManager(dependencies);
  }

  // ---------------------------------------------------------------------------
  // Version operations — delegated to VersionController
  // ---------------------------------------------------------------------------

  /**
   * Create a new content version
   */
  async createVersion(
    postId: string,
    content: CanonicalPost,
    adaptations: Record<ProviderId, CanonicalPost>,
    metadata: {
      createdBy: string;
      changelog?: string;
      branchName?: string;
      parentVersionId?: string;
      tags?: string[];
      category?: string;
    }
  ): Promise<OrchestrationResult<ContentVersion>> {
    return this.versionController.createVersion({ postId, content, adaptations, metadata });
  }

  /**
   * Get version history for a post
   */
  async getVersionHistory(
    postId: string,
    branchName?: string,
    limit?: number
  ): Promise<ContentVersion[]> {
    return this.versionController.getVersionHistory(postId, branchName, limit);
  }

  /**
   * Restore content to a specific version
   */
  async restoreVersion(
    versionId: string,
    restoredBy: string
  ): Promise<OrchestrationResult<ContentVersion>> {
    return this.versionController.restoreVersion(versionId, restoredBy);
  }

  // ---------------------------------------------------------------------------
  // Branch operations — delegated to BranchManager
  // ---------------------------------------------------------------------------

  /**
   * Create a new content branch
   */
  async createBranch(
    postId: string,
    branchName: string,
    baseVersionId: string,
    createdBy: string,
    description?: string
  ): Promise<OrchestrationResult<import("./contentVersionTypes").VersionBranch>> {
    // Resolve the base version first so BranchManager receives a typed object
    const baseVersion = await this.versionController.getVersion(baseVersionId);
    if (!baseVersion || baseVersion.postId !== postId) {
      return {
        ok: false,
        error: {
          id: `version_${randomUUID()}`,
          type: "validation",
          message: `Invalid base version: ${baseVersionId}`,
          retryable: false,
          occurredAt: new Date(),
        },
      };
    }

    return this.branchManager.createBranch(postId, branchName, baseVersion, createdBy, description);
  }

  // ---------------------------------------------------------------------------
  // Diff / comparison operations — delegated to DiffCalculator
  // ---------------------------------------------------------------------------

  /**
   * Compare two versions and generate a diff
   */
  async compareVersions(
    fromVersionId: string,
    toVersionId: string
  ): Promise<OrchestrationResult<VersionDiff[]>> {
    const fromVersion = await this.versionController.getVersion(fromVersionId);
    const toVersion = await this.versionController.getVersion(toVersionId);

    if (!fromVersion || !toVersion) {
      return {
        ok: false,
        error: {
          id: `version_${randomUUID()}`,
          type: "validation",
          message: "One or both versions not found",
          retryable: false,
          occurredAt: new Date(),
        },
      };
    }

    const diffs = this.diffCalculator.generateDiff(fromVersion, toVersion);
    return { ok: true, value: diffs };
  }

  // ---------------------------------------------------------------------------
  // Merge operations — delegated to MergeManager
  // ---------------------------------------------------------------------------

  /**
   * Create a merge request between two branches
   */
  async createMergeRequest(
    postId: string,
    sourceBranch: string,
    targetBranch: string,
    requestedBy: string
  ): Promise<OrchestrationResult<import("./contentVersionTypes").MergeRequest>> {
    const source = await this.branchManager.getBranchByName(postId, sourceBranch);
    const target = await this.branchManager.getBranchByName(postId, targetBranch);

    if (!source || !target) {
      return {
        ok: false,
        error: {
          id: `version_${randomUUID()}`,
          type: "validation",
          message: "Source or target branch not found",
          retryable: false,
          occurredAt: new Date(),
        },
      };
    }

    return this.mergeManager.createMergeRequest(
      postId,
      sourceBranch,
      targetBranch,
      source.headVersionId,
      target.headVersionId,
      requestedBy
    );
  }

  /**
   * Resolve merge conflicts on a pending merge request
   */
  async resolveMergeConflicts(
    mergeRequestId: string,
    resolutions: import("./contentVersionTypes").ConflictResolution[]
  ): Promise<OrchestrationResult<import("./contentVersionTypes").MergeRequest>> {
    return this.mergeManager.resolveMergeConflicts(mergeRequestId, resolutions);
  }

  /**
   * Execute an approved merge request
   */
  async executeMerge(
    mergeRequestId: string,
    mergedBy: string
  ): Promise<OrchestrationResult<ContentVersion>> {
    const mergeRequest = await this.mergeManager.getMergeRequest(mergeRequestId);
    if (!mergeRequest || mergeRequest.status !== "approved") {
      return {
        ok: false,
        error: {
          id: `version_${randomUUID()}`,
          type: "validation",
          message: "Merge request not found or not approved",
          retryable: false,
          occurredAt: new Date(),
        },
      };
    }

    // Resolve branch head versions
    const sourceBranch = await this.branchManager.getBranchByName(
      mergeRequest.postId,
      mergeRequest.sourceBranch
    );
    const targetBranch = await this.branchManager.getBranchByName(
      mergeRequest.postId,
      mergeRequest.targetBranch
    );

    if (!sourceBranch || !targetBranch) {
      return {
        ok: false,
        error: {
          id: `version_${randomUUID()}`,
          type: "validation",
          message: "Source or target branch not found",
          retryable: false,
          occurredAt: new Date(),
        },
      };
    }

    const sourceVersion = await this.versionController.getVersion(sourceBranch.headVersionId);
    const targetVersion = await this.versionController.getVersion(targetBranch.headVersionId);

    if (!sourceVersion || !targetVersion) {
      return {
        ok: false,
        error: {
          id: `version_${randomUUID()}`,
          type: "validation",
          message: "Source or target version not found",
          retryable: false,
          occurredAt: new Date(),
        },
      };
    }

    // Produce merged content
    const mergedContent = this.mergeManager.performMerge(
      sourceVersion,
      targetVersion,
      mergeRequest.resolutions
    );

    // Create the resulting merged version
    const versionMetadata: { createdBy: string; changelog: string; branchName?: string } = {
      createdBy: mergedBy,
      changelog: `Merged ${mergeRequest.sourceBranch} into ${mergeRequest.targetBranch}`,
      ...(mergeRequest.targetBranch !== "main" && { branchName: mergeRequest.targetBranch }),
    };

    const mergedVersion = await this.createVersion(
      mergeRequest.postId,
      mergedContent.content,
      mergedContent.adaptations,
      versionMetadata
    );

    if (!mergedVersion.ok) {
      return mergedVersion;
    }

    // Finalise the merge request record
    mergeRequest.status = "merged";
    mergeRequest.mergedAt = new Date();
    await this.mergeManager.emitMergeCompleted(mergeRequest);

    return { ok: true, value: mergedVersion.value };
  }
}
