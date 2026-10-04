# Billing gateways: currency, routing, non-payment and consumer sales

- **Status**: Decided 2026-10-04 — ready for implementation slices (§10)
- **Date**: 2026-10-04
- **Owner**: Edward / Platform engineering
- **Decisions**: [ADR-0024](../technical/ADR-0024-billing-currency-and-price-catalog.md) (currency and
  price catalog) · [ADR-0025](../technical/ADR-0025-payment-gateway-selection-and-country-routing.md)
  (gateway selection and routing) · [ADR-0026](../technical/ADR-0026-non-payment-lifecycle.md)
  (non-payment lifecycle) · [ADR-0027](../technical/ADR-0027-consumer-sales-and-tax-handling.md)
  (consumer sales and tax)
- **Research**: [research-2026-10-04-billing.md](../reports/research-2026-10-04-billing.md)
- **Findings this work closes**: F13 (SMELL-184), F14 (SMELL-185) in
  [roadmap-detected-smells-backlog.md](../reports/roadmap-detected-smells-backlog.md); master plan
  N-COR-4 (`BILLING-DUNNING-DEAD`) and L-6 (`BILLING-EVENTID-FALLBACK`) in
  [MASTER_PLAN_ES.md](../product/MASTER_PLAN_ES.md)
- **Related**: [docs/api/billing.md](../api/billing.md) (today's billing services and routes)

---

## 1. Scope

**In scope**

- One price catalog in the domain, per-currency price lists, and their synchronisation to Stripe and
  Paddle.
- Gateway configuration in Admin as the single source, and routing customers by billing country.
- A provider-neutral payment event, with the provider passed by the webhook route.
- The non-payment lifecycle: cut-off, suspension, lock, cancellation, reactivation, paused and
  missed posts, deadline reminders.
- Selling to consumers: the six mechanics, tax-exclusive display, reverse-charge gating and location
  evidence on the Stripe path.
- Exchange rates for reporting in USD.

**Out of scope**

- Which plans exist and what they include. The catalog is keyed by plan and cycle; defining the plans
  is product work outside this specification.
- Data deletion after cancellation: the existing soft-delete, restore and tombstone retention flows
  stay as they are.
- A GBP price list. It is a later map edit plus a new list, with no code change.

## 2. Glossary

| Term                 | Meaning                                                                                                                          |
| -------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| Price catalog        | Plan × billing cycle → one amount per currency, in integer minor units. The source of every price                                |
| Price list           | The amounts of one currency in the catalog. Hand-set and round; never computed from a rate                                       |
| Billing country      | The ISO-3166 alpha-2 country the customer gives at checkout. It decides currency and gateway                                     |
| Currency map         | Country → ISO-4217 currency. Seeded EUR for Europe, USD elsewhere                                                                |
| Routing map          | Country → gateway (`STRIPE` or `PADDLE`). One value per country, so exclusive by structure                                       |
| Payment event        | The provider-neutral record each adapter translates a payment webhook into                                                       |
| Billing-access state | The account's state in the non-payment lifecycle: `ACTIVE`, `PAST_DUE`, `SUSPENDED_READ_ONLY`, `LOCKED_PAYMENT_ONLY`, `CANCELED` |
| Cut-off              | The N-th failed payment attempt (default 3), where suspension starts                                                             |
| Grace date           | The Admin-set date X by which customers affected by a routing change must accept the new gateway                                 |
| Location evidence    | The items that fix a customer's tax location on the Stripe path (billing country, IP, card country)                              |

## 3. Requirements

### 3.1 Currency and catalog ([ADR-0024](../technical/ADR-0024-billing-currency-and-price-catalog.md))

- **R1** USD is the accounting currency; every report is in USD.
- **R2** A customer is charged in the currency the currency map assigns to the billing country, from
  that currency's price list. No charged amount is computed from an exchange rate.
- **R3** The catalog is the only writer of prices. Synchronisation is one-way: Stripe prices carry
  `currency_options[eur]`, Stripe subscriptions are created with an explicit `currency`, and Paddle
  prices carry `unit_price_overrides` for the countries mapped to EUR with the same integer.
- **R4** Every EUR Stripe price is created with `tax_behavior: "exclusive"` set explicitly.
- **R5** Stripe Adaptive Pricing and Paddle automatic currency conversion are off. Payment Links,
  where Adaptive Pricing is always on, are not used.
- **R6** Money is integer minor units plus an ISO-4217 code wherever it is stored or crosses a port.
  Exchange rates are decimal strings.
- **R7** A country can be mapped only to a currency with a complete price list for every plan and
  cycle.

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
- **R12** A routing change honours existing subscriptions until the grace date X; affected customers
  get weekly reminders with X; the old subscription ends at the period end aligned to X; a customer
  who has not accepted by X is suspended and the new gateway is not charged.
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
- **R18** The account moves through the billing-access state machine of §7.1. A successful payment
  at any step returns it to `ACTIVE`.
- **R19** One API guard rejects mutating requests in `SUSPENDED_READ_ONLY` and `LOCKED_PAYMENT_ONLY`,
  except the billing endpoints, with one dedicated error code.
- **R20** The payment form is the gateway's embedded component (Stripe Payment Element, Paddle.js).
  On success the method becomes the account's, the unpaid invoice is retried at once, and the account
  reactivates.
- **R21** Scheduled posts pause from suspension. The publish worker checks the billing-access state
  before every dispatch. On reactivation, posts whose time has passed get an explicit missed state and
  are listed for rescheduling; they are never published in a burst.
- **R22** Cancellation always happens at the gateway, through the adapter. The account and its data
  are kept.
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
- **R28** A reminder before an annual renewal is charged.
- **R29** An optional "buying as a business" checkbox plus VAT ID at checkout.
- **R30** The reverse charge applies only when the VAT ID's verification status is `verified`.
- **R31** On the Stripe path, each invoice keeps its location evidence, append-only, for 10 years
  from the end of the year; two agreeing items fix the location, a disagreement flags the invoice.
- **R32** A client IP used as evidence comes only from `resolveClientIp`.

### 3.6 Reporting ([ADR-0024](../technical/ADR-0024-billing-currency-and-price-catalog.md))

- **R33** Non-USD revenue is reported in USD at the ECB reference rate, with the rate and its date
  shown. A stale or missing rate never blocks a checkout.

## 4. Admin screens and fields

All billing configuration lives under the existing Admin settings, which already has a Gateways tab
(`apps/admin/components/settings/GatewaysTab.tsx`). Secrets are stored encrypted through
`PlatformCredentialService`.

### 4.1 Gateways

| Field                                  | Stripe | Paddle | Notes                                                                                                  |
| -------------------------------------- | ------ | ------ | ------------------------------------------------------------------------------------------------------ |
| Enabled                                | yes    | yes    | At least one gateway enabled. Enabling runs the connection test                                        |
| Secret key / API key                   | yes    | yes    | Exists today (`secretKey`, `apiKey`)                                                                   |
| Webhook secret                         | yes    | yes    | Exists today                                                                                           |
| Sandbox mode                           | yes    | yes    | Exists today                                                                                           |
| Client-side key for the embedded form  | yes    | yes    | Needed by the Stripe Payment Element and Paddle.js (R20). Not stored today; confirm names in the slice |
| Price ids per plan and cycle           | shown  | shown  | Written by the catalog synchronisation, read-only here. Replaces the four hand-entered price-id fields |
| Automatic cancellation left off        | check  | check  | A checklist item the operator confirms in the gateway dashboard (R17)                                  |
| Adaptive Pricing / auto-conversion off | check  | check  | Checklist item (R5)                                                                                    |

### 4.2 Seller

| Field                           | Notes                                                                                              |
| ------------------------------- | -------------------------------------------------------------------------------------------------- |
| Country of establishment        | ISO-3166 alpha-2. Decides the OSS scheme and which registrations the Stripe path asks for (R13)    |
| Tax registrations (Stripe path) | One row per jurisdiction OmniPost is registered in: country, region where relevant, scheme, number |

### 4.3 Price catalog

A grid of plan × cycle, one column per currency, amounts entered in major units and stored in minor
units. Saving re-synchronises both gateways. A currency column is "complete" only when every cell is
filled; the currency map refuses incomplete currencies (R7).

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
date X, sees the number of affected accounts, and confirms. A status view lists accepted, pending and
suspended accounts per change.

## 5. Customer surfaces

- **Pricing page**: price lists shown tax-exclusive. Before checkout the currency shown can only be a
  preselection: the research notes that under the Geo-blocking Regulation an IP may preselect a
  currency and the visitor must be able to switch (Report 3, Q3). The charged currency is always the
  one the billing country maps to.
- **Checkout** (first subscription): billing country (required), postal code and address where the
  gateway needs them, the optional "buying as a business" checkbox and VAT ID, the VAT-inclusive
  total for consumers, and the "order with obligation to pay" button. The gateway is chosen by the
  routing map, never by the customer.
- **Billing settings**: payment method (through the embedded component), invoices, end-of-period
  cancellation with a confirmation step, and the gateway selector of `GatewaySection.tsx` removed.
- **Banners**: "update payment details" while `PAST_DUE` or read-only; the cancellation date during
  the lock; the grace date during a routing change.
- **Payment-only screen** while `LOCKED_PAYMENT_ONLY`.
- **Missed posts list** after reactivation, with reschedule actions.

## 6. Data model sketch

Names are indicative; each slice fixes its own. Every new model that carries `accountId` is enrolled
in `TENANT_SCOPED_MODELS` or the documented denylist (fitness #39), gets row-level security, and
follows `docs/security/MULTI_TENANT_GUARDS.md`. The global configuration tables carry no `accountId`.

**Global configuration**

| Table             | Columns                                                                                      | Notes                                         |
| ----------------- | -------------------------------------------------------------------------------------------- | --------------------------------------------- |
| `BillingSettings` | `sellerCountry`, `stripeEnabled`, `paddleEnabled`, `failedAttemptLimit` (3), `lockDays` (30) | One row                                       |
| `TaxRegistration` | `country`, `region?`, `scheme`, `number?`, `activeFrom`                                      | Stripe path only                              |
| `PlanPrice`       | `plan`, `cycle`, `currency` (ISO-4217), `amountMinor` (integer)                              | Unique on plan, cycle, currency               |
| `GatewayPrice`    | `plan`, `cycle`, `gateway`, `gatewayPriceId`, `syncedAt`                                     | One gateway price carries every currency      |
| `CountryCurrency` | `countryCode` (PK), `currency`                                                               | Seeded per ADR-0024                           |
| `CountryGateway`  | `countryCode` (PK), `gateway`                                                                | One value per country: exclusive by structure |
| `RoutingChange`   | `id`, `countryCodes`, `fromGateway`, `toGateway`, `graceDate`, `createdBy`, `createdAt`      | One per Admin routing change                  |

**Per account** (tenant-scoped)

| Table                  | Columns                                                                                                                                                                                                 | Notes                                                                                                                      |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `BillingProfile`       | `accountId` (PK), `billingCountry`, `postalCode?`, `region?`, `line1?`, `city?`, `customerType`, `taxId?`, `taxIdType?`, `taxIdStatus?`, `taxIdVerifiedAt?`, `currency`, `gateway`, `gatewayCustomerId` | Captured at first checkout. Relationship to today's `Account.gatewayProvider` and `gatewayCustomerId` decided in the slice |
| `BillingAccess`        | `accountId` (PK), `state`, `enteredAt`, `deadlineAt?`, `failedAttempts`                                                                                                                                 | The state machine of §7.1                                                                                                  |
| `RoutingChangeAccount` | `routingChangeId`, `accountId`, `status`, `acceptedAt?`                                                                                                                                                 | The per-account machine of §7.2                                                                                            |
| `TaxLocationEvidence`  | `id`, `accountId`, `invoiceId`, `type`, `country`, `source`, `rawIp?`, `capturedAt`, `retainUntil`                                                                                                      | Append-only, Stripe path, 10 years from the end of the year                                                                |

**Changed**

| Table     | Change                                                                                                                                                                           |
| --------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Invoice` | `amountDue Float` and `amountPaid Float` become integer minor units; `currency` holds an ISO-4217 code; Paddle's `customer_country_code` and `customer_ip_country_code` mirrored |
| `Post`    | An explicit missed state for posts whose time passed while paused                                                                                                                |

**Payment event** (in `packages/ports/src/PaymentAdapter.ts`)

```typescript
interface PaymentEvent {
  provider: "STRIPE" | "PADDLE"; // passed by the route, never inferred
  type: "payment.failed" | "payment.succeeded";
  eventId: string; // the gateway's native id
  gatewayCustomerId: string;
  gatewaySubscriptionId: string | null;
  gatewayInvoiceId: string;
  attemptCount: number;
  amount: { minor: number; currency: string }; // ISO-4217
  occurredAt: Date;
}
```

## 7. State machines

### 7.1 Billing access (per account)

| From                                                     | Event                       | To                    | Side effects                                                                                 |
| -------------------------------------------------------- | --------------------------- | --------------------- | -------------------------------------------------------------------------------------------- |
| `ACTIVE`                                                 | Payment failed, attempt < N | `PAST_DUE`            | Banner "update payment details"; gateway keeps retrying                                      |
| `PAST_DUE`                                               | Payment failed, attempt < N | `PAST_DUE`            | Attempt count updated from the payment event                                                 |
| `PAST_DUE`                                               | Payment failed, attempt = N | `SUSPENDED_READ_ONLY` | Scheduled posts paused; guard engages; gateway stops charging on its own schedule (see note) |
| `SUSPENDED_READ_ONLY`                                    | 72 hours elapse             | `LOCKED_PAYMENT_ONLY` | Deadline = now + lock length; weekly reminders start                                         |
| `LOCKED_PAYMENT_ONLY`                                    | Lock length elapses         | `CANCELED`            | Subscription canceled at the gateway; data kept                                              |
| `PAST_DUE`, `SUSPENDED_READ_ONLY`, `LOCKED_PAYMENT_ONLY` | Payment succeeded           | `ACTIVE`              | Guard releases; paused posts in the future resume; past ones move to the missed list         |
| `CANCELED`                                               | Customer resubscribes       | `ACTIVE`              | New subscription; data already there                                                         |

**Note.** Whether the gateway subscription is canceled at the cut-off or kept unpaid until the lock
ends is the open point of [ADR-0026](../technical/ADR-0026-non-payment-lifecycle.md); the cut-off
slice (BILL-10) does not start until Edward confirms it.

### 7.2 Routing change (per affected account)

| From       | Event                                       | To          | Side effects                                               |
| ---------- | ------------------------------------------- | ----------- | ---------------------------------------------------------- |
| —          | Admin confirms the change                   | `PENDING`   | Notification with X; weekly reminders until X              |
| `PENDING`  | Customer sets up payment on the new gateway | `ACCEPTED`  | Old subscription set to end at the period end aligned to X |
| `ACCEPTED` | X reached                                   | `MIGRATED`  | New subscription charges from X                            |
| `PENDING`  | X reached without acceptance                | `SUSPENDED` | Account suspended; the new gateway is not charged          |

Which billing-access state a `SUSPENDED` routing change enters is the second open point of
[ADR-0025](../technical/ADR-0025-payment-gateway-selection-and-country-routing.md).

### 7.3 VAT ID verification (Stripe path)

`PENDING` → `VERIFIED` | `UNVERIFIED` | `UNAVAILABLE`, mirrored from Stripe's `verification.status`.
Only `VERIFIED` applies the reverse charge.

## 8. Notifications

| Trigger                           | Channel        | Cadence                   | Content                                          |
| --------------------------------- | -------------- | ------------------------- | ------------------------------------------------ |
| Payment failed before the cut-off | Email + banner | Per failed attempt        | Update payment details; attempt count            |
| Cut-off reached                   | Email + banner | Once                      | Read-only for 72 hours; posts paused; how to pay |
| Lock started and during the lock  | Email + banner | Weekly until the deadline | The cancellation date; how to pay                |
| Subscription canceled at lock end | Email          | Once                      | Data kept; how to resubscribe                    |
| Reactivated                       | Email + banner | Once                      | Access restored; missed posts to reschedule      |
| Routing change announced          | Email + banner | Once, then weekly until X | The grace date X; how to accept                  |
| Annual renewal coming             | Email          | Before each annual charge | Amount, date, how to cancel                      |

One scheduled-reminder mechanism keyed on a deadline drives the weekly rows: the gateway-switch
reminder job of `apps/api/src/billing/GatewaySwitchJobService.ts`, generalised from one reminder at
24 hours to a weekly cadence until the deadline.

## 9. Webhook flow (target)

1. The gateway-specific webhook route verifies the signature and knows its provider.
2. The route hands the raw payload to that gateway's adapter, which translates it into a payment
   event (§6). A payload the translator cannot read is rejected loudly, not recorded as the other
   gateway.
3. The service receives the typed event and the provider, finds the account by gateway and customer
   id, updates the invoice in minor units, and advances the billing-access state.
4. Deduplication uses the gateway's native event id.

## 10. Implementation slices

Each slice is one pull request of about 400 authored changed lines (a planning heuristic, not a
cap), with its tests and documentation in the same change. The order respects dependencies; slices
with no dependency between them may run in a different order.

| ID      | Slice                                                                                                                                                                                                    | Depends on      | ADR                                                                                                                                                                                                                   | Closes                        |
| ------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------- |
| BILL-1  | `PaymentEvent` type in the `PaymentAdapter` port, and the Stripe translator tested against a real `2026-03-25.dahlia` invoice payload                                                                    | —               | [0026](../technical/ADR-0026-non-payment-lifecycle.md)                                                                                                                                                                | —                             |
| BILL-2  | The Paddle translator, tested against a real Paddle payload. PR #396 (Paddle webhook await) is merged, so nothing blocks it                                                                              | BILL-1          | [0026](../technical/ADR-0026-non-payment-lifecycle.md)                                                                                                                                                                | —                             |
| BILL-3  | The webhook routes pass the provider; `handlePaymentFailed` and `handlePaymentSucceeded` take the typed event; the invented `subscription_id` fixture is replaced; native event ids only                 | BILL-1, BILL-2  | [0026](../technical/ADR-0026-non-payment-lifecycle.md)                                                                                                                                                                | F13 / SMELL-184, N-COR-4, L-6 |
| BILL-4  | `Invoice` money to integer minor units: schema and data migration, and every reader                                                                                                                      | BILL-3          | [0024](../technical/ADR-0024-billing-currency-and-price-catalog.md)                                                                                                                                                   | —                             |
| BILL-5  | Billing reads the Admin-stored gateway configuration; the gateway environment variables and both `buildPriceMap` copies are removed; `SECRETS.md` and `ENVIRONMENT_VARIABLES.md` updated                 | —               | [0025](../technical/ADR-0025-payment-gateway-selection-and-country-routing.md)                                                                                                                                        | F14 / SMELL-185               |
| BILL-6  | Price catalog in the domain, Admin grid, and one-way synchronisation (Stripe `currency_options` with `tax_behavior: "exclusive"`, Paddle `unit_price_overrides`); Admin price-id fields become read-only | BILL-4, BILL-5  | [0024](../technical/ADR-0024-billing-currency-and-price-catalog.md)                                                                                                                                                   | —                             |
| BILL-7  | Currency map and routing map with their seeds and Admin screens; seller establishment country; the European warning                                                                                      | BILL-6          | [0024](../technical/ADR-0024-billing-currency-and-price-catalog.md), [0025](../technical/ADR-0025-payment-gateway-selection-and-country-routing.md), [0027](../technical/ADR-0027-consumer-sales-and-tax-handling.md) | —                             |
| BILL-8  | `BillingProfile` captured at checkout; checkout routed by the maps; the customer's gateway selector removed                                                                                              | BILL-7          | [0025](../technical/ADR-0025-payment-gateway-selection-and-country-routing.md)                                                                                                                                        | —                             |
| BILL-9  | `BillingAccess` state machine, the single API guard with its error code, and the portal banners and payment-only screen                                                                                  | BILL-3          | [0026](../technical/ADR-0026-non-payment-lifecycle.md)                                                                                                                                                                | —                             |
| BILL-10 | The cut-off: Admin-configurable N, cancellation through the adapter's `cancelSubscription`, local state from the gateway's confirmation. Starts after Edward confirms the ADR-0026 open point            | BILL-9          | [0026](../technical/ADR-0026-non-payment-lifecycle.md)                                                                                                                                                                | —                             |
| BILL-11 | Publish worker checks billing access before dispatch; paused posts; the missed state and list                                                                                                            | BILL-9          | [0026](../technical/ADR-0026-non-payment-lifecycle.md)                                                                                                                                                                | —                             |
| BILL-12 | Embedded payment component (Stripe Payment Element, Paddle.js), immediate invoice retry, reactivation                                                                                                    | BILL-9, BILL-5  | [0026](../technical/ADR-0026-non-payment-lifecycle.md)                                                                                                                                                                | —                             |
| BILL-13 | Deadline-reminder mechanism (weekly) generalised from the gateway-switch reminder job; the lock-end cancellation job                                                                                     | BILL-10         | [0026](../technical/ADR-0026-non-payment-lifecycle.md)                                                                                                                                                                | —                             |
| BILL-14 | Country-wide routing change: grace date, notifications, acceptance on the new gateway, suspension at X without charging                                                                                  | BILL-8, BILL-13 | [0025](../technical/ADR-0025-payment-gateway-selection-and-country-routing.md)                                                                                                                                        | —                             |
| BILL-15 | Stripe-path tax: tax registrations, VAT ID verification gating the reverse charge, `TaxLocationEvidence` and the two-evidence rule                                                                       | BILL-8          | [0027](../technical/ADR-0027-consumer-sales-and-tax-handling.md)                                                                                                                                                      | —                             |
| BILL-16 | Consumer mechanics on OmniPost's surfaces: inclusive total and order button, cancellation with confirmation, annual renewal reminder, voluntary 14-day refund, business checkbox                         | BILL-8, BILL-13 | [0027](../technical/ADR-0027-consumer-sales-and-tax-handling.md)                                                                                                                                                      | —                             |
| BILL-17 | `ExchangeRatePort`, ECB adapter, `CachePort` entry and daily scheduler task; USD reporting of non-USD revenue                                                                                            | BILL-4          | [0024](../technical/ADR-0024-billing-currency-and-price-catalog.md)                                                                                                                                                   | —                             |

## 11. Open points

- **Gateway cancellation timing at the cut-off** — [ADR-0026](../technical/ADR-0026-non-payment-lifecycle.md),
  open points. Blocks BILL-10.
- **The exact ISO seed of the routing map**, including the "similar VAT/GST regimes" —
  [ADR-0025](../technical/ADR-0025-payment-gateway-selection-and-country-routing.md). Needed by BILL-7.
- **The state a missed routing deadline enters** —
  [ADR-0025](../technical/ADR-0025-payment-gateway-selection-and-country-routing.md). Needed by BILL-14.
- **The plan set.** The port and the environment price map know `BASIC`, `PRO` and `ENTERPRISE`; the
  Admin form knows Starter and Pro. The catalog (BILL-6) needs one plan set.
- **Withdrawal button and mid-period withdrawal on the Paddle path** —
  [ADR-0027](../technical/ADR-0027-consumer-sales-and-tax-handling.md), open points; for counsel.
