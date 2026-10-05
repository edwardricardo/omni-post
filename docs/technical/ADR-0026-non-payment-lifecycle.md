# ADR-0026: Non-payment lifecycle — OmniPost owns the cut-off, one billing-access state machine

- **Status**: Accepted
- **Date**: 2026-10-04
- **Deciders**: Edward
- **Supersedes**: —
- **Superseded by**: —
- **Related**: [ADR-0025](ADR-0025-payment-gateway-selection-and-country-routing.md) (routing-change
  grace period), [ADR-0006](ADR-0006-result-type-over-throws.md) (Result over throws),
  [ADR-0030](ADR-0030-pricing-model.md) (a trial that ends without a payment method enters this
  flow)

## Context

When a renewal fails, three things must happen identically on Stripe and Paddle: the gateway
retries the card, someone decides when to stop, and the customer's access changes. Measured on
`main` at `bad953f2`, none of the three is reliable.

**Stripe payment events are never recorded (finding F13).**
`packages/core/billing/src/GatewayBillingService.ts:859` (`handlePaymentFailed`) and `:942`
(`handlePaymentSucceeded`) decide the gateway with:

```typescript
const provider: "STRIPE" | "PADDLE" = String(data.subscription_id ?? "").startsWith("sub_")
  ? "STRIPE"
  : "PADDLE";
```

The installed `stripe@21.0.1` speaks API version `2026-03-25.dahlia`, whose `Invoice` has no
top-level `subscription` or `subscription_id`; the only subscription field is
`parent.subscription_details.subscription` (`stripe/types/Invoices.d.ts:1068`). Every Stripe invoice
is therefore classed `PADDLE`, and `findByGatewayCustomerId`, which filters on the gateway
(`apps/api/src/infrastructure/repositories/PrismaAccountBillingRepository.ts:80`), finds no account.
Stripe `payment.failed` and `payment.succeeded` events are never recorded. The sniff cannot work for
Paddle either: Paddle subscription ids also start with `sub_`. The unit fixture invents
`subscription_id: "sub_abc"` (`apps/api/tests/unit/billing/dunning.test.ts:232`), which is why the
suite stays green. The master plan already tracks the symptom as N-COR-4 (`BILLING-DUNNING-DEAD`:
the service re-derives the provider from the payload); F13 is its measured mechanism, recorded as
SMELL-184 in [roadmap-detected-smells-backlog.md](../reports/roadmap-detected-smells-backlog.md).

**The cut-off cancels locally and leaves the gateway charging.** On the third failed attempt,
`GatewayBillingService.ts:899` sets the subscription to `CANCELED` in the database and never calls
the gateway, so Stripe or Paddle keeps retrying and may charge a customer OmniPost shows as canceled.
The email sent at that point says the account "has been suspended" (`:918`) while the stored status
is `CANCELED`. The attempt count is read from Stripe-shaped raw keys,
`data.attempt_count ?? data.payment_attempt_number` (`:868`).

**There is no defined access state for an unpaid account.** `SubscriptionStatus` holds `TRIALING`,
`ACTIVE`, `PAST_DUE`, `CANCELED` and `GRANDFATHERED`; nothing says what a past-due or cut-off
customer may still do, or what happens to the posts they scheduled.

## Decision

