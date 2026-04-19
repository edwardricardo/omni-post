/**
 * @file setupTeamUseCases.ts
 * @description Registers approval workflow, team member, and comment use cases
 *              in the DI container. Extracted from setupUseCases.ts.
 * @layer infrastructure
 */
import type { Container } from "./Container.js";
import { TOKENS } from "./types.js";
import type { EmailPort } from "../../domain/repositories/EmailPort.js";
import type { PlatformCredentialService } from "../../security/PlatformCredentialService.js";
import type { PostRepository } from "../../domain/index.js";
import type { ApprovalRequestRepository } from "../../domain/repositories/ApprovalRequestRepository.js";
import type { ApprovalWorkflowRepository } from "../../domain/repositories/ApprovalWorkflowRepository.js";
import type { TeamMemberRepository } from "../../domain/repositories/TeamMemberRepository.js";
import type { PostCommentRepository } from "../../domain/repositories/PostCommentRepository.js";
import type { UnitOfWork } from "../../domain/repositories/Repository.js";
import {
  SubmitForReviewUseCase,
  ApprovePostUseCase,
  RejectPostUseCase,
  GetApprovalHistoryQuery,
  GetPendingApprovalsQuery,
  CreateApprovalWorkflowUseCase,
  UpdateApprovalWorkflowUseCase,
  DeleteApprovalWorkflowUseCase,
  ListApprovalWorkflowsQuery,
} from "../../application/approvals/index.js";
import {
  InviteTeamMemberUseCase,
  GetTeamMembersQuery,
  UpdateTeamMemberRoleUseCase,
  RemoveTeamMemberUseCase,
  SearchTeamMembersQuery,
} from "../../application/team/index.js";
import { NotifyMentionedUsersService } from "../../application/mentions/index.js";
import type { CreateNotificationUseCase } from "../../application/notifications/index.js";
import {
  CreateCommentUseCase,
  EditCommentUseCase,
  DeleteCommentUseCase,
  GetPostCommentsQuery,
} from "../../application/comments/index.js";

/**
 * Register approval workflow, team member, and comment use cases
 */
