# Post Publication Retraction Alert — Spec (post-publish-partial-failure)

> **Amendment 2026-09-16 (Q11–Q14).** This capability is NEW in this amendment. It did not exist in
> the proposal's capability list, which named two capabilities; the design gate's multi-fragment gap
> and Edward's Q13 created it. It is deliberately SMALL: one alert, one dedupe rule, one payload.
>
> **NEW capability** for change `post-publish-partial-failure` (N-COR-8). Capability: **when a
> channel resolves not-published while fragments of the post are STILL LIVE on the platform, and the
> platform cannot retract them, the customer is alerted URGENTLY through every notification channel
> the account has — because a manual retraction is then the only exit.**
>
> **Why it is a capability and not a log line.** Q12 puts retraction in a separate change (N-COR-10);
> until that lands, and afterwards whenever a provider exposes no delete capability or retraction
> exhausts its own budget, the system knowingly leaves content live that the customer did not intend
> to keep. A state nobody is told about is indistinguishable, from the customer's side, from a state
> that did not happen. Edward's words (Q13): "debe notificarsele al cliente de esto de forma urgente
> y por todos los medios posibles, dentro del dashboard, email, sms e hipoteticamente un push si
> terminamos creando una api para una tambien hipotetica aplicacion mobil."
>
> **Depends on** `post-channel-publication-record`: the record is what holds the not-published
> outcome, the live fragment references and the "pending retraction" state this capability reads. It
> states the requirement, never the delivery mechanism.
>
> **What exists today, measured 2026-09-16 (this is a dependency map, not a design).**
>
> | Medium                | State in the tree                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
> | --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
> | In-app (dashboard)    | **EXISTS.** `Notification` entity (`packages/core/domain/src/entities/Notification.ts`), `CreateNotificationUseCase` (`packages/core/notifications/src/`), technology-free `NotificationDispatchPort` (`packages/ports/src/NotificationDispatchPort.ts:31`) with its composition-root adapter (`apps/api/src/infrastructure/container/adapters/NotificationDispatchAdapter.ts`), routes (`apps/api/src/notifications/notificationRoutes.ts`) and a realtime broadcaster (`apps/api/src/services/NotificationBroadcaster.ts`). |
> | Email                 | **EXISTS, gated.** `NotificationMailer` port (`packages/core/domain/src/repositories/NotificationMailer.ts`) + `TransactionalEmailAdapter` (`apps/api/src/infrastructure/adapters/TransactionalEmailAdapter.ts`) behind `SendEmailNotificationService`, which sends ONLY for the four types in its `EMAIL_ENABLED_TYPES` allow-list (`packages/core/notifications/src/SendEmailNotificationService.ts:18-23`) and honours the recipient's preference.                                                                         |
> | Slack / Teams webhook | **EXISTS.** `ExternalNotifierPort` (`packages/core/domain/src/repositories/ExternalNotifierPort.ts:29`), `SlackNotifierAdapter`, `TeamsNotifierAdapter`, `ExternalNotificationDispatcher`.                                                                                                                                                                                                                                                                                                                                    |
> | SMS                   | **DOES NOT EXIST.** No SMS port, adapter, provider or configuration anywhere in `apps/` or `packages/` (searched tree-wide).                                                                                                                                                                                                                                                                                                                                                                                                  |
> | Push                  | **DOES NOT EXIST**, and is out of scope by Edward's own wording ("hipoteticamente… si terminamos creando una api"). Named here so it is a known gap, not a silent one.                                                                                                                                                                                                                                                                                                                                                        |
>
> The notification TYPE vocabulary is a closed set of nine values
> (`packages/core/domain/src/value-objects/NotificationType.ts:10-20`) with none for publication
> outcomes, and `NotificationEventHandlers` covers approvals, comments and mentions only — so this
> capability adds a type, it does not reuse one by coincidence.
>
> **Scenario tags.** `[integration]` — real row, real outbox. `[unit]` — vitest with doubles of the
> ports.

---

## Amendment 2026-09-17 (Q15–Q21)

Edward signed Q15–Q18 (`pre-propose-decisions.md` §"Third design gate follow-ups (rev 3, signed
2026-09-16)") and then Q19–Q21 (2026-09-17). What changed in this file:

1. **Delivery is the CUSTOMER's choice** (Q16), and for the PER-MEMBER media the rule is the same on
   each: the delivery requirement no longer names only the email allow-list, and no per-member medium
   is exempt from the per-type opt-out.
2. **DEFAULT delivery for the new type is IN-APP + EMAIL** (Q20, refining Q16). The dashboard needs no
   customer datum — it is the product itself, and it is where the confirm-manual-retraction act lives —
   so it is active by default alongside email, which is the only CONTACT medium on by default. SMS and
   push deliver once the customer adds them; Slack/Teams is governed by its config (item 5).
   **N-COR-8 adds NO per-medium switch**: the one per-type answer the tree holds speaks for every
   per-member medium at once, and making it per-medium is `customer-notification-policy`'s subject.
3. **NEW** requirement — the APPLICATION parametrizes the customer's ACTION WINDOW (Q16/Q17). When it
   expires the channel's outcome is finalized and the alert cycle ends; the content lock stays engaged
   until an explicit act, because a timeout decides nothing about what is live on a platform.
4. **Slack/Teams reach every ACTIVE config, regardless of that config's `events` filter** (Q18).
5. **Slack/Teams are SHARED destinations, and the ACTIVE CONFIG IS the switch** (Q21): they carry no
   per-member preference at all, deliver even when no member has the type on, and are turned off by
   deactivating the config.

The dedupe and outbox requirements are unchanged by this amendment.

### Dependencies named by this pass

| Dependency                         | What it owns                                                                                                                                                                                                                                                    | Relation to N-COR-8                                                                                                                                                                                                                                                                                         |
| ---------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **`customer-notification-policy`** | the full customer-configurable policy for EVERY notification type — which media carry which type, delivered simultaneously or as an escalation ladder in the customer's order with a customer-set interval, and the PER-MEDIUM switch that does not exist today | successor; N-COR-8 honours the per-type choice that exists today and invents no policy of its own. It inherits Q21: a shared destination stays governed by its config, not by a member preference                                                                                                           |
| **the SMS change**                 | the SMS port, adapter, provider, phone datum and consent — none of which exist anywhere in the tree                                                                                                                                                             | successor; this alert adopts SMS when it lands, under the same preference rule                                                                                                                                                                                                                              |
| **`integration-events-v2`**        | the OUTBOUND integration-event catalog (Zapier/Make subscriptions) and its delivery reliability — retry and DLQ per subscription                                                                                                                                | successor (Q19). **N-COR-8 adds NO new external integration event**: the alert event and the channel-keyed domain events stay INTERNAL — outbox to in-process consumers only. No `post.partially_published`, no `post.channel.*`, no `post.retraction_pending` projection is emitted outward by this change |

Push is a further gap, waiting on a mobile API; it is named in the delivery requirement rather than
here because no change owns it yet.

---

## Requirements

### Requirement: A channel stranded with LIVE FRAGMENTS raises an URGENT customer alert **[MERGE-BLOCKING]**

When a channel resolves to the terminal not-published outcome while fragments of the post remain live
on the platform — retraction impossible for that provider, or exhausted after its own budget — the
system SHALL alert the customer, and SHALL mark the alert as URGENT so it is not ranked with routine
notifications.

The alert SHALL be raised from the same truth as the record: it is a consequence of the recorded
state, not of a code path that happened to run. A channel that reaches "pending retraction" without
an alert is a defect of this requirement, whatever the reason the alert did not go out.

The alert SHALL NOT be raised when nothing is live — a channel that failed with no fragment on the
platform needs no manual act from the customer and SHALL NOT be escalated as if it did.

#### Scenario: an unretractable interrupted thread alerts the customer [integration]

- **GIVEN** a channel resolving not-published with two fragments live and no retraction capability for that provider
- **WHEN** the outcome is recorded
- **THEN** exactly one urgent alert exists for that `(post, channel)`, addressed to the post's account

#### Scenario: a clean failure raises no alert [unit]

- **GIVEN** a channel that failed with no fragment live on the platform
- **WHEN** the outcome is recorded
- **THEN** no retraction alert is raised

#### Scenario: a successful retraction raises no alert [unit]

