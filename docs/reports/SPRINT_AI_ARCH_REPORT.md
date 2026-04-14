# Sprint AI-ARCH Report — AI Service Architecture (Pool + BYOK + Rate Limiting)

**Date:** 2026-04-14
**Branch:** Genesis
**Commit:** 9fa868a

## Objective

Refactor the AI service layer to support BYOK (Bring Your Own Key), pool-based rate limiting with token tracking, and add the missing Anthropic provider. Eliminate the module-level singleton pattern.

## Deliverables

### New Files (3)

| File                                     | Lines | Purpose                                                              |
| ---------------------------------------- | ----- | -------------------------------------------------------------------- |
| `apps/api/src/ai/providers/anthropic.ts` | 226   | Anthropic Claude provider implementing AIProvider interface          |
| `apps/api/src/ai/AIProviderFactory.ts`   | 60    | Static factory creating providers from API keys with default configs |
| `apps/api/src/ai/AiRequestService.ts`    | 230   | Central service: BYOK/pool routing, rate limiting, token tracking    |

### Modified Files (7)

| File                                                     | Change                                                                              |
| -------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| `apps/api/src/ai/orchestrator.ts`                        | DI constructor, removed singleton, added token callback, deprecated createFromEnv() |
| `apps/api/src/ai/aiService.ts`                           | Inject AiRequestService, accountId in all methods, lazy admin orchestrator          |
| `apps/api/src/ai/routes.ts`                              | accountId added to all Zod schemas and handler calls                                |
| `apps/api/src/infrastructure/container/types.ts`         | +TOKENS.AiRequestService                                                            |
| `apps/api/src/infrastructure/container/setupServices.ts` | Register AiRequestService, change AIService to factory                              |
| `apps/api/package.json`                                  | +@anthropic-ai/sdk                                                                  |
| `pnpm-lock.yaml`                                         | Updated lockfile                                                                    |

## Architecture

### Before

```
Routes → AIService (singleton) → aiOrchestrator (singleton, env-based)
                                  └── OpenAI / Gemini / Perplexity (from process.env)
```

### After

```
Routes (pass accountId) → AIService (DI) → AiRequestService (DI)
                                            ├── BYOK path: getAccountCredential → AIProviderFactory → AIOrchestrator
                                            └── Pool path: checkRateLimit → getGroup("AI_POOL") → AIProviderFactory → AIOrchestrator
                                                └── trackUsage → AiTokenUsage table

Admin ops (health/metrics/cache) → AIService → lazy AIOrchestrator.createFromEnv()
```

## Key Changes

### 1. Singleton Removal

- `export const aiOrchestrator = new AIOrchestrator()` — **deleted**
- `export const aiService = new AIService()` — **deleted**
- Both now created via DI factory in setupServices.ts

### 2. AIOrchestrator Constructor

```typescript
// Before
constructor() { this.initializeProviders(); this.startMetricsCollection(); }

// After
constructor(
  providers: Map<string, AIProvider>,
  private readonly onTokensUsed?: (provider: string, tokens: number) => Promise<void>
)
```

### 3. Request Flow

1. Route extracts `accountId` from request body
2. AIService delegates to `AiRequestService.executeRequest({ accountId, task })`
3. AiRequestService checks BYOK via `PlatformCredentialService.getAccountCredential()`
4. If BYOK: creates per-request orchestrator with client's key, tracks `isByok=true`
5. If pool: checks rate limit (`providers × accounts × 10K tokens/month`), tracks `isByok=false`
6. Token usage always written to `AiTokenUsage` table (never throws)

### 4. Anthropic Provider

- Full AIProvider implementation using `@anthropic-ai/sdk`
- Default model: `claude-sonnet-4-6`
- All methods: generateText, analyzeContent, optimizeContent, predictPerformance, generateVariations
- No generateImage (Anthropic doesn't support it)

### 5. Backward Compatibility

- Routes without accountId fall back to env-based admin orchestrator
- `AIOrchestrator.createFromEnv()` kept as deprecated static factory
- All existing AI endpoints continue to work without accountId

## Verification

- TypeScript: 0 new errors (15 pre-existing in unrelated files)
- ESLint + Prettier: passed via pre-commit hooks
- 10 files committed, 921 lines added, 154 removed
