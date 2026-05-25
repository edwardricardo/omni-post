# Core Migration Roadmap — `apps/api` core → `packages/@core`

> **Qué es esto:** la guía **trackeable** para migrar el core de aplicación (`apps/api/src/domain` +
> `apps/api/src/application`) a `packages/@core`, en **fases de tamaño parejo, no solapadas, en orden de
> complejidad**. Cada fase se ejecuta con su **propio plan formal** generado usando este roadmap. **Este doc no
> ejecuta nada.** Mapa arquitectónico objetivo: [TARGET_ARCHITECTURE_CANON_ES.md](./TARGET_ARCHITECTURE_CANON_ES.md).
> Fuentes canónicas: `canon_research_index.md` §"Hexagonal monorepo".
>
> **Regla de oro (Edward): cero sorpresas a mitad de fase.** Por eso: (a) el §Apéndice bound-ea el scope a nivel
> archivo; (b) el §Template de plan por fase **obliga** a enumerar files+shims+import-sites+tests antes de ejecutar;
> (c) el §Gotchas lista las trampas conocidas del maratón prisma→DI.

## 1. Principios

- **Strangler fig (Fowler):** mover un archivo a `@core` + dejar un **re-export shim** en la ruta vieja
  (`export * from "@core/…"`) → los consumidores siguen compilando sin tocar nada → se migran sus imports por fases →
  el shim se borra en la fase de burn-down. Convierte "cambiar N import-sites de golpe" en "mover 1 file + 1 shim".
- **Kernel-first:** lo que importa ~todo el repo (UnitOfWork, EntityId, DomainError, DomainEvent) se mueve primero,
  con shims, para no bloquear nada.
- **Composition root por ejecutable** (Seemann): `apps/api`/`apps/workers` quedan delgados; el core es compartido.
- **Boundary enforcement** (no por convención): `dependency-cruiser` impide que `@core` importe de `apps/`/infra.
- **Una fase = un commit = un checkpoint de rollback.** Aprobación de Edward al cierre de cada fase.

## 2. Fases (trackeable)

Status: `PENDING` · `IN-PROGRESS` · `DONE (<commit>)`. Las fases de contexto **P3–P7 no se bloquean entre sí** (solo
dependen de P1+P2 vía shims) → orden por complejidad, no por dependencia.

| Fase   | Nombre                      | Scope                                                                                                                                                                                                                                                                                                | Complejidad | Depends-on | Status                         |
| ------ | --------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------- | ---------- | ------------------------------ |
| **P0** | Scaffold + boundary gate    | Crear `@core/domain` + `@core/application` (package.json, tsconfig, alias en `tsconfig.base`, project refs, barrels vacíos). `dependency-cruiser` reglas de frontera en **warn**. Sin mover código.                                                                                                  | Baja        | —          | DONE (2d9418a)                 |
| **P1** | Kernel base (con shims)     | A `@core/domain`: `Entity`, `AggregateRoot`, `EntityId`+IDs base, `errors/`, `events/DomainEvent`, `repositories/Repository.ts` (UnitOfWork). A `@core/application`: `UseCase.ts`. Shims en rutas viejas. Desambiguación `DomainEvent`: `@shared` → `EventStoreEvent`. Gate `@shared ✗→ @core/apps`. | Media       | P0         | DONE (6a758e2·e6c052b·4b5dc2d) |
| **P2** | Shared cross-cutting        | Domain de 2–5 ctx + entities cross-cutting (`Account`/`Project`/`Channel`/`Provider`/`Content`/`PublishStatus` + ports compartidos — ver §Apéndice). Shims.                                                                                                                                          | Media-alta  | P1         | PENDING                        |
| **P3** | Contextos hoja              | Slices verticales: embeddings, guardrails, security, providers, utm, usage, apiKeys, ai-image, mentions, webhooks, glossary, brand-kit, brand-voice, style-guide, listening.                                                                                                                         | Baja        | P1, P2     | PENDING                        |
| **P4** | Features standalone         | links, notifications, first-comment, referral, ml, comments, crisis, external-notifications, aiPromptTemplates, trends.                                                                                                                                                                              | Baja-media  | P1, P2     | PENDING                        |
| **P5** | Módulos de feature          | analytics, reports, recurring, tasks, team, integrations, crm.                                                                                                                                                                                                                                       | Media       | P1, P2     | PENDING                        |
| **P6** | Features grandes            | ai, custom-reports, campaigns, assets, approvals.                                                                                                                                                                                                                                                    | Media-alta  | P1, P2     | PENDING                        |
| **P7** | Centrales & sensibles       | inbox, posts, auth, customer-auth, bulk-scheduling, channels, billing.                                                                                                                                                                                                                               | Alta        | P1, P2     | PENDING                        |
| **P8** | Burn-down shims + gate hard | Migrar import-sites restantes → `@core`; **borrar todos los shims**; flip `dependency-cruiser` a **error** (CI gate).                                                                                                                                                                                | Media       | P3–P7      | PENDING                        |
| **P9** | Cablear deployables         | apps/workers resuelve use-cases de `@core`; decidir topología; mover driven adapters Prisma del dominio a `packages/adapters/*`.                                                                                                                                                                     | Media       | P8         | PENDING                        |

