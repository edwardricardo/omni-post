/**
 * Domain Layer - Events Exports
 *
 * Part of Sprint 5: DDD Architecture Implementation
 */

// Base event infrastructure
export {
  type DomainEvent,
  type DomainEventHandler,
  type EventDispatcher,
  InMemoryEventDispatcher,
} from "./DomainEvent.js";

// Post events
export {
  PostCreated,
  PostContentUpdated,
  PostScheduled,
  PostPublished,
  PostPublishingFailed,
  PostCancelled,
  PostMediaAdded,
  PostSubmittedForReview,
  PostApproved,
  PostRejected,
  type PostEvent,
} from "./PostEvents.js";

// Project events (Sprint 19)
export { type ProjectEvent } from "./ProjectEvents.js";

// Social Inbox events are co-located with their aggregates/entities:
// - SocialMessageReceived, SocialMessageRead, etc. → SocialMessageAggregate.ts
// - ConversationResolved, ConversationReopened → SocialConversation.ts
// Re-exported from aggregates/index.ts and entities/index.ts
