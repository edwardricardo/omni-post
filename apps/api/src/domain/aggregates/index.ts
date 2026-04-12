/**
 * @file index.ts
 * @description Barrel export for aggregates — re-exports all public aggregate roots, their input types, and state snapshots.
 * @layer domain
 */

export { type AggregateSnapshot } from "./AggregateRoot.js";
export {
  PostAggregate,
  type CreatePostAggregateInput,
  type PostAggregateState,
} from "./PostAggregate.js";

// In-context comments aggregate (Phase 1 Step 4: In-Context Comments)
export {
  PostCommentAggregate,
  type CreateCommentProps,
  type PostCommentState,
  CommentAdded,
  CommentEdited,
  CommentDeleted,
} from "./PostCommentAggregate.js";

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

// Social Inbox aggregate (Phase 2: Social Inbox)
export {
  SocialMessageAggregate,
  type CreateSocialMessageInput,
  type SocialMessageState,
  type SocialMessageEvent,
  SocialMessageReceived,
  SocialMessageRead,
  SocialMessageReplied,
  SocialMessageAssigned,
  SocialMessageArchived,
} from "./SocialMessageAggregate.js";
