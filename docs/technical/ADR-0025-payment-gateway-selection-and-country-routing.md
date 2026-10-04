# ADR-0025: Payment gateways — configured in Admin, routed by billing country

- **Status**: Accepted
- **Date**: 2026-10-04
- **Deciders**: Edward
- **Supersedes**: —
- **Superseded by**: —
- **Related**: [ADR-0024](ADR-0024-billing-currency-and-price-catalog.md) (price catalog and
  currency map), [ADR-0026](ADR-0026-non-payment-lifecycle.md) (suspension and reminders),
  [ADR-0027](ADR-0027-consumer-sales-and-tax-handling.md) (consumer and tax obligations)

## Context

OmniPost supports two payment gateways with different legal roles:

- **Paddle is the merchant of record.** It sells to the buyer, collects and remits VAT/GST, keeps
  the location evidence, and carries the tax risk (research Report 3, Q2).
- **On Stripe, OmniPost is the merchant.** It must register for consumption tax where it sells,
  keep its own location evidence, and handle refunds and consumer compliance itself (Reports 3 and
  4). How it registers depends on where the seller is established: a seller with no EU establishment
  registers in the non-Union OSS from the first euro, while a seller established in one Member State
  has a €10,000 threshold and the Union OSS. The UK requires registration from the first supply for
  a non-established seller (Report 3, Q1).

Measured on `main` at `bad953f2`:

- **The customer chooses the gateway.** The client billing settings offer both, Stripe preselected
  and switchable
  (`apps/client/app/[locale]/dashboard/settings/billing/components/GatewaySection.tsx`).
