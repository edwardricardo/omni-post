# Application Migration Roadmap — `apps/api/src/application` → `packages/@core/application`

> **Qué es esto:** la guía **trackeable** para migrar la capa de aplicación (los use-cases de
> `apps/api/src/application/**`) a `packages/@core/application`, tras completar el dominio (Core Migration Roadmap
> P1–P7). Fases de tamaño parejo, no solapadas, en orden de complejidad. Cada fase se ejecuta con su **propio plan
> formal** generado usando este roadmap. **Este doc no ejecuta nada.** Mapa arquitectónico:
> [TARGET_ARCHITECTURE_CANON_ES.md](./TARGET_ARCHITECTURE_CANON_ES.md). Continúa
> [CORE_MIGRATION_ROADMAP_ES.md](./CORE_MIGRATION_ROADMAP_ES.md) (dominio, DONE).
>
> **Regla de oro (Edward): cero sorpresas a mitad de fase.** Por eso cada plan de fase enumera files+shims+import-sites+
> tests antes de ejecutar; los tests son **exhaustivos** (no representativos).

## 1. Principios (heredados del dominio)

- **Strangler fig:** mover el use-case a `@core/application` + dejar un **re-export shim** en la ruta vieja
  (`export * from "@core/application/…"`) → los consumidores (rutas, container, workers) siguen compilando sin tocar
  nada → import-sites se migran después → shims se borran en burn-down.
- **Clean-first, blocked-last:** los use-cases que solo dependen de `@core/domain` + `@shared` + `@ports` se mueven
  directo (strangler verbatim). Los que importan infra de `apps/api` se refactorizan a **inyección/ports** primero.
- **Boundary enforcement:** `dependency-cruiser` impide que `@core/application` importe de `apps/`/infra (regla a
  endurecer al cerrar el workstream).
- **Una fase = uno+ commits = checkpoint de rollback.** Aprobación de Edward al cierre de cada fase.

## 2. Análisis de closure (estado al abrir el workstream)

- **242 archivos** en `apps/api/src/application/**` (44 contextos + `UseCase.ts` ya en `@core`).
- **221 clean (≈91%):** solo `@core/domain` (vía shims) + `@shared` + `@ports` + `@core/application` (UseCase) + otros
  archivos de application. Movibles directo.
- **21 bloqueados (≈9%):** importan infra de `apps/api` (`config/env`, `auth/{passwordHashing,customerJwt}`,
  `metrics/*`, `lib/logger`, `security/PlatformCredentialService`, `ai/{structuredSchemas,aiService}`). Son violaciones
  de capa pre-existentes → refactor a ports/inyección antes de mover.

## 3. Fases (trackeable)

Status: `PENDING` · `IN-PROGRESS` · `DONE (<commit>)`. Conteos aproximados; cada plan de fase regenera el grep de
closure y fija la lista exacta.

