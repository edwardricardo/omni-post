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
