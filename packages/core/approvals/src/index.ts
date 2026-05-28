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

export {
  CreateApprovalWorkflowUseCase,
  type CreateApprovalWorkflowCommand,
  type CreateApprovalWorkflowResult,
} from "./CreateApprovalWorkflowUseCase.js";

export {
  UpdateApprovalWorkflowUseCase,
  type UpdateApprovalWorkflowCommand,
} from "./UpdateApprovalWorkflowUseCase.js";

export {
  DeleteApprovalWorkflowUseCase,
  type DeleteApprovalWorkflowCommand,
} from "./DeleteApprovalWorkflowUseCase.js";

export {
  ListApprovalWorkflowsQuery,
  type ListApprovalWorkflowsInput,
  type ApprovalWorkflowDTO,
  type WorkflowLevelDTO,
} from "./ListApprovalWorkflowsQuery.js";
