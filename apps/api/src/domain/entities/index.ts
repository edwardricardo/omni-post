/**
 * Domain Layer - Entity Exports
 *
 * Part of Sprint 4: DDD Architecture Implementation
 * Exports all domain entities.
 *
 * Entities are objects with identity that persists over time.
 * Two entities are equal if they have the same identity, regardless of their attributes.
 */

// Base entity class
export { type EntityProps, type AuditInfo } from "./Entity.js";

// Domain entities
export {
  Channel,
  type ChannelProps,
  type CreateChannelInput,
  type ChannelCredentials,
  type ConnectionStatusValue,
  CONNECTION_STATUS,
} from "./Channel.js";

export {
  Account,
  type AccountProps,
  type CreateAccountInput,
  type SubscriptionTierValue,
  type BillingCycleValue,
  SUBSCRIPTION_TIER,
} from "./Account.js";

export {
  Project,
  type ProjectProps,
  type CreateProjectInput,
  type ProjectStats,
  type CrisisModeEntry,
} from "./Project.js";

// Link Tracking entities (Sprint 19)
export { TrackedLink, type TrackedLinkProps, type TrackedLinkCreateProps } from "./TrackedLink.js";

export { LinkClick, type LinkClickProps, type LinkClickCreateProps } from "./LinkClick.js";

// Team entities (Phase 1: TeamMember foundation)
export { TeamMemberEntity } from "./TeamMember.js";

// Notification entities (Phase 1 Step 2: Notification system)
export {
  NotificationEntity,
  type NotificationProps,
  type CreateNotificationParams,
} from "./Notification.js";

// Campaign entities (Phase 3: Analytics & Reporting)
export {
  Campaign,
  type CampaignProps,
  type CampaignCreateProps,
  type CampaignEvent,
  CampaignCreated,
  CampaignActivated,
  CampaignCompleted,
  CampaignArchived,
  PostTaggedWithCampaign,
  PostUntaggedFromCampaign,
} from "./Campaign.js";

// Scheduled Report entities (Phase 3: Analytics & Reporting)
export {
  ScheduledReport,
  type ScheduledReportProps,
  type ScheduledReportCreateProps,
} from "./ScheduledReport.js";

// Social Inbox entities (Phase 2: Social Inbox)
export {
  SocialConversation,
  type CreateSocialConversationInput,
  type SocialConversationState,
  type SocialConversationEvent,
  ConversationResolved,
  ConversationReopened,
} from "./SocialConversation.js";
