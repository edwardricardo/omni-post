# ADR-0024: Billing currency — USD accounting, fixed per-currency price lists, FX for reporting only

- **Status**: Accepted
- **Date**: 2026-10-04
- **Deciders**: Edward
- **Supersedes**: —
- **Superseded by**: —
- **Related**: [ADR-0025](ADR-0025-payment-gateway-selection-and-country-routing.md) (gateway
  routing), [ADR-0027](ADR-0027-consumer-sales-and-tax-handling.md) (tax display),
  [ADR-0030](ADR-0030-pricing-model.md) (the pricing rules each price list holds)

## Context

OmniPost charges through two gateways, Stripe and Paddle, so customers on both sides of the world
can pay. Edward's rule for them is that **both must work exactly the same**: same price, same
currency, same flow, whichever gateway a customer lands on.

On the night of 2026-10-04 his first answer on currency was: payments are canonical in USD, and
European customers see the amount converted to EUR for display. Three research reports were run on
that answer ([research-2026-10-04-billing.md](../reports/research-2026-10-04-billing.md), Reports 1
to 3). They showed that a display-only conversion is the weakest of the available options:

- **Every multi-currency competitor uses hand-set round price lists, never live conversion.**
  Metricool charges €16 against $20 and €43 against $53; Agorapulse uses the same numerals in both
  currencies; Iconosquare is reported at €33 against $39 (third-party source). Slack and Figma bill
  in a fixed currency per subscription (Report 1 §Synthesis (b); Report 2 §4).
- **A converted display never matches what the card is charged.** The customer pays the issuer's
  FX fee, and the EU Consumer Rights Directive requires the total price, taxes included, directly
  before the order button (Art. 6(1)(e) and 8(2)). Presenting EUR as _the_ price while charging USD
  risks being a misleading action under the Unfair Commercial Practices Directive (Report 2 §1).
- **Letting each gateway convert makes the two gateways diverge.** Stripe Adaptive Pricing
  re-converts a subscription at each billing cycle at a real-time rate, with a 2–4% fee paid by the
  customer and no notice to the customer. Paddle's automatic conversion produces non-round prices
  and does not document whether renewals are re-converted (Report 2 §1).
- **The reference rate is not meant for charging.** The ECB publishes its rates "for information
  purposes only" and strongly discourages using them for transactions (Report 2 §2).
- **Stripe's default tax behaviour would make EUR prices tax-inclusive.** Its "Automatic" setting
  treats non-USD/CAD prices as inclusive, and a price's `tax_behavior` cannot be changed once set
  (Report 1 §Synthesis (c)).

The code measured on `main` at `bad953f2` has no price catalog and stores money as floats:

- `infra/prisma/schema.prisma`, `model Invoice`: `amountDue Float`, `amountPaid Float`,
  `currency String @default("usd")`.
- `packages/core/billing/src/GatewayBillingService.ts:869` reads `data.amount_due ?? data.amount`
  from the raw webhook payload and divides it by 100 into a JavaScript number.
- Gateway price ids are opaque strings read from the environment by two copies of `buildPriceMap`
  (`apps/api/src/infrastructure/billing/GatewayAdapterRegistry.ts:54`,
  `apps/api/src/infrastructure/billing/paymentAdapterFactory.ts:24`). Nothing in the domain knows
  what a plan costs.
- `Account` has no country field, so nothing can tell which customers are European.

## Decision

1. **USD is the canonical accounting currency.** Revenue, reports and internal figures are in USD.
2. **Customers are charged in the currency their billing country maps to, from a fixed, hand-set
   price list of round prices for that currency** (for example $20 → €16). A charged amount is
   never computed from an exchange rate. This supersedes the "display EUR, charge USD" part of the
   first answer of 2026-10-04.
3. **One price catalog lives in the domain**: plan × billing cycle → one amount per currency, in
   integer minor units. It is the source of truth, and the gateways are synchronised from it:
   - **Stripe**: each price carries `currency_options[eur]`; subscriptions are created with an
     explicit `currency`, because without it Stripe uses the price's default currency.
   - **Paddle**: each price carries `unit_price_overrides` for the countries mapped to EUR, with the
     same integer amount.
