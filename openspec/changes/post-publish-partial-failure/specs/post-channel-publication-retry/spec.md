# Post Channel Publication Retry — Spec (post-publish-partial-failure, Slice 2)

> **NEW capability** for change `post-publish-partial-failure` (N-COR-8). Capability: **the customer
> can SEE what happened on every channel of a post and ACT on the channels that are missing — an
> explicit, channel-scoped retry that is idempotent under double submit, re-includes an excluded
> channel after remediation, and publishes exactly the content that is already live elsewhere.**
>
> **Why this is a capability and not a screen.** A retry that is not idempotent double-posts to a
> provider, and a provider double-post cannot be undone (there is no compensation past the pivot).
> A panel that shows a channel outcome the record does not hold is a second source of truth. Both
> failure modes are behavioural, so they are specified here rather than left to the UI slice.
>
> **Depends on Slice 1** (`post-channel-publication-record`): the record, the derived status, the
> content lock, the per-channel budget and the re-drive primitive. Nothing here re-states those; this
> capability adds the USER-TRIGGERED act and the customer-facing reading of the record.
>
> **Decisions already signed (Edward, 2026-09-16 — `pre-propose-decisions.md`):** the customer UI
> MUST show per-channel outcome and MUST let the user retry the missing channels; a channel with a
> problem of its own is EXCLUDED and the post reads "Partially Posted" (Q2); content stays LOCKED
> (Q3); `PARTIALLY_PUBLISHED` is a RESTING state (Q7); an excluded channel is re-includable after
> remediation, publishing the SAME locked content (Q8).
>
> **Left OPEN for design.** The transport shape of the retry (command/route naming, one channel per
> request vs a set), the panel's layout and copy, and whether the retry reuses the re-drive primitive
> or carries its own entry point. Every requirement below is satisfiable by any of those.
>
> **Scenario tags.** `[integration]` — real row, real queue, real outbox. `[unit]` — vitest with
> doubles of the ports. `[static]` — decidable by inspecting source. Frontend scenarios run in the
> frontend vitest tier and are tagged `[unit]`.

---

## Amendment 2026-09-17 (Q15–Q18)

Edward signed Q15–Q18 (`pre-propose-decisions.md` §"Third design gate follow-ups (rev 3, signed
2026-09-16)"). What changed in this file:

1. **NEW** requirement (Q15) — the "confirm manual retraction" act (route + use case) SHALL be
   available to the customer in the SAME delivery window as the state it exits, so no customer is ever
   stranded on `main` with live fragments and no exit. The PANEL affordance may follow in this slice;
   the act SHALL NOT wait for it.
2. The act's availability after the application's action window expires is stated here too: the window
   closes the ALERT (`post-publication-retraction-alert`), never the exit (Q17).

Nothing else in this file changed; the retry's refusal while fragments are live (Q11/Q13) stands
exactly as written.

---

## Amendment 2026-09-16 (Q11–Q14)

Edward signed Q11–Q14 (`pre-propose-decisions.md` §"Design-gate follow-up (rev 2, C-new-1)"). What
changed in this file:

1. Re-inclusion (Q8) is aligned with Q11: a channel that had live fragments is re-includable ONLY
   once nothing is live on it — retracted (N-COR-10) or recorded as manually removed by the customer.
   The retry SHALL REFUSE with a named reason while fragments are live, because re-sending a thread
   over live fragments double-posts them and there is no undo past the pivot.
2. **Q14 — the retry is PUBLISH-NOW only.** Scheduling a retry for later is not a capability of this
   change; wording that could be read as scheduling is stated as out of scope.
3. The customer panel shows the pending-retraction state and the manual action, so the urgent alert
   (`post-publication-retraction-alert`) and the screen say the same thing.

---

## Requirements

### Requirement: An explicit channel-scoped retry acts ONLY on unpublished channels **[MERGE-BLOCKING]**

The customer SHALL be able to trigger a retry scoped to a channel of a post. The retry SHALL act only
on channels the record shows UNPUBLISHED (unresolved or excluded); for a channel already published it
SHALL make no provider call, SHALL enqueue no job, and SHALL leave that channel's recorded outcome,
external reference and publication moment untouched.

A retry naming a channel that is not in the post's recorded target set SHALL be refused as a client
error — the retry is an act on the RECORDED intent, never a way to add a target.

A retry for a post with no unpublished channel SHALL be refused as a client error and SHALL enqueue
nothing.

A retry SHALL NOT set the post's status directly. The status stays a pure function of the record
(Slice 1), so the post reaches `PUBLISHED` because the last channel published — not because a retry
route said so.

**The retry is PUBLISH-NOW only (Q14).** It SHALL take effect against the provider as soon as the
system can act on it; it SHALL NOT accept a future time, and "retry at" is not a capability of this
change. A retry that could be scheduled would also have to answer what happens when the content lock,
the target set or the channel's credentials change in between — questions this change does not open.

