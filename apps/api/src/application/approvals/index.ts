/**
 * @file index.ts
 * @description Barrel export for all approval workflow use cases and queries.
 * @layer application
 */

export {
  SubmitForReviewUseCase,
  type SubmitForReviewCommand,
  type SubmitForReviewResult,
} from "./SubmitForReviewUseCase.js";

export { ApprovePostUseCase, type ApprovePostCommand } from "./ApprovePostUseCase.js";

export { RejectPostUseCase, type RejectPostCommand } from "./RejectPostUseCase.js";

export {
  GetApprovalHistoryQuery,
  type GetApprovalHistoryInput,
  type ApprovalRequestDTO,
  type ApprovalReviewDTO,
} from "./GetApprovalHistoryQuery.js";

export {
  GetPendingApprovalsQuery,
  type GetPendingApprovalsInput,
} from "./GetPendingApprovalsQuery.js";