## 3. Apéndice — mapa de ownership de domain (bound de scope, a nivel archivo)

> **Reproducible (no congelar — regenerar al armar cada plan de fase, los conteos cambian con los shims):**
>
> ```bash
> for f in $(find apps/api/src/domain -name "*.ts" | sed 's#apps/api/src/domain/##;s#\.ts$##'); do
>   b=$(basename "$f"); ctxs=$(grep -rlE "domain/.*${b}(\.js)?\"" apps/api/src/application --include="*.ts" 2>/dev/null \
>     | sed -E 's#apps/api/src/application/([^/]+)/.*#\1#' | sort -u); n=$(echo "$ctxs" | grep -c .)
>   echo "${n}|${f}|$(echo $ctxs | tr '\n' ',')"; done | sort -t'|' -k1 -rn
> ```

### Kernel → P1 (lo importan ~todos los contextos)

`repositories/Repository.ts` (UnitOfWork + base, **40 ctx**) · `value-objects/EntityId.ts` (+ IDs base) ·
`entities/Entity.ts` · `aggregates/AggregateRoot.ts` · `errors/` (DomainError hierarchy) · `events/DomainEvent.ts`
(+ reconciliar con `@shared/types/events`) · los `index.ts` barrels (entities/value-objects/repositories/services/
events/errors/aggregates + top) · infra-ports cross-cutting: `ReadModelDtos.ts`, `AuditLogRepository.ts`,
`OutboxWriter.ts`, `HttpClientPort.ts`, `EmailPort.ts`. + `application/UseCase.ts` → `@core/application`.

### Shared cross-cutting → P2 (2–5 contextos)

Ports: `ChannelRepository` · `ChannelQueryForIngestion` · `AIServicePort` · `AnalyticsReadRepository` ·
`PostRepository` · `RoleRepository` · `CustomerUserRepository` · `CustomerRoleRepository` · `ApiKeyRepository` ·
`BrandVoiceRepository`. VOs: `Provider` · `NotificationType` · (cross-cutting: `Content`, `PublishStatus`,
`ScheduledTime`, `MediaAttachment` — confirmar al armar P2). Entities: `Account` · `Project` · `Channel` ·
`CustomerUser`.

### Context-owned → P3–P7 (1 contexto = slice limpio)

El resto (mapeo por nombre, confirmado por el script de arriba): `SocialMessage*`/`SocialConversation*`/
`ConversationNote`/`SocialOutboundReply`→inbox · `Post*`/`PublishStatus`→posts · `UTMParameters`/`TrackedLink`→utm/
links · `Task*`→tasks · `Campaign*`→campaigns · `Mention*`/`TrackedTerm`→mentions/listening · `Crm*`→crm ·
`Approval*`/`ReviewDecision`→approvals · `BrandKit`→brand-kit · `Glossary`→glossary · `MediaAsset`/`AssetFolder`/
`AssetTag`→assets · `Notification*`→notifications · `Recurring*`→recurring · `CustomReport`/`ScheduledReport`→
reports/custom-reports · `Oidc*`/`Saml*`→auth · `Customer*`/`Role*`→customer-auth · `Trend*`→trends · `Usage*`→usage ·
`Integration*`→integrations · `FirstComment`→first-comment · `StyleGuide*`→style-guide · `Guardrail*`→guardrails ·
`GeneratedImage`→ai-image · etc. **El plan de cada fase corre el script y fija la lista exacta.**

