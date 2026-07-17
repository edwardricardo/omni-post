# Post Targeting Model + Bulk Scheduling Redesign

- **Status**: Decision-complete (§8 closed 2026-06-01) — ready for ADR + decomposition into implementation PRs (§9)
- **Date**: 2026-06-01
- **Owner**: Edward / Platform engineering
- **Scope**: the **app-wide post→channel targeting model** (single/conventional
  posts AND bulk), plus the bulk-scheduling redesign that adopts it
- **Supersedes the current**: `packages/core/bulk-scheduling/*` flow
- **Absorbs**: the B.3 dual-write/lost-jobs fix (durability) as a sub-part
- **Related**: `docs/features/templates.md`, `docs/architecture/ARCHITECTURE_CANON.md` (Outbox, UoW), ADR-0015 (BruteForce)

---

## 0. Canonical targeting model (app-wide) — investigation result

This is **not** a bulk-only concern. The mental model (Edward): the client
creates a **canonical post** on their account, then **selects which channels** it
goes to. Targeting is **by channel** (the concrete connected account); the
**provider is derived from the channel**, never chosen independently.

Verified against the code:

- **The live canonical path is already channel-based.** `SchedulePostUseCase`
  takes explicit `channelIds`; the **Post Publishing Saga** (`/sagas/post-publishing/start`)
  decomposes into **one BullMQ job per channel** (`publish-${postId}-${channelId}`);
  the worker resolves the provider **from the channel**; receipts go to
  `PublishLog` (per-channel). So conventional single-post targeting is correct.
  (Note: `channelIds` are not persisted on the `Post` — they flow saga→jobs
  in-memory; relevant for bulk durability.)
- **`PublishingQueue.providers[]` is DEAD CODE.** Verified: **zero writes, zero
  reads** repo-wide (only `deleteMany` in account/project cleanup + the
  tenant-guard allowlist; `results Json` never populated). It is the **fossil of
  an older provider-fan-out design**, superseded by the saga + per-channel BullMQ
  - PublishLog architecture. It only _looks_ like a competing provider-level
    targeting model — nothing uses it.

**Resolution:** there is **one** live targeting canon — **by channel**. The
perceived "two models" = the live channel model + a dead provider-fan-out fossil.

Therefore the two real targeting problems are separate:

- **(a)** Bulk's provider fan-out (the conceptual error this redesign fixes — bulk
  must adopt the channel-based canon).
- **(b)** `PublishingQueue` dead cruft → **remove** (model + table migration;
  audit-deletion: verified orphan; a final pre-removal grep confirms 0 refs).

---

## 1. Context & the conceptual error

The current CSV bulk-scheduling import (`ImportSchedulingCsvUseCase` +
`ProcessBulkScheduleRowUseCase`) has a **conceptual targeting error** plus a
durability bug:

- **Targeting by provider, not channel (conceptual error).** Each CSV row has a
  required `provider` column; the worker resolves **all channels of that provider
  in the project** (`findByProjectAndProvider`) and schedules **identical content
  to every one of them**. A project with two same-provider channels for different
  audiences (e.g. `@acme_us` English, `@acme_es` Spanish, both `provider=instagram`)
  cannot receive differentiated content — the system **assumes** the fan-out
  instead of letting the user choose. The normal app flow lets the user pick
  specific channels; bulk degrades that.
- **Durability (B.3).** The batch + items commit in the UoW transaction, then
  `enqueueBulk` runs **outside** the transaction. If enqueue fails the batch
  persists with zero jobs and items stuck `PENDING` forever (classic dual-write;
  no reconciliation). The CSV row content is **not persisted** on the item — it
  lives only in the ephemeral BullMQ job payload — so a failed enqueue loses the
  content irrecoverably.
- **Media gap.** The row carries `mediaUrls`, but the worker's `createPost` call
  does **not** pass them — media is never attached to bulk-created posts.

---

## 2. Goals

- The user **explicitly chooses** the target platforms and channels at upload
  time — never an assumption derived from a column or an auto fan-out.
- One template row = one **canonical post**, always created.
- Post body **may differ per target channel** (size-tier variant), as a
  **one-canonical-to-many-channels** relationship.
- Reliable creation: no dual-write window; failed enqueue/creation is
  recoverable (durable content + transactional outbox + reconciliation).
- Media actually attaches.

## Non-goals (for this iteration)

- Per-row channel selection (decided: per-upload — see §4). Differentiated
  audiences are handled by separate uploads.
- Automatic content rewriting/AI adaptation between size tiers (the user authors
  the variants).

---

## 3. Domain glossary (to keep terms straight)

- **Provider** — a platform _type_ (x, instagram, facebook, …). A category; no
  credentials. Defines char limits / capabilities.
- **Channel** — a _connected account_ on a provider within a project (handle +
  encrypted OAuth credentials). The thing you actually publish to. A project may
  hold several channels of the same provider.
