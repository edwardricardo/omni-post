/**
 * @file PrismaApprovalRequestRepository.ts
 * @description Infrastructure adapter implementing ApprovalRequestRepository port
 *   using Prisma ORM. Maps between Prisma database types and domain aggregates.
 * @layer infrastructure
 */

import type { PrismaClient } from "@infra/prisma";
import { type Result, ok, err } from "@shared/types";
import type { ApprovalRequestRepository } from "../../domain/repositories/ApprovalRequestRepository.js";
import {
  ApprovalRequestAggregate,
  type Review,
} from "../../domain/aggregates/ApprovalRequestAggregate.js";
import { ApprovalRequestId } from "../../domain/value-objects/ApprovalRequestId.js";
import { ApprovalStatus } from "../../domain/value-objects/ApprovalStatus.js";
import { ReviewDecision } from "../../domain/value-objects/ReviewDecision.js";
import { EntityNotFoundError, type DomainError } from "../../domain/errors/index.js";

/**
 * Raw Prisma row shape for type-safe mapping (ApprovalRequest with reviews)
 */
interface PrismaApprovalRequestRow {
  id: string;
  postId: string;
  submitterId: string;
  status: string;
  comment: string | null;
  createdAt: Date;
  updatedAt: Date;
  reviews: PrismaApprovalReviewRow[];
}

/**
 * Raw Prisma row shape for a single review
 */
interface PrismaApprovalReviewRow {
  id: string;
  requestId: string;
  reviewerId: string;
  decision: string;
  comment: string | null;
  reviewedAt: Date;
}

/**
 * @class PrismaApprovalRequestRepository
 * @description Adapter for ApprovalRequestRepository using Prisma.
 *   Converts between Prisma database records and ApprovalRequestAggregate domain objects.
 */
export class PrismaApprovalRequestRepository implements ApprovalRequestRepository {
  constructor(private readonly prisma: PrismaClient) {}

  /**
   * @method findById
   * @description Finds an approval request by its unique identifier, including reviews.
   * @param id - The approval request ID string
   * @returns Result containing the aggregate on success, EntityNotFoundError if missing
   */
  async findById(id: string): Promise<Result<ApprovalRequestAggregate, EntityNotFoundError>> {
    try {
      const row = await this.prisma.approvalRequest.findUnique({
        where: { id },
        include: { reviews: true },
      });

      if (!row) {
        return err(new EntityNotFoundError("ApprovalRequest", id));
      }

      return ok(this.toDomain(row));
    } catch (error: unknown) {
      return err(
        new EntityNotFoundError(
          "ApprovalRequest",
          `${id} (query failed: ${error instanceof Error ? error.message : String(error)})`
        )
      );
    }
  }

  /**
   * @method findByPostId
   * @description Retrieves all approval requests for a given post, including reviews.
   * @param postId - The post ID to search by
   * @returns Array of matching ApprovalRequestAggregate instances
   */
  async findByPostId(postId: string): Promise<ApprovalRequestAggregate[]> {
    const rows = await this.prisma.approvalRequest.findMany({
      where: { postId },
      include: { reviews: true },
      orderBy: { createdAt: "desc" },
    });

    return rows.map((row) => this.toDomain(row));
  }

  /**
   * @method findPendingForReviewer
   * @description Retrieves all pending approval requests where the given member
   *   has not yet submitted a review and is not the submitter.
   * @param reviewerId - The reviewer's member ID
   * @returns Array of pending ApprovalRequestAggregate instances
   */
  async findPendingForReviewer(reviewerId: string): Promise<ApprovalRequestAggregate[]> {
    const rows = await this.prisma.approvalRequest.findMany({
      where: {
        status: "PENDING",
        submitterId: { not: reviewerId },
        reviews: {
          none: {
            reviewerId,
          },
        },
      },
      include: { reviews: true },
      orderBy: { createdAt: "asc" },
    });

    return rows.map((row) => this.toDomain(row));
  }

  /**
   * @method save
   * @description Persists an approval request aggregate (create or update via upsert).
   *   Also upserts all reviews within the aggregate.
   * @param request - The ApprovalRequestAggregate to save
   * @returns Result<void> on success, DomainError on failure
   */
  async save(request: ApprovalRequestAggregate): Promise<Result<void, DomainError>> {
    try {
      const json = request.toJSON();
      const reviews = request.reviews;

      // Cast domain status/decision strings to the Prisma enum types.
      // The domain layer validates these values, so the cast is safe.
      // Use Awaited<ReturnType> to extract the concrete enum type from a findFirst result.
      type PrismaApprovalRow = NonNullable<
        Awaited<ReturnType<typeof this.prisma.approvalRequest.findFirst>>
      >;
      type PrismaReviewRow = NonNullable<
        Awaited<ReturnType<typeof this.prisma.approvalReview.findFirst>>
      >;

      const statusValue = json.status as PrismaApprovalRow["status"];

      await this.prisma.$transaction(async (tx) => {
        // Upsert the approval request
        await tx.approvalRequest.upsert({
          where: { id: request.id.value },
          create: {
            id: request.id.value,
            postId: request.postId,
            submitterId: request.submitterId,
            status: statusValue,
            comment: (json.comment as string) ?? null,
          },
          update: {
            status: statusValue,
          },
        });

        // Upsert each review
        for (const review of reviews) {
          const decisionValue = review.decision.value as PrismaReviewRow["decision"];
          await tx.approvalReview.upsert({
            where: { id: review.id },
            create: {
              id: review.id,
              requestId: request.id.value,
              reviewerId: review.reviewerId,
              decision: decisionValue,
              comment: review.comment ?? null,
              reviewedAt: review.reviewedAt,
            },
            update: {
              decision: decisionValue,
              comment: review.comment ?? null,
            },
          });
        }
      });

      return ok(undefined);
    } catch (error: unknown) {
      return err(
        new EntityNotFoundError(
          "ApprovalRequest",
          `save failed: ${error instanceof Error ? error.message : String(error)}`
        )
      );
    }
  }

  /**
   * @method toDomain
   * @description Maps a Prisma row (with reviews) to an ApprovalRequestAggregate domain object.
   * @param row - Raw Prisma record including reviews
   * @returns Reconstituted ApprovalRequestAggregate
   */
  private toDomain(row: PrismaApprovalRequestRow): ApprovalRequestAggregate {
    // Map status from DB string to domain value object
    const statusResult = ApprovalStatus.create(row.status);
    const status = statusResult.ok ? statusResult.value : ApprovalStatus.pending();

    // Map reviews from DB rows to domain Review objects
    const reviews: Review[] = row.reviews.map((r) => {
      const decisionResult = ReviewDecision.create(r.decision);
      const decision = decisionResult.ok ? decisionResult.value : ReviewDecision.approved();

      return {
        id: r.id,
        reviewerId: r.reviewerId,
        decision,
        ...(r.comment !== null && { comment: r.comment }),
        reviewedAt: r.reviewedAt,
      };
    });

    return ApprovalRequestAggregate.reconstitute({
      id: ApprovalRequestId.fromStringUnsafe(row.id),
      postId: row.postId,
      submitterId: row.submitterId,
      status,
      ...(row.comment !== null && { comment: row.comment }),
      reviews,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      version: 0,
    });
  }
}
