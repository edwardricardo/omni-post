# Post-Remediation Backlog

> **Propósito.** Registro de **fixes paliativos aplicados durante ejecución del roadmap de remediación** (`REMEDIATION_ROADMAP.md` v2.1+) que resolvieron un bloqueador inmediato pero **no son la solución definitiva**. Cada entry captura: qué se hizo como band-aid, qué habría que hacer como fix de raíz, y cuándo revisarlo.
>
> **Regla operacional.** Cuando un batch del roadmap encuentra un bloqueador pre-existente fuera de su scope y se aplica un fix mínimo para desbloquear la ejecución, el fix se registra aquí. **Después de cerrado el roadmap completo**, Edward revisa este backlog y decide qué fixes ameritan upgrade a fix definitivo.
>
> **Formato.**
>
> ```markdown
> ### PR-<N> — <título corto>
>
> **Fecha de aplicación:** YYYY-MM-DD
> **Batch de origen:** T<tier>-<letter> (del roadmap v2.1)
> **Severidad del bug pre-existente:** bajo / medio / alto / crítico
> **Tipo:** config / code / infra / docs / tests
>
> **Fix paliativo aplicado** (qué se cambió):
> <archivo + línea + descripción>
>
> **Root cause real:**
> <qué bug está realmente ahí, que el band-aid oculta>
>
> **Fix definitivo recomendado:**
> <qué habría que hacer para resolver de raíz>
>
> **Cuándo revisar:**
> <inmediato / post-roadmap / sprint dedicado / batch específico (T<n>-<letter>)>
>
> **Estado:** APLICADO / REVIEWED / FIXED / WONT_FIX
> ```

---

## Entradas

### PR-1 — `@providers/threads` vitest `--passWithNoTests`

**Fecha de aplicación:** 2026-04-22
**Batch de origen:** T0-A (Secrets Rotation + Repo Hygiene)
**Severidad del bug pre-existente:** medio — bloqueaba `pnpm test` completo bajo turbo
**Tipo:** config

**Fix paliativo aplicado.**

`packages/providers/threads/package.json:13` — cambio de script `test`:

```diff
- "test": "vitest run",
+ "test": "vitest run --passWithNoTests",
```

Con el flag, vitest retorna exit 0 cuando no encuentra tests en lugar de exit 1. Desbloquea `pnpm test` + `pnpm turbo run test`.

**Root cause real.**

El paquete `@providers/threads` está **scaffolded sin suite de tests**. El script `test` existe porque es convención del monorepo (todos los packages tienen `test` para que turbo los orquesta), pero no hay archivos `*.test.ts`. El `--passWithNoTests` enmascara esa ausencia — el paquete sigue sin cobertura de tests.

Además: `@providers/shared` usa `node --test` con glob (`tests/**/*.test.ts`) y probablemente tiene el mismo problema latente (el glob no matchea nada pero node --test no falla igual que vitest). No investigado en profundidad.

**Fix definitivo recomendado.**

Opción 1 (preferida): **Escribir suite de tests** para `@providers/threads`. El provider Threads existe en el código (`packages/providers/threads/src/`), merece coverage mínima consistente con otros providers (`@providers/x`, `@providers/facebook`, etc., que tienen 100+ tests cada uno).

Opción 2: Si el provider se considera SCAFFOLD no-producto (no wireado en DI, no integrado en publishWorker), **DELETE del paquete** completo — tratar como T6-style §5.9 validación antes de borrar, Edward decide.

Decisión depende de: ¿`@providers/threads` es provider planeado/activo o scaffold muerto?

**Cuándo revisar.**

Post-roadmap completo. Cross-ref al cluster D7 (Critical Tests Coverage) del PLAN_MAESTRO.md — cuando D7 se ejecute (después del tramo de remediación), esta entrada debería quedar resuelta por escribir tests o eliminar el paquete.

**Estado:** APLICADO (2026-04-22)

---

### PR-2 — TikTok `marketingApiClient.ts` location extraction bug fix

**Fecha de aplicación:** 2026-04-22
**Batch de origen:** T0-A (root-cause fix aplicado como excepción cross-batch para cumplir la regla "tests 100% verdes antes de commit")
**Severidad del bug pre-existente:** alto — 3 tests fallando en `marketingApiClient.test.ts`, funcionalidad real rota (audience insights por ubicación retornaba shape incorrecto)
**Tipo:** code + type