**A channel is retryable ONLY when nothing of this post is live on it** (Q11/Q13). A channel that
holds fragments PENDING RETRACTION SHALL be refused, with a reason naming those live fragments and
the manual action, and SHALL enqueue nothing — a re-send would double-post content that is already on
the platform. It becomes retryable once the record shows nothing live there, whether because
retraction succeeded (N-COR-10) or because the customer's manual removal was recorded.

#### Scenario: retrying a partially published post publishes only the missing channel [integration]

- **GIVEN** a post with two published channels and one excluded channel that has been remediated
- **WHEN** the customer retries that channel
- **THEN** exactly one publish job is enqueued for it, no provider call is made for the published channels, and on success the post derives `PUBLISHED` with `publishedAt` set

#### Scenario: retrying a published channel is a no-op [unit]

- **GIVEN** a channel the record shows published
- **WHEN** a retry is requested for it
- **THEN** no job is enqueued and its recorded outcome, identifier and publication moment are unchanged

#### Scenario: a retry for an untargeted channel is refused [unit]

- **GIVEN** a channel that is not in the post's recorded target set
- **WHEN** a retry is requested for it
- **THEN** it is refused as a client error, no record is created and no job is enqueued

#### Scenario: a retry with nothing to do is refused [integration]

- **GIVEN** a post whose every intended channel has published
- **WHEN** a retry is requested
- **THEN** it is refused as a client error and the queue receives no new publish job

#### Scenario: a channel with live fragments pending retraction is refused [integration]

- **GIVEN** a channel whose record shows fragments still live pending retraction
- **WHEN** the customer retries that channel
- **THEN** it is refused with a reason naming the live fragments and the manual action, and no job is enqueued

#### Scenario: the retry takes no future time [unit]

- **GIVEN** a retry request carrying a future time for a channel
- **WHEN** it is handled
- **THEN** the future time is not honoured — the request is refused or the retry acts now — and no scheduled work is created

---

### Requirement: The retry is IDEMPOTENT under double submit — one provider call **[MERGE-BLOCKING]**

Two submissions of the same retry — a double click, a retried HTTP request, a redelivered event, two
tabs — SHALL produce EXACTLY ONE provider call for that channel and exactly one recorded outcome.

The retry's identity SHALL be DETERMINISTIC, derived from `(postId, channelId, attempt)` or an
equivalent function of the record's own state, and SHALL be reproducible by any caller holding the
record. It SHALL NOT be a generated identifier: `randomUUID()` or `Math.random()` in a dedupe key is
blocked at hard-zero by fitness #7, and the reason is exactly this — a fresh identifier per
submission makes every duplicate look like new work to every dedupe layer in the path.

The record SHALL be consulted BEFORE the work is enqueued, so a channel that published between the
customer's page load and the submit is not re-sent.

Duplicate suppression SHALL be observable: a suppressed duplicate SHALL be answerable as such rather
than being silently indistinguishable from work that ran.

#### Scenario: a double submit publishes once [integration]

- **GIVEN** a retry submitted twice for the same channel and the same attempt
- **WHEN** both submissions are processed
- **THEN** the provider is called exactly once, exactly one outcome is recorded, and the attempt count advanced by one

#### Scenario: the retry identity is deterministic [unit]

- **GIVEN** the same post, channel and attempt
- **WHEN** the retry identity is derived twice
- **THEN** the two values are identical and derived from the post, channel and attempt

#### Scenario: no generated identifier reaches a dedupe key [static]

- **GIVEN** the change is applied
- **WHEN** the retry path is inspected
- **THEN** its dedupe key is derived from the record, contains no generated identifier, and fitness #7 measures zero

#### Scenario: a channel that published in the meantime is not re-sent [integration]

- **GIVEN** a retry submitted for a channel whose record reached published before the submission was processed
- **WHEN** it is processed
- **THEN** no provider call is made and the existing outcome is preserved

---

### Requirement: An excluded channel is RE-INCLUDABLE, and publishes the SAME locked content **[MERGE-BLOCKING]**

Exclusion is a per-channel state within the post, NOT an irreversible decision (Q8). After the
underlying problem is remediated, an excluded channel SHALL be returnable to an unresolved outcome by
an explicit act, and SHALL then be publishable. **No channel is ever permanently closed** — including
a channel whose thread was interrupted.

**Re-inclusion has ONE precondition: nothing of this post is live on that channel** (Q11). A channel
whose fragments are still live pending retraction SHALL NOT be re-included, and the refusal SHALL
name those fragments rather than reporting a generic rejection. Once the record shows nothing live —
retraction by N-COR-10, or the customer's manual removal recorded as such — the channel is
re-includable and the WHOLE post is re-sent, every fragment of it, with no double-post: the re-send
is safe precisely because nothing was left behind.