- **Template** — the uploaded set of rows; each **row = one post**.
- **Canonical post** — the single `Post` entity created per row (always created).
- **Channel-target** — one (canonical post → channel) edge, carrying the body
  variant used for that channel.

---

## 4. Settled decisions

1. **Single standard body per post — no authored variants.** Each row carries
   ONE content body. Per-platform fit (truncate/reformat) is handled at publish
   time by the existing **`PlatformContentAdapterStrategy`** (runtime
   auto-adaptation). The user does not re-author content per platform/size — the
   goal is to save them rework. (Supersedes the earlier size-tier-variant idea,
   now dropped.)
2. **Per-post targeting — not "all or nothing".** Each row/post chooses its own
   **subset of channels/providers** (e.g. a post to X + TikTok but not
   Instagram). The user has full potestad over where each post goes. (Supersedes
   the earlier "per-upload single channel set" decision — that was still
   all-or-nothing per the chosen set.)
3. **CSV is content-pure** for the _body_ — no `provider` column that ASSUMES the
   target. How the per-post channel subset is captured (interactive grid vs a
   user-authored CSV target column vs upload-default + per-row override) is an
   open decision (§8). Key principle unchanged: targeting is the **user's
   explicit choice**, never our assumption.
4. **One canonical : many channels (the chosen subset).** One canonical `Post`
   per row is always created and scheduled to the **per-row selected** channels.
   **Single body** (locale-resolved + runtime-adapted) — NOT a per-channel
   authored body. The 1:N is the post→channels _targeting_ relation, not a
   content-variant relation.

---

## 5. Data model implications

**Content stays single-body — no new content axis.** Verified in the schema:

- `Post` has `contents PostContent[]` 1:N keyed per-LOCALE
  (`@@unique([postId, locale, revision])`) — that covers **language** (en/es).
- `PlatformContentAdapterStrategy` is **runtime auto-adaptation** (rule-based
  transform/truncate at publish), which covers **platform fit** automatically.

Between per-locale content + runtime platform adaptation, the body is already
handled. The redesign does **not** add a per-channel authored-body relation
(the dropped size-tier idea would have).

**What changes is targeting, not content.** The post→channels relation already
exists (schedule with `channelIds` → `publishingQueue`). Today bulk **forces**
the targets (provider fan-out to all same-provider channels); the redesign lets
**each row carry its own user-chosen channel subset**. So the data-model work is:

- **Lean manifest** (§8.1, confirmed): `BulkScheduleBatch` + `BulkScheduleItem`
  persist **status only** (progress UI: PENDING→SCHEDULED/FAILED) — **no content
  columns**. The durable post-intent (single body + media + selected channels)
  rides the **outbox event payload**, written in the same confirm-time TX and
  auto-removed by the outbox cleaner once processed.
- No `PostChannelContent`; no per-channel body. The 1:N is post→channels
  (targeting), with the single locale-resolved + runtime-adapted body.

---

## 6. End-to-end flow (target)

1. **Upload + parse + structural validation.** Required content fields present,
   row cap, dates parseable, generic length sanity.
2. **Interactive channel selection.** Show the account's channels; the user picks
   the target channels (per-row subset — §4). Provider is derived from each
   channel.
3. **Per-provider feasibility check.** With channels (hence providers) known,
   surface per-row warnings: scheduling support, hard media/format constraints.
   Soft length is handled at publish by the runtime adapter (single body, §4/§5).
4. **Create + schedule, durably.** For each row: create the canonical post
   (always), attach media, schedule to the selected channels (single body;
   provider derived from channel; runtime adapter fits per platform). Durability
   via the transactional outbox (§7).

---

## 7. Durability (absorbs B.3)

Canon (repo + industry): **transactional outbox** converts the dual write into a
single write. The repo already runs this pattern end-to-end for inbox triage
(`SocialMessageReceived` → outbox in the same tx → `OutboxRelay`
(SELECT FOR UPDATE SKIP LOCKED + `OutboxBackoff` + DLQ; at-least-once delivery, consumer-side idempotency) →
`TriageDispatchEventHandler` enqueues, throw-to-retry).

Bulk-scheduling clones it:

- The confirm step persists, **in one UoW transaction**: the **lean manifest**
  (batch + items = status only) **+ the outbox event whose payload carries the
  post-intent** (content + selected channels). Single write — no dual-write gap.
- The relay dispatches → a `BulkScheduleDispatchEventHandler` reads the payload
  and enqueues the per-channel publish jobs (idempotent: deterministic
  `dedupeKey` = `bulk-${batchId}-${itemId}-${channelId}` → BullMQ `jobId` dedup;
  consumer keeps its status guard + `postId` reuse). Throw-to-retry → outbox
  backoff → DLQ. The **outbox cleaner** auto-removes processed events.