**Naturaleza especial.** A diferencia de PR-1 (fix paliativo con TODO), este es un **fix de raíz** aplicado durante T0-A por excepción. No requiere revisión posterior — el bug queda resuelto. Registrado aquí por trazabilidad: explica por qué un cambio en `@providers/tiktok` aparece en el commit de T0-A (Secrets Rotation).

**Fix aplicado.**

Archivo: `packages/providers/tiktok/src/marketingApiClient.ts`

1. Reemplazo del tipo `dimensions: Record<string, string>` (línea 83) por interface explícita `TikTokDimensions` que refleja el shape real de la API — `location` es `string | { country?: string }`, otros campos son `string | undefined`.

2. Fix del extractor de ubicación (líneas ~447-455, era 447-453):

   ```diff
   - const locationValue = dimension.location;
   - if (locationValue) {
   -   audienceInsight.location.push({
   -     country: locationValue,
   -     percentage: impressions,
   -   });
   - }
   + const locationValue = dimension.location;
   + const country =
   +   typeof locationValue === "string" ? locationValue : locationValue?.country;
   + if (country) {
   +   audienceInsight.location.push({
   +     country,
   +     percentage: impressions,
   +   });
   + }
   ```

**Root cause real.**

El tipo `Record<string, string>` era una mentira — la API de TikTok retorna `dimension.location` como objeto `{ country?: string }` (o `{}` vacío) en el endpoint de audience insights. El truthy check `if (locationValue)` aceptaba `{}` como verdadero y pusheaba estructura incorrecta al array (el objeto entero como `country`, o `{}` como `country`).

Introducido en commit `069155c` ("refactor: audit remediation A1-A7 — security, type safety, UoW, schemas, deps") — probable refactor incompleto.

**Fix definitivo recomendado.**

Ya aplicado — no pendiente.

**Cuándo revisar.**

N/A — resuelto. Solo confirmar en D4 (Conformidad Funcional) del PLAN_MAESTRO que el contrato TikTok audience insights retorna shape esperado en integración real (si es posible con mocks contra sandbox).

**Estado:** FIXED (2026-04-22)

---

### PR-3 — Lint cleanup: 5 unused imports/vars

**Fecha de aplicación:** 2026-04-22
**Batch de origen:** T0-A (cross-batch fix para cumplir `pnpm lint --max-warnings 0` pre-commit)
**Severidad del bug pre-existente:** bajo — warnings de ESLint `@typescript-eslint/no-unused-vars`, no afectan funcionalidad
**Tipo:** code

**Naturaleza especial.** Igual que PR-2, son **fixes de raíz** aplicados como excepción cross-batch. Cleanup directo de imports muertos, no paliativo. Registrado aquí por trazabilidad.

**Fixes aplicados (5):**

| #   | Archivo                                                             | Cambio                                                                                                                                                                                                                                                                               |
| --- | ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | `apps/admin/app/(dashboard)/security/page.tsx:19`                   | Removido import `ActionButton` (no usado)                                                                                                                                                                                                                                            |
| 2   | `apps/admin/components/settings/OverviewTab.tsx:11`                 | Removido `CREDENTIAL_KEYS` del import destructurado                                                                                                                                                                                                                                  |
| 3   | `apps/api/tests/unit/security/PlatformCredentialService.test.ts:11` | Renombrado parámetro `overrides` → `_overrides` (convención CLAUDE.md para args intencionalmente no usados)                                                                                                                                                                          |
| 4   | `apps/api/tests/unit/subscriptionPlanService.test.ts:10`            | Removido `expect` del import de vitest (el test usa `assert` exclusivamente)                                                                                                                                                                                                         |
| 5   | `apps/client/components/onboarding/OnboardingChecklist.tsx:13,28`   | Removidos `useCompleteStep` import + `completeMutation` var. El hook nunca se invocaba — los steps se completan server-side via acciones del usuario (connect provider, create post, etc.). Residuo de diseño previo con botón "Complete step" que se reemplazó por auto-completion. |

**Root cause real.**

Drift acumulado durante sprints previos:

- #1, #2: refactors que removieron uso sin limpiar imports.
- #3: pattern inconsistente — otros mocks en el mismo archivo usan `_` prefix ya.
- #4: copy-paste de template de vitest que importa `expect` por default.
- #5: rediseño incompleto del componente — se auto-completó el flujo pero no se limpió el hook residual.

**Fix definitivo recomendado.**

Ya aplicado — cleanup directo.

**Cuándo revisar.**

