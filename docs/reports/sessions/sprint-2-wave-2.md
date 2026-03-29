# Sprint 2 Report — Wave 2 Features

Date: 2026-03-28

## Batches Summary

| Batch | Feature                                     | Status | Tests Added |
| ----- | ------------------------------------------- | ------ | ----------- |
| 1     | Make connector (Integration generalization) | ✅     | 10          |
| 2     | Multi-level approvals                       | ✅     | 43          |
| 3     | Task assignment                             | ✅     | 59          |
| 4     | Backlog update                              | ✅     | —           |

## Batch 1 — Make Connector

Approach: **Option C — Generalized Integration Platform**

- Renamed `ZapierApiKey` → `IntegrationApiKey` + `IntegrationPlatform` enum (ZAPIER, MAKE)
- Renamed `ZapierSubscription` → `IntegrationSubscription` + platform field
- Renamed all domain entities, repositories, use cases, auth middleware, DI tokens
- `/api/zapier/*` routes preserved (backward compat), `/api/make/*` routes added
- Auth middleware accepts both `zap_` and `mak_` prefixes
- `TriggerIntegrationEventService` supports platform-filtered event delivery
- Migration: `generalize_integration_platform`
- Tests: 10 new (Make-specific key generation, subscription, platform filtering)

## Batch 2 — Multi-Level Approvals

New Prisma models: `ApprovalWorkflow`, `ApprovalWorkflowLevel`
Extended: `ApprovalRequest` (+workflowId, +currentLevel, +totalLevels), `ApprovalReview` (+level)
Migration: `add_approval_workflows`

Domain: `ApprovalWorkflow` entity (1-10 levels, sequential orders, isComplete, getLevel)
Extended: `ApprovalRequestAggregate` — multi-level progression in addReview(), ApprovalLevelAdvanced event

New use cases:

- `CreateApprovalWorkflowUseCase` (UoW, validates unique name, handles default swap)
- `UpdateApprovalWorkflowUseCase` (UoW, replaces levels atomically)
- `DeleteApprovalWorkflowUseCase` (guards against active requests)
- `ListApprovalWorkflowsQuery`

Extended use cases:

- `SubmitForReviewUseCase` — accepts workflowId, resolves default, sets levels
- `ApprovePostUseCase` — advances level on approval, fully approves on last level
- `RejectPostUseCase` — terminates chain at any level

Routes: 5 new at `/api/approval-workflows` (CRUD + list)
Tests: 43 new (19 entity + 16 workflow use cases + 8 multi-level approval progression)

Backward compatible: single-level approval (null workflowId) unchanged.

## Batch 3 — Task Assignment

New Prisma model: `Task` + `TaskStatus` enum (OPEN, IN_PROGRESS, COMPLETED, CANCELLED) + `TaskPriority` enum (LOW, MEDIUM, HIGH, URGENT)
Migration: `add_tasks`

Domain: `Task` entity with state machine:

- OPEN → IN_PROGRESS (via assign)
- OPEN/IN_PROGRESS → COMPLETED (via complete, guards against CANCELLED)
- OPEN/IN_PROGRESS → CANCELLED (via cancel, guards against COMPLETED)

Use cases:

- `CreateTaskUseCase` (UoW)
- `UpdateTaskUseCase` (UoW, account ownership guard)
- `CompleteTaskUseCase` (UoW, only assignee or creator)
- `CancelTaskUseCase` (UoW, only creator)
- `ListTasksQuery` (filters: status, priority, assigneeId, projectId, pagination)
- `GetTaskQuery`

Routes: 7 endpoints at `/api/tasks` (CRUD + complete + cancel + soft delete)
Tests: 59 new (38 entity state machine + 21 use case)

## Totals

| Metric          | Before Sprint 2 | After Sprint 2 | Delta |
| --------------- | --------------- | -------------- | ----- |
| Tests passing   | 6,583           | 6,695          | +112  |
| Test files      | 312             | 316            | +4    |
| Prisma models   | 73              | 76             | +3    |
| API route files | 48              | 51             | +3    |

## Build and Test

| Check                   | Result                           |
| ----------------------- | -------------------------------- |
| TypeScript build        | 0 errors, 9/9 tasks              |
| All tests               | 316 files, 6695 passed, 0 failed |
| ESLint                  | 0 errors, 0 warnings             |
| Architecture boundaries | Clean (0 violations)             |

## Decisions Made

| Decision                | Choice                                      | Reason                                                                      |
| ----------------------- | ------------------------------------------- | --------------------------------------------------------------------------- |
| Make connector approach | Option C (generalize)                       | Future-proof for N8N, Pabbly; single codebase for all integration platforms |
| Zapier model rename     | IntegrationApiKey + IntegrationSubscription | Platform-agnostic naming scales to N connectors                             |

## Backlog Items Closed

| ID       | Item                  | Score | Status                                        |
| -------- | --------------------- | ----- | --------------------------------------------- |
| D-INT-03 | Make connector        | ~16   | ✅ Done (generalized to Integration platform) |
| D-TC-01  | Multi-level approvals | 15    | ✅ Done                                       |
| D-TC-02  | Task assignment       | 13    | ✅ Done                                       |

## Score Updates

| ID       | Item                    | Change       | Reason                                 |
| -------- | ----------------------- | ------------ | -------------------------------------- |
| D-INT-01 | CRM integration         | Priority ↓   | Zapier/Make cover CRM sync use case    |
| D-INT-04 | Integration marketplace | Dependency ↑ | 2 integrations now live (Zapier, Make) |

## Wave 3 Candidates

| ID      | Item                  | Score | Notes                                 |
| ------- | --------------------- | ----- | ------------------------------------- |
| D-UX-02 | @Mention autocomplete | 13    | More valuable now tasks + notes exist |
| D-AN-01 | Custom report builder | 12    | Static dashboards cover 90%           |
| D-AL-02 | Google Drive import   | 12    | Convenience feature                   |
| D-UX-03 | Canva / Adobe Express | 12    | Partnership required                  |