4. **A country→currency map decides the charged currency.** It maps ISO-3166 alpha-2 codes to
   ISO-4217 codes, is editable in Admin, and is seeded with:
   - **EUR** for all of Europe: the 27 EU member states, the rest of the EEA (Norway, Iceland,
     Liechtenstein), the United Kingdom and Switzerland;
   - **USD** for every other country.

   A country can map only to a currency that has a complete price list for every plan and cycle;
   Admin validates this before saving. Adding a currency later (GBP, for example) is a new price
   list plus map edits, with no code change.

5. **Money is stored as integer minor units plus an ISO-4217 code**, wherever it is persisted or
   crosses a port. Exchange rates are stored as decimal strings. Floats are never used for money.
   This matches both gateways: Stripe takes `1000` to charge USD 10, and Paddle takes integer
   strings in the lowest denomination.
6. **Exchange rates are used for reporting in USD only.** An `ExchangeRatePort` in `packages/ports`,
   an ECB adapter in `packages/adapters`, a `CachePort` entry (key `fx:USD:EUR`, about 26 hours) and
   a daily `BackgroundTaskScheduler` task provide the rate. It converts non-USD revenue into USD for
   reports and nothing else; a stale or missing rate never blocks a checkout.
7. **Gateway-side conversion is switched off.** Stripe Adaptive Pricing is off; Paddle's automatic
   currency conversion is off. Neither can show a third EUR figure that differs from the price list.
8. **EUR prices on Stripe are created with `tax_behavior: "exclusive"` set explicitly**, because the
   value cannot be changed after creation and the default would make them tax-inclusive. Prices are
   displayed tax-exclusive; [ADR-0027](ADR-0027-consumer-sales-and-tax-handling.md) covers the
   VAT-inclusive total a consumer sees before ordering.

**Pricing model ([ADR-0030](ADR-0030-pricing-model.md), decided later on 2026-10-04).** The plans
and cycles this record keys the catalog on are now pricing rules: per-channel tiers, workspace
volume tiers and term multipliers, configured per currency. Each currency's price list (point 2) is
that currency's hand-set set of rule values, and a list is complete (point 4) when every rule has a
value. A charged amount is computed from the rules of the customer's currency, never from an
exchange rate, so points 2 and 5 to 8 hold unchanged. How the computed amounts are synchronised to
the gateways (point 3) is an open point of ADR-0030.

## Rationale

1. **It is what the market does.** Competitors that sell in more than one currency keep a separate
   round list per currency (Report 1). A customer comparing OmniPost with Metricool sees the same
   kind of price.
2. **The amount shown is the amount charged.** A fixed EUR price is the binding total, so the
   consumer-law requirement to show the total before ordering is met by construction, and the card
   statement matches the page.
3. **Both gateways charge the same integer.** The catalog is the one source; Stripe and Paddle
   receive the same amount for the same plan, cycle and currency. Gateway conversion is the one
   option that can never match, which is why it is off.
4. **Renewals are stable.** A fixed list does not move with the exchange rate, unlike Adaptive
   Pricing, which re-converts every cycle.
5. **Integer minor units remove a class of rounding defect** and match the gateways' own wire
   format, so a translator never converts between representations.
6. **The ECB rate is used only for what the ECB allows.** Reporting is "information purposes";
   charging is not.

## Alternatives Considered