N/A — resuelto. Idealmente el CI fitness function de CLAUDE.md (fitness.yml pendiente en T4-P) debería enforce `--max-warnings 0` por default, previniendo acumulación futura.

**Estado:** FIXED (2026-04-22)

---

### PR-4 — Deferred `no-explicit-any` enforcement (apps/admin, apps/client, packages, stories)

**Fecha de aplicación:** 2026-04-22
**Batch de origen:** T1-A (ESLint rules wire)
**Severidad del bug pre-existente:** medio — 92 `any` types fuera de backend core; no rompen producción pero degradan type safety
**Tipo:** config (scope temporal del rule)

**Fix paliativo aplicado.**

`eslint.config.cjs` — regla `@typescript-eslint/no-explicit-any` configurada como:

- `error` en `apps/api/src/{domain,application,infrastructure}/**/*.ts` (core layers — 0 violations actuales)
- `off` (default) en el resto del monorepo

Esto permite que lint quede verde en T1-A mientras mantiene enforcement en el scope crítico.

**Root cause real.**

~92 ocurrencias de `: any`, `as any`, `<any>` fuera de core layers:

- `apps/admin/stories/**` (Storybook — algunos legítimos por callbacks de demos)
- `apps/client/components/**` (especialmente `PublishDialog.tsx`, `BulkScheduleView.tsx`, content/templates)
- `apps/client/.storybook/**`
- `packages/ui/**` (tipos legacy en componentes compartidos)

Type safety debilitada; refactor requiere definir tipos específicos caso por caso.

**Fix definitivo recomendado.**

Iterativo por dominio:

1. **apps/admin**: durante T3-G (admin small god files split) — refactor types al paso.
2. **apps/client**: durante T3-F (client small god files split) + T2-K (type narrowing) — batch dedicado.
3. **packages/ui**: durante T5-D/T5-E (consolidaciones) — tipos compartidos definidos.
4. **Storybook (.stories)**: aceptable — scope override permanente en config.

Cuando cada cluster tenga `any` = 0, remover override correspondiente de `eslint.config.cjs`.

**Cuándo revisar.**

Progresivo durante T2-K, T3-F, T3-G, T4-R. Cierre total al final del tramo de remediación.

**Estado:** APLICADO (2026-04-22) — scope temporal

---

### PR-5 — Deferred `no-floating-promises` enforcement (backend orchestration/services/video/webhooks/workers)

**Fecha de aplicación:** 2026-04-22
**Batch de origen:** T1-A (ESLint rules wire)
**Severidad del bug pre-existente:** medio-alto — 30 fire-and-forget promises sin `void`/`await`/`.catch()`; errores asíncronos pueden perderse silenciosamente
**Tipo:** config (scope temporal) + code (violations reales pendientes)

**Fix paliativo aplicado.**

`eslint.config.cjs` — regla `@typescript-eslint/no-floating-promises` configurada con `projectService: true` (type-aware parser) scoped exclusivamente a:

- `apps/api/src/domain/**/*.ts`
- `apps/api/src/application/**/*.ts`
- `apps/api/src/infrastructure/**/*.ts`

No aplicada a `apps/api/src/orchestration/**`, `services/`, `video/`, `webhooks/processors/`, `apps/workers/src/**`.

**Root cause real.**

30 violations pre-existentes detectadas en el primer lint run:

| Archivo                                                                | Violations |
| ---------------------------------------------------------------------- | ---------: |
| `apps/api/src/index.ts:685`                                            |          1 |
| `apps/api/src/orchestration/PublishingOrchestrator.ts:297`             |          1 |
| `apps/api/src/orchestration/sync/StreamProcessor.ts:41,124`            |          2 |
| `apps/api/src/services/NotificationBroadcaster.ts:162`                 |          1 |
| `apps/api/src/video/thumbnailGeneration.ts:39`                         |          1 |
| `apps/api/src/video/uploadPipeline.ts:124,378`                         |          2 |
| `apps/api/src/video/videoProcessor.ts:102`                             |          1 |
| `apps/api/src/webhooks/processors/linkedinWebhookProcessor.ts:278,310` |          2 |
| `apps/api/src/webhooks/processors/snapchatWebhookProcessor.ts:227,253` |          2 |
| `apps/api/src/webhooks/realtimeWebhookBroadcaster.ts:608,621`          |          2 |
| `apps/workers/src/analyticsIngestWorker.ts:182`                        |          1 |
| `apps/workers/src/inboxSyncWorker.ts:180`                              |          1 |
| `apps/workers/src/publishWorker.ts:134`                                |          1 |