export function setupTeamUseCases(container: Container): void {
  // Register Approval Workflow Use Cases (Phase 1.3)
  container.register<SubmitForReviewUseCase>(
    TOKENS.SubmitForReviewUseCase,
    () =>
      new SubmitForReviewUseCase(
        container.resolve<ApprovalRequestRepository>(TOKENS.ApprovalRequestRepository),
        container.resolve<PostRepository>(TOKENS.PostRepository),
        container.resolve<UnitOfWork>(TOKENS.UnitOfWork),
        container.resolve<ApprovalWorkflowRepository>(TOKENS.ApprovalWorkflowRepository)
      ),
    true
  );
  container.register<ApprovePostUseCase>(
    TOKENS.ApprovePostUseCase,
    () =>
      new ApprovePostUseCase(
        container.resolve<ApprovalRequestRepository>(TOKENS.ApprovalRequestRepository),
        container.resolve<UnitOfWork>(TOKENS.UnitOfWork)
      ),
    true
  );
  container.register<RejectPostUseCase>(
    TOKENS.RejectPostUseCase,
    () =>
      new RejectPostUseCase(
        container.resolve<ApprovalRequestRepository>(TOKENS.ApprovalRequestRepository),
        container.resolve<UnitOfWork>(TOKENS.UnitOfWork)
      ),
    true
  );
  container.register<GetApprovalHistoryQuery>(
    TOKENS.GetApprovalHistoryQuery,
    () =>
      new GetApprovalHistoryQuery(
        container.resolve<ApprovalRequestRepository>(TOKENS.ApprovalRequestRepository)
      ),
    true
  );
  container.register<GetPendingApprovalsQuery>(
    TOKENS.GetPendingApprovalsQuery,
    () =>
      new GetPendingApprovalsQuery(
        container.resolve<ApprovalRequestRepository>(TOKENS.ApprovalRequestRepository)
      ),
    true
  );

  // Register Multi-Level Approval Workflow Use Cases
  container.register<CreateApprovalWorkflowUseCase>(
    TOKENS.CreateApprovalWorkflowUseCase,
    () =>
      new CreateApprovalWorkflowUseCase(
        container.resolve<ApprovalWorkflowRepository>(TOKENS.ApprovalWorkflowRepository),
        container.resolve<UnitOfWork>(TOKENS.UnitOfWork)
      ),
    true
  );
  container.register<UpdateApprovalWorkflowUseCase>(
    TOKENS.UpdateApprovalWorkflowUseCase,
    () =>
      new UpdateApprovalWorkflowUseCase(
        container.resolve<ApprovalWorkflowRepository>(TOKENS.ApprovalWorkflowRepository),
        container.resolve<UnitOfWork>(TOKENS.UnitOfWork)
      ),
    true
  );
  container.register<DeleteApprovalWorkflowUseCase>(
    TOKENS.DeleteApprovalWorkflowUseCase,
    () =>
      new DeleteApprovalWorkflowUseCase(
        container.resolve<ApprovalWorkflowRepository>(TOKENS.ApprovalWorkflowRepository),
        container.resolve<UnitOfWork>(TOKENS.UnitOfWork)
      ),
    true
  );
  container.register<ListApprovalWorkflowsQuery>(
    TOKENS.ListApprovalWorkflowsQuery,
    () =>
      new ListApprovalWorkflowsQuery(
        container.resolve<ApprovalWorkflowRepository>(TOKENS.ApprovalWorkflowRepository)
      ),
    true
  );

  // Register Team Member Use Cases (Phase 1.1)
  container.register<InviteTeamMemberUseCase>(
    TOKENS.InviteTeamMemberUseCase,
    () =>
      new InviteTeamMemberUseCase(
        container.resolve<TeamMemberRepository>(TOKENS.TeamMemberRepository),
        container.resolve<UnitOfWork>(TOKENS.UnitOfWork),
        container.resolve<EmailPort>(TOKENS.EmailPort),
        container.resolve<PlatformCredentialService>(TOKENS.PlatformCredentialService)
      ),
    true
  );
  container.register<GetTeamMembersQuery>(
    TOKENS.GetTeamMembersQuery,
    () =>
      new GetTeamMembersQuery(container.resolve<TeamMemberRepository>(TOKENS.TeamMemberRepository)),
    true
  );
  container.register<UpdateTeamMemberRoleUseCase>(
    TOKENS.UpdateTeamMemberRoleUseCase,
    () =>
      new UpdateTeamMemberRoleUseCase(
        container.resolve<TeamMemberRepository>(TOKENS.TeamMemberRepository),
        container.resolve<UnitOfWork>(TOKENS.UnitOfWork)
      ),
    true
  );
  container.register<RemoveTeamMemberUseCase>(
    TOKENS.RemoveTeamMemberUseCase,
    () =>
      new RemoveTeamMemberUseCase(
        container.resolve<TeamMemberRepository>(TOKENS.TeamMemberRepository),
        container.resolve<UnitOfWork>(TOKENS.UnitOfWork)
      ),
    true
  );
  container.register<SearchTeamMembersQuery>(
    TOKENS.SearchTeamMembersQuery,
    () =>
      new SearchTeamMembersQuery(
        container.resolve<TeamMemberRepository>(TOKENS.TeamMemberRepository)
      ),
    true
  );

  // @Mention notification service
  container.register<NotifyMentionedUsersService>(
    TOKENS.NotifyMentionedUsersService,
    () =>
      new NotifyMentionedUsersService(
        container.resolve<CreateNotificationUseCase>(TOKENS.CreateNotificationUseCase)
      ),
    true
  );

  // Register Comment Use Cases (Phase 1.4)
  container.register<CreateCommentUseCase>(
    TOKENS.CreateCommentUseCase,
    () =>
      new CreateCommentUseCase(
        container.resolve<PostCommentRepository>(TOKENS.PostCommentRepository),
        container.resolve<UnitOfWork>(TOKENS.UnitOfWork)
      ),
    true
  );
  container.register<EditCommentUseCase>(
    TOKENS.EditCommentUseCase,
    () =>
      new EditCommentUseCase(
        container.resolve<PostCommentRepository>(TOKENS.PostCommentRepository),
        container.resolve<UnitOfWork>(TOKENS.UnitOfWork)
      ),
    true
  );
  container.register<DeleteCommentUseCase>(
    TOKENS.DeleteCommentUseCase,
    () =>
      new DeleteCommentUseCase(
        container.resolve<PostCommentRepository>(TOKENS.PostCommentRepository),
        container.resolve<UnitOfWork>(TOKENS.UnitOfWork)
      ),
    true
  );
  container.register<GetPostCommentsQuery>(
    TOKENS.GetPostCommentsQuery,
    () =>
      new GetPostCommentsQuery(
        container.resolve<PostCommentRepository>(TOKENS.PostCommentRepository)
      ),
    true
  );
}
