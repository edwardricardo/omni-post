# Proposal: Guarded Client Injection in API Composition Modules (tenant-guard Slice 6a, N-SEC-3)

## Intent

Layer-1 tenant isolation (Prisma `$extends` tenantGuard) is registered as `TOKENS.PrismaClient` in `setup.ts:61-64` and resolved correctly 41x by `setupRepositories` — but 12 container setup modules plus the `index.ts` bootstrap adapter construct repositories/adapters with the RAW `@infra/prisma` singleton, bypassing the guard for their request-scope routes and the in-process TRIAGE_INBOX / TREND_RADAR consumers. Isolation there rests only on hand-written `where: { accountId }` clauses (CWE-639 exposure). Fitness #21 is blind to this: it gates where the singleton is IMPORTED (composition root excepted), not whether the INJECTED client is guarded. This slice closes the injection gap mechanically and adds a fitness function so it cannot regress.

## Scope

### In Scope

1. Swap raw `prisma` → `container.resolve<PrismaClient>(TOKENS.PrismaClient)` in the 12 modules below.
2. `apps/api/src/index.ts:301`: pass the guarded client to `createPrismaRepoAdapter` (feeds `tenantHealthMonitor`).
3. New fitness function #28 (two-part, hard-zero) gating raw-client injection.
4. Doc-drift fix: `PrismaUnitOfWork.ts:71` says "the 51 tenant-scoped tables" — stale (guard Set = 57 models; RLS policies now cover 58 tables = 51 in the base migration + 7 slice migrations). Replace with count-free wording.
5. Add-on integration test: assert the guard extension is inherited by `$transaction` interactive-tx clients (`PrismaUnitOfWork.ts:68-90`) — converts a documented assumption into a verified invariant.

### Verified module inventory (all under `apps/api/src/infrastructure/container/`)

| Module                                  | Models touched (V = in TENANT_SCOPED_MODELS)                                                                |
| --------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| setupInboxUseCases                      | trackedTerm V, socialMessage V, crmContact V                                                                |
| setupTrendUseCases                      | brandVoice V, trendRadarResult V, socialMessage V, channel (Slice 7), analyticsDailySummary, post (Slice 8) |
| setupCrmUseCases                        | crmConnection V, crmContact V, crmActivity V, crmSyncLog                                                    |
| setupAssetUseCases                      | mediaAsset V, assetTag V, assetFolder V                                                                     |
| setupBrandVoiceUseCases                 | brandVoice V                                                                                                |
| setupBrandKitUseCases                   | brandKit V                                                                                                  |
| setupSamlUseCases                       | samlConfiguration V                                                                                         |
| setupWebhookAdminUseCases               | webhookSubscription V                                                                                       |
| setupLocalizedGenerationUseCases        | glossary V, styleGuideRule V (+ audited raw pgvector paths — see Risks)                                     |
| setupCustomReportUseCases               | customReport V                                                                                              |
| setupReferralUseCases                   | referral, referralCode V, accountSubscription V                                                             |
| setupSecretsRotationUseCases            | secretRotationLog                                                                                           |
| `apps/api/src/index.ts:301` (bootstrap) | project V + publish logs, via `createPrismaRepoAdapter` → tenantHealthMonitor                               |

Unenrolled models pass through the guard unchanged — no behavior change on those.

### Call-order verification (linchpin — VERIFIED)

`setupContainer` (`setup.ts:52`) registers the guarded client eagerly via `registerInstance(TOKENS.PrismaClient, guardedPrisma)` at `setup.ts:64` BEFORE calling `setupUseCases(container)` at `setup.ts:89`; all 12 modules are invoked synchronously inside `setupUseCases` (`setupUseCases.ts:48-77`). `index.ts:301` executes after `setupContainer` returns (`index.ts:306` already resolves from the container). `resolve(TOKENS.PrismaClient)` is therefore safe at every swap site — the change is mechanical.

### Out of Scope (deferred)

- **6b** — `withSystemContext` wraps for the 8 background surfaces (saga sweeps, gateway-switch, integration-event relay, data-retention, auto-renewal, inbox-sync, repurpose, bulk-schedule).
- **6c** — `apps/workers` deployable guard enrollment + mention cross-tenant dedup fix + composite-unique migration (BLOCKED on the mention-uniqueness product decision).
- RLS FORCE + `omnipost_app` role provisioning — own infra ADR.
- SMELL-55 sibling routes — blocked on delete-gate merge.
- Channel (Slice 7) and Post (Slice 8) guard enrollment.

## Capabilities

### New Capabilities

- None

### Modified Capabilities

