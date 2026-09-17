# Pre-propose decisions: post-publish-partial-failure (N-COR-8)

**Status**: SIGNED (2026-09-16) — every non-optional question below carries Edward's decision, including the three research follow-ups (Q7–Q9). The selected research lane is DONE (`research.md`, gate PASS); `sdd-propose` may run.
**Date opened**: 2026-09-16 · **Input**: `explore.md` (gate PASS) · **Owner of the decisions**: Edward Velasquez.
**Recommendations were the orchestrator's input; the "Decision" line is what governs.** Where Edward answered in his own words, the answer is quoted verbatim (Spanish) and rendered in English underneath.

Reference: option table in `explore.md` §6 (A post-level `PARTIALLY_PUBLISHED` · B per-channel record as source of truth · C wire `markAsFailed` + retry command · D atomic publish, rejected · E one saga per channel).

---

## Research lane — SELECTED (completion is mandatory before propose)

**Lane**: how comparable multi-channel schedulers model partial publication (per-channel state vs post-level status, retry of failed channels, content locking after the first channel publishes), and the canonical guidance for saga forward recovery with N independent external effects (Richardson, Azure Architecture Center; Vernon on aggregate rollups).
**Decision**: **Seleccionar** — run `sdd-research` on this lane; its artifact is `research.md` in this change directory. Propose reads it.

---

## Q1 — Is a post that reached 2 of 3 channels "published" for the numbers the business counts?

**Evidence**: dashboard tile counts `status === "PUBLISHED"` (`apps/client/app/[locale]/dashboard/page.tsx:62`); top-performers requires `PUBLISHED` **and** `publishedAt not null` (`PrismaPostQueryRepository.ts:339-352`); `incrementPostPublished()` fires at SCHEDULE time (`SchedulePostUseCase.ts:192`, pre-existing defect).
**Decision**: **ONE rule** — a post counts as published only when EVERY intended channel has published, derived from the per-channel record. Channel-level counts (billing/analytics) count each channel publication. The schedule-time increment is a separate backlog row, not absorbed here.

## Q2 — What can the user DO after a partial failure?

**Evidence**: no retry capability exists anywhere; the only re-publish path (`SagaIntegration.ts:428-432`) admits `DRAFT` only; the worker's `dedupeKey` + `OK`-skip (`publishHandler.ts:726, :733-739`) makes a re-drive channel-selective by accident.
**Decision (verbatim)**: "No solo TODOS los canales tienen que publicar para considerarse PUBLISHED, debe existir una parte en la interfaz de usuario que deje ver que todos los canales publicaron, y que deje hacer retry a los canales que faltan, y si existe algun problema puntual del canal, una mala configuracion, una cuenta suspendida u otro que este sea excluido y se lea com PARTIALLY Posted."
**Rendering**: (1) `PUBLISHED` requires ALL channels published (restates Q1); (2) the customer UI MUST show per-channel publication outcome; (3) the user MUST be able to retry the channels that are missing; (4) a channel with a problem of its own (misconfiguration, suspended account, or similar) is EXCLUDED, and the post then reads as **"Partially Posted"** (`PARTIALLY_PUBLISHED`).
**Scope consequence**: this is more than one slice — per-channel record + derived status + customer-facing per-channel UI + user-triggered retry of failed channels + exclusion semantics with reasons. `sdd-propose` slices it; the first slice must at least land the record and the derived status so the UI and the retry have something true to read.

## Q3 — Is a partially published post EDITABLE?

**Evidence**: today yes, twice — the post stays `DRAFT`, and `FAILED` is editable too (`PublishStatus.ts:181-182`).
**Decision**: **LOCK content the moment the first channel publishes.** Editing content that is live on a provider is a separate capability (edit-in-place per provider or re-publish as new), out of this change.

## Q4 — Status model

