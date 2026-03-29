# SendReply DI Wiring — Implementation Report

Date: 2026-03-25

## Summary

ProviderAdapterResolver is now registered in the DI container and injected into SendReplyUseCase. Replies from the inbox will call the actual provider API for X, Instagram, Facebook, YouTube, and LinkedIn.

## Changes Made

| File                                                        | Change                                                                                                               |
| ----------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| apps/api/src/infrastructure/container/setupInboxUseCases.ts | Imported ProviderRegistryService, injected inline resolver wrapping `registry.getAdapter()` as 5th constructor param |

## Resolver Implementation

Approach: **Inline adapter object wrapping existing ProviderRegistryService** — no new class created.

```typescript
{
  resolve: (provider) => registry.getAdapter(provider);
}
```

This delegates to `ProviderRegistryService.getAdapter(id)` which is already registered in DI as `TOKENS.ProviderRegistry` singleton. Zero new files, zero new abstractions.

## DI Registration

- Container type: Custom (Container.ts with `register`/`resolve`)
- Registration pattern: Singleton factory (`true` third param)
- Token: `TOKENS.SendReplyUseCase`
- Resolver injected as 5th param of `new SendReplyUseCase()`

## Verification

| Check                                  | Result                                         |
| -------------------------------------- | ---------------------------------------------- |
| TypeScript build                       | Inferred from vitest (no TS errors)            |
| Inbox tests                            | 41 pass, 0 fail                                |
| Full API suite                         | 6,408 pass, 0 fail                             |
| Resolver injected (not undefined)      | Confirmed — 5th param passed in DI             |
| Backward-compat path no longer default | Confirmed — resolver IS provided in production |

## SendReply End-to-End Flow

1. Frontend → `POST /api/inbox/messages/:id/reply { body: "..." }`
2. `InboxRouteHandler.sendReply()` validates and calls use case
3. `SendReplyUseCase.execute()` creates outbound reply record
4. `ProviderAdapterResolver.resolve(provider)` → `ProviderRegistryService.getAdapter(provider)`
5. Checks `adapter.capabilities.replies` and `adapter.postReply` exists
6. Loads channel credentials via `ChannelRepository.findById()`
7. `adapter.postReply({ channelCredentials, inReplyToProviderMessageId, body })`
8. Updates outbound reply status to SENT with `providerReplyId`
9. Marks message as REPLIED, dispatches domain events