- **Reconciliation backstop** (per Edward, "most complete"): a scheduler sweep
  (mirror `SagaManagerLifecycle.startRetryRecoveryChecker`) recovers batches
  stuck with PENDING items after N minutes — re-driving from the DLQ'd outbox
  event (where the post-intent survives). Covers a relay/DLQ failure.

Because the manifest now persists the row content (decision §4 + §8), the handler
and the backstop can rebuild jobs from the DB — resolving the original B.3 "A vs
B" question in favour of durable content on the manifest.

---

## 8. Decisions (resolved 2026-06-01)

1. **Channel subset captured INTERACTIVELY at bulk load** (UI), not a CSV column.
   CSV stays content-pure; targeting is the interactive step. ✅
2. **Transient until confirm.** Phase 1 (upload+parse) writes nothing to the DB.
   The batch is **born complete at confirm**, when content + channels are both
   known — persisted in ONE UoW transaction (the durability single-write). If the
   user abandons phase 2, nothing was written (no orphan drafts, no draft
   lifecycle). ✅
3. **Manifest stays lean; durable post-intent rides the outbox event** (confirmed
   2026-06-01). Manifest = status tracking only; content + channels live in the
   outbox payload, auto-cleaned by the outbox cleaner. See §8.1. ✅
4. **Per-provider validation is REQUIRED.** Once channels (→ providers) are
   chosen, validate each row against each selected provider before creating
   anything ("you can't post content you don't know is valid for that provider").
   The runtime adapter still does soft formatting, but hard invalidity (length
   over a provider's hard cap, unsupported media/format, no scheduling support)
   blocks that row and is surfaced per-row. ✅
5. **Remove the assumed `provider` column** from the CSV ("if you don't need it,
   why have it"). Content-pure CSV. ✅

### 8.1 Where the durable post-intent lives (manifest vs outbox payload)

For durability, the per-row content + selected channels must be durable at
confirm so a failed enqueue is recoverable. Two homes, given Edward's "don't
persist extra DB data unless auto-cleaned":

- **CONFIRMED (2026-06-01) — outbox event payload (auto-cleaned).** At confirm, in one TX:
  persist the **lean manifest** (batch + items = _status tracking only_, for
  progress UI: PENDING→SCHEDULED/FAILED, ~as today) **+ a `BulkSchedule*` outbox
  event whose payload carries the content + selected channels**. The relay turns
  it into per-channel publish jobs; the **outbox cleaner auto-removes processed
  events** (the auto-delete mechanism Edward asked about). The content is durable
  only as long as needed; the manifest gains **no content columns**. Reconciliation
  re-drives stuck/DLQ'd outbox events. Best fit for "transient + minimal DB".
- Alternative — content columns on the manifest item (body/schedule/media/
  channels). Durable + directly queryable, reconciliation reads the DB, but adds
  permanent-ish columns (until batch cleanup) — more DB data, against the stated
  preference.

_(Resolved/dropped earlier: size-tier variants, tier→provider mapping,
per-channel authored body — superseded by single-body + runtime adapter, §4.)_

---

## 9. Impact / scope

This spans **bulk-scheduling + the post targeting/publish model + frontend** (the
channel picker), and is materially larger than the original B.3 bugfix. Suggested
decomposition once §8 is closed:

- **Cleanup: remove `PublishingQueue`** (dead provider-fan-out fossil, §0) — drop
  the Prisma model + table migration + the `Post.publishingQueue` relation +
  cleanup `deleteMany` calls + tenant-guard allowlist entry. Pre-removal grep
  confirms 0 refs. Migration ⇒ sensitive-edit token. (Standalone, low-risk; can
  go first.)
- Schema migration (manifest persists single body + media + **selected channels
  per row**).
- Bulk-scheduling: per-row channel targeting (drop provider fan-out) + 2-phase
  flow (upload/parse → select/validate → create) + outbox durability +
  reconciliation + media-attach fix.
- Frontend: upload + channel-selection UI.
- Tests: unit + integration + e2e smoke per phase.

Each becomes its own plan/PR; settled architectural choices graduate to ADRs
(next free: ADR-0016+).

---

## 10. Next steps

1. ✅ §8 decisions closed (2026-06-01).
2. Promote settled choices to an ADR (next free: ADR-0016 — channel-canonical
   post targeting + `PublishingQueue` removal).
3. Decompose into implementation plans/PRs (§9) — suggested order:
   (i) remove `PublishingQueue` (standalone, low-risk);
   (ii) bulk redesign (interactive per-row channel targeting, content-pure CSV,
   per-provider validation, transient-until-confirm, lean manifest + outbox
   durability + reconciliation, media-attach fix).
4. Until then, the legacy flow stays as-is; **B.3's standalone fix is on hold**
   inside this redesign (current WIP: `BulkScheduleBatchCreated.ts` + a partial
   `BulkScheduleBatchRepository` port edit, uncommitted — the
   `BulkScheduleBatchCreated` event survives; the dedupeKey gains `-${channelId}`
   for per-channel jobs).
