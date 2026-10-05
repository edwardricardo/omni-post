# Billing gateways: pricing, currency, routing, non-payment and consumer sales

- **Status**: Decided 2026-10-04 — ready for implementation slices (§10)
- **Date**: 2026-10-04
- **Owner**: Edward / Platform engineering
- **Decisions**: [ADR-0024](../technical/ADR-0024-billing-currency-and-price-catalog.md) (currency and
  price catalog) · [ADR-0025](../technical/ADR-0025-payment-gateway-selection-and-country-routing.md)
  (gateway selection and routing) · [ADR-0026](../technical/ADR-0026-non-payment-lifecycle.md)
  (non-payment lifecycle) · [ADR-0027](../technical/ADR-0027-consumer-sales-and-tax-handling.md)
  (consumer sales and tax) · [ADR-0030](../technical/ADR-0030-pricing-model.md) (pricing model) ·
  [ADR-0031](../technical/ADR-0031-domain-vocabulary.md) (vocabulary)
- **Research**: [research-2026-10-04-billing.md](../reports/research-2026-10-04-billing.md)
- **Findings this work closes**: F13 (SMELL-184), F14 (SMELL-185), F16 (SMELL-187) and the pricing
  defects SMELL-188 to SMELL-193 in
  [roadmap-detected-smells-backlog.md](../reports/roadmap-detected-smells-backlog.md); master plan
  N-COR-4 (`BILLING-DUNNING-DEAD`) and L-6 (`BILLING-EVENTID-FALLBACK`) in
  [MASTER_PLAN_ES.md](../product/MASTER_PLAN_ES.md)