- **GIVEN** an interrupted thread whose live fragments were retracted successfully
- **WHEN** the channel resolves
- **THEN** no retraction alert is raised, and the record shows nothing pending

---

### Requirement: The alert NAMES the post, the channel, the live fragments and the manual action **[MERGE-BLOCKING]**

The alert SHALL carry, in terms the customer can act on without reading a log:

| Field          | Obligation                                                                                                                                                   |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Post           | the post's identity and enough of its content to recognise it                                                                                                |
| Channel        | the channel's identity and its human-readable name; the provider is DERIVED from the channel, never carried as an independent targeting dimension (ADR-0016) |
| Live fragments | each live fragment's provider reference, and its link when the provider gives one                                                                            |
| Cause          | why retraction did not happen — no capability for this provider, or retraction exhausted — in the customer's vocabulary                                      |
| Action         | that the fragments must be removed MANUALLY on the platform, and that the channel can be retried only once nothing is live there                             |

An alert that says only "publication failed" SHALL NOT satisfy this requirement: it is the exact
failure this change exists to delete, moved into the notification layer.

The alert SHALL NOT carry credentials, tokens or provider secrets.

#### Scenario: the payload carries every field [integration]

- **GIVEN** an alert raised for an interrupted thread with two live fragments
- **WHEN** the delivered alert is read
- **THEN** it names the post, the channel and both fragment references, states the cause and states the manual action

#### Scenario: the provider is derived from the channel [unit]

- **GIVEN** an alert for a channel of a post
- **WHEN** its payload is built
- **THEN** the provider is derived from the channel and no independently chosen provider field is carried

---

### Requirement: Delivery reaches every medium the CUSTOMER chose, on EQUAL terms **[MERGE-BLOCKING]**

The alert is RAISED from the record unconditionally (requirement above); what the customer's choice
governs is DELIVERY. The alert SHALL be delivered on every medium that is ON for this notification
type and SHALL NOT be delivered on a medium that is off. Urgency raises the alert's RANK, never its
permission: an urgent alert SHALL NOT override the customer's choice on ANY medium (Q16).

**Two kinds of medium, each with its own switch, and neither exempt.**

| Kind               | Media                                      | What turns it on and off                                                          |
| ------------------ | ------------------------------------------ | --------------------------------------------------------------------------------- |
| PER-MEMBER         | in-app, email, and SMS/push when they land | the member's per-TYPE answer (`NotificationPreference`)                           |
| SHARED destination | Slack/Teams                                | the existence of an ACTIVE config; there is no per-member preference for it (Q21) |

**The per-member rule SHALL be the SAME on every per-member medium** — in-app, email, and every
per-member medium added later. There SHALL be no per-member medium exempt from the per-type opt-out
and none the opt-out cannot reach.

**What the tree actually holds, measured 2026-09-17.** In-app and email BOTH consult the same per-type
row — `CreateNotificationUseCase.ts:63-71` (`findByMember`, then skip when the matching preference is
present and disabled) and `SendEmailNotificationService.ts:37-41` — so neither per-member medium is
ungated. The one real gap on that side is email's ADDITIONAL hard-coded four-type allow-list
`EMAIL_ENABLED_TYPES` (`SendEmailNotificationService.ts:18-23`), which no customer preference can
open — hence the admission clause below. The Slack/Teams fan-out is keyed by project + event
(`ExternalNotificationDispatcher.broadcast`) and reads no member preference at all; under Q21 that is
the CORRECT shape for a shared destination, not a gap to close.

Underneath the per-member side there is NO per-medium switch: `NotificationPreference` is ONE
`enabled` boolean per `(memberId, type)` (`schema.prisma:437-447`, `@@unique([memberId, type])`,
defaulting to enabled), so the per-type answer necessarily speaks for every per-member medium at once.
**N-COR-8 SHALL NOT add a per-medium switch** — that model is `customer-notification-policy`'s
(dependency table above). What this requirement obliges is that every per-member medium honour the ONE
answer that exists, with none exempt.

**Default delivery for this type is IN-APP + EMAIL** (Q20). Absent an explicit customer choice, the
alert SHALL be delivered BOTH in-app and by email, and SHALL NOT be delivered on any other medium:

- **in-app** is on by default because it needs no customer datum — the dashboard is the product, and it
  is where the confirm-manual-retraction act lives, so the alert sits next to the act it demands;
