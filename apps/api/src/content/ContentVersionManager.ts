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
   * @method createVersion
   * @description Creates a new content version with canonical content and per-provider adaptations.
   * @param postId - The post ID to version
   * @param content - The canonical post content
   * @param adaptations - Provider-specific content adaptations keyed by provider ID
   * @param metadata - Version metadata including author, changelog, branch, and tags
   * @returns OrchestrationResult containing the created ContentVersion or an error
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
   * @method getVersionHistory
   * @description Retrieves the version history for a post, optionally scoped to a branch with a result limit.
   * @param postId - The post ID to fetch history for
   * @param branchName - Optional branch name filter
   * @param limit - Optional maximum number of versions to return
   * @returns Array of ContentVersion records ordered by creation date
   */
  async getVersionHistory(
    postId: string,
    branchName?: string,
    limit?: number
  ): Promise<ContentVersion[]> {
    return this.versionController.getVersionHistory(postId, branchName, limit);
  }

  /**
   * @method restoreVersion
   * @description Restores content to a previously saved version, creating a new version entry as the restoration.
   * @param versionId - The version ID to restore to
   * @param restoredBy - The user ID performing the restoration
   * @returns OrchestrationResult containing the newly created ContentVersion or an error
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
   * @method createBranch
   * @description Creates a new content branch from a base version for parallel editing workflows.
   * @param postId - The post ID the branch belongs to
   * @param branchName - The name for the new branch
   * @param baseVersionId - The version ID to branch from
   * @param createdBy - The user ID creating the branch
   * @param description - Optional description of the branch purpose
   * @returns OrchestrationResult containing the created VersionBranch or a validation error
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
   * @method compareVersions
   * @description Compares two content versions and generates a list of field-level diffs.
   * @param fromVersionId - The source version ID for comparison
   * @param toVersionId - The target version ID for comparison
   * @returns OrchestrationResult containing an array of VersionDiff entries or a validation error
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
   * @method createMergeRequest
   * @description Creates a merge request to integrate changes from a source branch into a target branch.
   * @param postId - The post ID both branches belong to
   * @param sourceBranch - The branch name to merge from
   * @param targetBranch - The branch name to merge into
   * @param requestedBy - The user ID requesting the merge
   * @returns OrchestrationResult containing the created MergeRequest or a validation error
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
   * @method resolveMergeConflicts
   * @description Applies conflict resolutions to a pending merge request, advancing it toward approval.
   * @param mergeRequestId - The merge request ID to resolve conflicts on
   * @param resolutions - Array of conflict resolution decisions
   * @returns OrchestrationResult containing the updated MergeRequest or an error
   */
  async resolveMergeConflicts(
    mergeRequestId: string,
    resolutions: import("./contentVersionTypes").ConflictResolution[]
  ): Promise<OrchestrationResult<import("./contentVersionTypes").MergeRequest>> {
    return this.mergeManager.resolveMergeConflicts(mergeRequestId, resolutions);
  }

  /**
   * @method executeMerge
   * @description Executes an approved merge request by producing merged content and creating the resulting version.
   * @param mergeRequestId - The approved merge request ID to execute
   * @param mergedBy - The user ID performing the merge
   * @returns OrchestrationResult containing the merged ContentVersion or a validation error
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
