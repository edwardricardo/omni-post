# Canon Candidate — State flag vs Domain Event for aggregate state changes

## Metadata

- **Task surfacing this gap**: PR-43-A (Wave 3.2 — Channel force re-auth admin-triggered)
- **Specific decision**: should `Channel.markForReauth(reason)` be implemented as (a) a STATE FLAG mutation (`needsReauth = true` + audit log emitted by route handler), or (b) a DOMAIN EVENT (`ChannelMarkedForReauth` published by the aggregate, with downstream handlers reacting)?
- **Decision date**: 2026-05-07
- **Synthesized by**: claude-opus-4-7
- **Status**: approved (2026-05-07)

## Why this gap exists

- **Existing canon adjacent**:
  - `cockburn-hexagonal-architecture` — covers ports/adapters, not the choice between state flag vs event
  - Saga / CQRS canon entries — cover orchestration patterns but not the "should this be an event" question
  - No canon entry on the criterion for promoting state changes to domain events
- **What's missing in those entries**: nothing prescribes the criterion. Decision was intuitive: "Channel has needsReauth column → mutate it" — without justifying why we DIDN'T model it as an event.
- **Why default heuristic is insufficient**: I picked state-flag by default. Is this canon-aligned, or should it be an event for future extensibility (notifications, analytics, cross-system propagation)? Need explicit criterion to defend the choice + apply consistently to similar future decisions.

## Research scope

- **Search keywords**: `domain event vs state flag entity DDD`, `when to use domain event Vaughn Vernon Eric Evans`, `state pattern aggregate root`
- **Sources targeted**: Microsoft .NET Architecture (eShop) — comprehensive 2024-updated DDD docs citing Vernon, Evans, Bogard, Dahan; Martin Fowler — original Domain Event definition; Vernon — Effective Aggregate Design (referenced as canonical).
- **Sources excluded**: Medium / personal blog posts without affiliation; older content predating the "events as side-effect mechanism" consensus.

## Sources consulted

### [1] Martin Fowler — Domain Event — [martinfowler.com](https://martinfowler.com/eaaDev/DomainEvent.html)

- **Fetched**: 2026-05-07
- **Authority**: Martin Fowler — author of original Domain Event pattern definition.
- **Key claims**:
  - Definition: "Captures the memory of something interesting which affects the domain."
  - "Not all of them are interesting, some may be worth recording but don't provoke a reaction."
  - Canonical scenario: state change that triggers downstream processing (audit logs, inter-system communication, replay capabilities).
  - Implication: trivial state changes lacking external consequences don't warrant event modeling.
- **My reading**: Fowler's "interesting + provokes reaction" criterion. If no consumer reacts, it's not a domain event — it's just state.

### [2] Microsoft .NET Architecture (eShop) — Domain events: Design and implementation — [learn.microsoft.com](https://learn.microsoft.com/en-us/dotnet/architecture/microservices/microservice-ddd-cqrs-patterns/domain-events-design-implementation)

- **Fetched**: 2026-05-07 (last updated 2024-01-03 per page metadata)
- **Authority**: Microsoft .NET Architecture team, eShop reference application. Cites Vernon, Evans, Bogard, Dahan as canonical references — represents synthesis of mainstream DDD opinion.
- **Key claims**:
  - "Use domain events to explicitly implement side effects across multiple aggregates."
  - "If executing a command related to one aggregate instance requires additional domain rules to be run on one or more additional aggregates, you should design and implement those side effects to be triggered by domain events."
  - Quotes Vaughn Vernon (Effective Aggregate Design Part II): "if executing a command on one aggregate instance requires that additional business rules execute on one or more aggregates, use eventual consistency... An aggregate method publishes a domain event that is in time delivered to one or more asynchronous subscribers."
  - The criterion for an event is **cross-aggregate reaction OR open-ended set of side-effect handlers** that would otherwise create coupling.
  - "Decoupled implementation by segregating responsibilities" is the architectural payoff — but only when there ARE multiple handlers (current or anticipated).
  - Anti-pattern: introducing events without subscribers, just for "future flexibility" (open/closed principle is satisfied retroactively when a subscriber appears).
- **My reading**: this is the canonical synthesis. Domain events are for **propagating state changes across multiple aggregates within the same domain**, not for documenting state mutations within a single aggregate. The architectural overhead (event class + collection on aggregate + dispatcher + handlers) is justified ONLY when consumers exist or are imminent.

### [3] Vaughn Vernon — Effective Aggregate Design Part II — [dddcommunity.org](https://dddcommunity.org/wp-content/uploads/files/pdf_articles/Vernon_2011_2.pdf)

