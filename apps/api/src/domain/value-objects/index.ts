/**
 * @file index.ts
 * @description Barrel export for value objects — re-exports all public value object classes, types, and constants.
 * @layer domain
 */

// Entity Identifiers (strongly-typed IDs)
export {
  PostId,
  ChannelId,
  AccountId,
  ProjectId,
  ContentId,
  MediaId,
  TrackedLinkId,
  LinkClickId,
  CampaignId,
  ScheduledReportId,
} from "./EntityId.js";

// Link Tracking value objects
export { ShortCode } from "./ShortCode.js";

// Content value objects
export { Content, type ContentProps, type ContentLocale, type PlatformType } from "./Content.js";

// Status value objects
export { PublishStatus, type PublishStatusValue, PUBLISH_STATUS } from "./PublishStatus.js";

// Media value objects
export {
  MediaAttachment,
  type MediaAttachmentProps,
  type MediaType,
  type MediaPlatform,
} from "./MediaAttachment.js";

// Time value objects
export { ScheduledTime, type ScheduledTimeProps, type Timezone } from "./ScheduledTime.js";

// Provider value objects
export { Provider, PROVIDERS, type ProviderType, type ProviderCapabilities } from "./Provider.js";

// Team value objects (Phase 1: TeamMember foundation)
export { TeamMemberId } from "./TeamMemberId.js";
export { TeamRole, TEAM_ROLE, type TeamRoleValue, type TeamPermission } from "./TeamRole.js";

// Notification value objects (Phase 1 Step 2: Notification system)
export { NotificationId } from "./NotificationId.js";
export {
  NotificationType,
  NOTIFICATION_TYPES,
  type NotificationTypeValue,
} from "./NotificationType.js";

// Comment value objects (Phase 1 Step 4: In-Context Comments)
export { CommentId } from "./CommentId.js";

// Social Inbox value objects (Phase 2: Social Inbox)
export { SocialMessageId } from "./SocialMessageId.js";
export { SocialConversationId } from "./SocialConversationId.js";
export {
  SocialMessageType,
  SOCIAL_MESSAGE_TYPES,
  type SocialMessageTypeValue,
} from "./SocialMessageType.js";
export {
  SocialMessageStatus,
  SOCIAL_MESSAGE_STATUSES,
  type SocialMessageStatusValue,
} from "./SocialMessageStatus.js";

// UTM parameters (Phase 3 Step 4: UTM/GA4 Integration)
export { UTMParameters, type UTMParametersProps } from "./UTMParameters.js";

// Campaign value objects (Phase 3: Analytics & Reporting)
export { CampaignStatus, CAMPAIGN_STATUS, type CampaignStatusValue } from "./CampaignStatus.js";

// Approval workflow value objects (Phase 1 Step 3: Content Approval)
export { ApprovalRequestId } from "./ApprovalRequestId.js";
export { ApprovalStatus, APPROVAL_STATUSES, type ApprovalStatusValue } from "./ApprovalStatus.js";
export { ReviewDecision, REVIEW_DECISIONS, type ReviewDecisionValue } from "./ReviewDecision.js";
