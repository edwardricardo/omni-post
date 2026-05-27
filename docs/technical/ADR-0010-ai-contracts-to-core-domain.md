# ADR-0010: Promote AI contracts (`AIProvider`, `AITask`, `AIResponse`) to `@core/domain/ai/`

- **Status**: Accepted
- **Date**: 2026-05-27
- **Deciders**: Platform engineering
- **Supersedes**: —
- **Superseded by**: —

## Context

Until S4.3 the technology-free AI contracts lived in
`apps/api/src/ai/types.ts` (`@layer infrastructure`). The same module
held two distinct kinds of types:

1. **Domain contracts** (`AIProvider` interface, `AITask` discriminated
   union, `AIResponse<T>` envelope, `ContentAnalysis`,
   `ContentOptimization`, `PerformancePrediction`). These are pure
   shapes — no SDK, no Fastify, no runtime dependency.
2. **Infrastructure config** (`AIProviderConfig`, `RateLimitConfig`,
   `AITaskConfig`, `AIUsageMetrics`). Real infra concerns (timeouts,
   API keys, rate limits) used only inside concrete provider
   adapters.

`AiRequestService` lived in `apps/api/src/ai/AiRequestService.ts` and
imported `AITask`/`AIResponse`/`AIProvider` from this mixed `types.ts`
file. The S4.3 goal was to relocate `AiRequestService` to
`@core/application/ai/` (canon: application services live in
`@core/application/`). Two blockers:

1. **AI contracts in infra-flavored `types.ts` blocked the move.**
   Application code in `@core/application` cannot import from
   `apps/api/src/ai/types.ts` (depcruise rule
   `core-application-no-infrastructure`).
2. **Type-safety vs port abstraction trade-off.** Options were:
   - (a) **Promote AI types to `@core/domain/ai/`** — preserves type
     safety, makes the move clean.
   - (b) **Opaque port boundary** — `AIRequestExecutorPort` accepts
     `task: unknown` and returns `{value: unknown, …}`. Faster
     refactor but loses type safety.

We chose (a). The cost was higher (touch the 10+ files that consume
`types.ts`), but the canon outcome is cleaner.

## Decision

**Promote the technology-free AI contracts to
`packages/core/domain/src/ai/AIContracts.ts`. Leave infra-only types
(`AIProviderConfig`, `RateLimitConfig`, `AITaskConfig`,
`AIUsageMetrics`) in `apps/api/src/ai/types.ts`. The infra
`types.ts` becomes a thin re-export shim for the domain types +
container of the infra-only configs.**

### NEW `packages/core/domain/src/ai/AIContracts.ts`

- `AIProvider` (port — interface every SDK adapter implements)
- `AIProviderName` (`"openai" | "anthropic" | "perplexity" | "gemini"`)
- `AITask` (discriminated union: generate | analyze | optimize | predict | variations)
- `AIResponse<T>` (envelope: ok / value / error / metadata)
- `ContentAnalysis`, `ContentOptimization`, `PerformancePrediction`
  (analysis DTOs)

### NEW `packages/core/domain/src/repositories/AIRequestExecutorPort.ts`

Wraps the orchestrator + provider-factory complexity behind a port:

- `executeWithApiKey(provider, apiKey, task, onUsage)` — BYOK path
- `executeWithPool(poolCredentials, preferred?, task, onUsage)` —
  pool path with fallback chain

Both fire the `onUsage` callback so token-usage tracking stays in
the application service (not in the adapter).

### NEW `apps/api/src/ai/AIRequestExecutorAdapter.ts`

Concrete adapter wrapping the existing `AIProviderFactory` +
`AIOrchestrator` + `BackgroundTaskScheduler` + `CachePort` behind
the port.

### `apps/api/src/ai/types.ts` (post-promotion)

Kept as a re-export shim:

```typescript
import type { AIProvider, AITask, AIResponse, … } from "@core/domain/ai/AIContracts.js";
export type { AIProvider, AITask, AIResponse, … };

// Infra-only types stay here:
export interface AIProviderConfig { … }
export interface RateLimitConfig { … }
export interface AITaskConfig { … }
export interface AIUsageMetrics { … }
```

The 10+ existing consumers (`orchestrator.ts`, `providers/*.ts`,
`AIProviderFactory.ts`, `structuredSchemas.ts`, `aiService.ts`)
keep resolving without churn.

## Rationale

