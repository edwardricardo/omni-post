# Delta for saga-step-outcome-contract — a failed CHANNEL is an outcome, not a failed STEP (post-publish-partial-failure)

> ONE requirement changes: **"A step outcome is exactly one of THREE states"**. The three-state
> union itself is UNCHANGED — `succeeded` / `failed` / `waiting`, mutually exclusive, exhaustively
> branched. What changes is the publish wait step's clause inside it: the step stops reading queue
> COUNTS and starts reading the per-channel publication record, and "a job that ended in error"
> stops being one of its `failed` cases.
>
> **Why the clause has to move, and why the contract does not.** The authoring rule the living spec
> states — `waiting` is what becomes DECIDABLE BY ASKING AGAIN, anything else is `failed` — is
> exactly right and is preserved. The defect is upstream of it: the step asks the QUEUE, which
> answers in counts (`QueuePort.ts:92`, `queue-adapter.ts:214-238`) and cannot name a channel, so a
> channel that failed for a problem of its own became a STEP failure (`saga.ts:796-834` @`6737984a`;
> `:926-933` in the working tree). Past the pivot that is a canon violation, not a policy choice:
> compensation is unavailable (`SagaManagerExecution.ts:1085-1087`) and the saga must complete
> forward. Once the per-channel record exists, "this channel failed" IS decidable and IS decided —
> it is written down — so it is not a question the step can usefully be asked again about, and it is
> not a failure of the step either. It is an OUTCOME the step reports as resolved.
>
> The other four requirements of this capability — `waiting` consumes no retry budget,
> event-driven advancement does not amplify with channel count, one execution at a time, and the
> read-side normalization of pre-change rows — are REUSED verbatim and are NOT restated here.
>
> This delta depends on `post-channel-publication-record` (same change) for the record the step
> reads.

---

## MODIFIED Requirements

### Requirement: A step outcome is exactly one of THREE states

(Previously: the publish wait step's clause read the queue and listed "a job that ended in error"
among its `failed` cases. The step now reads the per-channel publication record; a channel that
ended in error is a RECORDED OUTCOME and resolves the step rather than failing it; `failed` is
reserved for observation failure and missing scheduling data. The union, the exhaustiveness rule,
the compensation clause and the authoring rule are unchanged.)

`SagaStepResult` SHALL be a discriminated union on `outcome` with exactly three cases —
`succeeded`, `failed` and `waiting` — mutually exclusive by construction:

```typescript
type SagaStepResult =
  | { outcome: "succeeded"; data?: unknown; compensationData?: unknown }
  | { outcome: "failed"; error: string; compensationData?: unknown }
  | { outcome: "waiting"; reason: string; data?: unknown };
```

- A cause SHALL belong only to the case that has one: `error` on `failed`, `reason` on
  `waiting`. No representation SHALL permit a step to be simultaneously failed and waiting,
  and no consumer SHALL infer "still pending" from the text of an error or from a boolean.
- The engine SHALL branch on the discriminator exhaustively, so a fourth outcome would be a
  compile-time obligation on every consumer rather than a silent fall-through into the
  failure branch.
- Compensations SHALL use the same contract, so a rollback that has not finished is never
  recorded as one that failed.
- **The publish wait step SHALL decide from the post's per-channel publication record, not from
  queue counts.** It SHALL return `waiting` while ANY intended channel is unresolved, `succeeded`
  once EVERY intended channel has RESOLVED — published or excluded, including when some were
  excluded — and SHALL reserve `failed` for a real failure of the STEP: scheduling data that was
  never recorded, or a record it could not read at all.
- **A channel that ended in error is an OUTCOME, not a step failure.** It is recorded against that
  channel with its cause, it resolves that channel, and the step reports the publish as complete
  once every sibling has also resolved. The saga then FORWARD-COMPLETES: a publish that reached
  some channels and not others SHALL reach a terminal `COMPLETED`, never `FAILED`. Past the pivot
  there is no compensation to run and no state to return to, so ending the saga `FAILED` over a
  channel that failed abandons the channels that succeeded — which is what the post-pivot rule
  forbids.
- **A failed OBSERVATION is `failed`, never `waiting`.** "I could not read the record" is not
  evidence that work is still in progress, and a reader that answers an all-unresolved aggregate for
  an outage hands the step the one shape it cannot tell from healthy in-flight work — with no retry
  spent, no error recorded and no metric moved. The record reader therefore SHALL express
  observation failure distinctly (a `Result`), and the step SHALL map it to `failed`, so an
  unreadable dependency stays bounded by the retry policy as it was before this contract.
- **The step SHALL NOT infer a channel's outcome from queue state.** An evicted completed job is
  absent from the queue's view; read as failure it would produce a spurious EXCLUSION of a channel
  that actually published. The record is written by the worker before the job completes, and the
  record is the only source the step consults.

**The authoring rule SHALL live at the contract**, not in one step's body: `waiting` is what
BECOMES DECIDABLE BY ASKING AGAIN; anything that cannot is `failed`. A resolved channel outcome is
neither: it is already decided, and it belongs to the step's DATA, not to its verdict.

#### Scenario: the outcome type admits exactly three cases

- **GIVEN** the step-outcome contract and its consumers
- **WHEN** they are inspected
- **THEN** succeeded, failed and waiting are mutually exclusive cases, every consumer branches on the discriminator, and no consumer infers pending work from an error string or a boolean

#### Scenario: the wait step reports waiting while siblings are unresolved

- **GIVEN** a publish saga whose record shows some channels resolved and at least one still unresolved
- **WHEN** the wait step executes
- **THEN** it returns `waiting`, and it does not return a failure

#### Scenario: an unreadable record is a failure, not a wait

- **GIVEN** a publish saga whose publication-record reader cannot answer
- **WHEN** the wait step executes
- **THEN** it returns `failed` carrying the cause, spends retry budget, and does not report the saga as waiting

#### Scenario: missing scheduling data is still a failure

- **GIVEN** a publish saga for which no scheduling data was ever recorded
- **WHEN** the wait step executes
- **THEN** it returns `failed` carrying the cause, and it does not return waiting or success

#### Scenario: a channel that ended in error resolves the step, it does not fail it

- **GIVEN** a publish saga one of whose channels ended in error and is recorded as excluded, with every sibling channel published
- **WHEN** the wait step executes
- **THEN** it returns `succeeded`, the saga reaches COMPLETED, and it does not return `failed`

#### Scenario: an evicted queue entry does not fail a channel the record shows published

- **GIVEN** a channel whose record reads published and whose queue job is no longer observable
- **WHEN** the wait step executes
- **THEN** the channel counts as resolved-published, and neither a failure nor an exclusion is produced for it
