# Sprint 1 Report — Wave 1 Features

Date: 2026-03-28

## Batches Summary

| Batch | Feature                        | Status | Tests Added        |
| ----- | ------------------------------ | ------ | ------------------ |
| 1     | Tech debt: test teardown fixes | ✅     | 0 (fixed existing) |
| 2     | Emoji picker (emoji-mart)      | ✅     | 0 (UI component)   |
| 3     | Internal notes on inbox        | ✅     | 22                 |
| 4     | Brand Kit                      | ✅     | 38                 |
| 5     | Zapier connector               | ✅     | 45                 |
| 6     | Backlog update                 | ✅     | —                  |

## Batch 1 — Tech Debt

| Fix                             | File                     | Status |
| ------------------------------- | ------------------------ | ------ |
| \_originalGetComments afterEach | LinkedInAdapter.test.ts  | ✅     |
| \_originalPostReply afterEach   | LinkedInAdapter.test.ts  | ✅     |
| \_mockPostComment assertion     | LinkedInAdapter.test.ts  | ✅     |
| \_originalEnv afterEach         | PinterestAdapter.test.ts | ✅     |

## Batch 2 — Emoji Picker

Approach: emoji-mart (@emoji-mart/react 1.1.1 + @emoji-mart/data 1.2.1)
Package: Installed in @packages/ui (shared across admin + client)
Files created: EmojiPickerButton.tsx
Files modified: ContentEditorCore.tsx (added picker to toolbar), useContentEditor.ts (added insertTextAtCursor + textareaRef)
Works in: admin composer, client composer (via shared ContentEditorCore)

## Batch 3 — Conversation Notes

New Prisma model: ConversationNote
Migration: 20260328201631_add_conversation_notes
Domain entity: ConversationNote (body validation 1-5000 chars, soft delete)
Use cases: AddConversationNoteUseCase (UoW), DeleteConversationNoteUseCase (UoW), ListConversationNotesQuery
Routes: GET/POST/DELETE /api/inbox/conversations/:id/notes (auth + schema)
Route file: conversationNoteRoutes.ts (extracted to keep inboxRoutes under 800 lines)
Tests: 22 (10 entity + 12 use case)

## Batch 4 — Brand Kit

New Prisma model: BrandKit (1 per account, accountId @unique)
Migration: 20260328203817_add_brand_kit
Domain entity: BrandKit (hex color validation #RRGGBB, optional fields)
Use cases: UpsertBrandKitUseCase (UoW), DeleteBrandKitUseCase (UoW), GetBrandKitQuery
Routes: GET/PUT/DELETE /api/brand-kit/:accountId (auth + schema)
DI setup: setupBrandKitUseCases.ts
Tests: 38 (18 entity + 16 use case + 4 integration)

## Batch 5 — Zapier Connector

New Prisma models: ZapierApiKey, ZapierSubscription
Migration: 20260328205009_add_zapier_integration
Domain entities:

- ZapierApiKey: zap\_ prefix key generation, argon2 hash (domain receives pre-hashed), revoke/markUsed
- ZapierSubscription: 6 supported events, HTTPS-only targetUrl, deactivate
  Auth middleware: zapierAuthMiddleware.ts (Bearer zap\_... validation via argon2.verify)
  Use cases:
- GenerateZapierApiKeyUseCase (max 5 per account, UoW)
- RevokeZapierApiKeyUseCase (UoW)
- ListZapierApiKeysQuery
- SubscribeZapierTriggerUseCase (UoW)
- UnsubscribeZapierTriggerUseCase (UoW)
- TriggerZapierEventService (fire-and-forget POST to subscribers)
  Triggers supported: post.published, post.failed, approval.requested, approval.approved, approval.rejected, inbox.message_received
  Actions supported: create-draft, schedule-post
  Polling: GET /api/zapier/triggers/posts-published (last 25)
  Routes: 9 endpoints at /api/zapier/\* (auth + schema)
  Tests: 45 (13 ZapierApiKey entity + 10 ZapierSubscription entity + 22 use cases)

## Totals

| Metric          | Before | After | Delta |
| --------------- | ------ | ----- | ----- |
| Tests passing   | 6,478  | 6,583 | +105  |
| Test files      | 305    | 312   | +7    |
| Prisma models   | 69     | 73    | +4    |
| API route files | 45     | 48    | +3    |

## Build and Test

| Check                   | Result                           |
| ----------------------- | -------------------------------- |
| TypeScript build        | 0 errors, 9/9 tasks              |
| All tests               | 312 files, 6583 passed, 0 failed |
| ESLint                  | 0 errors, 0 warnings             |
| Architecture boundaries | Clean (0 violations)             |

## Decisions Made

| Decision                   | Choice                     | Reason                                           |
| -------------------------- | -------------------------- | ------------------------------------------------ |
| Emoji picker approach      | emoji-mart (Option B)      | Consistent appearance across OS for SaaS product |
| DB services for migrations | Always `pnpm db:up`        | CLAUDE.md rule — never skip                      |
| Zapier auth                | API Key (not OAuth)        | Simpler for initial integration, per sprint spec |
| argon2 in domain           | Moved to application layer | Domain must be framework-free per CLAUDE.md      |

## Backlog Items Closed

| ID       | Item                         | Score | Status  |
| -------- | ---------------------------- | ----- | ------- |
| D-UX-01  | Emoji picker                 | 14    | ✅ Done |
| D-TC-03  | Internal notes on inbox      | 14    | ✅ Done |
| D-AL-01  | Brand Kit                    | 14    | ✅ Done |
| D-INT-02 | Zapier connector             | 18    | ✅ Done |
| —        | Tech debt (4 test teardowns) | —     | ✅ Done |

## Score Updates

| ID       | Item           | Change     | Reason                            |
| -------- | -------------- | ---------- | --------------------------------- |
| D-INT-03 | Make connector | Effort M→S | ZapierSubscription infra reusable |
