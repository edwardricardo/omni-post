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

// In-context comments aggregate
export {
  PostCommentAggregate,
  type CreateCommentProps,
  type PostCommentState,
  CommentAdded,
  CommentEdited,
  CommentDeleted,
} from "./PostCommentAggregate.js";

// Approval workflow aggregate
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

// Social Inbox aggregate
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