- **Related**: [docs/api/billing.md](../api/billing.md) (today's billing services and routes)

---

## 1. Scope

**In scope**

- The pricing model: pricing rules per currency, bundles as templates, channels counted per
  workspace, prepaid terms, price-lock cohorts, expansion, reduction and early-exit refunds, the
  trial and the free plan.
- One price catalog in the domain — the pricing rules — with per-currency price lists, and the
  synchronisation of the amounts they produce to Stripe and Paddle.
- Gateway configuration in Admin as the single source, and routing organizations by billing country.
- A provider-neutral payment event, with the provider passed by the webhook route, and the
  subscription written back from the gateway's events.
- The non-payment lifecycle: cut-off, suspension, lock, cancellation, reactivation, paused and
  missed posts, deadline reminders.
- Selling to consumers: the six mechanics, tax-exclusive display, reverse-charge gating and location
  evidence on the Stripe path.
- Exchange rates for reporting in USD.

**Out of scope**

- Renaming `Account`, `Project` and the member models in the code and the database: its own
  workstream ([ADR-0031](../technical/ADR-0031-domain-vocabulary.md)).
- Data deletion after cancellation: the existing soft-delete, restore and tombstone retention flows
  stay as they are.
- A GBP price list. It is a later map edit plus a new list, with no code change.

## 2. Glossary

This specification uses the vocabulary of [ADR-0031](../technical/ADR-0031-domain-vocabulary.md).
Until the rename lands, an **organization** is an `Account` in the code (tenant-scoped tables carry
`accountId`), a **workspace** is a `Project`, and a **platform** is a `Provider`.

| Term                  | Meaning                                                                                                                               |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| Organization          | The customer who signs up and pays. It owns one subscription, its workspaces and its members                                          |
| Workspace             | A space per client or brand inside an organization, with its own members and channels                                                 |
| Channel               | One connected social account on a platform, belonging to one workspace. The unit of price                                             |
| Pricing rules         | Per-channel tiers, workspace volume tiers and term multipliers, each with a value per currency. The price catalog                     |
| Per-channel tier      | The price every channel of a workspace pays, chosen by the workspace's channel count                                                  |
| Workspace volume tier | The multiplier every workspace of an organization takes, chosen by the organization's workspace count                                 |
| Term                  | The prepaid billing period: 1, 3, 6, 12, 18 or 24 months. It is the subscription's billing interval                                   |
| Term multiplier       | The factor a term applies to the monthly list price; the monthly term is ×1.0                                                         |
| Quote                 | The amount the pricing rules give for an organization's workspaces, channels and term, in its currency, in integer minor units        |
| Bundle                | A named template of platforms, one channel each, priced by the same rules as the same manual selection                                |
| Price cohort          | Units bought at the same unit amount; one subscription item each                                                                      |
| Price lock            | A cohort keeps its unit amount until the term ends                                                                                    |
| Expansion             | A unit (a channel, or a workspace with its channels) added during a term                                                              |
| Reduction             | A unit removed during a term                                                                                                          |
| Early-exit refund     | Amount paid − (months used × monthly list price), never negative                                                                      |
| Price list            | The values of one currency in the pricing rules. Hand-set and round; never computed from a rate                                       |
| Billing country       | The ISO-3166 alpha-2 country the customer gives at checkout. It decides currency and gateway                                          |
| Currency map          | Country → ISO-4217 currency. Seeded EUR for Europe, USD elsewhere                                                                     |
| Routing map           | Country → gateway (`STRIPE` or `PADDLE`). One value per country, so exclusive by structure                                            |
| Payment event         | The provider-neutral record each adapter translates a payment or subscription webhook into                                            |
| Billing-access state  | The organization's state in the non-payment lifecycle: `ACTIVE`, `PAST_DUE`, `SUSPENDED_READ_ONLY`, `LOCKED_PAYMENT_ONLY`, `CANCELED` |
| Cut-off               | The N-th failed payment attempt (default 3), where suspension starts                                                                  |
| Grace date            | The Admin-set date X by which organizations affected by a routing change must accept the new gateway                                  |
| Location evidence     | The items that fix a customer's tax location on the Stripe path (billing country, IP, card country)                                   |

## 3. Requirements

### 3.1 Currency and catalog ([ADR-0024](../technical/ADR-0024-billing-currency-and-price-catalog.md))

- **R1** USD is the accounting currency; every report is in USD.
- **R2** An organization is charged in the currency the currency map assigns to the billing
  country, from that currency's price list. No charged amount is computed from an exchange rate.
- **R3** The pricing rules are the only source of prices. Synchronisation is one-way and gives both
  gateways the same integer: Stripe prices carry `currency_options[eur]` and subscriptions are
  created with an explicit `currency`; Paddle prices carry `unit_price_overrides` for the countries
  mapped to EUR with the same integer. How the amounts the rules compute become gateway prices is an
  open point of [ADR-0030](../technical/ADR-0030-pricing-model.md), decided in BILL-6.
- **R4** Every EUR Stripe price is created with `tax_behavior: "exclusive"` set explicitly.
- **R5** Stripe Adaptive Pricing and Paddle automatic currency conversion are off. Payment Links,
  where Adaptive Pricing is always on, are not used.
- **R6** Money is integer minor units plus an ISO-4217 code wherever it is stored or crosses a port.
  Exchange rates and multipliers are decimal strings.
- **R7** A country can be mapped only to a currency that has a value for every pricing rule.

### 3.2 Gateways and routing ([ADR-0025](../technical/ADR-0025-payment-gateway-selection-and-country-routing.md))

- **R8** Admin enables Stripe, Paddle or both, and asks for every datum the enabled gateway needs. A
  gateway cannot be enabled while its configuration is incomplete or its connection test fails.
- **R9** Billing reads only the Admin-stored configuration; the gateway environment variables are
  removed. No environment fallback.
- **R10** With both gateways enabled, the routing map decides the gateway from the billing country.
  The customer does not choose.
- **R11** The routing map is seeded with Paddle for consumption-tax countries (EU, UK, Norway,
  Switzerland, Canada, Australia, New Zealand and similar regimes) and Stripe for the rest, the US
  included. Admin can move countries between gateways.
- **R12** A routing change honours existing subscriptions until the grace date X; affected
  organizations get weekly reminders with X; the old subscription ends at the period end aligned to
  X; an organization that has not accepted by X is suspended and the new gateway is not charged.
- **R13** The seller's country of establishment is an Admin field; the tax registrations Admin asks
  for on the Stripe path derive from it.

### 3.3 Payment events ([ADR-0026](../technical/ADR-0026-non-payment-lifecycle.md))

- **R14** Each adapter translates its gateway's payment webhooks into one typed payment event. The
  service reads no raw gateway key.
- **R15** The webhook route passes the provider. Nothing infers it from a payload field.
- **R16** Every payment event carries the gateway's native event id; a synthesised id is never used
  for deduplication (master plan L-6).

### 3.4 Non-payment ([ADR-0026](../technical/ADR-0026-non-payment-lifecycle.md))

- **R17** The cut-off is N failed attempts, default 3, configurable in Admin, identical for both
  gateways. Each gateway's own automatic cancellation is configured not to fire first.
- **R18** The organization moves through the billing-access state machine of §7.1. A successful
  payment at any step returns it to `ACTIVE`.
- **R19** One API guard rejects mutating requests in `SUSPENDED_READ_ONLY` and `LOCKED_PAYMENT_ONLY`,
  except the billing endpoints, with one dedicated error code.
- **R20** The payment form is the gateway's embedded component (Stripe Payment Element, Paddle.js).
  On success the method becomes the organization's, the unpaid invoice is retried at once, and the
  organization reactivates.
- **R21** Scheduled posts pause from suspension. The publish worker checks the billing-access state
  before every dispatch. On reactivation, posts whose time has passed get an explicit missed state and
  are listed for rescheduling; they are never published in a burst.
- **R22** Cancellation always happens at the gateway, through the adapter. The organization and its
  data are kept.
- **R23** During the lock the customer gets a weekly email and in-app banner showing the cancellation
  date.

### 3.5 Consumers and tax ([ADR-0027](../technical/ADR-0027-consumer-sales-and-tax-handling.md))

- **R24** Consumers may buy. If Admin moves a European country to Stripe, or enables Stripe only,
  Admin warns that the consumer obligations become OmniPost's.
- **R25** A voluntary 100% refund within 14 days of the first payment, and of the first payment
  after a trial converts.
- **R26** Prices are displayed tax-exclusive. On surfaces OmniPost controls, a consumer sees the
  VAT-inclusive total and an "order with obligation to pay" button before ordering.
- **R27** Online cancellation at the end of the period, with a confirmation step.
- **R28** A reminder before a renewal is charged, for every prepaid term of 3 months or more.
- **R29** An optional "buying as a business" checkbox plus VAT ID at checkout.
- **R30** The reverse charge applies only when the VAT ID's verification status is `verified`.
- **R31** On the Stripe path, each invoice keeps its location evidence, append-only, for 10 years
  from the end of the year; two agreeing items fix the location, a disagreement flags the invoice.
- **R32** A client IP used as evidence comes only from `resolveClientIp`.

### 3.6 Reporting ([ADR-0024](../technical/ADR-0024-billing-currency-and-price-catalog.md))

- **R33** Non-USD revenue is reported in USD at the ECB reference rate, with the rate and its date
  shown. A stale or missing rate never blocks a checkout.

### 3.7 Pricing ([ADR-0030](../technical/ADR-0030-pricing-model.md))

- **R34** The price unit is the connected channel. A workspace's per-channel price is the tier its
  channel count falls into, and every channel of the workspace pays it.
- **R35** Every workspace of an organization takes the multiplier of the volume tier the
  organization's workspace count falls into.
- **R36** A quote is
  `Σ over workspaces (perChannelPrice(channels) × channels) × volumeMultiplier × termMultiplier`, in
  the organization's currency, from that currency's values, in integer minor units. No exchange rate
  enters it.
- **R37** The per-channel tiers, the workspace volume tiers, the term multipliers and the list-price
  notice period are configured in Admin, per currency. A currency is complete only when every rule has
  a value in it.
- **R38** A bundle is a named list of platforms, one channel each. Its price is computed by R36 in
  every currency and shown live in Admin; it has no hand-set price and no usage limits.
- **R39** Terms are 1, 3, 6, 12, 18 and 24 months, paid upfront. Consumers may choose up to 12
  months; buyers who tick "buying as a business" up to 24. The server enforces the limit.
- **R40** The units contracted at the start of a term keep their price until the term ends. A
  renewal prices the subscription at the then-current list.
- **R41** A unit added during a term pays the then-current list price with the term's multiplier,
  charged at once and prorated to the end of the paid term. The price lock is a ceiling: when the
  expansion moves the workspace or the organization into a cheaper tier, all units move to the
  cheaper price, and the difference for the remaining prepaid months is credited against the
  expansion charge by the refund rule (§7.4; never negative, nothing extra is ever charged).
- **R42** A unit removed during a prepaid term is refunded: amount paid for it − (months used × its
  monthly list price); a started month counts as used; the refund is never negative and nothing is
  ever charged. A reduction is an explicit billing action; disconnecting a channel or an expired
  token changes nothing, and reconnecting is not billed again. On the monthly term there is no
  refund and the reduction applies from the next month. The remaining units keep their lock even if the workspace volume tier changes; the new tier
  applies at renewal.
- **R43** An organization that leaves early is refunded amount paid − (months used × monthly list
  price), with the four rules of ADR-0030 point 8: a started month counts as used and access runs to
  its end; never negative; added units use the same formula; within 14 days of the first payment the
  refund is 100% for every customer, consumer or business, and takes precedence. The monthly list
  price is the one in force at purchase.
- **R44** No exit fee is ever charged.
- **R45** A list-price change reaches a subscriber only at a renewal at least the notice period
  (default 30 days) after the notice is sent.
- **R46** The trial lasts 14 days by default, configurable in Admin. Whether a card is required to
  start is an Admin setting, off by default. The trial unlocks all features, with quantity caps
  configurable in Admin (§4.9). A trial that ends without a payment method enters the
  §7.1 flow at `SUSPENDED_READ_ONLY`. When a card is required, the customer is notified before the
  first charge.
- **R47** The free plan is off by default. When Admin switches it on, its fixed limits apply, each
  configurable in Admin: workspaces, channels, scheduled posts per month, members, storage, AI
  tokens.
- **R48** The monthly AI pool is a number of tokens per channel, configurable in Admin. Computed
  amounts are rounded per line to integer minor units, half-up, and only workspaces with at least
  one paid channel count toward the volume tier.
- **R49** There is no separate workspace (project) limit for paying organizations, no yearly × 12 or
  × 10, no `BASIC`/`PRO`/`ENTERPRISE` tier, and no price table in the client.
- **R50** Each organization has one gateway subscription with one item per price cohort and the term
  as its billing interval. Checkout sends the line items of the quote. The gateway's subscription
  events write the subscription back. Refunds for reductions and early exits are the formula's
  amount, not a gateway proration credit.

## 4. Admin screens and fields

All billing configuration lives under the existing Admin settings, which already has a Gateways tab
(`apps/admin/components/settings/GatewaysTab.tsx`), and the existing Admin › Pricing page
(`apps/admin/app/[locale]/(dashboard)/pricing/page.tsx`). Secrets are stored encrypted through
`PlatformCredentialService`.

### 4.1 Gateways

| Field                                  | Stripe | Paddle | Notes                                                                                                                                          |
| -------------------------------------- | ------ | ------ | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| Enabled                                | yes    | yes    | At least one gateway enabled. Enabling runs the connection test                                                                                |
| Secret key / API key                   | yes    | yes    | Exists today (`secretKey`, `apiKey`)                                                                                                           |
| Webhook secret                         | yes    | yes    | Exists today                                                                                                                                   |
| Sandbox mode                           | yes    | yes    | Exists today                                                                                                                                   |
| Client-side key for the embedded form  | yes    | yes    | Needed by the Stripe Payment Element and Paddle.js (R20). Not stored today; confirm names in the slice                                         |
| Gateway prices                         | shown  | shown  | Written by the synchronisation of computed amounts (BILL-6), read-only here. Replaces the four hand-entered `priceStarter*`/`pricePro*` fields |
| Automatic cancellation left off        | check  | check  | A checklist item the operator confirms in the gateway dashboard (R17)                                                                          |
| Adaptive Pricing / auto-conversion off | check  | check  | Checklist item (R5)                                                                                                                            |

### 4.2 Seller

| Field                           | Notes                                                                                              |
| ------------------------------- | -------------------------------------------------------------------------------------------------- |
| Country of establishment        | ISO-3166 alpha-2. Decides the OSS scheme and which registrations the Stripe path asks for (R13)    |
| Tax registrations (Stripe path) | One row per jurisdiction OmniPost is registered in: country, region where relevant, scheme, number |

### 4.3 Pricing rules (per currency)

Replaces today's Providers and Accounts tabs of Admin › Pricing, which edit one USD-only set of
platform tiers and account multipliers. One column per currency; amounts entered in major units and
stored in minor units; multipliers stored as decimal strings.

| Rule                  | Rows                                                      | Value per currency |
| --------------------- | --------------------------------------------------------- | ------------------ |
| Per-channel tiers     | Channel-count boundaries per workspace (from, to or open) | Amount per channel |
| Workspace volume tier | Workspace-count boundaries per organization               | Multiplier         |
| Term multipliers      | 1, 3, 6, 12, 18 and 24 months (1 month fixed at ×1.0)     | Multiplier         |

- A tier set with a gap or an overlap is refused, as today's calculator refuses a gap.
- A currency column is complete only when every cell has a value; the currency map refuses
  incomplete currencies (R7).
- A preview computes a quote for a sample organization (workspaces, channels, term) in each currency.
- Saving does not change any running subscription: new quotes use the new values at once, and
  existing subscribers get them only at a renewal after the notice period (§4.8).

### 4.4 Country maps

- **Currency map**: country → currency, with the seed of [ADR-0024](../technical/ADR-0024-billing-currency-and-price-catalog.md)
  (EUR for the EU, the rest of the EEA, the UK and Switzerland; USD elsewhere).
- **Routing map** (shown only when both gateways are enabled): country → gateway. Moving a country
  opens the routing-change flow of §4.6.
- **Warning** (R24): moving any European country to Stripe, or enabling Stripe alone, shows that the
  withdrawal button, statutory refunds and VAT become OmniPost's obligations, and asks for
  confirmation.

### 4.5 Non-payment policy

| Field                     | Default | Notes                                 |
| ------------------------- | ------- | ------------------------------------- |
| Failed attempts (cut-off) | 3       | N of R17                              |
| Lock length               | 30 days | `LOCKED_PAYMENT_ONLY` duration        |
| Read-only window          | 72 h    | Shown, not editable: decided as fixed |

### 4.6 Routing change

Started when the routing map changes for a country with existing subscriptions. Admin sets the grace
date X, sees the number of affected organizations, and confirms. A status view lists accepted,
pending and suspended organizations per change.

### 4.7 Bundles

Replaces today's Bundles tab, whose bundles carry a hand-set price per account and usage limits.

- A bundle has a name, a slug, a description, a sort order, an active flag and its list of
  platforms. No price field and no limits.
- **While the platforms are picked, the editor shows the computed price live**, per currency and per
  term, exactly as a customer would see it for one workspace.
- Every field is editable, the slug and the sort order included (today they are dropped on update).
- When the pricing rules change, bundle prices follow; nothing is re-entered.

### 4.8 Terms and price changes

| Field                    | Default                    | Notes                                                                                     |
| ------------------------ | -------------------------- | ----------------------------------------------------------------------------------------- |
| Terms offered            | 1, 3, 6, 12, 18, 24 months | 18 and 24 months only for business buyers; offered on Paddle only after the sandbox check |
| Consumer maximum term    | 12 months                  | Fixed by ADR-0030 point 4                                                                 |
| List-price notice period | 30 days                    | R45                                                                                       |

A list-price change shows the number of subscriptions affected and the renewal date each will reach
the new price on, and sends the notices.

### 4.9 Trial and free plan

| Field                                | Default | Notes                                                       |
| ------------------------------------ | ------- | ----------------------------------------------------------- |
| Trial length                         | 14 days | R46. Replaces the 14-day and 7-day values in the code today |
| Card required to start a trial       | off     | When on, the notice before the first charge is sent (R46)   |
| Trial cap: workspaces                | 3       | All features unlocked; caps configurable (R46)              |
| Trial cap: channels                  | 10      |                                                             |
| Trial cap: members                   | 3       |                                                             |
| Trial cap: AI tokens                 | 20,000  |                                                             |
| Trial cap: storage                   | 1 GB    |                                                             |
| Free plan                            | off     | R47. Switched on only when it is profitable                 |
| Free plan: workspaces                | 1       |                                                             |
| Free plan: channels                  | 3       |                                                             |
| Free plan: members                   | 1       |                                                             |
| Free plan: scheduled posts per month | 30      |                                                             |
| Free plan: storage                   | 500 MB  |                                                             |
| Free plan: AI tokens per month       | 2,000   |                                                             |
| AI tokens per channel per month      | 10,000  | R48                                                         |

**Seed data.** The initial values of every pricing rule (per-channel tiers in USD and EUR,
workspace volume multipliers, term multipliers), these caps, the notice period, the non-payment
numbers and the signed-URL validity are listed in
[ADR-0030, "Initial values"](../technical/ADR-0030-pricing-model.md#initial-values). They are seed
data, all Admin-configurable and meant to be tuned later; the seed must make every currency
complete (R37).

## 5. Customer surfaces

- **Pricing page**: the customer sets workspaces and the channels of each, or picks a bundle for a
  workspace, and a term; the page shows the quote the API computes, tax-exclusive. The client holds
  no price table (R49). Before checkout the currency shown can only be a preselection: the research
  notes that under the Geo-blocking Regulation an IP may preselect a currency and the visitor must be
  able to switch (Report 3, Q3). The charged currency is always the one the billing country maps to.
- **Checkout** (first subscription): billing country (required), postal code and address where the
  gateway needs them, the optional "buying as a business" checkbox and VAT ID, the term (18 and 24
  months only for business buyers), the VAT-inclusive total for consumers, and the "order with
  obligation to pay" button. The gateway is chosen by the routing map, never by the customer. The
  gateway receives the quote's line items.
- **Workspaces and channels**: adding a channel or a workspace during a term shows the prorated
  amount charged now; removing one shows the refund on a prepaid term, or "from next month" on the
  monthly term. The amount is shown before the change is confirmed.
- **Billing settings**: payment method (through the embedded component), invoices, the term and its
  renewal date, end-of-period cancellation with a confirmation step, early exit with the refund
  amount shown first, and the gateway selector of `GatewaySection.tsx` removed.
- **Banners**: "update payment details" while `PAST_DUE` or read-only; the cancellation date during
  the lock; the grace date during a routing change; the days left in a trial.
- **Payment-only screen** while `LOCKED_PAYMENT_ONLY`.
- **Missed posts list** after reactivation, with reschedule actions.
- **Free plan usage**: each limit with its current use, when the free plan is on.

## 6. Data model sketch

Names are indicative; each slice fixes its own. Every new model that carries `accountId` is enrolled
in `TENANT_SCOPED_MODELS` or the documented denylist (fitness #39), gets row-level security, and
follows `docs/security/MULTI_TENANT_GUARDS.md`. The global configuration tables carry no `accountId`.

**Global configuration**

| Table                 | Columns                                                                                                                                                                                   | Notes                                                                    |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| `BillingSettings`     | `sellerCountry`, `stripeEnabled`, `paddleEnabled`, `failedAttemptLimit` (3), `lockDays` (30), `trialDays` (14), `trialRequiresCard` (false), `priceNoticeDays` (30), `aiTokensPerChannel` | One row                                                                  |
| `FreePlanSettings`    | `enabled` (false), `maxWorkspaces`, `maxChannels`, `maxMembers`, `maxScheduledPostsPerMonth`, `maxStorageBytes`, `maxAiTokensPerMonth`                                                    | One row                                                                  |
| `TaxRegistration`     | `country`, `region?`, `scheme`, `number?`, `activeFrom`                                                                                                                                   | Stripe path only                                                         |
| `ChannelPriceTier`    | `currency`, `minChannels`, `maxChannels?`, `amountPerChannelMinor` (integer)                                                                                                              | Replaces `ProviderPricingTier`. No gaps or overlaps per currency         |
| `WorkspaceVolumeTier` | `currency`, `minWorkspaces`, `maxWorkspaces?`, `multiplier` (decimal string)                                                                                                              | Replaces `AccountPricingTier`. Every workspace takes the tier            |
| `TermMultiplier`      | `currency`, `termMonths` (1, 3, 6, 12, 18, 24), `multiplier` (decimal string)                                                                                                             | `termMonths` 1 is ×1.0                                                   |
| `GatewayPrice`        | `gateway`, `currency`, `unitAmountMinor`, `termMonths`, `gatewayPriceId`, `syncedAt`                                                                                                      | Only if BILL-6 chooses synchronised prices over inline ones (open point) |
| `CountryCurrency`     | `countryCode` (PK), `currency`                                                                                                                                                            | Seeded per ADR-0024                                                      |
| `CountryGateway`      | `countryCode` (PK), `gateway`                                                                                                                                                             | One value per country: exclusive by structure                            |
| `RoutingChange`       | `id`, `countryCodes`, `fromGateway`, `toGateway`, `graceDate`, `createdBy`, `createdAt`                                                                                                   | One per Admin routing change                                             |

**Per organization** (tenant-scoped; keyed by `accountId` until the rename)

| Table                  | Columns                                                                                                                                                                                                 | Notes                                                                                                                      |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `BillingProfile`       | `accountId` (PK), `billingCountry`, `postalCode?`, `region?`, `line1?`, `city?`, `customerType`, `taxId?`, `taxIdType?`, `taxIdStatus?`, `taxIdVerifiedAt?`, `currency`, `gateway`, `gatewayCustomerId` | Captured at first checkout. Relationship to today's `Account.gatewayProvider` and `gatewayCustomerId` decided in the slice |
| `BillingAccess`        | `accountId` (PK), `state`, `enteredAt`, `deadlineAt?`, `failedAttempts`                                                                                                                                 | The state machine of §7.1                                                                                                  |
| `RoutingChangeAccount` | `routingChangeId`, `accountId`, `status`, `acceptedAt?`                                                                                                                                                 | The per-organization machine of §7.2                                                                                       |
| `TaxLocationEvidence`  | `id`, `accountId`, `invoiceId`, `type`, `country`, `source`, `rawIp?`, `capturedAt`, `retainUntil`                                                                                                      | Append-only, Stripe path, 10 years from the end of the year                                                                |
| `SubscriptionItem`     | `id`, `accountId`, `subscriptionId`, `currency`, `unitAmountMinor`, `quantity`, `termMonths`, `lockedUntil`, `gatewayItemId`                                                                            | One per price cohort: the price-lock record                                                                                |
| `BilledUnit`           | `id`, `accountId`, `subscriptionItemId`, `projectId`, `channelId?`, `monthlyListMinor`, `paidMinor`, `addedAt`, `removedAt?`, `refundMinor?`                                                            | What was paid for each unit and its monthly list price, so a refund reads only stored facts                                |
| `PriceChangeNotice`    | `id`, `accountId`, `sentAt`, `effectiveAtRenewal`, `oldAmountMinor`, `newAmountMinor`, `currency`                                                                                                       | One per notified subscription and list change                                                                              |

**Channels per workspace** need no new table: they are the live `Channel` rows of each `projectId`
(`deletedAt: null`, the soft-delete convention fitness #38 enforces for `channel`).

**Changed**

| Table                                       | Change                                                                                                                                                                                                                                                 |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `Invoice`                                   | `amountDue Float` and `amountPaid Float` become integer minor units; `currency` holds an ISO-4217 code; Paddle's `customer_country_code` and `customer_ip_country_code` mirrored                                                                       |
| `Post`                                      | An explicit missed state for posts whose time passed while paused                                                                                                                                                                                      |
| `AccountSubscription`                       | Loses `providers`, `accountCount`, `maxProjects` and `pricePerMonth` (the items carry the amounts); `billingCycle` becomes `termMonths`; gains `currency`; one gateway subscription id instead of `externalSubscriptionId` and `gatewaySubscriptionId` |
| `Account`                                   | Loses `maxProjects` and `billingCycle`; one gateway customer id instead of `stripeCustomerId` and `gatewayCustomerId`                                                                                                                                  |
| `ProviderBundle`                            | Loses `pricePerAccountMonth`, `maxPostsPerMonth` and `maxChannels`                                                                                                                                                                                     |
| `BundleFeatureFlag`                         | Deleted (decided 2026-10-05): no reader today                                                                                                                                                                                                          |
| `ProviderPricingTier`, `AccountPricingTier` | Replaced by `ChannelPriceTier` and `WorkspaceVolumeTier`, with a data migration                                                                                                                                                                        |
| `UsageMetric`                               | `postsPublished` is never incremented today; the free plan caps scheduled posts per month, so the slice counts those or removes the column                                                                                                             |

**Payment event and port** (in `packages/ports/src/PaymentAdapter.ts`)

```typescript
interface PaymentEvent {
  provider: "STRIPE" | "PADDLE"; // passed by the route, never inferred
  type:
    | "payment.failed"
    | "payment.succeeded"
    | "subscription.created"
    | "subscription.updated"
    | "subscription.canceled";
  eventId: string; // the gateway's native id
  gatewayCustomerId: string;
  gatewaySubscriptionId: string | null;
  gatewayInvoiceId: string | null; // payment events only
  attemptCount: number | null; // payment events only
  amount: { minor: number; currency: string } | null; // ISO-4217
  occurredAt: Date;
}

interface SubscriptionLineItem {
  unitAmount: { minor: number; currency: string }; // computed by the pricing rules
  quantity: number; // channels in this price cohort
  termMonths: 1 | 3 | 6 | 12 | 18 | 24; // the billing interval
  label: string;
}
```

The port's checkout and subscription operations take `SubscriptionLineItem[]` (today the port has no
quantity and checkout sends no items), and the port gains a refund operation for an amount in minor
units.

## 7. State machines

### 7.1 Billing access (per organization)

| From                                                     | Event                               | To                    | Side effects                                                                                        |
| -------------------------------------------------------- | ----------------------------------- | --------------------- | --------------------------------------------------------------------------------------------------- |
| `ACTIVE`                                                 | Payment failed, attempt < N         | `PAST_DUE`            | Banner "update payment details"; gateway keeps retrying                                             |
| `PAST_DUE`                                               | Payment failed, attempt < N         | `PAST_DUE`            | Attempt count updated from the payment event                                                        |
| `PAST_DUE`                                               | Payment failed, attempt = N         | `SUSPENDED_READ_ONLY` | Scheduled posts paused; guard engages; gateway retries stopped, subscription kept alive             |
| `ACTIVE` (trialing, card not required)                   | Trial ends without a payment method | `SUSPENDED_READ_ONLY` | Scheduled posts paused; guard engages ([ADR-0030](../technical/ADR-0030-pricing-model.md) point 11) |
| `SUSPENDED_READ_ONLY`                                    | 72 hours elapse                     | `LOCKED_PAYMENT_ONLY` | Deadline = now + lock length; weekly reminders start                                                |
| `LOCKED_PAYMENT_ONLY`                                    | Lock length elapses                 | `CANCELED`            | Subscription canceled at the gateway; data kept                                                     |
| `PAST_DUE`, `SUSPENDED_READ_ONLY`, `LOCKED_PAYMENT_ONLY` | Payment succeeded                   | `ACTIVE`              | Guard releases; paused posts in the future resume; past ones move to the missed list                |
| `CANCELED`                                               | Customer resubscribes               | `ACTIVE`              | New subscription; data already there                                                                |

**Note.** Resolved 2026-10-04: the gateway subscription is canceled on day 30 of the lock; at the
cut-off only the gateway's own retries stop, so the open invoice stays payable through the embedded
form ([ADR-0026](../technical/ADR-0026-non-payment-lifecycle.md), point 1). For a trial without a
card, whether there is a gateway subscription to cancel is an open point (§11).

### 7.2 Routing change (per affected organization)

| From       | Event                                       | To          | Side effects                                               |
| ---------- | ------------------------------------------- | ----------- | ---------------------------------------------------------- |
| —          | Admin confirms the change                   | `PENDING`   | Notification with X; weekly reminders until X              |
| `PENDING`  | Customer sets up payment on the new gateway | `ACCEPTED`  | Old subscription set to end at the period end aligned to X |
| `ACCEPTED` | X reached                                   | `MIGRATED`  | New subscription charges from X                            |
| `PENDING`  | X reached without acceptance                | `SUSPENDED` | Same flow as §7.1: 72 h read-only, 30-day lock, cancel     |

Resolved 2026-10-04: a `SUSPENDED` routing change enters the same billing-access flow as §7.1 —
`SUSPENDED_READ_ONLY` for 72 hours, then `LOCKED_PAYMENT_ONLY` for 30 days with weekly notices, then
`CANCELED` — with messages about accepting the new payment option; the new gateway is never charged
before acceptance ([ADR-0025](../technical/ADR-0025-payment-gateway-selection-and-country-routing.md)).

### 7.3 VAT ID verification (Stripe path)

`PENDING` → `VERIFIED` | `UNVERIFIED` | `UNAVAILABLE`, mirrored from Stripe's `verification.status`.
Only `VERIFIED` applies the reverse charge.

### 7.4 Units during a term (per organization)

| Event                                  | Prepaid term (3–24 months)                                                                                                                                                                                     | Monthly term                                                            |
| -------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| Unit added (expansion)                 | New cohort item at the current list price × the term multiplier; charged now, prorated to the term end (Stripe `always_invoice`, Paddle `prorated_immediately`)                                                | The same, prorated to the end of the month                              |
| Unit removed (reduction)               | Refund = paid for the unit − months used × its monthly list price (started month used; never negative); the item's quantity drops without a gateway credit; other cohorts keep their lock                      | No refund; the quantity drops from the next month                       |
| Organization leaves (early exit)       | Refund = paid − months used × monthly list price, with the four rules; access to the end of the started month; then the subscription ends                                                                      | Ends at the end of the month (R27); no refund outside the 14-day window |
| Renewal                                | Every cohort is priced at the current list; a list change applies only if noticed at least the notice period before                                                                                            | The same, every month                                                   |
| Workspace volume tier changes mid-term | Reduction: locked cohorts keep their price until the term ends; the new tier applies at renewal. Expansion into a cheaper tier: the lock is a ceiling, all units move to the cheaper price (credit flow below) | Applies from the next month                                             |

**Examples** ([ADR-0030](../technical/ADR-0030-pricing-model.md)): a workspace listed at $50 a month
on a 6-month term at 10% off ($270 paid) removed during month 4 is refunded $270 − 4 × $50 = $70; an
organization on a 12-month term at 20% off a $100 list ($960 paid) that leaves after 4 months is
refunded $960 − 4 × $100 = $560.

**Tier-crossing credit flow** (expansion into a cheaper per-channel or volume tier). If the list
rose instead, locked units keep their lock and only the new unit pays the current price.

1. The month in progress counts as used at the old price; the new price applies from the next month.
2. Credit = for each already-paid unit, (old monthly price − new monthly price) × remaining prepaid
   months.
3. The new unit is charged prorated for the rest of the current month, plus the remaining months at
   the new price.
4. The charge is the new unit's amount minus the credit; if the credit is larger the difference is
   refunded. Never negative, and nothing extra is ever charged.

Worked example (term multiplier omitted): 12 months × 3 channels × $10 = $360 paid. In the middle
of month 4 a 4th channel is added and the workspace moves to the $8 tier. Credit for the old
channels: 3 × ($10 − $8) × 8 = $48. New channel: half of month 4 ($4) + 8 × $8 = $68. Charged:
$68 − $48 = $20.

### 7.5 Trial (per organization)

| From     | Event                                                   | To                                 | Side effects                                        |
| -------- | ------------------------------------------------------- | ---------------------------------- | --------------------------------------------------- |
| —        | Sign-up                                                 | Trialing (billing access `ACTIVE`) | Trial end = now + trial length (14 days by default) |
| Trialing | Payment method added and the trial ends                 | Subscribed (`ACTIVE`)              | First charge for the chosen term                    |
| Trialing | Trial ends without a payment method (card not required) | `SUSPENDED_READ_ONLY` (§7.1)       | The non-payment flow, with trial-specific messages  |

With a card required, a trial cannot start without a payment method, and the notice before the
first charge is sent (R46).

## 8. Notifications

| Trigger                                  | Channel        | Cadence                                            | Content                                          |
| ---------------------------------------- | -------------- | -------------------------------------------------- | ------------------------------------------------ |
| Payment failed before the cut-off        | Email + banner | Per failed attempt                                 | Update payment details; attempt count            |
| Cut-off reached                          | Email + banner | Once                                               | Read-only for 72 hours; posts paused; how to pay |
| Lock started and during the lock         | Email + banner | Weekly until the deadline                          | The cancellation date; how to pay                |
| Subscription canceled at lock end        | Email          | Once                                               | Data kept; how to resubscribe                    |
| Reactivated                              | Email + banner | Once                                               | Access restored; missed posts to reschedule      |
| Routing change announced                 | Email + banner | Once, then weekly until X                          | The grace date X; how to accept                  |
| Annual renewal coming                    | Email          | Before each annual charge                          | Amount, date, how to cancel                      |
| Trial ending                             | Email + banner | Before the trial ends (timing set in the slice)    | Add a payment method; the date access narrows    |
| First charge after a card-required trial | Email          | Before the first charge                            | Amount, date, how to cancel                      |
| List-price change                        | Email          | Once, at least the notice period before it applies | The new price and the renewal it applies at      |
| Expansion charged                        | Email          | Per expansion                                      | Units added; prorated amount                     |
| Reduction or early exit refunded         | Email          | Per refund                                         | Units removed; refund amount; end of access      |

One scheduled-reminder mechanism keyed on a deadline drives the weekly rows: the gateway-switch
reminder job of `apps/api/src/billing/GatewaySwitchJobService.ts`, generalised from one reminder at
24 hours to a weekly cadence until the deadline.

## 9. Webhook flow (target)

1. The gateway-specific webhook route verifies the signature and knows its provider.
2. The route hands the raw payload to that gateway's adapter, which translates it into a payment
   event (§6). A payload the translator cannot read is rejected loudly, not recorded as the other
   gateway.
3. The service receives the typed event and the provider, finds the organization by gateway and
   customer id, updates the invoice in minor units, and advances the billing-access state.
4. Subscription events (created, updated, canceled) write the subscription's items, term, period
   and status back. Today `subscription.activated` is acted on only during a gateway switch and
   `subscription.updated` is not handled, so nothing is ever written back (F16).
5. Deduplication uses the gateway's native event id.

## 10. Implementation slices

Each slice is one pull request of about 400 authored changed lines (a planning heuristic, not a
cap), with its tests and documentation in the same change. IDs are stable: BILL-1 to BILL-17 keep
the numbers they were given when this specification was first written, BILL-6, BILL-7 and BILL-8
changed when the pricing model was decided (note below the table), and BILL-18 to BILL-29 were
appended. **The Depends on column, not the row order, sets the order**; slices with no dependency
between them may run in any order.

| ID      | Slice                                                                                                                                                                                                                                                                                                                                                                                                               | Depends on               | ADR                                                                                                                                                                                                                   | Closes                                               |
| ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------- |
| BILL-1  | `PaymentEvent` type in the `PaymentAdapter` port, and the Stripe translator tested against a real `2026-03-25.dahlia` invoice payload                                                                                                                                                                                                                                                                               | —                        | [0026](../technical/ADR-0026-non-payment-lifecycle.md)                                                                                                                                                                | —                                                    |
| BILL-2  | The Paddle translator, tested against a real Paddle payload. PR #396 (Paddle webhook await) is merged, so nothing blocks it                                                                                                                                                                                                                                                                                         | BILL-1                   | [0026](../technical/ADR-0026-non-payment-lifecycle.md)                                                                                                                                                                | —                                                    |
| BILL-3  | The webhook routes pass the provider; `handlePaymentFailed` and `handlePaymentSucceeded` take the typed event; the invented `subscription_id` fixture is replaced; native event ids only                                                                                                                                                                                                                            | BILL-1, BILL-2           | [0026](../technical/ADR-0026-non-payment-lifecycle.md)                                                                                                                                                                | F13 / SMELL-184, N-COR-4, L-6                        |
| BILL-4  | `Invoice` money to integer minor units: schema and data migration, and every reader                                                                                                                                                                                                                                                                                                                                 | BILL-3                   | [0024](../technical/ADR-0024-billing-currency-and-price-catalog.md)                                                                                                                                                   | —                                                    |
| BILL-5  | Billing reads the Admin-stored gateway configuration; the gateway environment variables, the undeclared `STRIPE_PRICE_*` and `PADDLE_PRICE_*` price-id variables and both `buildPriceMap` copies are removed; `SECRETS.md` and `ENVIRONMENT_VARIABLES.md` updated                                                                                                                                                   | —                        | [0025](../technical/ADR-0025-payment-gateway-selection-and-country-routing.md)                                                                                                                                        | F14 / SMELL-185                                      |
| BILL-6  | Synchronisation of computed amounts: each price cohort's unit amount, in the organization's currency, with the term as billing interval (Stripe recurring `month` × term with `tax_behavior: "exclusive"` explicit; Paddle `billing_cycle` `month` × term), by synchronised prices or inline prices per the ADR-0030 open point decided here after a sandbox check; Admin's price-id fields become a read-only view | BILL-4, BILL-5, BILL-18  | [0024](../technical/ADR-0024-billing-currency-and-price-catalog.md), [0030](../technical/ADR-0030-pricing-model.md)                                                                                                   | SMELL-187 (with BILL-8, BILL-22)                     |
| BILL-7  | Currency map and routing map with their seeds and Admin screens; seller establishment country; the European warning                                                                                                                                                                                                                                                                                                 | BILL-6, BILL-19          | [0024](../technical/ADR-0024-billing-currency-and-price-catalog.md), [0025](../technical/ADR-0025-payment-gateway-selection-and-country-routing.md), [0027](../technical/ADR-0027-consumer-sales-and-tax-handling.md) | —                                                    |
| BILL-8  | `BillingProfile` captured at checkout; checkout routed by the maps; the customer's gateway selector removed; checkout sends the quote's line items (one per price cohort, with quantity and term) through a port that carries quantity, instead of `{ gatewayProvider }` alone                                                                                                                                      | BILL-7, BILL-28          | [0025](../technical/ADR-0025-payment-gateway-selection-and-country-routing.md), [0030](../technical/ADR-0030-pricing-model.md)                                                                                        | SMELL-187 (with BILL-6, BILL-22)                     |
| BILL-9  | `BillingAccess` state machine, the single API guard with its error code, and the portal banners and payment-only screen                                                                                                                                                                                                                                                                                             | BILL-3                   | [0026](../technical/ADR-0026-non-payment-lifecycle.md)                                                                                                                                                                | —                                                    |
| BILL-10 | The cut-off: Admin-configurable N; at the cut-off the gateway's own retries stop and the subscription stays alive; on day 30 of the lock it is canceled through the adapter's `cancelSubscription`, local state from the gateway's confirmation                                                                                                                                                                     | BILL-9                   | [0026](../technical/ADR-0026-non-payment-lifecycle.md)                                                                                                                                                                | —                                                    |
| BILL-11 | Publish worker checks billing access before dispatch; paused posts; the missed state and list                                                                                                                                                                                                                                                                                                                       | BILL-9                   | [0026](../technical/ADR-0026-non-payment-lifecycle.md)                                                                                                                                                                | —                                                    |
| BILL-12 | Embedded payment component (Stripe Payment Element, Paddle.js), immediate invoice retry, reactivation                                                                                                                                                                                                                                                                                                               | BILL-9, BILL-5           | [0026](../technical/ADR-0026-non-payment-lifecycle.md)                                                                                                                                                                | —                                                    |
| BILL-13 | Deadline-reminder mechanism (weekly) generalised from the gateway-switch reminder job; the lock-end cancellation job                                                                                                                                                                                                                                                                                                | BILL-10                  | [0026](../technical/ADR-0026-non-payment-lifecycle.md)                                                                                                                                                                | —                                                    |
| BILL-14 | Country-wide routing change: grace date, notifications, acceptance on the new gateway, suspension at X without charging                                                                                                                                                                                                                                                                                             | BILL-8, BILL-13          | [0025](../technical/ADR-0025-payment-gateway-selection-and-country-routing.md)                                                                                                                                        | —                                                    |
| BILL-15 | Stripe-path tax: tax registrations, VAT ID verification gating the reverse charge, `TaxLocationEvidence` and the two-evidence rule                                                                                                                                                                                                                                                                                  | BILL-8                   | [0027](../technical/ADR-0027-consumer-sales-and-tax-handling.md)                                                                                                                                                      | —                                                    |
| BILL-16 | Consumer mechanics on OmniPost's surfaces: inclusive total and order button, cancellation with confirmation, annual renewal reminder, voluntary 14-day refund, business checkbox                                                                                                                                                                                                                                    | BILL-8, BILL-13          | [0027](../technical/ADR-0027-consumer-sales-and-tax-handling.md)                                                                                                                                                      | —                                                    |
| BILL-17 | `ExchangeRatePort`, ECB adapter, `CachePort` entry and daily scheduler task; USD reporting of non-USD revenue                                                                                                                                                                                                                                                                                                       | BILL-4                   | [0024](../technical/ADR-0024-billing-currency-and-price-catalog.md)                                                                                                                                                   | —                                                    |
| BILL-18 | Pricing rules in the domain, per currency: per-channel tiers, workspace volume tiers, term multipliers, behind a port; a new `PricingCalculator` (channel unit, one volume multiplier for every workspace, term multiplier, integer minor units, the rounding rule); `findCheaperBundle` removed; `ProviderPricingTier` and `AccountPricingTier` migrated                                                           | —                        | [0030](../technical/ADR-0030-pricing-model.md), [0024](../technical/ADR-0024-billing-currency-and-price-catalog.md)                                                                                                   | —                                                    |
| BILL-19 | Admin pricing screens per currency (§4.3, §4.8): rules, term multipliers, notice period, completeness per currency, preview; `pricingRoutes.ts` and `PricingAdminService` through the port instead of Prisma; `UpdatePricingConfigUseCase` resolved or deleted; the MRR tab computed from subscriptions                                                                                                             | BILL-18                  | [0030](../technical/ADR-0030-pricing-model.md)                                                                                                                                                                        | SMELL-191 (with BILL-20, BILL-27)                    |
| BILL-20 | Bundles as templates (§4.7): three `ProviderBundle` fields dropped; editor with the live computed price; every field editable; `BundleFeatureFlag` deleted; `/billing/plans` and the Admin plan reads return computed prices; `GET /admin/billing/plans/:tier` replaced                                                                                                                                             | BILL-19                  | [0030](../technical/ADR-0030-pricing-model.md)                                                                                                                                                                        | SMELL-191, SMELL-192 (part)                          |
| BILL-21 | Channels counted per workspace: the quote reads live channels per workspace, replacing `AccountSubscription.providers` and `accountCount`; `maxProjects` removed from `Account` and `AccountSubscription` with the project-creation quota check; the AI pool per channel                                                                                                                                            | BILL-18                  | [0030](../technical/ADR-0030-pricing-model.md)                                                                                                                                                                        | SMELL-188 (part), SMELL-192 (part), SMELL-193 (part) |
| BILL-22 | Subscription state from the gateway: subscription events in the typed event for both gateways; items, term, period and status written back; checkout completion no longer acted on only during a gateway switch; the adapters' `createSubscription` and `updateSubscription` wired or deleted; one gateway customer id and one subscription id                                                                      | BILL-3, BILL-8           | [0030](../technical/ADR-0030-pricing-model.md), [0026](../technical/ADR-0026-non-payment-lifecycle.md)                                                                                                                | SMELL-187 (with BILL-6, BILL-8), SMELL-193 (part)    |
| BILL-23 | Price-lock cohorts (§7.4): `SubscriptionItem` and `BilledUnit`; expansion at the current list × term multiplier, prorated to the term end; reduction refunded by the formula on a prepaid term, from the next month on the monthly term; renewal re-pricing; the list-price notice and its notifications                                                                                                            | BILL-21, BILL-22         | [0030](../technical/ADR-0030-pricing-model.md)                                                                                                                                                                        | —                                                    |
| BILL-24 | Prepaid terms and early exit: the term selector (consumers up to 12 months, business buyers up to 24, enforced on the server); the 18- and 24-month Paddle sandbox check before those terms go live on Paddle; the early-exit refund with its four rules (Stripe partial refund, Paddle refund adjustment) and access to the end of the started month                                                               | BILL-16, BILL-23         | [0030](../technical/ADR-0030-pricing-model.md), [0027](../technical/ADR-0027-consumer-sales-and-tax-handling.md)                                                                                                      | —                                                    |
| BILL-25 | Trial (§7.5): one Admin-configurable length (14 days), the 7-day `PRO` default of `TrialManagementService` removed; the card-required switch, off; a trial ending without a payment method enters §7.1; the notice before the first charge                                                                                                                                                                          | BILL-9, BILL-13          | [0030](../technical/ADR-0030-pricing-model.md), [0026](../technical/ADR-0026-non-payment-lifecycle.md)                                                                                                                | SMELL-193 (part)                                     |
| BILL-26 | Free plan (§4.9): the Admin switch, off; its fixed limits enforced where workspaces, channels, members, scheduled posts, stored media and AI calls are created or used; the monthly post counter                                                                                                                                                                                                                    | BILL-21                  | [0030](../technical/ADR-0030-pricing-model.md)                                                                                                                                                                        | SMELL-192 (part)                                     |
| BILL-27 | Legacy plan vocabulary removed: `SUBSCRIPTION_TIER` and `TIER_LIMITS`, the registration `plan` field, the admin tier schemas and bulk upgrade's `newTier`, Admin's `priceStarter*`/`pricePro*` credential fields, the yearly × 12 of `TrialManagementService`, the three disagreeing `maxProjects` maps                                                                                                             | BILL-5, BILL-20, BILL-21 | [0030](../technical/ADR-0030-pricing-model.md)                                                                                                                                                                        | SMELL-188, SMELL-191 (part), SMELL-193 (part)        |
| BILL-28 | Client pricing from the API: the hard-coded tiers, multipliers, 10-platform list and yearly × 10 removed; the pricing page and plan picker request quotes (workspaces, channels per workspace or a bundle, term); every platform of the enum offered                                                                                                                                                                | BILL-20, BILL-21         | [0030](../technical/ADR-0030-pricing-model.md)                                                                                                                                                                        | SMELL-189                                            |
| BILL-29 | Fitness #16 also catches bracket reads `process.env[...]`, mirrored in `fitness.yml`, with the red path demonstrated on a planted read; lands at 0 once BILL-5 has removed the 12 price-id reads (measured 2026-10-04: no other bracket read in its scope)                                                                                                                                                          | BILL-5                   | [0025](../technical/ADR-0025-payment-gateway-selection-and-country-routing.md)                                                                                                                                        | SMELL-190                                            |

**Changed on 2026-10-04 with the pricing model.** BILL-6 was "price catalog in the domain, Admin
grid, and one-way synchronisation" for a plan × cycle catalog: the catalog and its Admin screens
moved to BILL-18 and BILL-19, and BILL-6 now synchronises the amounts the rules compute. BILL-7 gained
BILL-19 as a dependency, because a currency is complete only when every pricing rule has a value.
BILL-8 gained the quote's line items (F16) and BILL-28 as a dependency. BILL-5 names the price-id
variables it removes.

## 11. Open points

- **The exact ISO seed of the routing map**, including the "similar VAT/GST regimes" —
  [ADR-0025](../technical/ADR-0025-payment-gateway-selection-and-country-routing.md). Needed by BILL-7.
- **Resolved 2026-10-04 — the plan set.** There are no plans: [ADR-0030](../technical/ADR-0030-pricing-model.md)
  prices with rules, and bundles are templates priced by them. `BASIC`/`PRO`/`ENTERPRISE` and the
  Admin Starter/Pro fields go in BILL-5 and BILL-27.
- **Resolved 2026-10-05 — pricing points** of [ADR-0030](../technical/ADR-0030-pricing-model.md)
  (decisions 16 to 24 and "Initial values"): default values (seed data, §4.9); an expansion across a
  tier boundary (the lock is a ceiling, credited by the refund rule, §7.4; BILL-23); empty
  workspaces (only those with a paid channel count; BILL-18); what removing a unit is (an explicit
  billing action; BILL-23); which list price refunds use (the one in force at purchase; BILL-23,
  BILL-24); early-exit rule 4 (every customer, within 14 days of the first payment; BILL-24); trial
  limits (all features, Admin-configurable caps; BILL-25); pre-renewal reminders (every prepaid term
  of 3 months or more; BILL-16, BILL-24); rounding (per line, half-up; BILL-18); `BundleFeatureFlag`
  (deleted; BILL-20); migration of existing subscriptions (none, no paying customers; BILL-22).
- **Pricing open points still open**, with the slice each blocks:
  - whether a trial without a card holds a gateway subscription (BILL-25);
  - synchronised or inline gateway prices (BILL-6);
  - 18- and 24-month billing on Paddle, to confirm in the sandbox (BILL-24).
- **Resolved 2026-10-05 — names in code written before the rename**
  ([ADR-0031](../technical/ADR-0031-domain-vocabulary.md)): new code keeps today's names until the
  rename lands.
- **Withdrawal button and mid-period withdrawal on the Paddle path** —
  [ADR-0027](../technical/ADR-0027-consumer-sales-and-tax-handling.md), open points; for counsel.