- **Admin already stores gateway credentials, and billing never reads them (finding F14).** The
  Admin Gateways tab (`apps/admin/components/settings/GatewaysTab.tsx`, `CredentialForm.tsx`) stores
  a STRIPE group (`secretKey`, `webhookSecret`, four price ids, `sandboxMode`) and a PADDLE group
  (`apiKey`, `webhookSecret`, four price ids, `sandboxMode`), defined in
  `apps/admin/components/settings/constants.ts`. They are encrypted through
  `PlatformCredentialService` and checked by `SettingsService.executeConnectionTest`. But
  `GatewayAdapterRegistry.ts` and `paymentAdapterFactory.ts` build the adapters from the
  environment (`STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `PADDLE_API_KEY`,
  `PADDLE_WEBHOOK_SECRET`, `PADDLE_SANDBOX`), and both copies of `buildPriceMap` read the price ids
  from `process.env`. An uncut search of the source (23 hits) finds no consumer of the STRIPE and
  PADDLE groups outside the settings store and its connection test. The two sources do not even
  describe the same plans: `buildPriceMap` reads six price ids per gateway (`BASIC`, `PRO`,
  `ENTERPRISE` × monthly, yearly) through bracket access, ``process.env[`${prefix}_PRICE_…`] ?? ""``
  (`GatewayAdapterRegistry.ts:59-68`, `paymentAdapterFactory.ts:27-36`), which fitness #16's
  `process\.env\.` pattern does not match and which falls back to an empty price id, while the Admin
  form holds four (Starter and Pro × monthly, yearly). An operator who enters gateway
  credentials in Admin believes they are in force; they are never used to charge. Recorded as
  SMELL-185 in [roadmap-detected-smells-backlog.md](../reports/roadmap-detected-smells-backlog.md).
- **A per-account gateway switch already exists.** `apps/api/src/billing/GatewaySwitchJobService.ts`
  and `gatewaySwitchProcessor.ts` enqueue a reminder job at 24 hours and a suspend job at 48 hours
  (deadline extendable to 72 hours), send emails, and write a `GATEWAY_SWITCH_AUTO_SUSPENDED` audit
  row. It is per account and customer-initiated; nothing switches a group of customers.
- **`Account` has `gatewayProvider` (default `STRIPE`) and `gatewayCustomerId`, and no country**
  (`infra/prisma/schema.prisma`, `model Account`).

## Decision

1. **Admin enables Stripe, Paddle, or both.** For each enabled gateway Admin asks for **every
   datum needed to run it**: the credentials (secret or API key, webhook secret, sandbox mode), the
   gateway price ids synchronised from the price catalog of
   [ADR-0024](ADR-0024-billing-currency-and-price-catalog.md), and, on the Stripe path, the tax
   registrations OmniPost needs as merchant. A gateway cannot be enabled with an incomplete
   configuration, and the connection test runs before the configuration is saved.
2. **Admin is the single source of gateway configuration.** Billing builds its adapters from the
   stored, encrypted configuration. This follows from point 1 and closes F14 at its root: the
   gateway environment variables listed above leave, because keeping them beside the Admin
   configuration is exactly the two-sources defect F14 describes. Storage takes the same step in
   [ADR-0028](ADR-0028-storage-configuration-and-media-access.md).
3. **With one gateway enabled, every customer uses it. With both enabled, the billing country
   decides** (option B of 2026-10-04):
   - **Paddle**, as merchant of record, for the countries where a foreign seller must collect
     consumption tax: the EU, the UK, Norway, Switzerland, Canada, Australia, New Zealand and similar
     VAT/GST regimes;
   - **Stripe** for every other country, the United States included.
4. **Routing is one country→gateway map**, ISO-3166 alpha-2 → `STRIPE | PADDLE`, seeded with the
   default above and editable in Admin, where an operator includes or excludes countries per
   gateway. **Every country belongs to exactly one gateway**: moving a country to one gateway
   removes it from the other. The exclusivity is structural (a map holds one value per key), not a
   validation across two lists.
5. **Routing is transparent to the customer.** Same price, same currency, same checkout flow,
   whichever gateway the country routes to. The customer no longer chooses a gateway in billing
   settings.
6. **A routing change honours existing subscriptions through a grace period.** It happens when Admin
   moves a country to the other gateway, or when a customer's billing country changes.
   - Admin sets the grace date X. Affected customers are notified that after X their payment option
     changes, and that they must accept the change — set up payment on the new gateway — before X.
   - They receive a **weekly reminder showing the date** until they accept or X arrives. This
     default was stated to Edward and stands unless he corrects it; it shares the deadline-reminder
     mechanism of [ADR-0026](ADR-0026-non-payment-lifecycle.md).
   - The old gateway's subscription stops at X: it is set to cancel at the end of the period aligned
     to X.
   - **A customer who has not accepted by X is suspended, and the new gateway is not charged.**
   - The existing per-account switch flow is generalised into this: a country-wide batch with an
     Admin-set grace date instead of a fixed 24/48-hour schedule.
7. **The seller's country of establishment is an Admin field** (a default stated to Edward, not
   objected to). The tax registrations Admin asks for on the Stripe path derive from it. It is
   configuration rather than code because the application may be sold to another owner, established
   elsewhere.
8. **Both gateways produce the same canonical payment events.** Each adapter translates its own
   webhook payload into one provider-neutral event, and the webhook route passes the provider; no
   service infers the provider from a payload field. That contract, and the defect it removes, are
   in [ADR-0026](ADR-0026-non-payment-lifecycle.md).

## Rationale

1. **The tax role follows the country.** Paddle exists in this setup to carry consumption tax where
   a foreign seller must collect it. Routing those countries to Paddle puts the merchant-of-record
   role exactly where it saves OmniPost a registration.
2. **The customer cannot pick wrongly.** A customer who chooses Stripe from a VAT country today
   makes OmniPost the merchant for that sale, with obligations nobody set up. Taking the choice away
   removes the exposure.
3. **A map cannot hold a country twice.** Exclusivity enforced by the data shape needs no
   cross-list validation and has no failure mode where both gateways claim a country.
4. **One source of configuration is the only kind an operator can trust.** F14 is what two sources
   look like in practice: the visible one is ignored.
5. **A grace period with a hard stop is fair and safe.** Customers keep what they paid for until X,
   and nobody is charged by a gateway they never set up.

## Alternatives Considered

- **Keep the customer's choice of gateway** (today's behaviour). Rejected: it lets the customer
  decide OmniPost's tax role, and it is the opposite of "both gateways work exactly the same".
- **Route by IP address.** Rejected: the billing country is the tax anchor. IP is evidence and a
  tie-breaker, not the routing key (Report 3, Q3).
- **Route by currency.** Not chosen: Canada, Australia and New Zealand route to Paddle for tax
  reasons while being charged USD; currency and gateway are separate maps.
- **Two editable lists, one per gateway, validated against each other.** Rejected for the single map
  (point 4).
- **A fixed routing list in code.** Not chosen: Edward asked for include/exclude per gateway in
  Admin.
- **Switch customers immediately when routing changes.** Rejected: it would end paid periods early
  or charge a new gateway without the customer's set-up.
- **Keep the environment variables beside the Admin configuration.** Rejected: that is F14.

## Consequences

**Positive**

- Admin can run with one gateway or both, and see exactly what each needs.
- The tax role of every sale is decided by configuration an operator can read.
- The Admin gateway form becomes real: what it stores is what charges.

**Negative / costs**

- **A billing country must be captured before routing can run.** `Account` has none today; the
  customer's billing profile gains it at first checkout, and existing customers need it collected.
- **Gateway secrets move from the environment to the database**, encrypted by
  `PlatformCredentialService`. The encryption key becomes the secret that guards them, and
  `docs/security/SECRETS.md` and `docs/deployment/ENVIRONMENT_VARIABLES.md` change with the slice
  that removes the variables.
- **The Stripe path carries real tax work**: registrations derived from the establishment country,
  location evidence and the obligations in [ADR-0027](ADR-0027-consumer-sales-and-tax-handling.md).
- **A country-wide routing change is a batch operation** with notifications and per-account state,
  larger than today's per-account switch.
- **A Stripe customer is single-currency**, so a routing change that also changes the currency
  replaces the subscription rather than editing it.

## Open points

- **The exact seed list.** The decision names regions ("the EU, the UK, Norway, Switzerland, Canada,
  Australia, New Zealand and similar VAT/GST regimes"), not ISO codes. The implementation slice
  proposes the full ISO list, including which "similar regimes" it adds, for Edward to confirm.
- **What "suspended" means at a missed routing deadline**: which state of the billing-access state
  machine in [ADR-0026](ADR-0026-non-payment-lifecycle.md) the account enters, read-only or
  payment-only. Not decided on 2026-10-04.

## Revisit if

- A third gateway is added, or a gateway gains or loses merchant-of-record status somewhere.
- The seller's establishment moves into or out of the EU, which changes the OSS scheme.
- Paddle stops covering a country routed to it.

## Risks and Mitigations

| Risk                                                                         | Mitigation                                                                                                                      |
| ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| A gateway is enabled with credentials that do not work                       | The connection test runs before saving; an incomplete configuration cannot be enabled                                           |
| Admin-stored credentials and environment variables both exist for a while    | The slice that reads the stored configuration removes the variables in the same change; boot does not fall back to them         |
| A European country is moved to Stripe without anyone noticing the obligation | Admin warns that consumer and tax obligations become OmniPost's ([ADR-0027](ADR-0027-consumer-sales-and-tax-handling.md))       |
| A customer misses the routing-change deadline                                | Weekly reminders with the date; at X the account is suspended and the new gateway is not charged, so nothing is billed in error |
| The billing country is missing for an existing customer                      | Routing applies to an account only once its billing country is known; how existing customers are asked for it is a slice detail |

## References

- Research: [research-2026-10-04-billing.md](../reports/research-2026-10-04-billing.md) — Report 3
  Q1 (EU, UK and US registration rules), Q2 (Stripe Tax and Paddle data), Q4 (data model sketch and
  the establishment-country gap); Report 4 §3 (what Paddle and Stripe each cover).
- Specification: [billing-gateways.md](../features/billing-gateways.md).
- Backlog: SMELL-185 (F14) in [roadmap-detected-smells-backlog.md](../reports/roadmap-detected-smells-backlog.md).
- Code: `apps/api/src/infrastructure/billing/GatewayAdapterRegistry.ts`;
  `apps/api/src/infrastructure/billing/paymentAdapterFactory.ts`;
  `apps/admin/components/settings/GatewaysTab.tsx`; `apps/admin/components/settings/constants.ts`;
  `packages/core/settings/src/SettingsService.ts` (`executeConnectionTest`);
  `packages/core/security/src/PlatformCredentialService.ts`;
  `apps/api/src/billing/GatewaySwitchJobService.ts`; `apps/api/src/billing/gatewaySwitchProcessor.ts`;
  `apps/client/app/[locale]/dashboard/settings/billing/components/GatewaySection.tsx`.
- Stripe Tax and the EU — https://docs.stripe.com/tax/supported-countries/european-union
- Paddle VAT handling — https://www.paddle.com/help/sell/tax/how-paddle-handles-vat-on-your-behalf
- Commission OSS guide —
  https://vat-one-stop-shop.ec.europa.eu/document/download/a316a98a-3b2b-4991-a9c0-3b5905d369fc_en?filename=OSS_guidelines_en.pdf