**Evidence**: `Post.status` is a free string (`schema.prisma:701`); `PUBLISHED` is terminal (`PublishStatus.ts:45`); ADR-0016 makes the channel the canonical targeting unit; a new status word costs 7 status unions + 6 UI maps.
**Decision**: **Confirmed reading of Q2** — option B as the model: a per-channel record (intended targets + outcome + reason) inside the Post boundary is the source of truth, and the post-level status is DERIVED: all channels OK → `PUBLISHED`; transient failures → the post stays in progress with retry available; a channel excluded for a problem of its own → **`PARTIALLY_PUBLISHED`** visible to the user. Implies a per-channel table (fitness #39 enrollment + RLS migration), a new status value (no DB migration — free string), and the read-model/UI blast radius named in the explore.

## Q5 — Should ONE provider's webhook flip the WHOLE post to `PUBLISHED`?

**Evidence**: `facebookWebhookProcessor.ts:421-424`, `xWebhookProcessor.ts:444`, `instagramWebhookProcessor.ts:343`, `youtubeWebhookProcessor.ts:400`, `tiktokWebhookProcessor.ts:363` — unguarded, no `publishedAt`, no version bump; can strand a post in terminal `PUBLISHED` with a null timestamp, which N-COR-1's promotion refuses with `INTERNAL_ERROR`.
**Decision**: **Own slice, named now — N-COR-9 "webhook-driven post status".** N-COR-8's derived status must leave the processors' direct `prisma.post.update` nothing legitimate to write, so N-COR-9 becomes a deletion, not a redesign.

## Q6 (optional) — DELETE / ARCHIVE of a post live on 2 providers?

**Evidence**: `PublishLog.postId` nullable with `onDelete: SetNull` (`schema.prisma:948`).
**Decision**: **Out of scope — backlog row**, alongside the `PublishLog` model verdicts (name, `updatedAt`, `accountId`).

---

## Research follow-ups — SIGNED (2026-09-16, after `research.md`)

The selected research lane (`research.md`, gate PASS) confirmed Q1–Q6 and surfaced three questions the evidence could not settle. Edward decided each.

### Q7 — Is `PARTIALLY_PUBLISHED` a resting state or terminal?

**Evidence**: sources split — ContentStudio treats partial as effectively terminal (duplicate to reschedule) [research S7]; Azure Scheduler-Agent-Supervisor treats it as a resting state the operator remediates and resubmits [research S14].
**Decision**: **RESTING state** — after remediation, retrying the missing channels can complete the post to `PUBLISHED` (derived). Double-publish risk is covered by the per-(post, channel) deterministic dedupe key (fitness #7).

### Q8 — Can an EXCLUDED channel be re-included after remediation, publishing the SAME locked content?

**Decision**: **YES** — the content stays locked (Q3); a retry publishes exactly what is live on the other channels. Exclusion is a per-channel state within the post, not an irreversible decision.

### Q9 — Content-lock consistency: immediate (strong boundary) or eventual (brief window)?

**Evidence**: "lock on first publish" is a set-level predicate, which places the per-channel record inside the `Post` aggregate (Vernon, research S17/S18); with up to 11 workers finishing concurrently, root-mediated child writes contend on the post's version. Eventual consistency would open a brief window where content already live on one network is still editable.
**Decision**: **IMMEDIATE — strong boundary, contention accepted.** Per-channel record inside `Post`, written through the root, optimistic-concurrency conflict retry on the worker side. The lock never has a window. Design must size the retry policy for the contention, not weaken the guarantee.

### Q10 — A content fingerprint per (post, channel)?

**Evidence**: idempotency by IDENTITY already exists — the worker's `dedupeKey = job.dedupeKey ?? \`${postId}:${channelId}\`` (`apps/workers/src/publishHandler.ts:726`) is consulted before publishing (`:733`) and `PublishLog.dedupeKey`is`@unique` (`schema.prisma:945`); fitness #7 forbids random dedupe keys. No content hash exists for posts anywhere in the tree (only device/file/chunk hashes). Within one post the locked content (Q3) makes a hash constant, so it adds nothing to retry safety; its value is AUDIT (what exactly went out, per channel) and a cross-post duplicate guard (same content, different `postId`, same channel), which carries false-positive risk (`RecurringPost`) unless it is per channel, time-windowed and user-confirmable.
**Decision** (2026-09-16): **YES for the audit half now** — the per-channel publication record carries the `contentHash` of the locked content as published (Slice 1); the identity key stays the retry guarantee. **The cross-post duplicate guard is its OWN backlog row / slice** with its product decisions (window, confirmation), not part of N-COR-8.

### Design-gate follow-up — the none-published case (D15.1)

**Decision** (2026-09-16): **CONFIRMED — `FAILED`.** A post where no channel published and every channel is excluded reads with the existing failure vocabulary, never "Partially Posted"; "Partially Posted" requires at least one published channel. Kept isolated as one branch of the derivation so it stays flippable.

### Design-gate follow-up (rev 2, C-new-1) — multi-fragment posts (threads) are ALL-OR-NOTHING per channel

**Context**: X returns `THREAD_INTERRUPTED` only when some tweets are already live (`packages/providers/x/src/XAdapter.ts:363-371`); a retry re-sends the whole thread (`apps/workers/src/publishHandler.ts:574-581`, `XAdapter.ts:321-348`), so a "partially published channel" would either double-post or strand the post. Rev 2 had made it non-re-includable, silently amending Q8 and D15.1.
**Decision Q11 (verbatim)**: "un hilo no puede quedar incompleto, o salen todos o ninguno, si salieron todos menos 1, o salio uno y el siguiente no, esto da igual, es o todos o nada, si salio alguno se retira del canal/plataforma y se marca como fallado, el PUBLISHED y PARTIALLY_PUBLISHED solo se usa si fue/fueron publicado/s todos los fragmentos del post en todos o al menos 1 de los canales seleccionados." And: "Si es una publicacion de un solo canal, y es un hilo de digamos 3 tweets y el primero sale pero los otros 2 no salen incluso luego del retry, lo ideal seria retirar/despublicar los anteriores… para efectos del post se considera failed, eso aplica para todos los canales. Ahora, si es multicanal y se publica en digamos 3 de 4 y ese ultimo canal fallo en publicar, entonces se considera failed para el canal, pero partially posted para el post (sencillo o hilo) en general."
**Rendering (confirmed by Edward, 2026-09-16)**: per CHANNEL, `PUBLISHED` only when EVERY fragment went out; otherwise the fragments that went out are RETRACTED from the platform and the channel is `FAILED`. Per POST: `PUBLISHED` when every selected channel is `PUBLISHED`; `PARTIALLY_PUBLISHED` when at least one channel is fully `PUBLISHED` and at least one is failed/excluded; `FAILED` when no channel is fully published. A "partially published channel" NEVER persists as a state. Consequently Q8 stays intact (a failed channel is re-includable; the re-send of the whole thread does not duplicate because nothing is live) and D15.1 stands in its literal wording ("Partially Posted" requires ≥1 fully published channel).

**Decision Q12 — retraction is its OWN change**: retracting published fragments is a NEW capability (no provider port exposes delete/unpublish today; only the X, Telegram and YouTube adapters carry an internal delete method; 8 providers none). It is **N-COR-10 "thread atomicity: retraction"** (port + per-provider adapters + a compensating step in the worker, with a per-provider capability table). N-COR-8 ASSUMES it: it models the outcome "failed with live fragments pending retraction" and keeps the content lock while anything is live.

**Decision Q13 — when retraction is impossible or fails (verbatim)**: "Si no se pueden retirar los fragmentos luego de que algun otro fragmento falle incluso luego del retry, debe notificarsele al cliente de esto de forma urgente y por todos los medios posibles, dentro del dashboard, email, sms e hipoteticamente un push si terminamos creando una api para una tambien hipotetica aplicacion mobil."
**Rendering**: the channel reads `FAILED` with an explicit reason naming the live fragments (retraction pending); the customer is notified URGENTLY through every available notification channel — in-app dashboard, email, SMS; push when a mobile API exists — so they can retract manually; the content lock stays engaged while any fragment is live (orchestrator's reading, consistent with Q3: live content is never editable).
**Q13 media scope (Edward, 2026-09-16, after measurement)**: in-app (`NotificationDispatchPort`) and email (the new notification type enrolled in `EMAIL_ENABLED_TYPES`, `SendEmailNotificationService.ts:18-23`) ship with N-COR-8 — plus Slack/Teams where the account has them (`ExternalNotifierPort`); **SMS does not exist in the tree** (no port, adapter, provider, phone data or consent) and is its OWN named change that the alert adopts when it lands; push arrives with a mobile API. Nothing is dropped silently: the alert spec names SMS and push as dependencies.

**Decision Q14 — retry is publish-now only**; scheduling a retry is not a capability of this change.

### Third design gate follow-ups (rev 3, signed 2026-09-16)

**Q15 — the stranded-channel window**: the "confirm manual retraction" route + use case move from Slice 2a into **PR 1d** (the root method `clearPendingRetraction` already lands in 1b); only the panel affordance stays in 2b. No customer is left without an exit on `main`.

**Q16 — notification preferences are the CUSTOMER's (verbatim)**: "Los tipos de notificaciones deben ser parametrizables incluidos por el cliente y solo el decide cuales quiere agregar, nosotros solo enviamos los que el seleccione, incluso se les puede agregar una opcion de que sea en el orden de preferencia que el decida cada ciertos minutos tambien parametrizable por el cliente, o si asi lo quiere enviar las notificaciones a todos los medios que el quiera al mismo tiempo, solo cumplimos con lo que el cliente estipule, lo que si tenemos que parametrizar nosotros como aplicacion es el tiempo de espera a que el cliente accione y de no hacerlo pasar el fragmento a failed y el post a failed o partially completed." And on defaults: "Viene activo por defecto solo para email que es la pieza de informacion del cliente que nosotros tenemos cuando el se registra, de resto no tenemos nada mas hasta que el lo agrega. asi que la notificacion por defecto es al email hasta que el decida que y como lo quiere recibir."
**Rendering**: (1) an urgent alert NEVER overrides the customer's per-type preference — the same rule on every medium (no in-app/email asymmetry); (2) the new type's DEFAULT delivery is **email only** (the one contact datum we hold at signup); in-app, Slack/Teams and any other medium deliver only once the customer has enabled/added them; (3) the full policy — media per type, simultaneous vs an escalation ladder in the customer's preferred order with a customer-set interval — is a NEW change **`customer-notification-policy`** applying to every notification type, not part of N-COR-8; N-COR-8 honours what exists today (the per-type preference) without inventing policy; (4) what the APPLICATION parametrizes is the **action timeout**: an env-configured wait (documented default) for the customer to act on a pending retraction; when it expires, the channel is finalized `FAILED` and the alert cycle ends; the post reads `FAILED` or `PARTIALLY_PUBLISHED` per D15.1.

**Q17 — the content lock after the timeout**: it STAYS engaged until the customer confirms the manual retraction (the 1d route) or N-COR-10 retracts; the timeout closes the ALERT cycle and fixes the channel's outcome, never the truth about live content (Q3: live content is never editable).

**Q18 — Slack/Teams**: the urgent alert reaches every ACTIVE Slack/Teams config the customer has, regardless of that config's `events` filter (the filter predates this event; respecting it would make the alert invisible on every existing config). Reconciled with Q16 by the fact that a config only exists because the customer added it; `customer-notification-policy` later unifies filter and preference.

**Q20 — in-app default (2026-09-17)**: for the new type, the IN-APP (dashboard) notification is ACTIVE by default together with email — the dashboard is the product itself and needs no customer datum, and it is where the "confirm manual retraction" act lives; Slack/Teams, SMS and push deliver only once the customer adds them. The customer can switch any medium off per type; the full policy stays `customer-notification-policy`. This refines Q16's "email only" default: email is the only CONTACT medium on by default.

**Q20 scoping (orchestrator, 2026-09-17, under Q16/Q20)**: the tree holds ONE `enabled` boolean per `(memberId, type)` (`NotificationPreference`, `@@unique([memberId, type])`, default enabled) and NO per-medium dimension; both the in-app path (`CreateNotificationUseCase.ts:63-71`) and the email path (`SendEmailNotificationService.ts:37-41`) consult that same row. N-COR-8 therefore honours the existing per-type switch on every medium alike and does NOT add a per-medium switch (no new preference table, enum or route change) — "switch any medium off per type" is `customer-notification-policy`'s. Defaults for the new type: the per-type switch defaults to enabled, so in-app + email deliver unless the customer turns the type off; email additionally requires the type to be admitted in `EMAIL_ENABLED_TYPES`.

**Q21 — Slack / Teams are SHARED destinations (verbatim)**: "Ambos tienen la opcion de dirigir mensajes a canales compartidos por muchos usuarios, si no hay usuarios activos de igual forma pueden enviarse a estos grupos/channels con multiples recipints."
**Rendering**: an active Slack/Teams config of the project IS the switch for that medium — the alert is delivered to every active config regardless of any member's per-type preference and even when no member has the type on (the config is the customer's stipulation for that shared medium, Q16); it is turned off by deactivating the config. No per-member preference is offered for Slack/Teams; `customer-notification-policy` inherits this rule.

**Q19 — Zapier / Make (outbound integration events)**: measured 2026-09-17 — the platform already has an outbound integration surface (`zapierRoutes.ts` REST hooks, `makeRoutes.ts` REST hooks + actions + polling, `integrationAuthMiddleware` API keys per platform, `IntegrationSubscription.targetUrl`, delivery through `IntegrationEventDeliveryHandler` over a 10-event catalog: `post.created/updated/scheduled/unscheduled/published/failed/cancelled/media_added/media_removed/submitted_for_review`, best-effort `Promise.allSettled` fan-out with no per-subscription retry; the outbound catalog is not documented in `docs/api/webhooks.md`). N-COR-1 made `post.published` fire for publish-now for the first time (the promotion never ran before). **Decision**: N-COR-8 adds NO new external integration events — no `post.partially_published`, no per-channel `post.channel.*`, no `post.retraction_pending` projection; D11's channel-keyed domain events and D17's alert event stay INTERNAL (outbox → in-process consumers only). The outbound catalog growth AND outbound delivery reliability (retry / DLQ per subscription) are one dedicated change, **`integration-events-v2`**, named as a successor.

---

## Consequences now fixed by the answers

- Q4 → there IS a schema migration (per-channel table) with fitness #39 enrollment + RLS; `PARTIALLY_PUBLISHED` enters `PublishStatusValue` and the FSM.
- Q2 + Q3 → FSM edges: content locks at first channel publish; `isEditable()` excludes any post with ≥1 published channel; retry is channel-scoped.
- Q5 → the five webhook processors are OUT of N-COR-8's blast radius (N-COR-9).
- ADR-0024 is owed (the durable record of a post's publication, per channel). Two files claim ADR-0020 — 0024 is the next free number.
- Backlog rows owed by this round: schedule-time `incrementPostPublished()`; `PublishLog` model verdicts + delete/archive orphaning (Q6); N-COR-9 named.
