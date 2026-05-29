# Bounded Contexts Map — `@core/*` packages

> Catalog of every bounded context in `packages/core/`, their responsibilities,
> public dependencies declared, and the canon rules they obey.

**Owner:** Platform engineering
**Last refresh:** 2026-05-28 (extracted from monolithic `@core/application`)

---

## How to read this map

- Every bounded context lives at `packages/core/<context>/`.
- Each context is a separate pnpm workspace package with its own
  `package.json`, `tsconfig.json`, and `src/` barrel.
- **A context may import only from**:
  - `@core/domain` (shared kernel — entities, value-objects, repository ports)
  - `@core/embeddings` (shared kernel — ML embedding generation)
  - `@core/application` (base `UseCase` interface + `UseCaseError`)
  - `@ports/core` (port interfaces for cross-context composition)
  - `@shared/types` (Result, AppError, etc.)
- **A context must NOT import from a sibling `@core/<other>/`** directly. The
  `no-cross-bounded-context` depcruise rule enforces this.
- Cross-context use cases compose via **port-adapter** wiring done in the
  composition root (`apps/api/src/infrastructure/container/`). Adapters
  implement the port and delegate to the destination context's service.

## Inventory (46 contexts)

| Context                  | Responsibility (one line)                                                                |
| ------------------------ | ---------------------------------------------------------------------------------------- |
| `ai`                     | AI request routing (BYOK + pool), token usage tracking, localized content generation.    |
| `ai-image`               | Generated-image use cases (gen + list).                                                  |
| `aiPromptTemplates`      | Curated prompt-template CRUD for AI flows.                                               |
| `analytics`              | Query-side analytics aggregations and dashboard feeds.                                   |
| `apiKeys`                | API key issuance + revocation.                                                           |
| `approvals`              | Multi-level approval workflows, request lifecycle, history queries.                      |
| `assets`                 | Media asset management (upload, list, delete, share).                                    |
| `auth`                   | Customer + admin authentication, password / token management.                            |
| `billing`                | Subscription, gateway billing (Stripe/Paddle), pricing config.                           |
| `brand-kit`              | Brand kit (color palette, fonts, logos) per project.                                     |
| `brand-voice`            | Brand voice repository for AI content generation.                                        |
| `bulk-scheduling`        | CSV-driven mass post creation + scheduling pipeline.                                     |
| `campaigns`              | Campaign CRUD + analytics rollups.                                                       |
| `channels`               | Channel CRUD + per-provider connection state.                                            |
| `comments`               | Post-level comments (team-internal review threads).                                      |
| `compliance`             | GDPR / DSAR / data-retention orchestration.                                              |
| `crisis`                 | Crisis-mode escalation use cases.                                                        |
| `crm`                    | CRM integration sync + activity logging.                                                 |
| `custom-reports`         | Custom report definitions, scheduling, sharing.                                          |
| `customer-auth`          | Customer-side auth (vs admin-side `auth`).                                               |
| `embeddings`             | **Shared kernel** — ML embedding service consumed by `ai`, `glossary`, `style-guide`.    |
| `external-notifications` | External (3rd-party) notification dispatch (webhooks, email integrations).               |
| `first-comment`          | First-comment auto-post on channels that support it.                                     |
| `glossary`               | Brand glossary terms (embedded for RAG).                                                 |
| `guardrails`             | Content-safety registry (PII, toxicity, brand). Composes per-guardrail ports.            |
| `inbox`                  | Social inbox (incoming DMs / mentions / replies, conversation notes, triage).            |
| `integrations`           | 3rd-party integration installation + sync.                                               |
| `links`                  | Short-link issuance + redirection.                                                       |
| `listening`              | Mention ingestion + share-of-voice queries.                                              |
| `mentions`               | @mention parsing + per-context notification dispatch.                                    |
| `ml`                     | ML pipeline (training / scoring) use cases.                                              |
| `notifications`          | In-app notification create / read / list.                                                |
| `posts`                  | Post aggregate root — create, update, schedule, list, archive, hard-delete, duplicate.   |
| `providers`              | Mass re-auth orchestration for connected provider channels.                              |
| `recurring`              | Recurring-post templates + recurrence engine.                                            |
| `referral`               | Customer referral codes + reward tracking.                                               |
| `reports`                | Scheduled report generation.                                                             |
| `security`               | Platform credentials, secret rotation, encryption envelopes.                             |
| `settings`               | Tenant settings (BYOK credentials, AI token budgets, etc.).                              |
| `style-guide`            | Style guide rules (embedded for RAG).                                                    |
| `tasks`                  | Team tasks (assignment, completion, cancellation).                                       |
| `team`                   | Team member invitation + role updates.                                                   |
| `trends`                 | Trend radar (detect + score + dispatch).                                                 |
| `usage`                  | Per-account usage counters + reads.                                                      |
| `utm`                    | UTM-link generation.                                                                     |
| `webhooks`               | Webhook receivers + DLQ archival + secret rotation.                                      |
| `application`            | **Base layer** — `UseCase`, `UseCaseError`, `USE_CASE_ERRORS`. Imported by all contexts. |
| `domain`                 | **Shared kernel** — entities, value-objects, repository ports. Imported by all contexts. |
| `engine`                 | Legacy — small leftover (`planPublication.ts`) before the @core split. To be retired.    |
| `threading`              | Per-provider threading planner (composes per-provider strategies).                       |