| Fase      | Nombre                                                           | Scope                                                                                                                                                                                                                                                                                                                                                                                                                                             | Complejidad | Status         |
| --------- | ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------- | -------------- |
| **A0**    | Scaffold roadmap                                                 | Este doc. Sin mover use-cases.                                                                                                                                                                                                                                                                                                                                                                                                                    | Baja        | DONE           |
| **A1**    | Contextos hoja clean                                             | 35 archivos: glossary(−1), brand-voice, brand-kit, style-guide(−1), listening, usage, utm, first-comment, ml, embeddings, providers, channels, comments, crisis. Rewrite `../../domain/`→`@core/domain/`.                                                                                                                                                                                                                                         | Baja        | DONE (f1891a0) |
| **A2**    | Features standalone clean                                        | links(6), notifications(5), external-notifications(4), referral(2), aiPromptTemplates(5), mentions(1) = 23. `trends` entero → A6; `referral/GrantReferralReward` + `notifications/SendEmailNotificationService` + `referral/GetOrCreateReferralCode` → A6.                                                                                                                                                                                        | Baja-media  | DONE (edf0fca) |
| **A3**    | Módulos de feature clean                                         | analytics(7), reports(5), recurring(6), tasks(6), team(4), integrations(5), crm(6) = 39. Diferidos a A6: `reports/GenerateReport` (`@packages/api-common`), `recurring/CreatePostFromRecurrence` (depende de `posts/SchedulePost` bloqueado), `team/InviteTeamMember`, `integrations/GenerateIntegrationApiKey`.                                                                                                                                  | Media       | DONE (f07ec5a) |
| **A4**    | Features grandes clean                                           | campaigns(9), assets(9), custom-reports(9), approvals(9), ai(10), ai-image(1) = 47. `ai-image` absorbido en A4 (no estaba en la fila original). Diferidos a A6: `custom-reports/EnableReportSharing` (config/env), `ai/GenerateLocalizedContent` (config/env + infra ai), `ai-image/GenerateImage` (adapter AIService).                                                                                                                           | Media-alta  | DONE (088aa3d) |
| **A5**    | Centrales clean                                                  | posts(8), inbox(17), auth(9 SSO), bulk-scheduling(4), webhooks(2), billing(3), security(1) = 44. Diferidos a A6: posts/{CreatePost,DeletePost,SchedulePost} (metrics), inbox/{TriageInboxMessage,SendReply} (ai + GuardrailRegistry), customer-auth COMPLETO (6, incl. LogoutCustomer → TokenService port), bulk-scheduling/ProcessBulkScheduleRow (posts), apiKeys/ApiKeyUseCases (passwordHashing). `csv-parse` declarado en @core/application. | Alta        | DONE (0bf4422) |
| **A6.1**  | Config inyectada                                                 | glossary/UpsertGlossaryTerm, style-guide/UpsertStyleGuideRule, referral/GetOrCreateReferralCode, custom-reports/EnableReportSharing (4) → `env` reemplazado por valores inyectados (Primitive Dependencies). `SendEmailNotificationService` movido a A6.4 (también importa `emailTemplates.tsx`).                                                                                                                                                 | Baja        | DONE (82093b0) |
| **A6.2**  | Metrics ports (dos, ISP)                                         | `BusinessMetricsPort` (nuevo) para posts/{CreatePost,DeletePost,SchedulePost}; `GuardrailMetrics` relocado a @core para guardrails/GuardrailRegistry; + encadenados ProcessBulkScheduleRow, CreatePostFromRecurrence, inbox/SendReply (7).                                                                                                                                                                                                        | Baja-media  | DONE (8b4ec81) |
| **A6.3a** | AI structured-output specs                                       | inyectar spec + relocar 3 result types a @core: ai/GenerateLocalizedContent, inbox/TriageInboxMessage, trends/ScoreTrendRelevance + cadena trends (DetectTrends, DispatchDetectTrends, FetchTrendingTopics, GetTrendRadarQuery, TrendRadarResultPort) = 8.                                                                                                                                                                                        | Media       | DONE (de2feb3) |
| **A6.3b** | ai-image (ImageGenerationPort)                                   | ai-image/GenerateImage: `ImageGenerationPort` (Result, no AIResponse) + relocar ImageGenerationOptions/Result a @core + adapter AIService→port (1).                                                                                                                                                                                                                                                                                               | Media       | DONE (8c7a223) |
| **A6.4**  | Email templates → infra + `EmailPort` render                     | reubicar `referralRewardEmail.tsx` + `emailTemplates.tsx`; mover referral/GrantReferralReward + notifications/SendEmailNotificationService (2, consumidores de templates). Prereq de A6.6.                                                                                                                                                                                                                                                        | Media       | PENDING        |
| **A6.5**  | `PasswordHasher` port                                            | apiKeys/ApiKeyUseCases, integrations/GenerateIntegrationApiKey (2). Prereq de A6.6.                                                                                                                                                                                                                                                                                                                                                               | Media       | PENDING        |
| **A6.6**  | `TokenService` (jwt-algorithm canon) + `CredentialPort` + logger | customer-auth COMPLETO (6) + team/InviteTeamMember (7). Mayor riesgo.                                                                                                                                                                                                                                                                                                                                                                             | Alta        | PENDING        |
| **A6.7**  | CSV serialization + cerrar gap depcruise                         | reports/GenerateReport (1) + agregar `@packages/api-common` al rule `core-application-no-infrastructure` (cierra SMELL-40).                                                                                                                                                                                                                                                                                                                       | Baja        | PENDING        |
| **A7**    | Burn-down shims                                                  | Migrar import-sites de application restantes → `@core/application`; borrar shims; (se une al P8 del dominio + flip dependency-cruiser a error).                                                                                                                                                                                                                                                                                                   | Media       | PENDING        |

## 4. Los 21 bloqueados (fase A6)

`ai-image/GenerateImageUseCase` · `ai/GenerateLocalizedContentUseCase` · `apiKeys/ApiKeyUseCases` ·
`custom-reports/EnableReportSharingUseCase` · `customer-auth/{LoginCustomer,RefreshCustomerToken,RegisterCustomer,
RequestPasswordReset,ResetPassword}` · `glossary/UpsertGlossaryTermUseCase` · `guardrails/GuardrailRegistry` ·
`inbox/TriageInboxMessageUseCase` · `integrations/GenerateIntegrationApiKeyUseCase` ·
`notifications/SendEmailNotificationService` · `posts/{CreatePost,DeletePost,SchedulePost}UseCase` ·
`referral/GetOrCreateReferralCodeUseCase` · `style-guide/UpsertStyleGuideRuleUseCase` · `team/InviteTeamMemberUseCase` ·
`trends/ScoreTrendRelevanceUseCase`.