- **email** is on by default because it is the one CONTACT datum the platform holds from signup;
- **SMS and push** SHALL deliver only once the customer has added them;
- **Slack/Teams** is not governed by this default at all — its switch is its config (below).

The email type allow-list (`EMAIL_ENABLED_TYPES`, `SendEmailNotificationService.ts:18-23`) SHALL
therefore ADMIT this type, so that the default is a delivered email and not a silently dropped one.

The customer's per-TYPE answer SHALL be honoured by every per-member medium alike — in-app and email
read the SAME `NotificationPreference` row, which defaults to enabled — so switching the type off
silences both together and switching it on restores both together. That single answer is the whole of
the customer's control in this change.

**Slack/Teams are SHARED destinations, and the ACTIVE CONFIG IS the switch (Q21).** Both carry
messages to channels shared by many people, and a shared channel is a legitimate destination even when
no individual member has this type on — Edward's words: "si no hay usuarios activos de igual forma
pueden enviarse a estos grupos/channels con multiples recipients". Therefore:

- every ACTIVE config SHALL receive the alert, and delivery to it SHALL NOT consult any member's
  per-type preference — the config, not a preference row, is the customer's stipulation for that
  medium, which is how this reconciles with Q16 rather than excepting it;
- delivery SHALL happen even when NO member has the type enabled;
- the medium is turned OFF by DEACTIVATING the config, and that SHALL be the only off switch for it;
- the config's `events` filter SHALL NOT gate this alert (Q18): the filter predates this event type,
  so honouring it would make the alert invisible on every config that exists today.

No per-member preference SHALL be invented for Slack/Teams in this change; `customer-notification-policy`
inherits this rule rather than overturning it.

A medium that does not exist yet is a DEPENDENCY, not an exemption: **SMS** has no port, adapter or
provider anywhere in the tree (table above), and **push** waits on a mobile API. Both are per-member
contact media and SHALL carry this alert under the per-type rule when they land — visible as a gap,
never silently dropped from the list.

Delivery SHALL be per-medium best-effort and SHALL NOT be all-or-nothing: a medium that fails SHALL
NOT suppress the others, and SHALL NOT roll back the recorded outcome that raised the alert. The
recorded state is the source of truth; the alert is its announcement.

An opt-out SHALL silence the ANNOUNCEMENT and never the TRUTH: the record keeps the pending
retraction, the post stays locked, and the customer-facing per-channel reading still shows the live
fragments and the manual action (`post-channel-publication-retry`). A customer who switches the type
off is never left unable to SEE the state — only unprompted about it.

This capability honours the per-type choice that exists today and SHALL NOT invent a delivery policy
of its own; the full policy is `customer-notification-policy` (dependency table above).

#### Scenario: the default is in-app plus email [integration]

- **GIVEN** a customer with no explicit choice recorded for this notification type and no active Slack/Teams config
- **WHEN** an urgent retraction alert is raised
- **THEN** it is delivered in-app AND by email, and on no other medium

#### Scenario: the per-type opt-out silences every per-member medium alike [unit]

- **GIVEN** a customer who has disabled this notification type
- **WHEN** an urgent retraction alert is raised
- **THEN** neither in-app nor email delivers it — in-app included, despite being a default medium — and the channel's recorded pending retraction is unchanged

#### Scenario: an added medium delivers alongside the defaults [unit]

- **GIVEN** a customer who has added a further per-member medium for this notification type
- **WHEN** an urgent retraction alert is raised
- **THEN** it is delivered on that medium as well as in-app and by email, and media the customer has not added are reported as not delivered rather than counted as delivered

#### Scenario: every active Slack/Teams config receives the alert [integration]

- **GIVEN** a customer with two active Slack/Teams configs whose `events` filters do not name this event type, and NO member with this notification type enabled
- **WHEN** an urgent retraction alert is raised
- **THEN** both configs receive it — no config is skipped for its `events` filter, and none is skipped for a member preference, because an active config IS the switch for that shared destination

#### Scenario: a deactivated Slack/Teams config is the off switch [unit]

- **GIVEN** a customer whose only Slack/Teams config has been deactivated
- **WHEN** an urgent retraction alert is raised
- **THEN** it is not delivered to that destination, and no member preference was consulted to decide it