The content published on re-inclusion SHALL be BYTE-IDENTICAL to the content already live on the
post's published channels. The content lock SHALL NOT re-open for the re-inclusion — not before it,
not during it, and not after it (Q3, Q9). "Retry with a fix to the copy" is a different capability
and is out of scope.

Re-inclusion SHALL PRESERVE the channel's history: the attempt count is not reset and the previous
exclusion reason remains readable, so a channel that needed three remediations does not read as a
first attempt.

#### Scenario: a remediated channel is re-included and publishes the live content [integration]

- **GIVEN** an excluded channel whose problem has been remediated
- **WHEN** it is re-included and retried
- **THEN** it publishes content identical to what the already-published channels hold, and its record reaches published

#### Scenario: re-inclusion does not unlock the content [unit]

- **GIVEN** an excluded channel on a post with at least one published channel
- **WHEN** it is re-included
- **THEN** a content update for that post is still refused

#### Scenario: re-inclusion preserves the history [unit]

- **GIVEN** a channel excluded after several attempts
- **WHEN** it is re-included
- **THEN** the attempt count is not reset and the prior exclusion reason is still readable

#### Scenario: re-inclusion is refused while fragments are live [unit]

- **GIVEN** a channel whose interrupted thread left fragments live pending retraction
- **WHEN** re-inclusion is requested
- **THEN** it is refused with a reason naming the live fragments, and the channel stays not-published

#### Scenario: the whole thread is re-sent once nothing is live [integration]

- **GIVEN** a channel whose live fragments were retracted or recorded as manually removed
- **WHEN** it is re-included and retried
- **THEN** every fragment of the post is sent, each fragment's reference is recorded, and no fragment is duplicated on the platform

---

### Requirement: The CONFIRM-MANUAL-RETRACTION act ships in the SAME window as the state it exits **[MERGE-BLOCKING]**

The customer SHALL be able to DECLARE that the live fragments of a stranded channel were removed
manually on the platform. That declaration is what clears the pending-retraction state — with its
cause and moment recorded (`post-channel-publication-record`) — and it is the ONLY exit while N-COR-10
is not in the tree: it releases the content lock when no channel of the post holds live content, it
resolves the standing alert, and it makes the channel re-includable and retryable again.

**The act SHALL be available to the customer no later than the delivery unit that first makes a
channel able to reach pending retraction** (Q15). A state that can be entered on `main` and not left
on `main` is a defect of this requirement even when every other requirement passes: the customer's
post is locked, content is live they did not intend to keep, and the alert obliges an act the system
gives them no way to record.

The act SHALL NOT depend on a screen. The customer-facing affordance MAY follow in this slice (the
panel requirement below), because the urgent alert already names the action and the act SHALL be
usable without the panel. A spec that made the exit wait for a screen would re-create the stranded
window through the UI rather than the backend.

The act SHALL be refused, as a client error, when the named channel has nothing pending — nothing live
means there is nothing to declare removed — and a second declaration SHALL NOT clear anything twice
nor read as work that ran.

The act SHALL remain available AFTER the application's action window expires (Q17): expiry finalizes
the channel's outcome and ends the alert cycle, and the confirmation still clears the live fragments
and releases the lock.

#### Scenario: the exit ships with the state [static]

- **GIVEN** the change's delivery units in their merge order
- **WHEN** the first unit in which a channel can resolve with fragments pending retraction is on `main`
- **THEN** the confirm-manual-retraction route and its use case are present on `main` in that same unit or earlier, and no unit exists in which a channel can be stranded with no recorded exit

#### Scenario: confirming manual removal clears the state and re-opens the channel [integration]

- **GIVEN** a channel whose record holds two fragments pending retraction
- **WHEN** the customer confirms the fragments were removed manually
- **THEN** the pending retraction is cleared with its cause and moment recorded, the standing alert is resolved, the channel becomes retryable, and the content lock releases once no channel holds live content

#### Scenario: confirming with nothing pending is refused [unit]

- **GIVEN** a channel whose record shows nothing live
- **WHEN** a manual-removal confirmation is submitted for it
- **THEN** it is refused as a client error, no record is altered, and no alert is resolved

---

### Requirement: The customer SEES every channel's outcome, its reason and its affordance **[MERGE-BLOCKING]**

For a post, the customer SHALL be able to see, per intended channel: the outcome (published, in
progress, or excluded), the provider reference for a published channel, the REASON for an excluded
one, and the affordance to retry an unpublished one.

The panel SHALL read the RECORD. It SHALL NOT reconstruct per-channel outcomes from the queue, from
`PublishLog`, or from the post's status word, and it SHALL NOT show a channel that is not in the
recorded target set.