1. **Application services in `@core/application/ai/` use canonical
   types.** `AiRequestService` (relocated to
   `packages/core/application/src/ai/AiRequestService.ts`) imports
   `AIProviderName`, `AITask`, `AIResponse` directly from
   `@core/domain/ai/AIContracts.js`. No layer violation.
2. **Type safety preserved.** Option (b) (opaque port with
   `task: unknown`) would have lost the discriminated-union switch
   pattern that's central to executing AI tasks.
3. **Infra config stays where it belongs.** `AIProviderConfig`
   carries `baseUrl`, `timeout`, `retries` — those are infra
   concerns. They stay in `apps/api/src/ai/types.ts` because the
   provider adapters need them, not the domain.
4. **Re-export shim avoids the 10-file churn.** Existing
   infrastructure files (`orchestrator.ts`, `providers/*.ts`, etc.)
   keep importing from `"./types.js"` — no behavioral change.
   When/if they're rewritten, they can switch to direct
   `@core/domain/ai/AIContracts.js` imports incrementally.

## Alternatives Considered

- **Opaque `AIRequestExecutorPort` with `task: unknown`.**
  Rejected — would lose the discriminated-union dispatch pattern
  inside `AiRequestService` and force runtime type guards.
- **Move BOTH domain contracts AND infra config to `@core/domain`.**
  Rejected: infra config has runtime dependencies (env vars, SDK-
  specific defaults) that don't belong in pure domain.
- **Move `AiRequestService` to `@core/application` but leave AI
  contracts in apps/api with a re-export from `@core`.**
  Rejected: inverts the natural dependency direction
  (domain shouldn't re-export from infrastructure).

## Consequences

**Positive**

- `AiRequestService` lives in `@core/application/ai/` with proper
  canonical layer (S4.3 commit `262faaf`).
- Type safety preserved end-to-end (no `unknown` casts in the use
  case).
- Infra config (`AIProviderConfig`, etc.) stays close to the
  provider adapters that consume it.
- Re-export shim in `apps/api/src/ai/types.ts` keeps the 10+
  existing consumers unchanged.

**Negative / costs**

- The re-export shim is a back-compat layer; ideally consumers
  migrate to direct `@core/domain/ai/AIContracts.js` imports over
  time. Tracked informally; no current pressure to burn-down.
- Domain layer now has a sub-folder (`@core/domain/ai/`) parallel
  to `@core/domain/repositories/`. Acceptable: AI contracts are
  pure shapes, not "repositories"; the sub-folder reflects that.

## Revisit if

If a future AI provider adapter requires runtime capabilities not
expressible via the current `AIProvider` interface (e.g., streaming
generators that don't fit `Promise<string>`), we extend
`AIProvider` in `@core/domain/ai/AIContracts.ts`. The provider
adapters in `apps/api/src/ai/providers/*` adopt the extension. No
ADR rev needed unless the shape changes radically.

## Risks and Mitigations

| Risk                                                                      | Mitigation                                                                                                                                             |
| ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Re-export shim diverges from `@core/domain` over time                     | `apps/api/src/ai/types.ts` does NOT redefine the domain types — it `export type { … }`-s them from `@core/domain/ai/AIContracts.js`. Drift impossible. |
| New AI types added to wrong location (infra-only in domain or vice versa) | Code review heuristic: a type with `baseUrl`/`timeout`/`apiKey` is infra; a type with only shape (no I/O) is domain.                                   |
| Burn-down of `types.ts` re-export shim breaks 10 files                    | Same approach as the `Permission` shim (ADR-0009): sed-batch + delete in one commit. Low risk, mechanical.                                             |
| `AIRequestExecutorPort` surface insufficient for future AI flows          | Port is hexagonal — extensions add new methods without breaking existing consumers (TS structural typing).                                             |

## References

- S4.3 commit `262faaf` — AI contracts promotion + `AiRequestService`
  relocation
- ADR-0001 — Agent orchestration (sibling: `AIServicePort` for
  agentic flows)
- OmniPost `docs/architecture/NORMALIZATION_ROADMAP.md §0.1`
- File: `packages/core/domain/src/ai/AIContracts.ts`
- File: `packages/core/domain/src/repositories/AIRequestExecutorPort.ts`
- File: `apps/api/src/ai/AIRequestExecutorAdapter.ts`
- File: `packages/core/application/src/ai/AiRequestService.ts`
