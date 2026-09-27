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

// Channel-publication value objects — the record's closed vocabulary
export {
  FragmentReference,
  sortFragments,
  type FragmentReferenceJson,
  type FragmentReferenceProps,
} from "./FragmentReference.js";
export {
  providedReference,
  noneReturnedReference,
  isProvidedReference,
  PROVIDER_REFERENCE_KINDS,
  type ProviderReference,
  type ProviderReferenceKind,
  type ProvidedReference,
  type NoneReturnedReference,
} from "./ProviderReference.js";
export {
  ExclusionReason,
  CHANNEL_FAILURE_CODES,
  type ChannelFailureCode,
  type ChannelFailureRecord,
  type ExclusionReasonProps,
} from "./ExclusionReason.js";
export {
  ContentFingerprint,
  digestOfFragments,
  type ContentFingerprintInput,
} from "./ContentFingerprint.js";
export {
  PUBLICATION_OUTCOME_KINDS,
  CHANNEL_RETRACTION_BLOCKS,
  CHANNEL_RETRACTION_CLEARANCES,
  ATTEMPT_CLASSIFICATIONS,
  unresolvedOutcome,
  publishedOutcome,
  excludedOutcome,
  isPublishedOutcome,
  isExcludedOutcome,
  isUnresolvedOutcome,
  liveFragmentsOf,
  outcomeHasLiveContent,
  type PublicationOutcome,
  type PublicationOutcomeKind,
  type UnresolvedOutcome,
  type PublishedOutcome,
  type ExcludedOutcome,
  type RetractionState,
  type RetractionPending,
  type RetractionNotPending,
  type RetractionActionWindow,
  type ChannelRetractionBlock,
  type ChannelRetractionClearance,
  type AttemptResult,
  type AttemptClassification,
  type PublishedAttemptResult,
  type FailedAttemptResult,
} from "./PublicationOutcome.js";

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

// Customer-side user identity. Role + permissions live on CustomerUser
// (roleId FK to CustomerRole) plus denormalised snapshot fields
// (roleName/roleLevel/permissions); no value object for role itself.
export { CustomerUserId } from "./CustomerUserId.js";

// Notification value objects
export { NotificationId } from "./NotificationId.js";
export {
  NotificationType,
  NOTIFICATION_TYPES,
  type NotificationTypeValue,
} from "./NotificationType.js";

// Comment value objects
export { CommentId } from "./CommentId.js";

// Social Inbox value objects
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

// UTM parameters
export { UTMParameters, type UTMParametersProps } from "./UTMParameters.js";

// Campaign value objects
export { CampaignStatus, CAMPAIGN_STATUS, type CampaignStatusValue } from "./CampaignStatus.js";

// Approval workflow value objects
export { ApprovalRequestId } from "./ApprovalRequestId.js";
export { ApprovalStatus, APPROVAL_STATUSES, type ApprovalStatusValue } from "./ApprovalStatus.js";
export { ReviewDecision, REVIEW_DECISIONS, type ReviewDecisionValue } from "./ReviewDecision.js";

// Mention context value object — used by mentions, inbox, tasks contexts
export { MENTION_CONTEXT, type MentionContextType } from "./MentionContext.js";