- `multi-tenant-isolation`: new requirement — the guarded client (`TOKENS.PrismaClient`) MUST be the only Prisma client injected into repositories/adapters in the api deployable; raw-singleton injection is a fitness-gated violation (#28).

## Approach

Per module: drop `import { prisma } from "@infra/prisma"`, resolve `const guardedPrisma = container.resolve<PrismaClient>(TOKENS.PrismaClient)` at the top of the setup function, pass it to the constructors. Convention: never name the resolved local `prisma` — the fitness gate keys on that identifier. In `index.ts`, pass the container-resolved client into `createPrismaRepoAdapter`. One-line UoW comment fix. New integration test (needs `pnpm db:up`) asserting a guarded-model query inside `executeInTransaction` is tenant-scoped/fail-closed, proving extension inheritance on itx clients.

### Fitness #28 spec (hard-zero; mirror verbatim in `.github/workflows/fitness.yml`)

Part A — container modules never value-import the raw singleton (line-anchored, so `setup.ts`'s JSDoc example does not match):

```bash
grep -rnE '^import \{[^}]*\bprisma\b[^}]*\} from "@infra/prisma"' \
  apps/api/src/infrastructure/container --include="*.ts" | wc -l   # expect 0
```

Baseline today: 12. After fix: 0.

Part B — no bare `prisma` identifier passed to a constructor/factory in `apps/api/src` (JSDoc `@example` lines and tests excluded, same comment filter as #3):

```bash
grep -rnE '(new [A-Z]\w+\(|createPrismaRepoAdapter\(\{)\s*prisma\s*[,)}]' \
  apps/api/src --include="*.ts" | \
  grep -vE "/tests/|\.test\.|^[^:]+:[0-9]+:\s*\*" | wc -l   # expect 0
```

Baseline today: 19 injection sites (18 constructor args + 1 factory shorthand). After fix: 0 — hard-zero provable at merge.

Fitness interaction: closes the loophole in **#21** (gates injection, not import location); **#23** raw-pgvector exceptions unchanged; **#1** unchanged.

## Affected Areas

| Area                                                         | Impact   | Description                                 |
| ------------------------------------------------------------ | -------- | ------------------------------------------- |
| 12 `setup*UseCases.ts` modules                               | Modified | ~4 lines each: import swap + resolve        |
| `apps/api/src/index.ts`                                      | Modified | bootstrap adapter receives guarded client   |
| `apps/api/src/infrastructure/unitofwork/PrismaUnitOfWork.ts` | Modified | 1-line comment fix (:71)                    |
| `CLAUDE.md` + `.github/workflows/fitness.yml`                | Modified | new fitness #28 (doc + CI, identical regex) |
| `apps/api/tests/integration/`                                | New      | itx guard-inheritance test                  |

Estimated < 200 changed lines.

## Risks

| Risk                                                                                                                                                | Likelihood | Mitigation                                                                                                                                                                                                                                                                                              |
| --------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/health/tenant/:tenantId/project/:projectId` route (`index.ts:704`) may run without tenant context → guarded `project.findMany` fails closed (500) | Med        | Verify at apply whether tenant middleware binds context for this route. If context-less, wrap the monitor calls in `withSystemContext()` (the canon-sanctioned path) in the same PR. Note: today the route takes tenantId from URL params (IDOR-shaped); fail-closed is the security-correct direction. |
| TRIAGE_INBOX / TREND_RADAR in-process consumers may process jobs without bound tenant context → fail-closed errors on enrolled models               | Med        | Verification task before merge: confirm each consumer binds tenant context from the job payload; if one lacks it, add the context bind in this PR or hold that single module for 6b.                                                                                                                    |
| pgvector `$queryRaw`/`$executeRaw` paths (Glossary, StyleGuideRule)                                                                                 | Low        | Unaffected: `$extends` query components hook only the typed API; raw passes through. Both audited (S2.1d) with `accountId` AND-clauses; fitness #23 exceptions unchanged.                                                                                                                               |
| Type friction from the `$extends` cast                                                                                                              | Low        | Guarded client is already cast `as unknown as PrismaClient` (`setup.ts:63`) and consumed 41x by `setupRepositories` — proven pattern.                                                                                                                                                                   |

## Rollback Plan

Single atomic PR, no migrations, no schema or data changes. Revert the PR commit → prior raw-injection behavior restored. Fitness #28 ships in the same PR, so a revert also removes the gate (no orphaned red CI).

## Dependencies

- Branch `workstream/cluster-c-guarded-injection-6a` stacked off `9ab0ac26` (current HEAD). No external dependencies; not blocked on the product decisions gating 6c.

## Success Criteria

- [ ] All 13 injection sites (12 modules + bootstrap) receive `TOKENS.PrismaClient`; zero value-imports of raw `prisma` under `container/`.
- [ ] Fitness #28 Parts A + B count = 0, wired in CLAUDE.md and `fitness.yml` with identical regexes.
- [ ] `PrismaUnitOfWork.ts` comment is count-free (no stale "51").
- [ ] New itx guard-inheritance integration test green.
- [ ] Full gate at 0/0: lint (`--max-warnings 0`), tsc, all fitness functions (now 28), LXC-safe test runs.