Concerns a abstraer (port + DI): `config/env` → config inyectada; `auth/{passwordHashing,customerJwt}` →
`PasswordHasher`/`TokenService` ports; `metrics/*` → `MetricsPort` (o quitar del use-case); `lib/logger` → logger
inyectado; `security/PlatformCredentialService` → port; `ai/{structuredSchemas,aiService}` → `AIServicePort`
(ya en `@core`) + reubicar schemas.

Bloqueos adicionales detectados durante A2/A3/A5 (no encajan en "importan infra" pero comparten la fase A6):

- **`trends` (contexto completo):** `ScoreTrendRelevanceUseCase` importa `config/env` + `ai`, y arrastra
  `DetectTrendsUseCase` ← `TrendRadarResultPort`. Mover parcial dejaría un tangle de shims intra-contexto, así que el
  contexto entero se mueve cuando A6 desbloquee `ScoreTrendRelevance`.
- **Cadena de template de email:** `referral/GrantReferralRewardUseCase` consume el template de presentación
  `notifications/referralRewardEmail.tsx`. Los 2 templates `.tsx` (`referralRewardEmail`, `emailTemplates`,
  `@react-email/components`) son **infraestructura/presentación** mal ubicados en `application/`; A6 los reubica a
  infraestructura, expone el render detrás de `EmailPort`, y recién entonces mueve `GrantReferralReward`,
  `SendEmailNotificationService`, `RegisterCustomer`, `InviteTeamMember` (los 4 consumidores del render).
- **`reports/GenerateReportUseCase` (serialización CSV):** importa `@packages/api-common` (`exportToCSV`,
  `ColumnDefinition`), clasificado `@layer infrastructure`. El use-case genera el CSV del reporte directamente —
  serialización de salida = concern de adapter/presentación. El rule `core-application-no-infrastructure` de
  dependency-cruiser **no atrapa** `@packages/api-common` (su `to.path` solo lista
  `prisma|fastify|ioredis|bullmq|next|@infra|@adapters`), así que el move solo lo bloquea el canon. A6 abstrae el CSV
  detrás de un port (o devuelve datos y mueve la serialización al delivery) y cierra el gap del regex.
- **`recurring/CreatePostFromRecurrenceUseCase` (encadenado a posts):** importa `../posts/SchedulePostUseCase`, que
  está bloqueado (importa `metrics/businessMetrics`). Se mueve junto a `SchedulePost` cuando A6 lo desbloquee.
- **`inbox/SendReplyUseCase` (encadenado a guardrails):** importa `../guardrails/GuardrailRegistry`, que está bloqueado.
  Se mueve cuando A6 desbloquee `GuardrailRegistry`.
- **`bulk-scheduling/ProcessBulkScheduleRowUseCase` (encadenado a posts):** importa `../posts/CreatePostUseCase` +
  `../posts/SchedulePostUseCase`, bloqueados (metrics). Se mueve junto a esos posts en A6.
- **`customer-auth` (contexto COMPLETO, decisión Edward):** 5 use-cases importan infra (`passwordHashing`,
  `customerJwt`, `config/env`, `PlatformCredentialService`, `lib/logger`, `emailTemplates.tsx`). El 6º,
  `LogoutCustomerUseCase`, solo usa `jwt.decode` (puro), pero se difiere con el contexto para introducir un
  TokenService port una sola vez y que `LogoutCustomer.decode()` pase por él en vez de `jsonwebtoken` crudo en el core.

### Sub-fases A6.1–A6.7 (descomposición por concern/port)

A6 se divide en 7 sub-fases, cada una con su **propio plan formal** (recon + lista exacta + tests exhaustivos). Cada
una: crear port (`@core/domain`/`@ports`) + adapter (infra) + token + registro en `Container.ts`/`setup*.ts` → refactor
de use-cases a inyección → mover a `@core/application` (cp + rewrite + shim) → gates → commit. Cobertura: 4+7+8+1+2+2+7+1
= **32** (todos los bloqueados; A6.1 ajustado 5→4 y A6.4 1→2 al pasar SendEmailNotificationService a A6.4; A6.3 dividido
en A6.3a (8) + A6.3b (1)).

