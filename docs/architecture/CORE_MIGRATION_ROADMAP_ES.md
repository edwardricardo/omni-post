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

| Fase   | Nombre                      | Scope                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | Complejidad | Depends-on | Status                                         |
| ------ | --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------- | ---------- | ---------------------------------------------- |
| **P0** | Scaffold + boundary gate    | Crear `@core/domain` + `@core/application` (package.json, tsconfig, alias en `tsconfig.base`, project refs, barrels vacíos). `dependency-cruiser` reglas de frontera en **warn**. Sin mover código.                                                                                                                                                                                                                                                                                                                                               | Baja        | —          | DONE (2d9418a)                                 |
| **P1** | Kernel base (con shims)     | A `@core/domain`: `Entity`, `AggregateRoot`, `EntityId`+IDs base, `errors/`, `events/DomainEvent`, `repositories/Repository.ts` (UnitOfWork). A `@core/application`: `UseCase.ts`. Shims en rutas viejas. Desambiguación `DomainEvent`: `@shared` → `EventStoreEvent`. Gate `@shared ✗→ @core/apps`.                                                                                                                                                                                                                                              | Media       | P0         | DONE (6a758e2·e6c052b·4b5dc2d)                 |
| **P2** | Shared cross-cutting        | VOs (Provider/Content/PublishStatus/ScheduledTime/MediaAttachment/NotificationType) + entities (Account/Channel/CustomerUser/Project) + ProjectEvents + ReadModelDtos + ports de esas entities + infra-ports (Outbox/AuditLog/Email/HttpClient). Read-models analytics→P5. Shims.                                                                                                                                                                                                                                                                 | Media-alta  | P1         | DONE (ed2b6c6·3fbc75a)                         |
| **P3** | Contextos hoja              | 17 archivos: UTMParameters, BrandKit (+repo), MentionParser, security rules + ports hoja (embeddings/guardrails/usage/apiKeys/ai-image/glossary/brand-voice/style-guide/listening×3). MentionQueryRepository→P7 (inbox); webhooks/providers sin footprint.                                                                                                                                                                                                                                                                                        | Baja        | P1, P2     | DONE (4461bfc)                                 |
| **P4** | Features standalone         | 15 archivos: VOs (ShortCode/CommentId/NotificationId) + entities (TrackedLink/LinkClick/Notification) + PostCommentAggregate(+eventos) + ports (links/notifications/comments/first-comment/external-notifications/aiPromptTemplates/conversions). ml sin footprint; trends→P3; crisis→P2.                                                                                                                                                                                                                                                         | Baja-media  | P1, P2     | DONE (9bc85be)                                 |
| **P5** | Módulos de feature          | 23 archivos: analytics (5 ports + 3 registry) + entities/ports de reports/recurring/tasks/integrations/crm. team sin footprint (P2). AccountSubscription/SubscriptionStats→P7 (billing).                                                                                                                                                                                                                                                                                                                                                          | Media       | P1, P2     | DONE (0ae375d·84b64c6)                         |
| **P6** | Features grandes            | approvals/campaigns/assets/custom-reports (17 archivos) + contexto `ai` (extracción de los 3 tipos-contrato a `@core/domain/ai/AiServiceContract`, AIServicePort, PlatformContentProfile). Incluyó backfill exhaustivo P1–P5 + limpieza de comentarios de fase + fitness #8 extendido.                                                                                                                                                                                                                                                            | Media-alta  | P1, P2     | DONE (b238263·f5a422b)                         |
| **P7** | Centrales & sensibles       | 30 archivos: posts (PostAggregate/PostEvents/PostRepository) + inbox (Social\* VOs/entities/aggregate/ports) + auth (Oidc/Saml + Admin ports) + billing (PricingCalculator + subscription ports) + bulk-scheduling + GA4. channels ya migró en P2. **Completa el dominio: apps/api/src/domain = 100% shims.**                                                                                                                                                                                                                                     | Alta        | P1, P2     | DONE (93c36ce·0cbd3ef·0252697·28e9067)         |
| **P8** | Burn-down shims + gate hard | Migrar import-sites restantes → `@core`; **borrar todos los shims**; flip `dependency-cruiser` a **error** (CI gate). **P8a application DONE (fe710c4)** (20 barrels @core + 238 import-sites + `apps/api/src/application` borrado, 242 shims); **P8b domain DONE (6ef962c)** (barrel VO @core + 333 import-sites incl. 2 `import()` dinámicos + `apps/api/src/domain` borrado, 143 shims) — **andamiaje strangler 100% removido de apps/api**; **P8c flip depcruise core-\* a error DONE (21398d8)** (4 reglas `warn`→`error`, CI-scope exit 0). | Media       | P3–P7      | DONE (P8a fe710c4 · P8b 6ef962c · P8c 21398d8) |
| **P9** | Cablear deployables         | apps/workers resuelve use-cases de `@core`; mover driven adapters Prisma a `packages/adapters/*` **donde haga falta**. Enfoque **A-rigurosa** (incremental por-worker bajo convención, ver §2bis): **P9.0** convención de adapters canónicos (este commit); **P9a** mentionIngest→@core; **P9b** autoRenewal (nuevo `AutoRenewExpiredTrialUseCase`); **P9c** romper no-circular (SMELL-42). `publish` se queda worker-only (ejecuta lo que @core agenda; no hay `PublishPostUseCase`).                                                            | Media       | P8         | IN-PROGRESS (P9.0 convención)                  |

## 2bis. P9 — Convención de adapters Prisma canónicos (A-rigurosa)

> **Decisión (Edward):** cablear workers a `@core` de forma **incremental por-worker**, moviendo **solo** los adapters
> que cada uno necesita — **no** los ~90 de golpe (churn enorme, no requerido por el milestone; los workers ya son
> DI-clean y usan el facade `@adapters/db-prisma`). Para que "mover solo lo necesario" **no** disperse adapters ni
> genere duplicación, se fijan estas 4 reglas **antes** de mover nada. Destino ya endosado por
> `TARGET_ARCHITECTURE_CANON_ES.md` ("Prisma repo impls → `packages/adapters/*`, consumibles por cualquier deployable,
> donde haga falta").

1. **Home canónico (discoverability):** `@adapters/db-prisma` es EL hogar de los Prisma adapters compartidos por >1
   deployable. Todo consumidor nuevo **busca ahí primero**.
2. **Move-not-copy (cero duplicación):** un adapter apps/api-only **migra** (nunca se copia) a `@adapters/db-prisma`
   cuando un 2º consumidor lo necesita; apps/api pasa a importarlo desde ahí. **Un port = un adapter = una ubicación.**
3. **Una impl por port:** el adapter canónico es el **full-domain** (implementa el port de `@core/domain`). No
   sobreviven impls paralelas simplificadas.
4. **Retiro del facade:** el facade `@ports/core` de `@adapters/db-prisma` (`createAccount/Project/Post/Channel/
PublishLog/Analytics/ThreadRepository`, usado hoy por publish + mention workers) es **transitorio**. Solapa los
   repos full-domain de apps/api para esas tablas (duplicación latente). A medida que los workers adoptan use-cases de
   `@core` (respaldados por los repos full migrados bajo la regla 2), las factories del facade **se retiran**. **Cero
   net-new facade repos.**

**Estado interino determinístico:** "disperso" = "todavía-no-compartido", **no** "ambiguo". Los ~80 adapters
apps/api-only se quedan en `apps/api/src/infrastructure/repositories/` **hasta** que un 2º consumidor los pida →
momento en que MIGRAN bajo la regla 2. No se mueve nada especulativamente.

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
