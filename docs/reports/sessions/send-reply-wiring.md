# SendReply Provider Wiring — Implementation Report

Date: 2026-03-25

## Summary

SendReplyUseCase now calls `providerAdapter.postReply()` for supported providers. Unsupported providers return a clear domain error before any provider API call. The implementation is backward compatible — the two new constructor parameters are optional.

## Changes Made

| File                                                        | Change                                                                                                                                                      |
| ----------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| apps/api/src/application/inbox/SendReplyUseCase.ts          | Added ChannelRepository + ProviderAdapterResolver as optional constructor params. Replaced TODO with provider API call, error handling, and status updates. |
| apps/api/src/infrastructure/container/setupInboxUseCases.ts | Updated DI registration to inject ChannelRepository                                                                                                         |
| apps/api/tests/unit/application/inboxUseCases.test.ts       | Added 7 tests for provider integration                                                                                                                      |

## Provider Support Matrix

| Provider  | Supported | Method Called                          |
| --------- | --------- | -------------------------------------- |
| X         | Yes       | postReply()                            |
| Instagram | Yes       | postReply()                            |
| Facebook  | Yes       | postReply()                            |
| YouTube   | Yes       | postReply()                            |
| LinkedIn  | Yes       | postReply()                            |
| Snapchat  | No        | Blocked — capabilities.replies = false |
| Telegram  | No        | Blocked — capabilities.replies = false |
| Pinterest | No        | Blocked — capabilities.replies = false |
| TikTok    | No        | Blocked — capabilities.replies = false |
| Bluesky   | No        | No postReply() in adapter              |

## Error Handling

| Scenario                              | Behavior                                                                |
| ------------------------------------- | ----------------------------------------------------------------------- |
| Provider not supported                | Returns VALIDATION_FAILED error, outbound reply marked FAILED           |
| Provider API error                    | Returns INTERNAL_ERROR, outbound reply marked FAILED with error message |
| Channel not found                     | Returns NOT_FOUND error, outbound reply marked FAILED                   |
| No adapter resolver (backward compat) | Falls through to direct SENT status (original behavior)                 |

## Tests Added (7)

| Test                               | Assertion                                                   |
| ---------------------------------- | ----------------------------------------------------------- |
| Provider call with correct params  | postReply() called with body + inReplyToProviderMessageId   |
| Returns providerReplyId on success | result.value.providerReplyId = "ext-reply-1"                |
| Unsupported provider error         | Returns error with "not supported" message                  |
| Provider API rejection             | Returns error, outbound reply marked FAILED                 |
| SENT status with providerReplyId   | updateStatus called with ("reply-1", "SENT", "ext-reply-1") |
| Channel not found error            | Returns NOT_FOUND, outbound reply marked FAILED             |
| Backward compatible (no resolver)  | Works without adapter resolver, marks SENT directly         |

## Build and Test Status

| Check                | Result                                                                          |
| -------------------- | ------------------------------------------------------------------------------- |
| New tests            | 41 pass (34 existing + 7 new)                                                   |
| Full API suite       | 6,407 pass, 1 pre-existing failure (templateEngine ServerTemplateEngine export) |
| Pre-existing failure | tests/unit/templateEngine.test.ts — NOT related to this change                  |

## Architecture Notes

- `ProviderAdapterResolver` interface defined in SendReplyUseCase.ts (application layer)
- Optional DI params maintain backward compatibility
- No ProviderAdapterFactory in DI yet — resolver not wired. Next step: create concrete resolver in infrastructure layer and register in DI.