| Sub-fase | Port/concern                                                                           | Archivos (n) | Dependencias                            |
| -------- | -------------------------------------------------------------------------------------- | ------------ | --------------------------------------- |
| A6.1     | config inyectada (reemplaza `env`) — DONE (82093b0)                                    | 4            | independiente                           |
| A6.2     | metrics ports (BusinessMetricsPort nuevo + GuardrailMetrics relocado) — DONE (8b4ec81) | 7            | independiente                           |
| A6.3a    | AI structured-output specs (inyectar spec + relocar result types) — DONE (de2feb3)     | 8            | A6.1 (GenerateLocalizedContent usa env) |
| A6.3b    | ai-image — `ImageGenerationPort` nuevo + tipos imagen — DONE (8c7a223)                 | 1            | independiente                           |
| A6.4     | email templates `.tsx` → infra + `EmailPort` render                                    | 2 (+2 tpl)   | prereq de A6.6                          |
| A6.5     | `PasswordHasher` port (Argon2id ya canónico)                                           | 2            | prereq de A6.6                          |
| A6.6     | `TokenService` (jwt-algorithm canon) + `CredentialPort` + logger                       | 7            | A6.4 + A6.5                             |
| A6.7     | CSV serialization + cerrar gap depcruise (SMELL-40)                                    | 1            | independiente                           |

**Orden:** A6.1 → A6.2 → A6.3 → A6.4 → A6.5 → A6.6 → A6.7 (fácil→difícil; el cluster de auth de mayor riesgo va al
final con sus prereqs A6.4/A6.5 listos). **Canon research obligatorio antes de A6.6:** jwt-algorithm (RFC 8725 BCP)
para el `TokenService` port.

**Notas de recon:** los 3 use-cases de ai (GenerateLocalizedContent, TriageInboxMessage, ScoreTrendRelevance) **ya
inyectan `AIServicePort`** — su blocker es solo `AIMessage` (ya en `@core/domain/ai/AiServiceContract`) + los specs de
`structuredSchemas`. `ai-image/GenerateImage` inyecta el `AIService` concreto y llama `generateImage()` (método ausente
en `AIServicePort` → extenderlo). `posts/*` llaman `incrementPost*()` **estático** → MetricsPort es port nuevo +
inyección. `PlatformCredentialService`: confirmar ubicación exacta en el plan de A6.6.

## 5. Template de plan por fase (OBLIGATORIO — anti-sorpresa)

1. Regenerar el grep de closure contra el estado real; fijar la lista EXACTA de use-cases de la fase (clean only).
2. Lista de shims (ruta vieja → `export * from "@core/application/…"`).
3. Import-sites a actualizar con conteo real (solo en burn-down A7).
4. Tests **exhaustivos** afectados (grep-driven, batches memory-safe).
5. Gates (§6) + checkpoint de rollback (commit propio).

## 6. Gates por fase (idénticos al dominio)

`tsc --noEmit` 0 en **apps/api + apps/workers** (heap 5120) · `eslint`/`prettier` 0 (tocados) · fitness
**#1/#8/#9/#10/#21** 0 · boundary gate `depcruise apps/api/src packages/core packages/shared` limpio · tests afectados
verdes (exhaustivo, per-file/batches) · commit propio inglés, sin Co-Authored-By, heap-bump 8192 · **aprobación de
Edward al cierre de la fase**.

## 7. Gotchas (heredados + propios de application)

- `@core/application` puede importar `@core/domain` + `@ports` + `@shared`; **NO** infra de apps/api (de ahí los 21).
- Mover use-case = `cp` + **rewrite obligatorio** de los imports a dominio: `(\.\./)+domain/` → `@core/domain/`.
  Razón: `@core/application` y `@core/domain` son paquetes distintos, así que la ruta relativa `../../domain/...`
  ya no resuelve tras el `cp` (apuntaría a `packages/core/application/domain`, que no existe). Lo que **sí** se
  preserva sin tocar: `../UseCase.js` (resuelve a `@core/application/src/UseCase.ts`), los imports intra-contexto
  (`./`), los cross-contexto dentro de la misma fase (`../<otro-ctx>/`) y los aliases `@shared`/`@ports`. Confirmar
  con tsc tras cada batch.
- Barrels per-context (`application/<ctx>/index.ts`) usan re-export nombrado → resuelven vía shim, no se editan.
- A6 introduce ports + DI rewiring (Container.ts, setup\*.ts) → riesgo alto, plan propio detallado.
- `node:crypto`/`zod` en use-cases: aceptables en `@core/application`.
- Heap LXC: tsc 5120, vitest batches, commit 8192. Husky lint-staged OOM'ea con default → `NODE_OPTIONS=8192 git commit`.
