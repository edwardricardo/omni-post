# Design: Guarded Client Injection in API Composition Modules (Slice 6a)

## Technical Approach

Mechanical DI rewiring: the 12 container setup modules and the `index.ts` bootstrap adapter stop value-importing the raw `@infra/prisma` singleton and instead resolve the guarded client already registered at `setup.ts:64`. Registration order is verified safe: `registerInstance(TOKENS.PrismaClient, guardedPrisma)` (`setup.ts:64`) runs before `setupUseCases(container)` (`setup.ts:89`), and `index.ts:301` runs after `setupContainer` returns (`index.ts:261`). Four out-of-context surfaces get `withSystemContext` wraps in the same PR so no swapped path fails closed. Fitness #28 locks the invariant.

## Architecture Decisions

| #   | Decision                 | Choice                                                                                                                                                                 | Rejected alternative                                                            | Rationale                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| --- | ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D1  | Swap shape               | `const guardedPrisma = container.resolve<PrismaClient>(TOKENS.PrismaClient);` at the top of each setup function; raw import replaced by `import type { PrismaClient }` | Pass the client as a parameter from `setupUseCases`                             | All 12 modules already receive `container: Container` (verified); a param change touches every caller signature for zero gain. Type-only import is #21/#28-safe (`setup.ts:7` precedent).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| D2  | Wrap placement           | `withSystemContext` at the bootstrap/callback boundary in `index.ts` — 5 call sites (see Interfaces)                                                                   | `withTenantContext({ accountId: job.payload.accountId })` for the two consumers | Spec requirement 2 mandates `withSystemContext` uniformly for the named surfaces. The tenant-bind alternative is strictly narrower (payloads carry `accountId`, `index.ts:1027`/`:1045`) — recorded as a 6b refinement when job-context binding is standardized across all background surfaces.                                                                                                                                                                                                                                                                                                                                                                                             |
| D3  | Fitness #28 Part B scope | `apps/api/src/infrastructure/container` + `apps/api/src/index.ts` only                                                                                                 | Proposal's `apps/api/src`-wide scope                                            | Repo-wide, the regex matches 15 already-guarded locals named `prisma` resolved from the container (e.g. `schedulingClientRoutes.ts:18`, `trendRoutes.ts:348`) — false positives that never reach 0 without unrelated renames. #21 (hard-zero) already confines the raw singleton to composition roots, so raw injection can only originate there; gating at the origin is sufficient and precise. Verified baseline in the narrowed scope: **30** (29 container constructor args + 1 `index.ts:301` factory) — the proposal's 19 was an undercount; the fix list (12 modules + bootstrap) is unchanged. Regex strengthened with `\(\{?` to also catch single-line options-object injection. |
| D4  | Sensitive-edit split     | `CLAUDE.md` + `.github/workflows/fitness.yml` are [SENSITIVE — orchestrator]; all other files [apply-agent]                                                            | —                                                                               | Tripwire/sensitive-path policy; identical-regex mirroring between doc and workflow is the failure mode to protect.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| D5  | Two-tenant test module   | Asset (`setupAssetUseCases` / `assetRoutes`) via HTTP `app.inject`                                                                                                     | Brand-voice                                                                     | Asset reads are projectId-shaped — matches the spec scenario ("carrying B's `projectId`"); brand-voice is account-singleton-shaped. Harness mirrored from `generatedImageTenantIsolation.test.ts` (minimal Fastify + test Container + real routes + real customer JWT — LXC-safe, no full boot).                                                                                                                                                                                                                                                                                                                                                                                            |
| D6  | Doc drift                | Count-free wording at `PrismaUnitOfWork.ts:71` AND `tenantContext.ts:6` (same stale "51")                                                                              | Fix only :71                                                                    | Same drift class, one line each; spec's static scenario checks :71, the second fix fulfills its intent.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |

**Residual raw egress in `index.ts` (documented, out of scope):** `:261` `setupContainer({ prisma })` — the guard's own input, by design; `:442` ipAllowlist (`securitySettings`, not enrolled); `:466` CSRF (`adminSession`, not enrolled); `:635` EventService (`storedEvent`, global, #23-audited); `:681` SagaIntegration — **`sagaInstance` IS enrolled**; swapping it requires the 6b saga-sweep wraps, explicitly deferred. None match #28 Part B shapes (lowercase factories / multi-line options objects).

## Data Flow

    Before: setup*UseCases ──(raw prisma import)──→ repos/adapters → DB (hand-written accountId only)
    After:  setup.ts:64 registers guardedPrisma → setup*UseCases resolve(TOKENS.PrismaClient)
            → repos/adapters → tenantGuard $extends → DB (guard-injected accountId; RLS layer 2 in UoW)
            Out-of-context surfaces (health route, 2 consumers, 2 dispatch callbacks)
            → withSystemContext(reason) → guard bypass + audit event

## File Changes