- **A. Display-only EUR, charge USD** (Edward's first answer, the Buffer model plus an estimate).
  Superseded by this decision: European buyers would see a USD line and an issuer FX fee on their
  statement, so the EUR shown would never be what they pay, and the consumer-law exposure rests on
  how prominently the binding USD total is shown.
- **C. Let each gateway convert** (Stripe Adaptive Pricing, Paddle automatic conversion). Rejected:
  Stripe re-converts each cycle with a 2–4% customer fee and no notice, Paddle's rate spread is not
  disclosed, and the two can never match.
- **A local currency for every country.** Not chosen: every currency needs its own maintained price
  list. The map makes it possible country by country later, without code.
- **Store money as `Decimal`.** Not chosen: integer minor units already carry the precision both
  gateways use, and a decimal type would add a conversion at every gateway boundary.
- **A paid FX feed** (Open Exchange Rates, XE, the APILayer products). Not needed: the rate is used
  for reporting only. Several free tiers also forbid commercial use (Report 2 §2).
- **Frankfurter's default v2 endpoint.** Rejected as the source: it blends 104 providers, so its
  USD/EUR rate is not the ECB rate unless pinned to `/v2/providers/ecb/rates` (Report 2 §2).

## Consequences

**Positive**

- One price catalog drives both gateways, the pricing page and the checkout.
- European customers pay a round EUR amount that stays the same at renewal.
- Money columns stop carrying float rounding.

**Negative / costs**

- **Every price change is made in every currency list** and re-synchronised to both gateways. The
  lists are hand-set on purpose, so nothing recomputes them.
- **Stripe charges a conversion fee** of +1% (US account) or +2% (Ireland account) when the
  presentment currency differs from the settlement currency, unless an EUR settlement account is
  added. Paddle includes conversion in its fee.
- **A Stripe customer is single-currency**: "You can't have two active subscriptions with different
  currencies." A customer whose currency changes needs the old subscription ended first.
- **USD reports of EUR revenue move with the exchange rate.** The report shows the rate and its
  date.
- **`Invoice.amountDue` and `Invoice.amountPaid` need a schema and data migration** from `Float` to
  integer minor units, and every reader of those columns changes with it.
- **A wrong `tax_behavior` cannot be repaired in place**: the Stripe price has to be replaced. The
  synchronisation must set it explicitly on every price it creates.

## Revisit if

- A gateway drops per-currency prices (`currency_options` or `unit_price_overrides`).
- OmniPost adds a non-USD settlement account, which changes the fee trade-off above.
- A currency is wanted whose prices should follow the exchange rate rather than a fixed list; that
  would reopen alternative C for that currency only.

## Risks and Mitigations

| Risk                                                                  | Mitigation                                                                                                                         |
| --------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| The catalog and a gateway drift apart (a price edited in a dashboard) | The catalog is the only writer; synchronisation is one-way from the domain, and the price ids it creates are stored with the entry |
| An EUR Stripe price is created tax-inclusive by default               | `tax_behavior: "exclusive"` set explicitly at creation, asserted by a test on the synchronisation request                          |
| A country is mapped to a currency with a missing plan price           | Admin refuses to save a map entry whose currency lacks a complete price list                                                       |
| Adaptive Pricing or automatic conversion is switched back on          | Both are part of the gateway setup checklist in Admin; Payment Links, where Adaptive Pricing is always on, are not used            |
| The ECB feed is down or stale (weekends, TARGET holidays)             | The last good rate is served with its `asOf` date; a rate is never needed to charge, so checkout is unaffected                     |
| A float creeps back into a money path                                 | Money types in ports carry minor units and a currency code; the Invoice migration removes the last `Float` money columns           |

## References

- Research: [research-2026-10-04-billing.md](../reports/research-2026-10-04-billing.md) — Report 1
  (competitor currencies and tax display), Report 2 §1 (gateways and EU display law), §2
  (exchange-rate sources), §3 (money storage), §5 (options A, B and C).
- Specification: [billing-gateways.md](../features/billing-gateways.md).
- Pricing model: [ADR-0030](ADR-0030-pricing-model.md).
- Stripe: tax behavior — https://docs.stripe.com/tax/products-prices-tax-codes-tax-behavior ·
  manual currency prices —
  https://docs.stripe.com/payments/checkout/localize-prices/manual-currency-prices.md?payment-ui=stripe-hosted
  · multi-currency customers — https://docs.stripe.com/invoicing/multi-currency-customers ·
  Adaptive Pricing for subscriptions — https://support.stripe.com/questions/adaptive-pricing-for-subscriptions
- Paddle: localized pricing — https://developer.paddle.com/build/products/offer-localized-pricing/
- ECB reference rates —
  https://www.ecb.europa.eu/stats/policy_and_exchange_rates/euro_reference_exchange_rates/html/index.en.html
- Code: `infra/prisma/schema.prisma` (`model Invoice`);
  `packages/core/billing/src/GatewayBillingService.ts:869`;
  `apps/api/src/infrastructure/billing/GatewayAdapterRegistry.ts:54`;
  `apps/api/src/infrastructure/billing/paymentAdapterFactory.ts:24`.
- Canon: `docs/observability/LOGGING_CANON.md` §Caching (CachePort) and §Background Tasks
  (scheduler); ADR-0018 (dependency policy, for any money or FX library added).
