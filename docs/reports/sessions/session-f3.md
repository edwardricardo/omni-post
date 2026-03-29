# Session F3 — Posts Use Cases + PostAggregate

Date: 2026-03-24

## Status: COMPLETE (Stryker verification pending)

## Tests Written

| File                                        | Tests   | Target                                                                     |
| ------------------------------------------- | ------- | -------------------------------------------------------------------------- |
| tests/unit/domain/aggregates.post.test.ts   | 74      | PostAggregate (full state machine, validation, events, media, review flow) |
| tests/unit/application/postUseCases.test.ts | 40      | CreatePost, UpdatePost, SchedulePost, DeletePost, GetPost, ListPosts       |
| **Total**                                   | **114** |                                                                            |

## PostAggregate Coverage

| Category                   | Tests | Methods Covered                                               |
| -------------------------- | ----- | ------------------------------------------------------------- |
| create() + validation      | 11    | Factory, body/platform validation, scheduled creation         |
| reconstitute()             | 1     | State loading without events                                  |
| schedule()                 | 5     | DRAFT→SCHEDULED, past rejection, timezone, status guard       |
| unschedule()               | 3     | SCHEDULED→DRAFT, event, guard                                 |
| startPublishing()          | 4     | DRAFT→PUBLISHING, SCHEDULED→PUBLISHING, event, guard          |
| markAsPublished()          | 3     | PUBLISHING→PUBLISHED, event, guard                            |
| markAsFailed()             | 3     | PUBLISHING→FAILED, event with retryable, guard                |
| cancel()                   | 4     | DRAFT/SCHEDULED→CANCELLED, event with reason, guard           |
| submitForReview()          | 3     | DRAFT→PENDING_REVIEW, event, guard                            |
| returnToDraft()            | 3     | PENDING_REVIEW→DRAFT, event, clears scheduledAt               |
| approveForScheduling()     | 4     | PENDING_REVIEW→SCHEDULED, event, past date rejection, guard   |
| updateContent()            | 8     | Body/title/tags update, events, version tracking, guards      |
| addMedia() + removeMedia() | 7     | Add/remove, events, non-existent media, guards                |
| isReadyForPublishing()     | 2     | False for draft, false when not passed                        |
| Status predicates          | 5     | isDraft, isEditable (DRAFT, FAILED, SCHEDULED, PUBLISHED)     |
| toJSON()                   | 3     | Serialization with scheduledAt, publishedAt                   |
| Domain events lifecycle    | 2     | clearDomainEvents, event accumulation                         |
| Full lifecycle paths       | 2     | DRAFT→REVIEW→SCHEDULED→PUBLISHING→PUBLISHED, failure recovery |

## Use Cases Covered

| Use Case            | Tests | Key Assertions                                                                                        |
| ------------------- | ----- | ----------------------------------------------------------------------------------------------------- |
| CreatePostUseCase   | 10    | DRAFT status, persistence, events, title/tags, scheduled, projectId, validation, save error           |
| UpdatePostUseCase   | 7     | Body/title/tags update, persist+dispatch, non-editable guard, not-found, invalid ID                   |
| SchedulePostUseCase | 7     | SCHEDULED status, channels verified, events, empty channels, invalid date, missing channel, not-found |
| DeletePostUseCase   | 7     | Draft/failed/cancelled deletion, SCHEDULED/PUBLISHED guard, invalid ID, not-found                     |
| GetPostUseCase      | 3     | Read model return, invalid ID, not-found                                                              |
| ListPostsUseCase    | 5     | Pagination, limit cap at 100, defaults, filtering, invalid projectId                                  |

## apps/api Test Count

| Metric        | Before | After |
| ------------- | ------ | ----- |
| Test files    | 301    | 303   |
| Tests passing | 6,275  | 6,389 |
| Tests failing | 0      | 0     |

## Stryker Results

Targeted run pending. Will update when complete.

## InMemory Repositories Created

None — used vi.fn() mock factories for PostRepository, PostQueryRepository, ChannelRepository, EventDispatcher. Pattern is reusable for future use case tests.

## Decisions Made

1. **Import fix**: PostUnscheduled, PostPublishingStarted, PostMediaAdded, PostMediaRemoved are not re-exported from domain/index.ts — imported directly from domain/events/PostEvents.ts.
2. **approveForScheduling from DRAFT**: The state machine allows DRAFT→SCHEDULED directly, so `approveForScheduling()` from DRAFT succeeds. Test adjusted to test from PUBLISHING status instead.

## Next: Session F4

F4 covers re-running the 11 timed-out micro-batches from Session B with increased timeout, now that 114 additional tests exist.