1. **The non-payment cut-off is OmniPost's rule, identical for Stripe and Paddle** (option B of
   2026-10-04). It is **N failed attempts, default 3** (today's value), configurable in Admin.
   - Card retries stay with each gateway's own retry schedule.
   - Each gateway's own automatic cancellation is configured **not to cancel first**: it leaves the
     subscription past due or unpaid, so the decision is always OmniPost's.
   - **At the cut-off the gateway stops charging on its own schedule, but the subscription stays
     alive** (Edward, 2026-10-04: "La subscripción se cancela el día 30"). Its automatic retries are
     stopped so it cannot charge behind OmniPost's back, and the open invoice remains payable
     through the embedded payment form of point 5, which reactivates the account.
   - **The gateway subscription is canceled on day 30 of the payment-only lock**, through the
     adapter; local state follows what the gateway confirms. A local-only cancel is never used. The decision record says the adapter
     "gains a cancel-now operation"; measured, the port already declares
     `cancelSubscription({ externalSubscriptionId, immediately })`
     (`packages/ports/src/PaymentAdapter.ts`), and the dunning path simply never calls it. The slice
     uses that operation, after confirming both adapters implement `immediately` as the port's JSDoc
     states.
2. **Every dunning fact comes from a provider-neutral payment event.** The `PaymentAdapter` port
   (`packages/ports/src/PaymentAdapter.ts`) gains a typed `PaymentEvent`; each adapter translates its
   own webhook payload into it (attempt count, amount in minor units, currency, invoice and
   subscription ids, customer id). **The webhook route passes the provider, which is never inferred
   from a payload field.** This is the precondition for everything below, and it closes F13.
3. **One billing-access state machine per account:**

   | State                 | Entered when                             | What the customer can do                                                                                                                |
   | --------------------- | ---------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
   | `ACTIVE`              | Paid, or any successful payment          | Everything                                                                                                                              |
   | `PAST_DUE`            | A renewal fails; the gateway is retrying | Everything                                                                                                                              |
   | `SUSPENDED_READ_ONLY` | The N-th failed attempt (the cut-off)    | Read only, for **72 hours**. No scheduling, no updates, no changes except payment details. Scheduled posts are paused                   |
   | `LOCKED_PAYMENT_ONLY` | 72 hours after suspension                | Only the payment form, for **30 days** (configurable in Admin)                                                                          |
   | `CANCELED`            | The 30-day lock ends unpaid              | The subscription is canceled at the gateway. **The account and its data are kept**, so the customer can resubscribe and find everything |

   **A successful payment at any step returns the account to `ACTIVE`.** Nothing is deleted
   automatically: deletion stays with the existing soft-delete, restore and tombstone retention flows.

   **Trial end ([ADR-0030](ADR-0030-pricing-model.md) point 11, decided later on 2026-10-04).**
   While a trial does not require a card, a trial that reaches its last day (14 by default) without
   a payment method enters this same flow, as a cut-off does: `SUSPENDED_READ_ONLY`, then
   `LOCKED_PAYMENT_ONLY`, then `CANCELED`. Whether such a trial holds a gateway subscription for the
   day-30 cancellation to act on is an open point of ADR-0030.

4. **One API guard enforces the state.** It rejects every mutating request except the billing
   endpoints, with a dedicated error code. The portals map that code to the "update payment details"
   banner while read-only, and to the payment-only screen while locked. No route checks billing state
   on its own.
5. **The payment form is the gateway's own embedded component**: the Stripe Payment Element or
   Paddle.js. Card data never touches OmniPost's servers. When the new method charges successfully,
   it becomes the account's payment method, the unpaid invoice is retried immediately, and the
   account reactivates.
6. **Scheduled posts pause from the moment of suspension**, because publishing is the paid service.
   - The publish worker checks the account's billing-access state before dispatching: one check,
     not one per provider.
   - Paused posts stay stored. On reactivation, posts whose time has passed get an explicit
     "missed / not published" state and appear in a list for the customer to reschedule. They are
     **never published in a burst**, and never silently dropped.
7. **Weekly deadline notifications.** During the 30-day lock the customer gets a weekly
   notification, by email and as an in-app banner, showing the date the subscription will be
   canceled. One scheduled-reminder mechanism keyed on a deadline provides it: the existing
   gateway-switch reminder job, generalised from a single reminder at 24 hours to a weekly cadence
   until the deadline. The routing-change grace period of
   [ADR-0025](ADR-0025-payment-gateway-selection-and-country-routing.md) uses the same mechanism.

## Rationale

1. **One rule for two gateways.** Each gateway's own dunning ends differently and on its own
   schedule; leaving the cut-off to them is how the two would diverge.
2. **What OmniPost shows is what the gateway does.** Canceling at the gateway, and following its
   confirmation, removes the state where a customer shown as canceled is still being charged.
3. **A typed event is the only fix for F13 that does not come back.** Reading raw provider keys in
   the service is also the root of finding F9 (Paddle events not normalised to the provider-neutral
   shape both gateways must share); a translator per adapter, with the provider passed by the route
   that received the webhook, cannot misclassify a payload.
4. **Read-only before locked gives the customer a soft landing.** For three days the customer still
   sees their work, with a clear banner, while fixing the card; after that the account narrows to
   the one action that resolves it.
5. **One guard is one place to get right.** Per-route checks drift; a single guard with a single
   error code gives the portals one thing to map.
6. **Missed posts are the customer's decision.** A burst of stale posts on reactivation can harm the
   customer more than a missed slot.

## Alternatives Considered

- **A. Each gateway's own dunning decides** (Stripe's and Paddle's retry-and-cancel settings).
  Rejected: the two gateways would end non-payment differently, which breaks "both work exactly the
  same".
- **Keep the local-only cancel** (today). Rejected: the gateway keeps retrying, and may charge, a
  customer shown as canceled.
- **Cancel and delete the data at the cut-off.** Rejected: the customer must be able to resubscribe
  and find everything; deletion stays with the retention flows.
- **Publish missed posts automatically on reactivation.** Rejected: stale content published in a
  burst.
- **An OmniPost-hosted card form.** Rejected: card data would reach OmniPost's servers. The
  gateways' embedded components keep it out.
- **Billing checks in each route.** Rejected for the single guard (point 4).
- **Keep sniffing the provider, with a better field.** Rejected: any payload-shape heuristic breaks
  on the next API version, and Stripe and Paddle share the `sub_` prefix.

## Consequences

**Positive**

- Stripe payment failures and recoveries are recorded for the first time.
- Both gateways end non-payment the same way, on a timeline Admin can read and configure.
- A customer always knows the state of the account and the date that matters.

**Negative / costs**

- **The `PaymentAdapter` port and both adapters change**, and the dunning suite's invented fixture
  is replaced by a real dahlia-shaped Stripe payload and a real Paddle payload.
- **A new account-level state, a guard on every mutating route, and a publish-worker check** all
  land; the guard's error code becomes part of the portals' contract.
- **Posts gain an explicit missed state** and the client gains a list to reschedule them.
- **Each gateway's dashboard settings become part of the deployment**: their automatic cancellation
  must be configured not to fire first, and that cannot be checked from the code alone.

## Open points

- **Resolved 2026-10-04 — when the gateway subscription is canceled.** Two decisions of that day
  read differently: the dunning decision canceled at the gateway when the N-attempt limit was
  reached, the lock-duration decision after the 30-day lock. Edward resolved it the same evening:
  the subscription is canceled on day 30 of the lock, and at the cut-off the gateway only stops its
  own retries (point 1).
- **The read-only window is 72 hours**, stated as fixed; only N and the lock length were made
  configurable.

## Revisit if

- A gateway cannot be configured to leave an unpaid subscription alone, so its own cancellation
  would fire before OmniPost's cut-off.
- A plan tier needs a different timeline (for example a longer lock for annual customers).

## Risks and Mitigations

| Risk                                                                 | Mitigation                                                                                                                                     |
| -------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| A translator misreads a payload field and the dunning count is wrong | Each translator is tested against a real payload of its gateway's pinned API version, not a hand-written fixture                               |
| A gateway's own auto-cancel fires before OmniPost's cut-off          | Part of the gateway setup checklist in Admin; the translator records a gateway-side cancel as an event, so the state machine sees it           |
| The guard blocks a request a locked customer needs                   | The guard allows the billing endpoints by name; the payment flow is tested end to end in the locked state                                      |
| A paused post is published after reactivation without the customer   | The worker's billing-access check runs before every dispatch; posts past their time move to the missed state instead of returning to the queue |
| A reactivation and a scheduled cancellation race                     | The state machine has one writer per account transition, and the cancel at the end of the lock re-reads the state before calling the gateway   |

## References

- Research: [research-2026-10-04-billing.md](../reports/research-2026-10-04-billing.md) — Report 2 §1
  (gateway behaviour), Report 4 §3 (what each gateway covers on refunds and cancellation).
- Specification: [billing-gateways.md](../features/billing-gateways.md).
- Pricing model and trial: [ADR-0030](ADR-0030-pricing-model.md).
- Backlog: SMELL-184 (F13) in [roadmap-detected-smells-backlog.md](../reports/roadmap-detected-smells-backlog.md);
  master plan item N-COR-4 in [MASTER_PLAN_ES.md](../product/MASTER_PLAN_ES.md).
- Code: `packages/core/billing/src/GatewayBillingService.ts:859`, `:868`, `:899`, `:918`, `:942`;
  `apps/api/src/infrastructure/repositories/PrismaAccountBillingRepository.ts:80`;
  `apps/api/tests/unit/billing/dunning.test.ts:232`; `packages/ports/src/PaymentAdapter.ts`;
  `apps/api/src/billing/GatewaySwitchJobService.ts` (the reminder job generalised by point 7).
- Stripe types: `stripe@21.0.1`, `types/Invoices.d.ts:1068`, API version `2026-03-25.dahlia`.
- Canon: `docs/architecture/ARCHITECTURE_CANON.md` §Hexagonal (ports and adapters) and §Unit of Work;
  `docs/observability/LOGGING_CANON.md` §Background Tasks (the reminder and lock-end jobs).