| File                                                           | Action | Description                                                                           |
| -------------------------------------------------------------- | ------ | ------------------------------------------------------------------------------------- |
| 12 `setup*UseCases.ts` (inventory in proposal)                 | Modify | Import swap + `guardedPrisma` resolve (~4 lines each)                                 |
| `apps/api/src/index.ts`                                        | Modify | `:301` → `{ prisma: guardedPrisma }`; 5 `withSystemContext` wraps                     |
| `apps/api/src/infrastructure/unitofwork/PrismaUnitOfWork.ts`   | Modify | `:71` count-free comment                                                              |
| `apps/api/src/security/tenantContext.ts`                       | Modify | `:6` count-free comment                                                               |
| `CLAUDE.md` + `.github/workflows/fitness.yml`                  | Modify | Fitness #28 (identical regexes) [SENSITIVE — orchestrator]                            |
| `apps/api/tests/integration/tenantGuardItxInheritance.test.ts` | Create | itx guard-inheritance test                                                            |
| `apps/api/tests/integration/assetTenantIsolation.test.ts`      | Create | Two-tenant HTTP test, previously-raw module                                           |
| `apps/api/scripts/run-tests.sh`                                | Modify | Append both tests to `integration:tenant-isolation` batch (`:169-177`, CONCURRENCY=1) |

## Interfaces / Contracts

Fitness #28 (mirror verbatim in `fitness.yml`):

```bash
# Part A — container modules never value-import the raw singleton. Baseline 12 → 0.
grep -rnE '^import \{[^}]*\bprisma\b[^}]*\} from "@infra/prisma"' \
  apps/api/src/infrastructure/container --include="*.ts" | wc -l   # expect 0

# Part B — no bare `prisma` identifier injected into a constructor/factory at the
# composition roots (the only places #21 lets the raw singleton exist). JSDoc
# excluded (Container.ts:21 example). Baseline 30 → 0.
grep -rnE '(new [A-Z]\w+\(\{?|createPrismaRepoAdapter\(\{)\s*prisma\s*[,)}]' \
  apps/api/src/infrastructure/container apps/api/src/index.ts --include="*.ts" | \
  grep -vE '^[^:]+:[0-9]+:\s*\*' | wc -l   # expect 0
```

`guardedPrisma` never matches (`\s*prisma` requires the bare identifier; `prisma:` property form excluded by `[,)}]`).

Wraps (reasons follow `tenantContext.ts` `system:*` convention):

| Site                                      | Wrap                                                                                                                                                                                                                                   |
| ----------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `index.ts:714` health route               | `withSystemContext("system:tenant-health-monitor", () => tenantHealthMonitor.getTenantHealth(tenantId, projectId))` — wraps the call only; `verifyProjectAccess` (`tenantHealth.ts:264`, explicit ownership check) stays intact inside |
| `index.ts:906` mention-search-dispatch    | wrap `dispatchMentionSearch.execute({})`                                                                                                                                                                                               |
| `index.ts:916` mention-reconcile-dispatch | same use case — same wrap (design catch: missing it leaves fail-closed)                                                                                                                                                                |
| `index.ts:1024` TRIAGE_INBOX subscribe    | wrap `processTriageInboxJob(...)`, reason `system:triage-inbox-consumer`                                                                                                                                                               |
| `index.ts:1042` TREND_RADAR subscribe     | wrap `processTrendRadarJob(...)`, reason `system:trend-radar-consumer`                                                                                                                                                                 |

## Testing Strategy

| Layer        | What                                                                                                                               | Approach                                                                                                                        |
| ------------ | ---------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| Static (RED) | #28 Parts A/B baselines 12/30 → 0; no stale "51"                                                                                   | Fitness greps, doc + CI                                                                                                         |
| Integration  | itx inheritance: guarded-model read/write inside `executeInTransaction` is tenant-scoped; no context → `TenantContextMissingError` | node:test; harness mirrors `projectMemberTenantIsolation.test.ts` (production-identical `$extends` client + `PrismaUnitOfWork`) |
| Integration  | A lists assets with B's `projectId` → 200 + `[]`, non-vacuous; no-context guarded query rejected                                   | node:test + `app.inject`; harness mirrors `generatedImageTenantIsolation.test.ts`                                               |
| Gate         | 0/0 full gate                                                                                                                      | lint, tsc, all 28 fitness, LXC-safe test batches                                                                                |

## Threat Matrix

N/A — no routing, shell, subprocess, VCS/PR automation, executable-file classification, or process-integration boundary. The only shell surface is two read-only `grep | wc -l` pipelines appended to the existing fitness workflow, identical in execution model to the 27 existing checks.

## Migration / Rollout

No migration, no schema/data change. Single revert restores raw injection; #28 ships in the same PR so a revert removes the gate (no orphaned red CI).

## Open Questions

- [ ] None blocking. For 6b: consider `withTenantContext` from job payload for per-tenant consumers (narrower than system bypass), and the `sagaInstance` raw egress at `index.ts:681`.
