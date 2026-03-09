/**
 * Domain Layer - Value Objects
 *
 * Part of Sprint 3: DDD Architecture Implementation
 * Exports all value objects for the domain layer.
 *
 * Value objects are immutable, equality is based on value not identity,
 * and they represent concepts that describe or measure something.
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
} from "./EntityId.js";

// Link Tracking value objects (Sprint 19)
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

// Approval workflow value objects (Phase 1 Step 3: Content Approval)
export { ApprovalRequestId } from "./ApprovalRequestId.js";
export { ApprovalStatus, APPROVAL_STATUSES, type ApprovalStatusValue } from "./ApprovalStatus.js";
export { ReviewDecision, REVIEW_DECISIONS, type ReviewDecisionValue } from "./ReviewDecision.js";