**Adicional:** `eslint.config.cjs` está en `ignores` (no linted — usa `__dirname` que requiere Node CJS globals no wireados).

**Fix definitivo recomendado.**

Per-file audit con 3 fixes posibles por cada floating promise:

1. `void promise` — si fire-and-forget es intencional (documenta intent)
2. `await promise` — si el resultado importa
3. `promise.catch(logger.error)` — si errores deben loggearse pero flujo continúa

Cluster de trabajo sugerido:

- **Workers** (3 violations): típicamente `main()` calls — review startup error handling. Cross-ref T4-I (workers retry + shutdown).
- **Video pipelines** (4 violations): fire-and-forget processing — probablemente necesitan `.catch()` con retry/notification. Cross-ref T4-X (webhook N+1 + retry queue).
- **Webhook processors** (6 violations): async acks. Similar a video.
- **Orchestration** (3): publishing + sync flows.
- **Services/broadcasters** (2): notifications.

Cuando cada cluster quede sin violations, expandir `typeAwareBackendPaths` en `eslint.config.cjs`.

**Cuándo revisar.**

Progresivo durante T4-I (workers), T4-X (webhook retry), T2-C (silent catches) que tocan paths relacionados. Cierre total al final del tramo.

**Estado:** APLICADO (2026-04-22) — scope temporal

---

### PR-6 — Frontend error handlers pending browser-logger port

**Fecha de aplicación:** 2026-04-22
**Fecha de cierre:** 2026-04-22 (mismo día — cerrado por creación de `@observability/browser-logger`)
**Batch de origen:** T1-A tightening (post-commit follow-up para alinear `no-console` al estándar CLAUDE.md "zero `console.*` in production code")
**Severidad del bug pre-existente:** medio — error logs sin correlation ID, sin routing a APM, sin redacción PII
**Tipo:** config (scope override temporal) → **resuelto con port abstracto**

**Fix paliativo aplicado.**

`eslint.config.cjs` — `"no-console": "error"` global (tightened — removido `allow: ["warn", "error"]`). Override temporal para 3 archivos frontend:

```js
{
  files: [
    "apps/admin/components/shared/ErrorBoundary.tsx",
    "apps/client/app/error.tsx",
    "packages/ui/src/components/VirtualScrollList.tsx",
  ],
  rules: { "no-console": "off" },
}
```

**Root cause real.**

Los 3 archivos usan `console.error(error)` para reportar errores de render/boundary. Son el único path disponible porque:

- No existe `@observability/browser-logger` port (backend tiene Pino, frontend no tiene equivalente wireado).
- Sin browser-logger port, `console.error` es el único sink disponible.
- Error boundaries/pages son puntos críticos donde NO logear es peor que logear sin estructura.

**Fix definitivo recomendado.**

Cuando se wire el browser-side logger port (batch que introduce `@observability/browser-logger` o similar, cross-ref LATERAL_FINDINGS L-347):

1. Crear port + adapter browser (envía a Sentry/Datadog RUM/similar con correlation ID, PII redact, structured fields).
2. Inyectar vía context provider en apps/admin + apps/client.
3. Reemplazar los 3 `console.error` por `logger.error(error, context)`.
4. Remover el override block de `eslint.config.cjs`.

**Cuándo revisar.**

Cuando se ejecute el batch que entrega browser-logger port. Hasta entonces, los 3 archivos quedan exentos.

**Estado:** FIXED (2026-04-22) — resuelto por creación de `@observability/browser-logger` package. Override ESLint removido. Los 3 archivos migrados a `BrowserLoggerPort`. Legacy `packages/shared/src/logger.ts` + `apps/admin/lib/logger.ts` + `apps/client/lib/logger.ts` eliminados. L-347 resuelto.

---

### PR-7 — `@typescript-eslint@8.57.2` + `tsconfck@3.1.6` + `madge@8.0.0` peer range declara `typescript@^5` pero repo usa `typescript@6.0.2`

**Fecha de aplicación:** 2026-04-22
**Batch de origen:** T1-F (JSDoc normalization + Storybook consolidation)
**Severidad del bug pre-existente:** bajo — warnings ruidosos durante `pnpm install`, sin impacto funcional en lint / build / tests
**Tipo:** deps

**Fix paliativo aplicado.**