#### Scenario: one medium failing does not suppress the others [unit]

- **GIVEN** an alert whose email delivery fails while another enabled medium succeeds
- **WHEN** delivery completes
- **THEN** the other medium's alert still exists, and the channel's recorded outcome is unchanged

#### Scenario: the type is admitted by the email allow-list [unit]

- **GIVEN** the urgent retraction alert type and a customer who has not opted it out
- **WHEN** email gating is evaluated
- **THEN** the alert is admitted, and it is not silently filtered out as a non-enabled type

---

### Requirement: The customer's ACTION WINDOW is APPLICATION-parametrized, and expiry closes the ALERT — never the LOCK **[MERGE-BLOCKING]**

The time the customer has to act on a pending retraction SHALL be parametrized by the APPLICATION, not
by the customer (Q16): a configured value with a DOCUMENTED default, read from the typed environment
(SECURITY_CANON §Secrets and Environment — no `process.env` read outside the env module, no fallback
literal at the call site).

When that window EXPIRES:

- the channel's outcome SHALL be FINALIZED as the terminal not-published one, with a recorded cause
  naming the expiry — a resolution the record can be READ for, never an inference recomputed from
  elapsed time at each read;
- the ALERT CYCLE SHALL END: the standing alert SHALL be resolved and marked expired, and no further
  alert for that `(post, channel)` SHALL be raised or re-sent — including on a later change to the live
  fragment set, which the dedupe rule above would otherwise re-send;
- the post SHALL read `FAILED` or `PARTIALLY_PUBLISHED` by the same derivation as any other finalized
  channel ("Partially Posted" requires at least one FULLY published channel).

**Expiry SHALL NOT clear the live fragments and SHALL NOT release the content lock** (Q17). The window
fixes the OUTCOME and ends the ANNOUNCEMENT; it decides nothing about what is live on a platform,
which only an explicit act can settle — the customer's confirmation that the fragments were removed,
or retraction by N-COR-10. A timeout that unlocked the post would let the customer rewrite copy that
is still live on a provider, the exact defect Q3 forbids, and it would assert a fact about the
platform that the system cannot know.

The confirmation act SHALL remain available AFTER expiry: an expired window closes the alert, never
the exit (`post-channel-publication-retry`).

#### Scenario: expiry finalizes the outcome and stops the alerting [integration]

- **GIVEN** a channel with fragments pending retraction and an outstanding alert whose action window has passed
- **WHEN** the window expires
- **THEN** the channel's outcome is finalized not-published with a cause naming the expiry, the alert is resolved as expired, and no further alert is raised for that `(post, channel)` even when the live fragment set later changes

#### Scenario: expiry does not unlock the content [unit]

- **GIVEN** a channel whose action window expired while its fragments are still live
- **WHEN** a content update for the post is attempted
- **THEN** it is refused, the live fragment references are still held, and the post's live-content predicate is still true

#### Scenario: confirmation after expiry still unlocks [unit]

- **GIVEN** a channel whose action window expired and whose live fragments the customer then confirms removed
- **WHEN** the confirmation is recorded
- **THEN** the pending retraction is cleared with its recorded cause, and the content lock releases once no channel of the post holds live content

---

### Requirement: The alert is DEDUPLICATED per (post, channel) and re-sent only on CHANGE **[MERGE-BLOCKING]**

At most ONE outstanding alert SHALL exist per `(post, channel)` pair. Recording the same outcome
again — a redelivered event, a retried job, a second reader of the same record — SHALL NOT produce a
second alert.

The alert SHALL be RE-SENT only when the SET OF LIVE FRAGMENTS CHANGES: a fragment retracted or
manually removed, or a further fragment discovered live. An alert whose content would be identical
SHALL NOT be re-sent, and a stale alert naming fragments that are no longer live SHALL NOT be left
standing as the customer's latest word.

The dedupe identity SHALL be DETERMINISTIC, derived from the record (the `(post, channel)` pair and
the live fragment set), never from a generated identifier — `randomUUID()` / `Math.random()` in a
dedupe key is hard-zero under fitness #7 for exactly this reason.

When nothing is live any more, the alert SHALL be resolved: it SHALL NOT keep asking the customer for
an act that is already done.