- **Fetched**: 2026-05-07 (cited via Microsoft doc; canonical Vernon paper)
- **Authority**: Vaughn Vernon, author of "Implementing Domain-Driven Design". Foundational text on aggregate boundaries.
- **Key claims** (per Microsoft synthesis):
  - One transaction = one aggregate. Cross-aggregate consistency via eventual consistency, achieved by domain events.
  - Don't model intra-aggregate state changes as events; that's just state.
  - Events when there ARE subscribers; otherwise the event is dead weight.
- **My reading**: aligns with [2]. The aggregate boundary IS the event boundary — events cross aggregates, not sit within them.

## Synthesis

### Recommendation: USE — state flag (current PR-43-A approach)

When the state change:

1. Affects only ONE aggregate (Channel.needsReauth changes within Channel itself).
2. Has NO downstream aggregate that needs to react synchronously or eventually.
3. Has NO open-ended set of side-effect handlers that would benefit from decoupling.
4. The "reaction" (tenant sees banner) is achieved via the read model (next API request returns updated state), not via event subscription.
5. The audit log is emitted by the application layer (route handler), not by a domain event handler.

This is exactly PR-43-A's `Channel.markForReauth(reason)`. State-flag is canon-aligned per Fowler's "interesting + provokes reaction" criterion (NO reaction in our current scope) AND Microsoft/Vernon's "events for cross-aggregate" criterion (single aggregate).

### Recommendation: PROMOTE TO DOMAIN EVENT later, IF

The set of subscribers grows beyond the current zero. Specifically, promote when:

1. **Tenant notifications** are added (email, in-app push when a channel is flagged for reauth).
2. **Analytics aggregator** needs to track "rate of reauth events per provider per day" as a separate aggregate.
3. **Cross-microservice propagation** is needed (e.g., a separate notification service consuming via integration event from outbox).
4. **An "open count" of side-effect handlers** materializes — e.g., one team wants email, another wants Slack, another wants Datadog metric increment. The decoupling payoff justifies the event overhead.

When promoting:

- Add `ChannelMarkedForReauth` event class (immutable, past-tense name).
- `Channel.markForReauth(reason)` adds the event to its internal list (deferred dispatch via `addDomainEvent`).
- UoW dispatches events RIGHT BEFORE commit (Bogard pattern, also adopted by eShop reference) so all handler side effects participate in the same transaction.
- Each subscriber registers an event handler in the application layer.
- Event payload should NOT contain sensitive data (no clientSecret, no encrypted creds) — IDs + reason only.
- The "Audit log entry" can THEN be implemented as the first event handler (instead of being emitted in the route handler). This makes the audit emission decoupled from the route — any path that calls `markForReauth` automatically gets audited.

### Recommendation: AVOID

- **Modeling state changes as domain events without subscribers** — pure architectural overhead. Unused dispatch infrastructure rots; future maintainers can't tell which events have real handlers. Anti-YAGNI.
- **Duplicating audit emission in BOTH a domain event handler AND a route handler** — introduces double-write race + drift risk. Pick one path.
- **Mixing event semantics with state queries** — events should be append-only "this happened"; state queries return current state. Don't conflate.

### Tradeoffs / decision tree

- **Single aggregate + 0 reactors today + 0 imminent**: STATE FLAG. Lightest path, easy to refactor later.
- **Multiple aggregates** (any reactor needs to update a different aggregate): DOMAIN EVENT. The boundary forces eventual consistency; events are the canonical mechanism.
- **Same aggregate + multiple in-process side effects** (logging, metrics, notifications): borderline. Acceptable as state flag if only audit log; promote to event when 2+ side effects appear.
- **Cross-microservice propagation needed**: ALSO an integration event (separate from domain event), via outbox. Domain event handler emits the integration event.
- **Event sourcing model**: separate question — if the system is event-sourced, state IS derived from events; the criterion is moot. Our system is state-stored (Prisma row updates), so this isn't our context.

### Pinned values / flags

- **State-flag pattern criterion**: aggregate boundary closed (no cross-aggregate side effects) + zero current/imminent subscribers + audit emission acceptable from application layer.
- **Promote-to-event trigger**: ANY of (a) cross-aggregate reaction needed, (b) 2+ side-effect handlers materialize, (c) cross-system integration via outbox required.
- **Event payload rule**: IDs + minimal context only. NEVER credentials, NEVER encrypted blobs. Aligned with `pino-redaction-docs`.
- **Event class naming**: past-tense verb (`ChannelMarkedForReauth`, `OrderStartedDomainEvent`). Immutable. No methods.

## Proposed canon-index.json entry

