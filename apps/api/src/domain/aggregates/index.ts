/**
 * Domain Layer - Aggregates Exports
 *
 * Part of Sprint 5: DDD Architecture Implementation
 */

export { type AggregateSnapshot } from "./AggregateRoot.js";
export {
  PostAggregate,
  type CreatePostAggregateInput,
  type PostAggregateState,
} from "./PostAggregate.js";

// Approval workflow aggregate (Phase 1 Step 3: Content Approval)
export {
  ApprovalRequestAggregate,
  type CreateApprovalRequestInput,
  type ApprovalRequestState,
  type Review,
  ApprovalRequestCreated,
  ApprovalReviewAdded,
  ApprovalRequestResolved,
  ApprovalRequestCancelled,
} from "./ApprovalRequestAggregate.js";