#### Scenario: a redelivered outcome does not double-alert [integration]

- **GIVEN** a channel outcome with live fragments recorded, then the same outcome redelivered
- **WHEN** both are processed
- **THEN** exactly one alert exists for that `(post, channel)`

#### Scenario: a changed fragment set re-alerts [unit]

- **GIVEN** an outstanding alert naming two live fragments, one of which is then removed
- **WHEN** the record is updated
- **THEN** the alert is re-sent naming the remaining fragment, and the superseded one is not left standing

#### Scenario: an unchanged fragment set does not re-alert [unit]

- **GIVEN** an outstanding alert and a record write that leaves the live fragment set identical
- **WHEN** the write commits
- **THEN** no new alert is raised

#### Scenario: the alert resolves when nothing is live [unit]

- **GIVEN** an outstanding alert whose fragments are all retracted or recorded as manually removed
- **WHEN** the record is updated
- **THEN** the alert is resolved and no longer asks for a manual act

---

### Requirement: The alert rides the EXISTING outbox / domain-event path (internal consumers only — Q19) **[MERGE-BLOCKING]**

The alert SHALL be raised through the same event path the rest of the system already uses: the
triggering domain event is written to the outbox **in the SAME transaction** as the record change
that caused it (ARCHITECTURE_CANON §Event-Driven Architecture), and delivery happens off that event
in-process (never projected to external integration subscribers in this change — see
`integration-events-v2`). The record write SHALL NOT be coupled to the success of a notification
provider, and no notification call SHALL be made inside the transaction (canon: no external API calls
inside the UoW).

The consumer SHALL be IDEMPOTENT — processing the event twice SHALL produce the same single alert as
processing it once, which is the dedupe rule above seen from the consumer's side.

This requirement fixes the SEAM, not the transport: which port carries which medium, whether a new
notification type or a dedicated alert model is introduced, and where the consumer lives, are design's
calls.

#### Scenario: the alert event and the record change share one transaction [integration]

- **GIVEN** a channel resolving with fragments pending retraction
- **WHEN** committed state is examined
- **THEN** no committed state carries the record change without its outbox row, or the outbox row without the record change

#### Scenario: a notification failure does not roll back the outcome [integration]

- **GIVEN** an alert whose delivery fails after the record committed
- **WHEN** the record is read back
- **THEN** the channel's outcome and its live fragment references are unchanged

#### Scenario: the consumer is idempotent [unit]

- **GIVEN** the alert event delivered twice
- **WHEN** the consumer processes both
- **THEN** exactly one alert exists

---

## Verification note (strict TDD — RED → GREEN)

Every requirement here is RED on the unmodified tree for a structural reason: no publication-outcome
notification type exists (`NotificationType.ts:10-20`), and nothing reads a per-channel record because
none exists. The dangerous red is the DEDUPE one — on a tree without a deterministic identity it fails
by alerting the customer repeatedly for the same stranded thread, which trains them to ignore the one
alert that obliges a manual act. That scenario therefore asserts the NUMBER of alerts, not an HTTP
status.

The ACTION-WINDOW scenarios SHALL drive expiry from a controllable clock, never by sleeping, and SHALL
assert the RECORDED cause and the still-engaged lock — not silence alone, which a system that simply
stopped alerting would also produce. The DELIVERY scenarios are red for a second reason, and it is NOT
that in-app is ungated — it is not (`CreateNotificationUseCase.ts:63-71`). They are red because
email's hard-coded allow-list would drop this type before any preference is read
(`SendEmailNotificationService.ts:18-23`), and because the shared-destination rule (Q21) is the
opposite of the per-member one: the Slack/Teams scenario asserts delivery to every active config with
NO member enabling the type, so an implementation that "helpfully" gates that fan-out on a preference
row fails it. Those two, not a missing in-app gate, are what the scenarios have to catch.

Integration scenarios need DB + Redis via `pnpm db:up` and run inside a real Unit of Work. Every new
suite is named by EXACTLY ONE `run_batch` in `apps/api/scripts/run-tests.sh` (fitness #30). New code
carries JSDoc `@file`/`@description`/`@layer` (fitness #9/#10) with no phase or sprint reference
(fitness #8).