```json
{
  "key": "ddd-state-flag-vs-domain-event-criterion",
  "topic": "DDD — state flag vs domain event criterion for aggregate state changes",
  "area": "Architecture · DDD · Aggregates and events",
  "summary": "Per Fowler and Microsoft DDD synthesis (citing Vernon, Evans, Bogard, Dahan), domain events should be modeled when state changes either (a) affect multiple aggregates requiring eventual consistency or (b) have an open-ended set of in-process side-effect handlers needing decoupling. State-flag mutation is canon-aligned for single-aggregate changes with zero current/imminent subscribers — adding event infrastructure without consumers is anti-YAGNI. Promote to domain event when cross-aggregate reaction is needed OR multiple side-effect handlers materialize OR cross-system integration via outbox is required. Audit log can be emitted by the application layer (route handler) for state-flag pattern, or by a domain event handler when promoted.",
  "keyTakeaway": "Domain events when there ARE subscribers (current or imminent); state flag when there are not. Don't preemptively model events for 'future flexibility' — open/closed is satisfied retroactively. The aggregate boundary IS the event boundary: events cross aggregates, not sit within them.",
  "patternAdopted": "Channel.markForReauth(reason) implemented as state-flag mutation (Channel.needsReauth: boolean) + audit log emitted by application layer (apps/api/src/admin/channelReauthRoutes.ts) post-commit. No domain event class because: (1) single aggregate, (2) zero downstream subscribers, (3) tenant 'reaction' is via read model (next dashboard fetch returns updated state), not via event subscription. If/when subscribers materialize (tenant notifications, analytics aggregator, cross-service propagation), promote to a `ChannelMarkedForReauth` domain event with deferred dispatch via UoW (Bogard pattern). Wired as state-flag in apps/api/src/domain/entities/Channel.ts (markForReauth method) + apps/api/src/application/channels/UpdateChannelAuthStateUseCase.ts. Anti-pattern explicitly avoided: emitting an unused event class + handler infrastructure 'just in case'.",
  "usedIn": "PR-43-A (Wave 3.2 — Channel force re-auth admin-triggered) — validates state-flag choice as canon-aligned",
  "date": "2026-05-07",
  "sources": [
    {
      "url": "https://martinfowler.com/eaaDev/DomainEvent.html",
      "fetchedAt": "2026-05-07",
      "title": "Martin Fowler — Domain Event (interesting + provokes reaction criterion)"
    },
    {
      "url": "https://learn.microsoft.com/en-us/dotnet/architecture/microservices/microservice-ddd-cqrs-patterns/domain-events-design-implementation",
      "fetchedAt": "2026-05-07",
      "title": "Microsoft .NET Architecture (eShop) — Domain events Design and Implementation (2024 update)"
    },
    {
      "url": "https://dddcommunity.org/wp-content/uploads/files/pdf_articles/Vernon_2011_2.pdf",
      "fetchedAt": "2026-05-07",
      "title": "Vaughn Vernon — Effective Aggregate Design Part II (cross-aggregate via events)"
    }
  ],
  "synthesizedBy": "claude-opus-4-7",
  "confidence": "high",
  "lastVerified": "2026-05-07",
  "version": 1,
  "appliesTo": [
    "apps/api/src/domain/entities/",
    "apps/api/src/domain/events/",
    "apps/api/src/application/"
  ]
}
```

## Impact on existing code

- **Files that already align with this canon** (validation):
  - `apps/api/src/domain/entities/Channel.ts:markForReauth()` — state-flag mutation, no event emission. Single aggregate. ✓
  - `apps/api/src/application/channels/UpdateChannelAuthStateUseCase.ts` — uses entity method via UoW; no event dispatch. ✓
  - `apps/api/src/admin/channelReauthRoutes.ts:74-93` — audit log emitted by application layer post-commit. ✓
  - Pattern is replicated correctly across PR-43-B (webhook secretKey rotation — single aggregate), PR-43-C (OIDC clientSecret — single aggregate), PR-43-D (ApiKey rotation — single aggregate). ✓ All canon-aligned.

- **No bug** in current implementation. Canon entry **validates** the existing pattern + documents the criterion + flags promotion triggers for future planning.

- **Future promote candidates** (track only, no immediate action):
  - When tenant notifications are added (likely PR-? in a future wave): `ChannelMarkedForReauth` event becomes natural fit. Notification service subscribes.
  - When SOC2 audit aggregator is built (likely follow-up to PR-42 dashboard): may benefit from event-sourced audit stream rather than ad-hoc log-table-grep.

## Edward's review

- [x ] Sources are sufficient (3: Fowler + Microsoft DDD synthesis + Vernon)
- [ x] Recommendations match project values (validates current PR-43-A design + sets criterion for future)
- [ x] Pinned values reasonable (promote-to-event trigger criteria)
- [ x] Approve append to `canon_research_index.md`
- [ x] Trigger NO refactor commit (current code is canon-aligned); track promote-to-event as forward-looking item
- Notes: approved.
