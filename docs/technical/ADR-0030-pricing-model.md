# ADR-0030: Pricing model — per connected channel, per workspace, prepaid terms without exit fees

- **Status**: Accepted
- **Date**: 2026-10-04
- **Deciders**: Edward
- **Supersedes**: —
- **Superseded by**: —
- **Related**: [ADR-0031](ADR-0031-domain-vocabulary.md) (the vocabulary used here),
  [ADR-0024](ADR-0024-billing-currency-and-price-catalog.md) (one hand-set price list per currency),
  [ADR-0025](ADR-0025-payment-gateway-selection-and-country-routing.md) (the gateway an
  organization is routed to), [ADR-0026](ADR-0026-non-payment-lifecycle.md) (the flow a trial
  enters when it ends without a payment method),
  [ADR-0027](ADR-0027-consumer-sales-and-tax-handling.md) (consumer refunds, the business checkbox)

## Context

This record uses the vocabulary of [ADR-0031](ADR-0031-domain-vocabulary.md): an **organization**
(today's `Account`) signs up and pays; it has **workspaces** (today's `Project`), each with its
**members** and its connected **channels**. A channel is one connected social account on a
**platform** (today's `Provider`). ADR-0031 maps every term to today's code names.

### What exists today

Measured on `main` at `bad953f2` by a read-only explorer, with path:line evidence (research
[Report 5](../reports/research-2026-10-04-billing.md#report-5-plan-model-map)); the parent
re-read `StripePaymentAdapter.ts:190-197`, the client's `pricing.ts`, `seed.ts:798-823`,
`PricingCalculator.ts:59-82` and `projectRoutes.ts:180`.

- **The real pricing model is a set of rules in the database**, edited in Admin › Pricing
  (`apps/admin/app/[locale]/(dashboard)/pricing/page.tsx`) through
  `apps/api/src/admin/pricingRoutes.ts` and `PricingAdminService`, which calls Prisma directly with
  no domain port:
  - `ProviderPricingTier`: a price per platform by how many platforms are chosen, seeded 1–3 at $10,
    4–7 at $8 and 8 or more at $6 (`infra/prisma/seed.ts:799-803`);
  - `AccountPricingTier`: a multiplier applied account by account in creation order — the first at
    ×1.0, the second to fifth at ×0.9, the sixth onward at ×0.8 (`seed.ts:818-822`,
    `packages/core/domain/src/billing/PricingCalculator.ts:74-81`);
  - `ProviderBundle`: a hand-set price per account per month with usage limits — Starter (X,
    Instagram, Facebook) $20 with 100 posts and 3 channels, Growth (6 platforms) $40 with 500 posts
    and 10 channels, Agency Full (all 11) $60 without limits (`seed.ts:835-877`);
  - `AccountSubscription`, holding one organization-wide `providers` list, `accountCount` (default
    1 and never written), `maxProjects`, `pricePerMonth` and a `MONTHLY`/`YEARLY` `billingCycle`.
- **Billing never reads those rules (finding F16).** The gateway price ids come only from the
  environment variables `{STRIPE|PADDLE}_PRICE_{BASIC|PRO|ENTERPRISE}_{MONTHLY|YEARLY}`, which are
  not in the env schema. The `PaymentAdapter` port has no quantity. Nothing outside the tests calls
  the adapters' `createSubscription` or `updateSubscription`. Checkout sends only
  `{ gatewayProvider }`: Stripe Checkout is created in subscription mode with no `line_items`
  (`apps/api/src/infrastructure/billing/StripePaymentAdapter.ts:191-197`) and the Paddle checkout
  URL carries no items, so whatever the customer picked is dropped. `subscription.activated` is
  handled only when a gateway switch is pending, `subscription.updated` is not handled, and the plan
  is never written back from the gateway. Recorded as SMELL-187 in
  [roadmap-detected-smells-backlog.md](../reports/roadmap-detected-smells-backlog.md).
- **The rest of the system disagrees with the rules.** The client hard-codes other prices ($12, $10,
  $8, $6 per platform; multipliers 1, 0.8, 0.65, 0.5), lists 10 platforms where the enum has 11, and
  prices yearly as monthly × 10 while the server bills monthly × 12. Three plan vocabularies coexist
  (bundle slugs, `BASIC`/`PRO`/`ENTERPRISE`, Admin's Starter/Pro price-id fields). `maxProjects`
  lives in two places that nothing keeps in sync, and registering on `ENTERPRISE` stores
  `maxProjects = -1`, which `apps/api/src/projects/projectRoutes.ts:180` (`heldSlots >= -1`) turns
  into "no project can ever be created". The trial is 14 days at registration and 7 days with tier
  `PRO` in `TrialManagementService`. The AI pool is platforms × `accountCount` × 10,000 tokens.
- **Nobody could say what the "account" in the multiplier is.** The client labels its slider
  "Social accounts"; the investor document means an agency's client accounts. ADR-0031 settles it:
  the multiplier's unit is a workspace.

### Edward's starting model, and what the research changed

Edward first described a usage-based model: expansion at any time, prorated to the end of the
current month; reduction allowed without refund; the units contracted at the start keep their price
until the end of the contracted term, later additions pay the current list price; a longer
commitment buys a lower price; and leaving early costs a penalty of a percentage of the remaining
contract value. Research
[Report 6](../reports/research-2026-10-04-billing.md#report-6-commitment-terms-early-exit-fees-and-proration)
then established:

- **A "% of the remaining value" exit fee is high-risk for consumers**: § 309 Nr. 6 BGB voids
  standard-term penalties for ending the contract and Nr. 5 caps flat-rate damages; the UK CMA's
  guidance CMA37 (22 July 2026), para 6.63, treats an early-termination charge as more likely unfair
  when it exceeds the benefit the consumer gained over a shorter contract — the ceiling a discount
  clawback recovers; France, Spain, Italy and Quebec point the same way. CJEU case C-821/24 (A1
  Bulgaria) asks exactly the clawback question and has no judgment yet.
- **Paddle cannot enforce a monthly-billed commitment.** Paddle's buyer terms (31 March 2026), §6:
  any buyer may cancel "with effect from the end of your current billing period… you will not be
  charged again after that", with no exception for business buyers (verified by the parent).
- **No competitor charges a percentage of the remaining value.** Among 13 social-media tools the
  common pattern is a prepaid term without refund, prorated upgrades and downgrades at the end of the
  period; Publer, which sells through Paddle, refunds an early exit pro rata minus the yearly
  discount.
- **Both gateways bill one interval per subscription.** Stripe allows several items with different
  prices in one subscription (same currency and interval); Paddle allows 1 to 100 items with one
  interval. Stripe's recurring interval goes up to three years (36 months,
  https://docs.stripe.com/api/prices/create); Paddle's `billing_cycle` takes `month` with an integer
  frequency and documents no maximum.

## Decision

1. **The price unit is the connected channel, priced per workspace** (2026-10-04, option B of the
   unit question; platforms chosen per workspace, option B of that question). In the organization's
   currency:

   ```text
   monthly list price = ( Σ over workspaces w : perChannelPrice(channels(w)) × channels(w) )
                        × volumeMultiplier(number of workspaces in the organization)
   price per month on a term = monthly list price × termMultiplier(term)
   charged for a term        = price per month on the term × months in the term
   ```

   - `perChannelPrice(n)` is the per-channel tier the workspace's channel count `n` falls into;
     every channel of the workspace pays that tier's price.
   - `volumeMultiplier(k)` is the tier the organization's total workspace count `k` falls into, and
     **every workspace takes it** (option C of the multiplier question). With 6 or more workspaces,
     all of them pay ×0.8, for example. This replaces today's graduated application by creation
     order.
   - Each workspace chooses and pays for its own channels; the organization-wide platform list goes.
     A workspace with one channel per network pays exactly what the per-platform model charged.
   - Amounts come from the organization's currency's own hand-set amounts
     ([ADR-0024](ADR-0024-billing-currency-and-price-catalog.md)) and are never computed from an
     exchange rate.

   **Illustration** (today's seeded USD figures read as per-channel and workspace tiers, and an
   assumed 12-month multiplier of ×0.80; the real defaults are an open point): workspace A has 3
   channels, 3 × $10 = $30; workspace B has 5, 5 × $8 = $40; two workspaces take ×0.9, so the
   monthly list price is ($30 + $40) × 0.9 = $63.00. On a 12-month term at ×0.80 that is $50.40 a
   month, $604.80 charged upfront.

2. **The pricing rules are configured in Admin, per currency**: the per-channel tiers (boundaries and
   the amount per channel), the workspace volume tiers (boundaries and multiplier) and one term
   multiplier per term (monthly is ×1.0, the list price). Each currency's amounts are hand-set and
   round. A currency is complete — and only then can countries be mapped to it — when every rule has
   a value in it.
3. **A bundle is a template** (2026-10-04, option B with Edward's condition): a named list of
   platforms, one channel each (Agency Full = all 11; Starter = X, Instagram, Facebook), that saves
   the customer picking network by network.
   - Its price is **never hand-set**. It is always computed by the same rules as the same manual
     selection, in every currency, and Admin shows the computed price live while a bundle is edited,
     exactly as a customer would see it.
   - When the rules change, bundle prices follow; existing subscribers keep their price lock until
     their term ends.
   - Bundles carry **no usage limits**. `ProviderBundle` loses `pricePerAccountMonth`,
     `maxPostsPerMonth` and `maxChannels`; `PricingCalculator.findCheaperBundle` is removed, because
     a bundle can never cost differently from the same selection.
4. **A commitment is a prepaid term** (2026-10-04, option A): 1, 3, 6, 12, 18 or 24 months, paid
   upfront, each with its term multiplier. Edward added 3 months as long enough to measure results
   and shorter than 6.
   - **Consumers choose up to 12 months.** CMA37 para 6.70: "tie-ins of over 12 months have been
     found to be unfair"; § 309 Nr. 9 BGB allows up to two years only with conditions.
   - **Businesses — buyers who tick "buying as a business"
     ([ADR-0027](ADR-0027-consumer-sales-and-tax-handling.md), point 1.6) — choose up to 24 months.**
   - The term is the subscription's billing interval, identical on both gateways.
5. **Price lock.** The units contracted at the start of a term keep their price until the term ends.
   Units added later pay the then-current list price (point 6). A renewal prices the subscription at
   the then-current list (point 10).
6. **Expansion during a term** (2026-10-04, option A). A unit — a channel, or a workspace with its
   channels — added during a prepaid term pays the then-current list price **with that term's
   multiplier**: the "normal price" is the price without the original lock, not without the term
   discount. It is charged at once, prorated to the end of the paid term, so everything renews on one
   date. On the monthly term that is the end of the month, which was Edward's original rule.
   **Illustration** (continuing point 1): at the start of month 5, after the 4–7 tier rose to $9,
   workspace B connects a sixth channel. It pays $9 × 0.9 × 0.80 = $6.48 a month, about $51.84 for
   the eight remaining months, charged now; B's first five channels keep their locked $8-based price.
7. **Reduction** (2026-10-04, superseding the default stated earlier that day, "no refund, applied
   at the end of the paid term"):
   - **During a prepaid term, a reduction is an early exit of the removed unit.** Refund for that
     unit = amount paid for it − (months used × that unit's monthly list price), with rules 1 to 3
     of point 8: a started month counts as used, the refund is never negative, and nothing extra is
     ever charged.
   - **Example** (Edward): a workspace lists at $50 a month; a 6-month term at 10% off costs $45 a
     month, so $270 was paid. The workspace is removed during month 4: 4 months used × $50 = $200,
     refund $70. That equals months 5 and 6 ($90) minus the $20 discount already enjoyed.
   - **On the monthly term there is no refund**: the current month counts as used, and the reduction
     applies from the next month.
   - **The remaining units keep their price lock until the term ends**, even if the workspace volume
     tier changes; the new tier applies at renewal.
8. **Early exit.** An organization that leaves before its term ends is refunded:

   ```text
   refund = amount paid − (months used × monthly list price)
   ```

   Equivalently, the remaining amount minus the promotion already enjoyed. **Example** (Edward): a
   $100 monthly list price, 12 months at 20% off = $960 paid; leaving after 4 months refunds
   $960 − 4 × $100 = $560. Four rules:
   1. A started month counts as used, and access continues to the end of that month.
   2. The refund is never negative. Zero or less means nothing is refunded and nothing extra is ever
      charged (Paddle could not charge it anyway).
   3. Units added during the term use the same formula, on what was paid for them.
   4. Within the 14-day consumer withdrawal window the refund is 100%, which takes precedence.

   The monthly list price in the formula is the one the unit's term price was computed from; only
   then does the formula equal "the remaining amount minus the promotion enjoyed", as both examples
   show. Stripe issues the refund as a partial refund and Paddle as a refund adjustment.

9. **No exit fee.** Nothing is ever charged for leaving. A percentage of the remaining value is
   high-risk for consumers in Germany, the UK, France, Spain, Italy and Quebec, and Paddle's buyer
   terms §6 make it unenforceable there for any buyer.
10. **List-price changes reach a subscriber only at a renewal, with 30 days' notice** (the notice
    period is configurable in Admin; a default stated to Edward and not objected to). A change takes
    effect at the first renewal that falls at least the notice period after the notice.
11. **Trial: 14 days**, configurable in Admin, replacing today's two values (14 at registration, 7
    with tier `PRO` in `TrialManagementService`).
    - **Whether a card is required to start is an Admin setting, and it starts off** (option A): at
      day 14 without a payment method the organization enters the suspension and lock flow of
      [ADR-0026](ADR-0026-non-payment-lifecycle.md).
    - It can be switched to card-required (option B) once there is a solid customer base. Then the
      consumer obligations apply automatically: a notice before the first charge, and, in the UK
      from 2027, the cooling-off period after a trial
      ([ADR-0027](ADR-0027-consumer-sales-and-tax-handling.md)).
12. **Free plan: it exists and is off by default** (option B). Admin switches it on only when it is
    profitable. Its limits are fixed and all configurable in Admin; the proposed defaults are 1
    workspace, 3 channels, a monthly cap on scheduled posts, 1 member, a storage cap and an AI-token
    cap.
13. **The monthly AI pool is per channel**, configurable in Admin, replacing platforms ×
    `accountCount` × 10,000 tokens (a default stated to Edward and not objected to).
14. **Removed** (defaults stated to Edward and not objected to, plus what follows from points 1–4):
    - the separate "max projects" limit: workspaces are what is paid, so `Account.maxProjects`,
      `AccountSubscription.maxProjects` and the project-creation quota check go;
    - the server's yearly × 12 and the client's yearly × 10, replaced by term multipliers;
    - the `BASIC`/`PRO`/`ENTERPRISE` tiers with their environment price ids, Admin's Starter/Pro
      price-id fields, and the client's hard-coded prices.
15. **Gateway mapping, the same on both gateways.**
    - **One subscription per organization**, in its currency, on the gateway its billing country is
      routed to ([ADR-0025](ADR-0025-payment-gateway-selection-and-country-routing.md)).
      `AccountSubscription.accountId` is already unique.
    - **One subscription item per price cohort.** Units bought at the same unit amount share an item
      whose quantity is their channel count; a unit added during the term opens a new item at the
      current amount. That is how the lock holds without re-pricing older items. Stripe allows
      several items with different prices in one subscription (20 in classic billing mode, 100 in
      flexible mode), all in one currency and one interval; Paddle allows 1 to 100 items with one
      interval.
    - **The term is the billing interval.** Stripe: a recurring `month` interval with an interval
      count equal to the term (up to 36 months, verified). Paddle: a `billing_cycle` of `month` with
      a frequency equal to the term; no maximum is documented, so 18 and 24 months are confirmed in
      the Paddle sandbox before they are offered.
    - **OmniPost computes every item's unit amount from the rules**; the gateways compute no tier and
      no multiplier, so both charge the same integer
      ([ADR-0024](ADR-0024-billing-currency-and-price-catalog.md), point 3).
    - **Expansion** is charged at once and prorated (Stripe `proration_behavior: always_invoice`,
      Paddle `prorated_immediately`). **Refunds for a reduction or an early exit are the amount the
      formula gives**, issued by OmniPost, not a gateway proration credit. A reduction on the monthly
      term changes the quantity from the next month (Stripe `proration_behavior: none`; Paddle's
      scheduled changes accept only cancel, pause and resume, so OmniPost applies it at renewal).
    - **Today's checkout sends no price at all (F16).** The checkout must send the line items of the
      computed quote, and the gateways' subscription events must write the subscription back.

## Rationale

1. **The channel is what the customer uses and what costs OmniPost.** Pricing per platform with
   unlimited channels lets 50 Instagram accounts cost as much as one. Buffer, Hootsuite and Sprout
   Social price per connected profile or channel.
2. **A workspace is how an agency works**: one per client or brand, each with its own networks, so
   each pays for what it connects.
3. **A volume multiplier can be computed by hand and cannot be gamed.** Graduated by creation order,
   it rewards deleting and recreating workspaces; graduated from the most to the least expensive, no
   customer can check the bill.
4. **One price rule means a bundle cannot be wrong.** A bundle priced by the rules can neither
   undercut nor overcharge the same selection, so `findCheaperBundle` has nothing left to find, and
   without limits the channel stays the only meter.
5. **A prepaid term is the only commitment both gateways can hold.** Paddle's buyer terms let any
   buyer stop at the end of the current billing period, so the commitment has to be the billing
   period itself. Prepaid terms without exit fees are also the competitors' common pattern.
6. **The early-exit refund is a discount clawback**, the variant CMA37 para 6.63 names as the
   ceiling and Quebec's statute effectively uses. It is a refund, never a later charge, so it works
   on Paddle; Publer does the same.
7. **A reduction must never cost more than leaving.** The default stated earlier that day — no
   refund, the reduction applied at the end of the paid term — made reducing costlier than cancelling
   everything and re-buying one workspace, which gets the clawback refund. Treating a reduced unit as
   an early exit of that unit makes the two paths cost the same.
8. **Expansion keeps the term discount and one renewal date.** Both gateways need one interval per
   subscription, and a customer who grows mid-term should not lose the discount on the new units.
9. **Price changes at renewal, with notice, keep the lock honest.** The Unfair Contract Terms
   Directive's grey list includes a price increase without a right to cancel (Annex 1(l)); Sprout
   Social and Loomly announce changes ahead of renewal.
10. **A trial without a card lowers the entry barrier now**, and the switch keeps card-required
    available for later without a code change.
11. **One number per thing.** Yearly × 12 against × 10, two `maxProjects`, three plan vocabularies
    and a client price table that differs from the database are F16's surroundings; removing them is
    what makes the shown price the charged price.

## Alternatives Considered

- **Per platform with unlimited channels.** Rejected: 50 Instagram accounts would cost as much as
  one.
- **Per platform with one included channel.** Rejected: it gives the same number as per channel and
  is harder to explain.
- **One organization-wide platform list** (today's `AccountSubscription.providers`). Rejected for
  platforms chosen and paid per workspace.
- **Workspace multiplier graduated by creation order** (today's `PricingCalculator`). Rejected:
  gameable by deleting and recreating workspaces.
- **Workspace multiplier graduated from the most to the least expensive workspace.** Rejected: too
  hard to compute by hand.
- **An exit fee of a percentage of the remaining contract value** (Edward's first description).
  Rejected: high-risk for consumers in Germany, the UK, France, Spain, Italy and Quebec, and
  unenforceable through Paddle.
- **A commitment billed monthly, with an exit charge or a clawback charge.** Rejected: Paddle's buyer
  terms let the buyer stop at the end of any month. The research's optional variant — annual billed
  monthly, for businesses, on Stripe only — was not chosen, because it would work on one gateway.
- **Monthly-only plans**, the fallback if commitments proved unworkable. Not needed: prepaid terms
  work the same on both gateways.
- **Expansion prorated to the end of the current month on a prepaid term** (Edward's first
  description). Superseded: one interval per subscription would leave two renewal dates.
- **Added units at the list price without the term multiplier.** Not chosen: the "normal price" is
  the price without the lock, not without the term discount.
- **Reductions without refund, applied at the end of the paid term** (the default stated earlier on
  2026-10-04). Superseded the same evening: reducing would cost more than leaving.
- **Hand-set bundle prices, and usage limits per bundle** (today's `ProviderBundle`). Rejected.
- **Terms over 12 months for consumers.** Rejected (CMA37 para 6.70).
- **A trial that requires a card from day one.** Not chosen now; it is an Admin setting for later.
- **No free plan, or a free plan on from launch.** Not chosen: a free plan exists and is switched on
  only when it is profitable.

## Consequences

**Positive**

- One rule set prices every quote, bundle, checkout and renewal, on both gateways and in every
  currency.
- The amount on the pricing page is the amount charged, and a customer can check it by hand.
- Leaving or shrinking early is always refunded fairly, and nothing is ever charged for it.

**Negative / costs**

- **The schema changes**: pricing-rule tables per currency replace `ProviderPricingTier` and
  `AccountPricingTier`; `ProviderBundle` loses three fields; `AccountSubscription` loses
  `providers`, `accountCount`, `maxProjects` and its single `pricePerMonth`, and gains a term and
  items per price cohort; `Account.maxProjects` goes. `PricingCalculator` is rewritten.
- **The `PaymentAdapter` port grows**: line items with quantity, subscription events and refunds.
- **Every currency must cover every rule**, so Admin edits tiers × currencies, and a currency is
  unusable until complete.
- **Items multiply with cohorts.** Stripe's classic billing mode allows 20 items per subscription;
  flexible mode allows 100 and is the default from API version `2025-09-30.clover`.
- **OmniPost computes and issues refunds itself**, and must keep, per unit, what was paid and its
  monthly list price.
- **18- and 24-month terms on Paddle are unverified** until the sandbox check.
- **The client's pricing page is rebuilt** to ask the API for quotes.
- **The documents use the new vocabulary while the code keeps the old names** until the rename of
  ADR-0031 lands.

## Open points

Each blocks the slice named in [billing-gateways.md](../features/billing-gateways.md) §11.

- **Default values**: per-channel tier boundaries and amounts, the EUR amounts, the workspace volume
  tiers, the multipliers for 3, 6, 12, 18 and 24 months, the AI tokens per channel, and the free
  plan's caps on posts, storage and AI tokens. Today's seeded USD figures are platform tiers, not
  channel tiers.
- **Expansion across a tier boundary.** A reduction leaves the locked units on their price even when
  the volume tier changes; for an expansion that moves a workspace into a cheaper per-channel tier,
  or the organization into a cheaper volume tier, it is not decided which tier prices the added unit
  and whether the locked units follow.
- **Empty workspaces.** As written, a workspace with no connected channel costs nothing and still
  counts toward the organization's volume tier.
- **What removing a unit is.** Whether disconnecting a channel is itself a reduction, or the customer
  lowers a paid count explicitly; a reconnection after an expired token must not be billed as a
  removal and a re-addition.
- **Which list price the refund formula uses** when the list changed between purchase and exit. Point
  8 reads it as the price the term price was computed from; the examples do not cover a change.
- **The scope of early-exit rule 4.** It names "the 14-day consumer withdrawal window"; the voluntary
  14-day refund of [ADR-0027](ADR-0027-consumer-sales-and-tax-handling.md) (point 1.2) is not limited
  to consumers, and Paddle gives UK annual subscribers a new window at renewal.
- **A trial without a card at the gateway.** Whether it holds a gateway subscription at all decides
  what the day-30 cancellation of [ADR-0026](ADR-0026-non-payment-lifecycle.md) acts on.
- **Limits during a trial**: the free plan's, none, or others.
- **Pre-renewal reminders.** [ADR-0027](ADR-0027-consumer-sales-and-tax-handling.md) point 1.5 names
  annual renewals; which of the 3-, 6-, 18- and 24-month terms get one is not decided.
- **Rounding** of computed amounts to integer minor units (per item or per quote). Today's calculator
  rounds each account line to cents.
- **How computed amounts reach the gateways**: a synchronised gateway price per distinct unit amount,
  or a price created inline per item. [ADR-0024](ADR-0024-billing-currency-and-price-catalog.md)
  point 3 was written for a plan × cycle catalog; the slice decides after a sandbox check on both
  gateways.
- **Existing subscriptions.** Whether any deployed environment has paying subscriptions under the
  environment price ids could not be determined; their migration depends on it.
- **`BundleFeatureFlag`** has no reader today; with bundles as templates without limits, whether it
  stays is to be reviewed.

## Revisit if

- Paddle refuses an 18- or 24-month billing cycle in the sandbox: a term only one gateway can bill
  breaks "both gateways work the same".
- The CJEU decides C-821/24 on discount clawbacks, or the UK subscription regime (from January 2027)
  or an EU Digital Fairness Act changes the rules on terms, renewals or early exit.
- An organization's cohorts approach a gateway's item limit.

## Risks and Mitigations

| Risk                                                                   | Mitigation                                                                                                                      |
| ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| The pricing page and the charged amount diverge again                  | One calculator in the domain serves quotes, bundles, checkout and renewals; the client renders API quotes and holds no prices   |
| A refund is computed from the wrong paid amount or list price          | Each billed unit records what was paid for it and its monthly list price when it is bought; the refund reads only those records |
| A consumer is offered a term over 12 months                            | The term selector offers 18 and 24 months only after "buying as a business" is ticked, and the server rejects them otherwise    |
| A gateway proration credit is issued on top of the formula's refund    | Reductions and early exits change items without a gateway credit; the formula's refund is the only refund issued                |
| Paddle cannot bill 18 or 24 months                                     | Sandbox check before those terms are offered on Paddle; see Revisit if                                                          |
| A list-price change reaches a subscriber without notice or mid-term    | Changes apply only at a renewal at least the notice period after the notice; the notice is sent and recorded per subscription   |
| A legacy tier, price id or hard-coded price survives and charges again | The slice that removes them deletes the code paths, the environment variables and the Admin fields together                     |

## References

- Research: [research-2026-10-04-billing.md](../reports/research-2026-10-04-billing.md) — Report 5
  (the plan model on `main`, with path:line evidence) and Report 6 (legality of terms and exit fees,
  competitors, Stripe and Paddle feasibility).
- Specification: [billing-gateways.md](../features/billing-gateways.md) — requirements R34–R50,
  slices BILL-18 to BILL-28.
- Backlog: SMELL-187 to SMELL-193 in
  [roadmap-detected-smells-backlog.md](../reports/roadmap-detected-smells-backlog.md).
- Stripe: prices (recurring interval up to three years) — https://docs.stripe.com/api/prices/create ·
  multiple items per subscription — https://docs.stripe.com/billing/subscriptions/multiple-products ·
  prorations — https://docs.stripe.com/billing/subscriptions/prorations · billing mode —
  https://docs.stripe.com/billing/subscriptions/billing-mode
- Paddle: buyer terms — https://www.paddle.com/legal/buyer-terms · prices (billing cycle) —
  https://developer.paddle.com/api-reference/prices/create-price/ · proration —
  https://developer.paddle.com/concepts/subscriptions/proration · subscription updates —
  https://developer.paddle.com/api-reference/subscriptions/update-subscription/
- UK CMA, unfair contract terms guidance (CMA37, 22 July 2026) —
  https://assets.publishing.service.gov.uk/media/6a609329b00f3323bf1a23f3/unfair_contract_terms_guidance.pdf
- § 309 BGB — https://dejure.org/gesetze/BGB/309.html · Directive 93/13/EEC —
  https://eur-lex.europa.eu/legal-content/EN/TXT/PDF/?uri=CELEX:31993L0013
- Code: `infra/prisma/schema.prisma:3006-3094`; `infra/prisma/seed.ts:798-892`;
  `packages/core/domain/src/billing/PricingCalculator.ts`;
  `apps/api/src/infrastructure/billing/StripePaymentAdapter.ts:191-197`;
  `apps/api/src/projects/projectRoutes.ts:180`;
  `apps/client/app/[locale]/dashboard/settings/billing/utils/pricing.ts`;
  `packages/core/ai/src/AiRequestService.ts:44`; `packages/core/billing/src/TrialManagementService.ts`.
