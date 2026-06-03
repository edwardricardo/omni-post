# ADR-0016: Channel-canonical post targeting + PublishingQueue removal

- **Status**: Accepted
- **Date**: 2026-06-01
- **Deciders**: Edward / Platform engineering
- **Supersedes**: —
- **Superseded by**: —
- **Design doc**: `docs/features/bulk-scheduling-redesign.md` (full model + flow)

## Context

Investigating a "lost jobs" durability bug in CSV bulk-scheduling surfaced a
deeper **conceptual targeting error** and a **dual-model smell** in how a post
chooses where it publishes.

Two representations of "where a post goes" coexist in the code:

1. **By channel** — `SchedulePostUseCase(channelIds)` → Post Publishing Saga →
   **one BullMQ job per channel** (`publish-${postId}-${channelId}`) → the worker
   resolves the provider **from the channel** → receipts in `PublishLog`. This is
   the **live, canonical path**; conventional single-post targeting is already
   correct (the user picks specific channels).
2. **By provider** — `PublishingQueue.providers[]` (+ `results Json`). Verified
   **dead code**: zero writes, zero reads repo-wide (only `deleteMany` in
   account/project cleanup + the tenant-guard allowlist; `results` never
   populated). It is the **fossil of an older provider-fan-out design**,
   superseded by the saga + per-channel BullMQ + `PublishLog` architecture.

Separately, the **bulk-scheduling** flow degrades the canon: its CSV row carries
a required `provider` column and the worker fans **identical content to all
channels of that provider** in the project (`findByProjectAndProvider`) — the
system _assumes_ the fan-out instead of letting the user choose. A project with
two same-provider channels for different audiences (e.g. `@acme_us` English,
`@acme_es` Spanish) cannot be differentiated.

So the perceived "two targeting models" = **one live channel model + one dead
provider fossil**, not two live competitors; and bulk diverges from the live
canon.

## Decision

1. **The canonical targeting unit is the channel** (the connected account). The
   **provider is always derived from the channel**, never chosen as an
   independent targeting dimension. This applies **app-wide** — conventional
   single posts AND bulk. The mental model: create a canonical post, then select
   the channels it goes to.
2. **Remove `PublishingQueue`** (model + table + the `Post.publishingQueue`
   relation + the cleanup `deleteMany` calls + the tenant-guard allowlist entry).
   It is verified dead provider-fan-out cruft; keeping it implies a second,
   provider-level targeting canon that does not exist. A pre-removal grep
   confirms zero references.
3. **Bulk-scheduling adopts the channel canon** (no provider fan-out): the user
   selects target channels interactively at upload; the CSV is content-pure (no
   `provider` column). Per-provider validation runs after channel selection.
   (Full flow + durability in the design doc; tracked as its own implementation
   workstream.)

## Rationale

- **Hexagonal / one-canon (ARCHITECTURE_CANON):** one cross-cutting concern
  (post targeting) must have one model. The channel model is the live, correct
  one; the provider fossil is divergence to delete — the same
  "duplication-by-divergence" remediation as ADR-0015 (BruteForce).
- **Correctness:** channel-level targeting is strictly more expressive than
  provider fan-out (it can target a subset, and differentiate same-provider
  accounts) and matches what conventional posts already do.
- **Provider as a derived detail:** char limits / capabilities belong to the
  provider, but a publish always happens to a concrete channel; deriving the
  provider from the channel keeps a single source of truth.

## Alternatives considered

- **Keep `PublishingQueue` as a future provider-level path.** Rejected: it is
  unwired since genesis, never read/written, and re-animating a provider-fan-out
  model contradicts decision (1).
- **Unify on provider-level targeting.** Rejected: loses the ability to target a
  channel subset / differentiate same-provider accounts; the live system and the
  user mental model are channel-based.

## Consequences

- The `Post.publishingQueue` relation, the `PublishingQueue` model, and a
  drop-table migration are removed (sensitive-edit + migration).
- Bulk-scheduling is redesigned (separate workstream; design doc) to consume the
  channel canon: interactive per-upload channel selection, content-pure CSV,
  per-provider validation, transient-until-confirm, lean manifest + transactional
  outbox + reconciliation, and the media-attach fix.
- No change to the conventional single-post path (already channel-canonical).

## Revisit if

- A genuine provider-level batch-publish requirement appears (then design it on
  the channel canon — resolve channels from the provider explicitly at the edge,
  not as a stored providers[] array).

## Risks

- Removing `PublishingQueue` is safe only because it is verified dead; the
  pre-removal grep + the migration must confirm no residual references
  (generated client, tenant allowlist, cleanup calls).

## References

- `docs/features/bulk-scheduling-redesign.md`
- ADR-0015 (single-canon port remediation precedent)
- `docs/architecture/ARCHITECTURE_CANON.md` (Hexagonal, Outbox, UoW)