## Cross-context composition: 5 ports

Cross-context dependencies that survived the split are routed through 5 port
interfaces in `@ports/core`. Each port has exactly one adapter in
`apps/api/src/infrastructure/container/adapters/`.

| Port                       | Purpose                                                  | Consumers                      | Adapter wraps                               |
| -------------------------- | -------------------------------------------------------- | ------------------------------ | ------------------------------------------- |
| `PostCreationPort`         | Create + schedule posts from outside `posts`.            | `bulk-scheduling`, `recurring` | `CreatePostUseCase` + `SchedulePostUseCase` |
| `NotificationDispatchPort` | In-app notifications from outside `notifications`.       | `mentions`, `inbox/handlers`   | `CreateNotificationUseCase`                 |
| `MentionTrackingPort`      | @mention dispatch from outside `mentions`.               | `inbox`, `tasks`               | `NotifyMentionedUsersService`               |
| `GuardrailEvaluationPort`  | Content evaluation from outside `guardrails`.            | `inbox` (send + triage)        | `GuardrailRegistry`                         |
| `PlatformCredentialPort`   | Read+write platform credentials from outside `security`. | `ai`, `settings`               | `PlatformCredentialService`                 |

## How to add a new bounded context

1. Create the package: `packages/core/<context>/` with `package.json`,
   `tsconfig.json`, and `src/index.ts` barrel. Use one of the existing
   contexts as a template.
2. Declare workspace deps in `package.json`: `@core/application`,
   `@core/domain`, `@ports/core`, `@shared/types` minimum.
3. Add the alias to `tsconfig.base.json` paths: `@core/<context>` and
   `@core/<context>/*`.
4. Add the same alias to `apps/api/vitest.config.ts`.
5. Add the workspace dep to `apps/api/package.json`.
6. Run `pnpm install` to wire the workspace symlinks.
7. Append the context to the inventory table above with a one-line summary.
8. If the new context needs to import from a sibling context, **resolve via
   a port-adapter** — never a direct import. Define the port in `@ports/core`,
   the adapter in `apps/api/src/infrastructure/container/adapters/`. The
   `no-cross-bounded-context` depcruise rule blocks direct imports.

## How to extend

- **New port** for a new cross-context composition need: file in
  `packages/ports/src/<Name>Port.ts`, adapter in
  `apps/api/src/infrastructure/container/adapters/<Name>Adapter.ts`,
  consumer use case takes the port in its constructor.
- **New shared kernel** (only when ≥3 contexts share a model): create
  `packages/core/<kernel>/` and add it to the whitelist in
  `.dependency-cruiser.cjs` `no-cross-bounded-context` rule + this map.
- **Removing a context**: ensure zero importers (`grep -rln "@core/<ctx>"`
  before delete), remove the package, remove the alias from tsconfig +
  vitest config + apps/api/package.json, run `pnpm install`.

## Git history preservation

The contexts were extracted with `git mv` from
`packages/core/application/src/<context>/`. To see the full history of any
moved file, use `git log --follow <new-path>`.

## Related canon

- `docs/architecture/ARCHITECTURE_CANON.md` — Hexagonal + DDD + DI rules.
- `CLAUDE.md §Mandatory Pre-Action Triggers` — the `cross-bounded-context-import`
  tripwire in `pre_edit_tripwire_blocker.py` blocks the same pattern at write time.
- `.dependency-cruiser.cjs` — the `no-cross-bounded-context` rule blocks at
  CI / pre-commit time.
- `docs/architecture/NORMALIZATION_ROADMAP.md §5.1` — the workstream that
  performed the extraction.