A channel with fragments PENDING RETRACTION SHALL be shown as such: the live fragments (with their
links where the provider gives one), the manual action they require, and NO retry affordance until
nothing is live there. The panel and the urgent alert
(`post-publication-retraction-alert`) SHALL say the same thing — a screen that offers a retry the
backend will refuse is the same class of defect as a status word the record does not support.

A channel SHALL NEVER be rendered as partially published: per Q11 that is not a persistable outcome,
so a screen that can draw it is drawing a state the system does not hold.

The derived `PARTIALLY_PUBLISHED` status SHALL render as **"Partially Posted"** wherever post status
is displayed, and the status vocabularies that would otherwise reject or crash on the new value SHALL
accept it — today the value appears in none of the seven status unions (`apps/client/lib/api/types.ts:35`,
`postsClient.ts:13`, `postsService.ts:16`, `:139`, `PostQueryGetList.ts:51`, `:196`,
`PostQuerySearchAnalytics.ts:43`, `schedulingSchemas.ts:15`, `postRoutes.ts:71`) nor in any of the six
status maps (`PostCard.tsx:44-52`, `PostsFilters.tsx:35-37`, `posts/[id]/page.tsx:224-239`,
`preview/page.tsx:182-184`, `dashboard/page.tsx:62`, `useSchedulingDashboard.ts:94-100`).

**Admin ↔ customer parity SHALL hold, levelled UP.** The admin scheduling list already surfaces
per-channel outcomes from `publishLogs` (`SchedulingPostHandlers.ts:105-180`) while the customer sees
nothing; after this capability BOTH sides answer per-channel questions from the record, and neither
side shows an outcome the other cannot see.

#### Scenario: the panel shows each channel's outcome and reason [unit]

- **GIVEN** a post whose record holds one published channel with an identifier, one in progress, and one excluded with a reason
- **WHEN** the post's channel panel is rendered
- **THEN** all three appear with their outcome, the published one shows its provider reference, the excluded one shows its reason, and the unpublished ones offer a retry

#### Scenario: "Partially Posted" renders wherever status is shown [unit]

- **GIVEN** a post whose derived status is `PARTIALLY_PUBLISHED`
- **WHEN** each status surface renders it
- **THEN** it reads "Partially Posted", and no surface falls through to an unknown-status branch or throws

#### Scenario: a stranded channel shows the manual action and no retry [unit]

- **GIVEN** a post whose record holds a channel with two fragments pending retraction
- **WHEN** the channel panel is rendered
- **THEN** the live fragments and the manual action are shown, and that channel offers no retry affordance

#### Scenario: both sides answer from the record [static]

- **GIVEN** the change is applied
- **WHEN** the admin and customer per-channel read paths are inspected
- **THEN** both resolve per-channel outcomes from the record, and neither answers publication questions from `PublishLog`

---

### Requirement: The editor SHALL NOT re-seed a default channel selection over a published post **[MERGE-BLOCKING]**

Opening a post that has at least one published channel SHALL present the RECORDED target set and its
outcomes — never a freshly computed default selection.

Today the editor seeds its channel selection from client-side state
(`computeDefaultChannelSelection`, `posts/[id]/page.tsx:77-86`, `:440-444`), so re-opening a partially
published post shows a default that has nothing to do with what actually happened; submitting it
would silently propose a target set that contradicts the record.

The target set of a post with a published channel SHALL NOT be silently replaced by a submission from
that screen.

#### Scenario: re-opening a partially published post shows what happened [unit]

- **GIVEN** a post with two published channels and one excluded
- **WHEN** it is opened in the editor
- **THEN** the recorded target set and outcomes are shown, and no default selection is computed over them

#### Scenario: the target set is not silently replaced [integration]

- **GIVEN** a post with at least one published channel
- **WHEN** a submission presents a different channel set
- **THEN** the recorded target set is not replaced, and the response names the refusal rather than reporting a silent success

---

## Verification note (strict TDD — RED → GREEN)

The dangerous red here is the double submit: on a tree without the deterministic identity it fails by
PUBLISHING TWICE to a real provider double, which is why the scenario asserts the number of provider
calls and the recorded attempt count rather than an HTTP status. The re-inclusion scenario asserts
content EQUALITY against what is already live, because "the same content" is the whole of Q8.

Integration scenarios need DB + Redis via `pnpm db:up`; frontend scenarios run in the frontend vitest
tier. Every new suite is named by EXACTLY ONE `run_batch` in `apps/api/scripts/run-tests.sh` (fitness
#30). New and changed code carries JSDoc `@file`/`@description`/`@layer` and, for components,
`@component` (fitness #9/#10/#12), with no phase or sprint reference (fitness #8).
