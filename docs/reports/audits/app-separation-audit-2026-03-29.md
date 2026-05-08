# OmniPost App Separation Audit

Date: 2026-03-29

## Definition (confirmed)

- **apps/admin** — Owner's superadmin portal (Edward's tool for managing his SaaS business)
- **apps/client** — Customer product (the tool Edward's customers use to manage their social media)

---

## Executive Summary

Creo que el 70% del código en apps/admin es código de producto que pertenece en apps/client. El admin app tiene 37 páginas — solo 11 son genuinamente de administración del SaaS (accounts, billing, compliance, security, logs). Las otras 26 son features de producto (posts, inbox, analytics, scheduling, AI, campaigns, approvals). El client app tiene solo 9 páginas y le faltan ~15 features que ya existen completas en admin. Este no es un problema menor de organización — es una confusión fundamental de quién usa qué.

---

## apps/admin — Current Contents

### Pages (37 total)

| Page                                          | Belongs In | What It Does                                            |
| --------------------------------------------- | ---------- | ------------------------------------------------------- |
| `/(auth)/login`                               | ADMIN ✅   | Login admin con MFA                                     |
| `/(dashboard)` (root)                         | ADMIN ✅   | Dashboard con total accounts, trials, MRR, revenue      |
| `/(dashboard)/accounts`                       | ADMIN ✅   | Lista TODOS los clientes con subscription, trial, usage |
| `/(dashboard)/subscriptions`                  | ADMIN ✅   | Billing: subscriptions activas, trials, MRR, revenue    |
| `/(dashboard)/executive`                      | ADMIN ✅   | KPIs de negocio: revenue growth, churn, uptime          |
| `/(dashboard)/compliance`                     | ADMIN ✅   | GDPR, audit score, compliance metrics                   |
| `/(dashboard)/security`                       | ADMIN ✅   | MFA adoption, RBAC hierarchy, role distribution         |
| `/(dashboard)/security/mfa`                   | ADMIN ✅   | MFA settings para admin users                           |
| `/(dashboard)/security/rbac`                  | ADMIN ✅   | RBAC management                                         |
| `/(dashboard)/logs`                           | ADMIN ✅   | Audit logs del sistema completo                         |
| `/(dashboard)/webhooks`                       | ADMIN ✅   | Webhook dashboard: métricas, events, DLQ                |
| `/(dashboard)/posts`                          | CLIENT ❌  | Lista de posts — esto lo hacen los clientes             |
| `/(dashboard)/posts/new`                      | CLIENT ❌  | Crear post — esto lo hacen los clientes                 |
| `/(dashboard)/posts/[id]`                     | CLIENT ❌  | Detalle de post — feature de cliente                    |
| `/(dashboard)/inbox`                          | CLIENT ❌  | Social inbox — feature de cliente                       |
| `/(dashboard)/approvals`                      | CLIENT ❌  | Workflow de aprobación — feature de cliente             |
| `/(dashboard)/content/library`                | CLIENT ❌  | Asset library — feature de cliente                      |
| `/(dashboard)/content/templates`              | CLIENT ❌  | Templates — feature de cliente                          |
| `/(dashboard)/analytics`                      | CLIENT ❌  | Analytics de sus posts — feature de cliente             |
| `/(dashboard)/analytics/insights`             | CLIENT ❌  | Performance insights — feature de cliente               |
| `/(dashboard)/analytics/reports`              | CLIENT ❌  | Reports — feature de cliente                            |
| `/(dashboard)/scheduling`                     | CLIENT ❌  | Calendar de publicación — feature de cliente            |
| `/(dashboard)/scheduling/recurring`           | CLIENT ❌  | Posts recurrentes — feature de cliente                  |
| `/(dashboard)/scheduling/recurring/new`       | CLIENT ❌  | Crear recurrente — feature de cliente                   |
| `/(dashboard)/scheduling/recurring/[id]/edit` | CLIENT ❌  | Editar recurrente — feature de cliente                  |
| `/(dashboard)/queue`                          | CLIENT ❌  | Publishing queue — feature de cliente                   |
| `/(dashboard)/channels`                       | CLIENT ❌  | Conectar cuentas sociales — feature de cliente          |
| `/(dashboard)/ai/generate`                    | CLIENT ❌  | AI content generation — feature de cliente              |
| `/(dashboard)/ai/analytics`                   | CLIENT ❌  | AI predictive analytics — feature de cliente            |
| `/(dashboard)/ai/optimizer`                   | CLIENT ❌  | Content optimizer — feature de cliente                  |
| `/(dashboard)/ai/templates`                   | CLIENT ❌  | Prompt templates — feature de cliente                   |
| `/(dashboard)/settings/brand-voice`           | CLIENT ❌  | Brand Voice config — feature de cliente                 |
| `/(dashboard)/settings/integrations`          | CLIENT ❌  | Slack/Teams webhooks — feature de cliente               |
| `/(dashboard)/settings/notifications`         | CLIENT ❌  | Notification prefs — feature de cliente                 |
| `/(dashboard)/instagram/stories`              | CLIENT ❌  | Instagram Stories editor — feature de cliente           |
| `/(dashboard)/instagram/upload`               | CLIENT ❌  | Instagram upload — feature de cliente                   |

### Component Groups

| Directory      | Files | Lines | Belongs In |
| -------------- | ----- | ----- | ---------- |
| ai/            | 25    | 2,946 | CLIENT ❌  |
| analytics/     | 11    | 1,697 | CLIENT ❌  |
| approvals/     | 4     | 537   | CLIENT ❌  |
| auth/          | 2     | 191   | ADMIN ✅   |
| comments/      | 1     | 155   | CLIENT ❌  |
| content/       | 21    | 1,999 | CLIENT ❌  |
| editor/        | 4     | 1,773 | CLIENT ❌  |
| inbox/         | 8     | 851   | CLIENT ❌  |
| instagram/     | 8     | 1,968 | CLIENT ❌  |
| notifications/ | 3     | 576   | CLIENT ❌  |
| publishing/    | 1     | 620   | CLIENT ❌  |
| queue/         | 8     | 743   | CLIENT ❌  |
| scheduling/    | 14    | 2,907 | CLIENT ❌  |
| security/      | 2     | 605   | ADMIN ✅   |
| settings/      | 4     | 827   | CLIENT ❌  |
| shared/        | 5     | 508   | BOTH       |
| webhooks/      | 5     | 2,322 | ADMIN ✅   |

### Summary

- Pages correctly in admin: **11** (30%)
- Pages that belong in client: **26** (70%)
- Component groups correctly in admin: **3** (auth, security, webhooks)
- Component groups that belong in client: **13** (ai, analytics, approvals, comments, content, editor, inbox, instagram, notifications, publishing, queue, scheduling, settings)
- Shared: **1** (shared/)

---

## apps/client — Current Contents

### Pages (9 total)

| Page                            | Status                          | Complete? |
| ------------------------------- | ------------------------------- | --------- |
| `/` (landing)                   | Provider health + quick actions | Partial   |
| `/login`                        | Full auth form                  | Yes       |
| `/register`                     | Full registration               | Yes       |
| `/dashboard`                    | Stats cards + recent activity   | Yes       |
| `/dashboard/posts`              | Advanced list with filters      | Yes       |
| `/dashboard/posts/new`          | Post editor + publishing        | Yes       |
| `/dashboard/posts/[id]`         | Post detail + edit              | Yes       |
| `/dashboard/posts/[id]/preview` | Platform preview                | Yes       |
| `/dashboard/templates`          | Template management (wrapper)   | Minimal   |

### What's Missing from Client

| Feature              | Priority | Exists in Admin?              | Admin Component Size |
| -------------------- | -------- | ----------------------------- | -------------------- |
| Social Inbox         | HIGH     | ✅ 8 components, 851 lines    | Full implementation  |
| Analytics Dashboard  | HIGH     | ✅ 11 components, 1,697 lines | Charts + insights    |
| Scheduling/Calendar  | HIGH     | ✅ 14 components, 2,907 lines | Multi-tab dashboard  |
| AI Features          | HIGH     | ✅ 25 components, 2,946 lines | Generate + optimize  |
| Approval Workflows   | MEDIUM   | ✅ 4 components, 537 lines    | Queue + review panel |
| Publishing Queue     | MEDIUM   | ✅ 8 components, 743 lines    | BullMQ monitor       |
| Asset Library        | MEDIUM   | ✅ 21 components, 1,999 lines | Grid/list/filter     |
| Channel Management   | MEDIUM   | ✅ Page exists                | Connect/disconnect   |
| Instagram Features   | MEDIUM   | ✅ 8 components, 1,968 lines  | Stories + upload     |
| Brand Voice Settings | LOW      | ✅ Form exists                | Config form          |
| Integration Settings | LOW      | ✅ Page exists                | Slack/Teams webhooks |
| Notification Prefs   | LOW      | ✅ Component exists           | Toggle settings      |

---

## The Real apps/admin (what should stay)

| Feature                           | Currently Exists?          | Completeness                       |
| --------------------------------- | -------------------------- | ---------------------------------- |
| Customer account management       | ✅ accounts page           | 90% — list, filter, edit           |
| Billing / subscription management | ✅ subscriptions page      | 80% — list, trials, MRR            |
| Revenue reporting                 | ✅ executive dashboard     | 70% — some metrics show 0          |
| Global platform config            | ❌                         | 0% — no global config page         |
| Compliance / audit logs           | ✅ compliance + logs pages | 90% — GDPR metrics, audit trail    |
| System health monitoring          | ✅ webhooks page           | 85% — events, DLQ, metrics         |
| Support tools                     | ❌                         | 0% — no customer support interface |

---

## Migration Scope

| Metric                                   | Value                                                            |
| ---------------------------------------- | ---------------------------------------------------------------- |
| Pages to move from admin → client        | 26                                                               |
| Component directories to move            | 13                                                               |
| Component files to move                  | ~126                                                             |
| Estimated lines of code to move          | ~20,000                                                          |
| Hook files to move                       | ~20 of 27                                                        |
| Pages that need building new in client   | ~5 (analytics, inbox, scheduling, channels, queue — as wrappers) |
| Pages to build new in admin (real admin) | ~3 (global config, support tools, customer impersonation)        |
| Shared packages affected                 | @packages/ui (used by both — no change needed)                   |

---

## Recommended Approach

### Option C: Rename/repurpose — make admin the client, build a new admin

### Reasoning

En mi opinión, Option C es la única opción sensata por estas razones:

1. **70% del admin ya ES el producto del cliente.** Mover 126 componentes, 26 páginas, y 20 hooks del admin al client es una migración masiva con alto riesgo de romper cosas. Es más simple renombrar lo que ya funciona.

2. **El client app tiene solo 9 páginas y le falta todo.** Construir sobre el client existente significaría reescribir o duplicar las 20,000 líneas que ya existen en admin. No tiene sentido.

3. **El admin real (owner portal) es pequeño.** Solo 11 páginas necesitan quedarse. Es más fácil extraer esas 11 páginas a un nuevo admin que mover las 26 páginas cliente.

### Plan concreto

1. **Renombrar `apps/admin` → `apps/client`** (o crear nuevo client desde admin)
2. **Extraer las 11 páginas admin** a un nuevo `apps/admin` limpio
3. **Eliminar del nuevo client** las páginas de owner (accounts, subscriptions, executive, compliance, security, logs, webhooks)
4. **El nuevo admin** tiene: login, dashboard (revenue/accounts), accounts, subscriptions, executive, compliance, security (MFA + RBAC), logs, webhooks, y las nuevas páginas que faltan (global config, support)

### Migration risk assessment

| Risk                                           | Severity | Mitigation                                                                                   |
| ---------------------------------------------- | -------- | -------------------------------------------------------------------------------------------- |
| Auth differences (admin MFA vs client regular) | HIGH     | Separar auth flows completamente — admin usa admin-session cookie, client usa client-session |
| Shared API routes                              | MEDIUM   | Backend ya soporta ambos — rutas son las mismas, auth middleware diferencia roles            |
| Component dependencies                         | LOW      | Todo pasa por @packages/ui que es shared — no hay coupling directo entre apps                |
| Navigation breakage                            | MEDIUM   | Sidebar nav necesita reconfigurarse — admin nav tiene items de producto mezclados            |
| Test regression                                | MEDIUM   | Los 38 admin tests son de UI — necesitan reasignarse a la app correcta                       |

---

## Honest Assessment

Creo que este problema es el resultado natural de construir features en el orden de "backend primero, UI después." Cada sprint agregó backend + UI, y la UI fue al admin porque era la app que ya existía y funcionaba. Nunca se hizo la separación porque no había un cliente externo todavía.

Lo que veo es un producto completo viviendo dentro de lo que se llama "admin." El admin real — el portal del dueño — es una capa delgada encima. Si Edward quiere lanzar esto a clientes, el cambio más importante no es construir más features — es separar correctamente quién usa qué.

En mi opinión, el esfuerzo de separación es de 1-2 sprints (M effort), pero el impacto es enorme: sin esta separación, no se puede dar acceso a clientes sin que vean el panel de administración del SaaS completo.
