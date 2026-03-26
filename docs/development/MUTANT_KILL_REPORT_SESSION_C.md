# Mutant Kill Session C — Zero-Coverage Directories

Date: 2026-03-20

## Status: COMPLETE

8 previously untested application use case directories now have test files. 76 new tests across 8 files covering billing, AI image, brand voice, UTM, first comment, external notifications, campaigns, and recurring posts.

## Directories Covered

| Directory              | Tests Written | Stryker Total     | Stryker Covered | Target Met |
| ---------------------- | ------------- | ----------------- | --------------- | ---------- |
| usage                  | 7             | 91.30%            | 91.30%          | ✅ ≥60%    |
| external-notifications | 10            | 100% (Configure)  | 100%            | ✅ ≥60%    |
| first-comment          | 6             | 92.86% (Set)      | 92.86%          | ✅ ≥60%    |
| brand-voice            | 14            | 80.39% (Upsert)   | 80.39%          | ✅ ≥60%    |
| ai-image               | 15            | 57.69% (Generate) | 57.69%          | ❌ close   |
| utm                    | 7             | 58.82% (Generate) | 58.82%          | ❌ close   |
| campaigns              | 8             | 36.17% (Create)   | 36.17%          | ❌         |
| recurring              | 9             | 27.50% (Create)   | 28.57%          | ❌         |

## Tests Written

| File                                                       | Tests  | Use Case                             |
| ---------------------------------------------------------- | ------ | ------------------------------------ |
| tests/unit/application/usageUseCase.test.ts                | 7      | GetUsageUseCase                      |
| tests/unit/application/brandVoiceUseCase.test.ts           | 14     | UpsertBrandVoiceUseCase              |
| tests/unit/application/generateImageUseCase.test.ts        | 15     | GenerateImageUseCase                 |
| tests/unit/application/utmLinksUseCase.test.ts             | 7      | GenerateUTMLinksUseCase              |
| tests/unit/application/firstCommentUseCase.test.ts         | 6      | SetFirstCommentUseCase               |
| tests/unit/application/externalNotificationUseCase.test.ts | 10     | ConfigureExternalNotificationUseCase |
| tests/unit/application/campaignUseCases.test.ts            | 8      | CreateCampaignUseCase                |
| tests/unit/application/recurringPostUseCases.test.ts       | 9      | CreateRecurringPostUseCase           |
| **Total**                                                  | **76** | **8 use cases**                      |

## Use Cases Now With Tests (first test ever in this session)

1. GetUsageUseCase (91.30% covered)
2. UpsertBrandVoiceUseCase (80.39% covered)
3. GenerateImageUseCase (57.69% covered)
4. GenerateUTMLinksUseCase (58.82% covered)
5. SetFirstCommentUseCase (92.86% covered)
6. ConfigureExternalNotificationUseCase (100% covered)
7. CreateCampaignUseCase (36.17% covered)
8. CreateRecurringPostUseCase (28.57% covered)

## Use Cases Still Without Tests

From each directory, these related use cases were NOT tested:

- IncrementUsageUseCase
- DeleteBrandVoiceUseCase, GetBrandVoiceQuery
- ListGeneratedImagesQuery
- GetTrackedLinkUseCase
- RemoveFirstCommentUseCase, GetFirstCommentQuery, PublishFirstCommentUseCase
- DeleteExternalNotificationUseCase, TestExternalNotificationUseCase, ListExternalNotificationsQuery
- UpdateCampaignUseCase, ArchiveCampaignUseCase, TagPostWithCampaignUseCase, GetCampaignAnalyticsUseCase
- UpdateRecurringPostUseCase, DeactivateRecurringPostUseCase, ProcessRecurrenceUseCase
- All 13 inbox use cases (IngestSocialMessage, MarkAsRead, SendReply, etc.)

## All API Tests Status

| Metric                   | Before Session C | After Session C                     |
| ------------------------ | ---------------- | ----------------------------------- |
| Test files               | 290              | 298                                 |
| Tests passing            | 5,895            | 6,218                               |
| Directories with 0 tests | 10               | 2 (inbox, reports still need tests) |

## Stryker Verification (5 min 14s)

Targeted run confirmed test effectiveness. Top scores:

- ConfigureExternalNotification: 100%
- SetFirstComment: 92.86%
- GetUsage: 91.30%
- UpsertBrandVoice: 80.39%

Lower scores (CreateCampaign 36%, CreateRecurringPost 28%) indicate these use cases delegate heavily to domain entity factories — the surviving mutants are in the entity creation logic, not the use case orchestration.

## Recommended Next Steps

1. **Inbox use cases** (13 files, 0 tests) — highest business value remaining gap
2. **Reports use cases** (5 files, 0 tests) — GenerateReportUseCase has complex orchestration
3. **Remaining CRUD use cases** — Update, Delete, Archive variants for each directory
4. **Domain entity factories** — Campaign.create(), RecurringPost.create() need direct tests to kill the 36%/28% survivors