**Ninguno.** Los warnings de peer deps son aceptados como deuda conocida y visible. Se consideró añadir `pnpm.peerDependencyRules.allowedVersions` en el root `package.json` para silenciarlos, pero Edward rechazó explícitamente el approach por considerarlo un ocultamiento ("cero parches, cero overrides, cero ocultamientos").

Warnings actuales al correr `pnpm install`:

```text
.
└─┬ @typescript-eslint/parser 8.57.2
  └─┬ @typescript-eslint/typescript-estree 8.57.2
    ├── ✕ unmet peer typescript@">=4.8.4 <6.0.0": found 6.0.2
    └─┬ @typescript-eslint/tsconfig-utils 8.57.2
      └── ✕ unmet peer typescript@">=4.8.4 <6.0.0": found 6.0.2

apps/admin
└─┬ vite-tsconfig-paths 6.1.1
  └─┬ tsconfck 3.1.6
    └── ✕ unmet peer typescript@^5.0.0: found 6.0.2

(similar para @typescript-eslint/eslint-plugin, type-utils, utils, project-service, y madge)
```

**Root cause real.**

El proyecto usa `typescript@6.0.2` (el major más reciente). Tres familias de paquetes declaran peer range `typescript@^5`:

1. **`@typescript-eslint@8.x`** — la versión que acepta oficialmente TS 6 es `@typescript-eslint@9.x` (2025). Saltar de v8 a v9 introduce breaking changes en reglas (varias renombradas o movidas) y config (`FlatConfig` estricto).
2. **`tsconfck`** (vía `vite-tsconfig-paths@6.1.1`) — upstream no ha actualizado peer range para aceptar TS 6. Funcionalmente parsea `tsconfig.json` igual en TS 5 y TS 6, pero la declaración está desfasada.
3. **`madge@8.0.0`** — idem; el analizador estático de imports circulares funciona con TS 6 pero el peer range dice 5.

Los warnings son de **declaración**, no de runtime. `pnpm lint`, `pnpm build`, `pnpm test`, `pnpm typecheck` pasan en verde.

**Fix definitivo recomendado.**

Batch dedicado `T3-X — Upgrade typescript-eslint to v9 + audit peer ranges`:

1. Upgrade `@typescript-eslint/parser`, `@typescript-eslint/eslint-plugin`, `@typescript-eslint/type-utils`, `@typescript-eslint/utils` de `8.57.2` → `9.x` (última estable).
2. Migrar `eslint.config.cjs` según changelog v9: rules renombrados (ej. `ban-types` → `no-restricted-types`, cambios en `no-unused-vars`), ajustes en `FlatConfig`.
3. Validar que todos los warnings ESLint pre-existentes siguen siendo 0.
4. Verificar que `vite-tsconfig-paths` / `tsconfck` / `madge` han actualizado su peer range a aceptar TS 6; si no, abrir issues upstream o considerar alternativas (`@vercel/tsconfig-paths-plugin`, `dpdm`).

Estimación: 4-6 horas (risk: medio — breaking changes en ~20 reglas ESLint).

**Cuándo revisar.**

Post-roadmap (fuera del alcance de los Tiers T0-T6). Cuando se ejecute el batch T3-X dedicado. Los warnings permanecen visibles en cada `pnpm install` hasta entonces — intencional.

**Estado:** APLICADO (aceptado como deuda conocida — warnings visibles, NO ocultos).

---

### PR-8 — Scheduling rules endpoint discrepancy (`/slots` vs `/rules`)

**Fecha de aplicación:** 2026-04-23
**Batch de origen:** T2-E (Path/nav corrections)
**Severidad del bug pre-existente:** medio — dos componentes del mismo dominio usan endpoints backend distintos para la misma entidad conceptual.
**Tipo:** code (endpoint routing)

**Fix paliativo aplicado.**

Durante T2-E migré dos componentes de scheduling a hooks TanStack + Dialogs:

- `apps/client/app/dashboard/scheduling/page.tsx` usa los endpoints `/api/backend/scheduling/slots` (GET/POST/PATCH) para manipular "rules" — pre-existente, se mantuvo.
- `apps/client/components/scheduling/MultiPlatformScheduler.tsx` usa `/api/backend/scheduling/rules` (GET/POST/PATCH + `/:id/toggle`) — pre-existente, se mantuvo.

Los nuevos hooks `useCreateSchedulingRule` / `useUpdateSchedulingRule` / `useToggleSchedulingRule` en `apps/client/hooks/api/useMultiPlatformScheduling.ts` apuntan al endpoint `/rules` (el que MultiPlatformScheduler ya usaba). `scheduling/page.tsx` refactorizó su handler para usar su Dialog + toast pero mantuvo el llamado a `/slots`.

