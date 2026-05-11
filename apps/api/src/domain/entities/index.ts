/**
 * @file index.ts
 * @description Barrel export for entities — re-exports all public domain entities and their associated types.
 * @layer domain
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

// Link Tracking entities
export { TrackedLink, type TrackedLinkProps, type TrackedLinkCreateProps } from "./TrackedLink.js";

export { LinkClick, type LinkClickProps, type LinkClickCreateProps } from "./LinkClick.js";

// Notification entities
export {
  NotificationEntity,
  type NotificationProps,
  type CreateNotificationParams,
} from "./Notification.js";

// Campaign entities
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

// Scheduled Report entities
export {
  ScheduledReport,
  type ScheduledReportProps,
  type ScheduledReportCreateProps,
} from "./ScheduledReport.js";

// Media Asset entity (Asset Library)
export {
  MediaAsset,
  MediaAssetId,
  type MediaAssetProps,
  type MediaAssetCreateProps,
} from "./MediaAsset.js";

// Brand Kit entity
export {
  BrandKit,
  BrandKitValidationError,
  type BrandKitProps,
  type CreateBrandKitInput,
  type UpdateBrandKitInput,
} from "./BrandKit.js";

// Social Inbox entities
export {
  SocialConversation,
  type CreateSocialConversationInput,
  type SocialConversationState,
  type SocialConversationEvent,
  ConversationResolved,
  ConversationReopened,
} from "./SocialConversation.js";

// Conversation Notes (Social Inbox)
export {
  ConversationNote,
  type ConversationNoteProps,
  type CreateConversationNoteInput,
} from "./ConversationNote.js";

// Task entity
export {
  Task,
  type TaskProps,
  type CreateTaskInput,
  type UpdateTaskInput,
  type TaskStatusValue,
  type TaskPriorityValue,
  TASK_STATUS,
  TASK_PRIORITY,
} from "./Task.js";

// Integration Platform entities (Zapier, Make, etc.)
export {
  IntegrationApiKey,
  type IntegrationApiKeyProps,
  type CreateIntegrationApiKeyInput,
  type IntegrationPlatformValue,
} from "./IntegrationApiKey.js";

export {
  IntegrationSubscription,
  type IntegrationSubscriptionProps,
  type CreateIntegrationSubscriptionInput,
} from "./IntegrationSubscription.js";

// SAML SSO entity
export {
  SamlConfiguration,
  type SamlConfigurationProps,
  type CreateSamlConfigurationInput,
  type SamlAttributeMapping,
} from "./SamlConfiguration.js";

// OIDC SSO entity
export {
  OidcConfiguration,
  type OidcConfigurationProps,
  type CreateOidcConfigurationInput,
  type OidcAttributeMapping,
} from "./OidcConfiguration.js";

// CRM Connection entity
export {
  CrmConnection,
  CrmConnectionValidationError,
  type CrmConnectionProps,
  type CreateCrmConnectionInput,
  type CrmPlatformValue,
} from "./CrmConnection.js";

// CustomerUser entity — customer-side user with auth, membership, RBAC.
// Roles live in the CustomerRole DB table; CustomerUser carries denormalised
// roleId/roleName/roleLevel/permissions snapshots for fast checks.
export {
  CustomerUser,
  type CustomerUserProps,
  type CreateCustomerUserInput,
  type CustomerUserPublicDto,
} from "./CustomerUser.js";

// Custom Report Builder entity
export {
  CustomReport,
  InvalidCustomReportError,
  type CustomReportProps,
  type CreateCustomReportInput,
  type UpdateCustomReportInput,
} from "./CustomReport.js";