## 4. Template de plan por fase (OBLIGATORIO — anti-sorpresa)

Cada plan de fase (en plan mode, aprobado por Edward antes de ejecutar) DEBE contener:

1. **Inventario exacto de archivos a mover** (regenerado con el script del §3 contra el estado actual).
2. **Lista de shims a crear** (ruta vieja → `export … from "@core/…"`), y cuáles se borran (solo en P8).
3. **Import-sites a actualizar, con conteo real** (`grep -rl` por cada símbolo movido) — el número exacto, no "varios".
4. **Tests a mover a rutas espejo** (`tests/unit/<mismo path que el source>` — lo exige el Stop hook) + su ajuste de
   import depth.
5. **Gates** (ver §6) + **checkpoint de rollback** (commit propio + `pct snapshot 102 antes-de-P<n>`).
6. **Verificación runtime** cuando aplique (DB+Redis arriba; smoke del path afectado).

## 5. Catálogo de gotchas (del maratón prisma→DI — chequear en cada fase)

- **Funciones top-level vs métodos:** una función suelta no tiene `this`; mover lógica que use `this.x` requiere
  threading por parámetro (pasó en webhookDashboardService `generateTimeline`). Grepear `this.` antes de mover.
- **Barrels `index.ts`:** los `domain/**/index.ts` re-exportan todo y los importan 8 contextos → durante la
  migración el barrel queda como shim (`export * from "@core/…"`) y se hace split al final (P8). No moverlos "a lo
  bruto".
- **`exactOptionalPropertyTypes: true`:** Zod `.optional()` da `T | undefined`; usar conditional spread
  (`...(x !== undefined && { x })`).
- **Preservar comportamiento (cero regresión):** al mover/re-cablear, no perder side-effects (p.ej. flag-for-reauth
  vía `UpdateChannelAuthStateUseCase`). Distinguir errores terminales (no-retry) de retryables.
- **Tests no se typechean por `tsc`** (include = `src`): esbuild/vitest transpila sin type-check → faltantes
  aparecen en runtime. Correr los tests afectados per-file.
- **prettier re-padea tablas markdown** (diffs grandes en docs) — esperado, no alarmarse.
- **Heap caps del LXC:** `NODE_OPTIONS=--max-old-space-size=5120` para tsc, `2048–3072` para vitest; tests per-file
  (la suite completa OOM'ea). Commit con `--max-old-space-size=8192` (husky lint-staged OOM'ea con default).
- **Reconciliación `@shared/types` ↔ `apps/api/domain`:** `DomainEvent`/`Result`/`errors` existen en ambos (formas
  distintas) → P1 fija cuál es canónico y borra el duplicado; no dejar dos.
- **No romper fitness #21/#1** (hard-zero): el core movido sigue sin importar el singleton prisma; `@core` no importa
  adapters/infra (boundary gate).
- **Paths sensibles** (`.github/workflows/`): requieren `omnipost-allow sensitive-edit` (token TTL 15 min) — aplica
  si una fase toca CI (P0 boundary gate / P8).

## 6. Invariantes globales por fase (gates)

`tsc` 0 en **apps/api + apps/workers** · `eslint` 0 errores / 0 warnings (tocados) · `prettier` · fitness
(**#21=0 / #1=0** + el boundary gate de `dependency-cruiser`) · tests afectados verdes (per-file) · commit propio en
inglés, sin Co-Authored-By, heap-bump · **aprobación explícita de Edward al cierre de la fase**.

---

_Stand-by hasta priorización: Implementation Roadmap (features), BF-HOMOLOG (SMELL-35), WEBHOOK-INGEST (SMELL-38),
Control-Freak (SMELL-36/37). Esta migración es el workstream activo una vez que se apruebe arrancar P0._
