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

| Fase   | Nombre                    | Scope                                                                                                                                                                                                     | Complejidad | Status         |
| ------ | ------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------- | -------------- |
| **A0** | Scaffold roadmap          | Este doc. Sin mover use-cases.                                                                                                                                                                            | Baja        | DONE           |
| **A1** | Contextos hoja clean      | 35 archivos: glossary(−1), brand-voice, brand-kit, style-guide(−1), listening, usage, utm, first-comment, ml, embeddings, providers, channels, comments, crisis. Rewrite `../../domain/`→`@core/domain/`. | Baja        | DONE (f1891a0) |
| **A2** | Features standalone clean | links, notifications(−1), external-notifications, trends(−1), referral(−1), aiPromptTemplates, mentions (≈35)                                                                                             | Baja-media  | PENDING        |
| **A3** | Módulos de feature clean  | analytics, reports, recurring, tasks, team(−1), integrations(−1), crm (≈45)                                                                                                                               | Media       | PENDING        |
| **A4** | Features grandes clean    | campaigns, assets, custom-reports(−1), approvals, ai(−1) (≈45)                                                                                                                                            | Media-alta  | PENDING        |
| **A5** | Centrales clean           | posts(−3), inbox(−1), auth, customer-auth(−5), bulk-scheduling, webhooks, apiKeys(−1), billing, security(−1) (clean restantes)                                                                            | Alta        | PENDING        |
| **A6** | Bloqueados (refactor)     | Los 21 que importan infra: introducir/usar ports (Metrics/PasswordHasher/TokenService/Credential/logger/config/ai) + DI rewiring, luego mover. Mayor riesgo.                                              | Alta        | PENDING        |
| **A7** | Burn-down shims           | Migrar import-sites de application restantes → `@core/application`; borrar shims; (se une al P8 del dominio + flip dependency-cruiser a error).                                                           | Media       | PENDING        |

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
- Mover use-case verbatim (`cp`) preserva imports relativos (`../../domain/...` → resuelve a los shims @core; o
  `../UseCase.js` → `@core/application`). Confirmar con tsc tras cada batch.
- Barrels per-context (`application/<ctx>/index.ts`) usan re-export nombrado → resuelven vía shim, no se editan.
- A6 introduce ports + DI rewiring (Container.ts, setup\*.ts) → riesgo alto, plan propio detallado.
- `node:crypto`/`zod` en use-cases: aceptables en `@core/application`.
- Heap LXC: tsc 5120, vitest batches, commit 8192. Husky lint-staged OOM'ea con default → `NODE_OPTIONS=8192 git commit`.