**Root cause real.**

El backend tiene dos rutas distintas para lo que semánticamente parece ser la misma entidad: "scheduling rules":

- `apps/api/src/**/schedulingRoutes.ts` (o equivalente) expone tanto `/slots` como `/rules`.
- No está documentado cuál es el canónico ni cuál se considera deprecado.
- Posible escenario: evolución del esquema en que "slots" fue renombrado a "rules" pero la ruta antigua nunca se eliminó, y page.tsx fue escrito antes del rename.

**Fix definitivo recomendado.**

Batch dedicado (sugerido `T4-M` o futuro tier):

1. Auditar backend: identificar controller/route que maneja cada path; verificar si el schema/tabla es la misma.
2. Decidir endpoint canónico (probablemente `/rules` por semántica; `/slots` sugiere "slot" como unidad de tiempo, no como regla).
3. Migrar todos los consumidores al endpoint canónico (incluye `scheduling/page.tsx`).
4. Deprecar la ruta duplicada con un 301 a la canónica por ~1 release; luego remover.
5. Documentar en OpenAPI el endpoint canónico y la razón del rename.

Estimación: 3-4 horas (audit backend + migrar ~5 call sites + deprecation path + docs).

**Cuándo revisar.**

Post-roadmap o en un batch T4 dedicado a backend consolidation. No bloquea T2-E porque ambos endpoints funcionan en producción hoy (cada componente llama al suyo). Riesgo real: usuarios pueden ver comportamiento inconsistente entre las dos tabs (Multi-Platform Scheduler vs Rules tab del schedule page) si el backend trata `/slots` y `/rules` como tablas separadas.

**Estado:** APLICADO (documentado — ningún componente cambia de endpoint en T2-E).

---

### PR-9 — `window.location.href` en Stripe checkout / OAuth redirects (L-215 false positive)

**Fecha de aplicación:** 2026-04-23 (documentación)
**Batch de origen:** T2-E (Path/nav corrections) — durante re-audit del patrón nav
**Severidad del bug pre-existente:** N/A — no es bug
**Tipo:** docs (aclaración de falso positivo del roadmap)

**Descubrimiento.**

El roadmap (línea 3311) lista **L-215 — `useCheckout`/`useBillingPortal` window.location.href** como hallazgo de T2-E ("path/nav corrections"). La extensión de búsqueda durante T2-E encontró 3 usos de `window.location.href =` en el client:

- `apps/client/hooks/api/useBilling.ts:198` — redirect a Stripe Checkout hosted URL
- `apps/client/hooks/api/useBilling.ts:226` — redirect a Stripe Billing Portal hosted URL
- `apps/client/components/settings/crm/CrmConnectionCard.tsx:49` — redirect a provider OAuth authorization URL

**Los 3 son correctos.** `next/navigation`'s `router.push` solo navega dentro de la app Next.js (client-side, same-origin). Para redirigir a un dominio externo (Stripe, OAuth provider), el único método soportado es `window.location.href = externalUrl` (o equivalentemente `window.location.assign()`). El MDN docs confirma: _"Assigning a value to location.href makes the browser navigate to the new URL"_.

Usar `router.push` con una URL de otro origen produce el error: _"The `href` prop must point to a path starting with "/" or a valid external URL_.

**Conclusión.**

L-215 es un **falso positivo** del audit original. Los tres usos son canon para redirects externos. No se toca ningún archivo.

**Cuándo revisar.**

N/A — cerrado como WONT_FIX documentado. Si un lector futuro del roadmap cuestiona L-215, esta entrada explica la razón.

**Estado:** WONT_FIX (falso positivo — uso correcto para redirects externos).

---

## Meta

**Visibilidad.** Este archivo se lee al comienzo de cada batch del roadmap para identificar si un fix paliativo vigente afecta al scope actual.

**Cierre.** Un entry se marca como `REVIEWED` cuando Edward lo revisa al final del roadmap. Se marca como `FIXED` cuando el fix de raíz se aplicó. Se marca como `WONT_FIX` si Edward decide que el paliativo es suficiente a largo plazo (en cuyo caso la razón debe documentarse).

**Protección contra acumulación infinita.** Si este archivo supera ~20 entries, es señal de que el roadmap está dejando demasiada deuda paliativa — pausar y revisar antes de continuar.
