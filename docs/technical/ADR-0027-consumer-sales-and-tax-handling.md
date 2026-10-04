# ADR-0027: Consumer sales and tax handling — consumers allowed, Paddle for Europe, evidence on Stripe

- **Status**: Accepted
- **Date**: 2026-10-04
- **Deciders**: Edward
- **Supersedes**: —
- **Superseded by**: —
- **Related**: [ADR-0024](ADR-0024-billing-currency-and-price-catalog.md) (tax-exclusive prices),
  [ADR-0025](ADR-0025-payment-gateway-selection-and-country-routing.md) (country routing),
  [ADR-0021](ADR-0021-trusted-proxy-peer-model.md) (client IP derivation),
  [ADR-0030](ADR-0030-pricing-model.md) (prepaid terms, early-exit refunds, trial)

## Context

Edward asked whether OmniPost should sell only to businesses or to individuals as well. The answer
decides which consumer-law and tax obligations apply, and on which gateway path they fall.

The research ([research-2026-10-04-billing.md](../reports/research-2026-10-04-billing.md), Reports 3
and 4) established:

- **Competitors split by audience.** Team and enterprise tools present themselves as business-only
  with no refunds (Hootsuite, Iconosquare, Sprout, Agorapulse, Sendible, Vista Social). Creator tools
  accept individuals with a free plan or a cheap tier, and several give voluntary money-back windows
  of 14 days or more (Buffer, Publer, SocialBee, Loomly) (Report 4 §1).
- **SaaS is a "digital service" under EU law**, so the 14-day withdrawal right lasts until the
  service is fully performed, and a consumer who asked for an early start and then withdraws owes a
  proportional amount (Directive 2011/83 Art. 14(3), 16(a)). The consumer must see the total price
  including taxes, per billing period, directly before an "order with obligation to pay" button
  (Art. 6(1)(e), 8(2)). The withdrawal button of Art. 11a applies from 19 June 2026. Germany adds a
  cancellation button (§ 312k BGB) and renewal limits (§ 309 Nr. 9 BGB); France a three-click
  cancellation; the UK's DMCC subscription regime arrives in January or spring 2027 (Report 4 §2).
- **A business-only clause does not settle consumer status.** The test is objective (CJEU Costea
  C-110/14, Schrems C-498/16), and VAT-number status is a separate question (Reg. 282/2011 Art. 18).
  Business-only would also give up the creator funnel, and would not remove Paddle's discretionary
  refunds, which apply to business buyers too (Report 4 §3–4).
- **Paddle is the trader toward the buyer.** Its buyer terms give EU/EEA/UK consumers the 14-day
  withdrawal, its customer portal has a withdrawal button, and it handles statutory refunds. Its
  seller agreement lets it refund any buyer within 14 days of purchase or renewal at its discretion
  (s.10.2) and charges the refund back to OmniPost, plus up to €20 per chargeback (s.10.4)
  (Report 4 §3).
- **On Stripe, OmniPost is the merchant** and "solely responsible for… refunds" (Report 4 §3), and it
  must establish the customer's location itself. For EU electronically supplied services that takes
  **two non-contradictory items of evidence** from the Art. 24f list: billing address, IP address,
  bank details, SIM country code, landline location, other commercially relevant information
  (Reg. 282/2011 Art. 24b(d)); Art. 24d allows rebutting with three. A seller with no EU
  establishment cannot use the €100,000 one-item simplification. The UK applies the same
  two-evidence rule. Records are kept 10 years from the end of the year (Report 3 Q1).
- **Stripe Tax uses one address, not two pieces of evidence**, so the second item is the merchant's
  job (Report 3 Q2). **And it applies the reverse charge on format alone.** Verified in Stripe's own
  documentation (https://docs.stripe.com/invoicing/customer/tax-ids): Stripe Tax "applies the
  reverse charge … when the tax ID has the required number format, regardless of the government
  verification result". EU law allows the reverse charge only once the VAT number is confirmed
  valid (Reg. 282/2011 Art. 18(1)).

## Decision

1. **OmniPost sells to consumers as well as businesses**, with these six mechanics:
   1. **EU, UK, Swiss and Norwegian consumers always go through Paddle**, which is already the
      default routing of [ADR-0025](ADR-0025-payment-gateway-selection-and-country-routing.md). If
      Admin moves a European country to Stripe, or enables Stripe only, **Admin shows a warning** that
      the consumer obligations — withdrawal button, statutory refunds, VAT — become OmniPost's.
   2. **A voluntary 100% refund within 14 days** of the first payment, and within 14 days of the first
      payment after a trial converts.
   3. **On surfaces OmniPost controls, the VAT-inclusive total and an "order with obligation to pay"
      button** are shown to consumers.
   4. **Online cancellation at the end of the period**, with a confirmation step.
   5. **A reminder before an annual renewal is charged.**
   6. **An optional "buying as a business" checkbox plus VAT ID** at checkout.
2. **Prices are displayed tax-exclusive**; a consumer sees the VAT-inclusive total before the order
   button (a default stated to Edward and not objected to). This matches every competitor that
   states a policy (Report 1) and the `tax_behavior: "exclusive"` of
   [ADR-0024](ADR-0024-billing-currency-and-price-catalog.md).
3. **The B2B reverse charge applies only when the VAT ID's verification status is `verified`** (a
   default stated to Edward and not objected to). On the Stripe path OmniPost gates it itself,
   because Stripe Tax would apply it on number format alone; `pending`, `unverified` and
   `unavailable` all mean the customer is charged VAT as a consumer.
4. **On the Stripe path, OmniPost applies the EU two-evidence location rule.** Every invoice keeps
   its location evidence, append-only, for 10 years from the end of the year of the transaction.
   Two items that agree fix the location. If they disagree, the invoice is flagged and the customer
   is asked, or a third item decides under Art. 24d. The second item alongside the billing country is
   the card issuer's country or the IP address. The UK path follows HMRC's equivalent rule.
5. **On the Paddle path, Paddle as merchant of record collects and keeps the evidence.** OmniPost
   mirrors `customer_country_code` and `customer_ip_country_code` from Paddle's webhooks for
   reporting and to keep both gateways consistent.
6. **A client IP used as tax evidence is derived only through `resolveClientIp`**
   ([ADR-0021](ADR-0021-trusted-proxy-peer-model.md)). A geolocation header such as Cloudflare's
   `CF-IPCountry` is trusted only if the origin is reachable solely through Cloudflare. IP breaks a
   tie; it never decides alone, because VPNs are the documented false positive.

**Pricing model ([ADR-0030](ADR-0030-pricing-model.md), decided later on 2026-10-04).** Four points
of this record meet the pricing model:

- **Term length follows the business checkbox of point 1.6.** Consumers choose prepaid terms of up
  to 12 months; buyers who tick "buying as a business" may choose 18 or 24 months.
- **The voluntary 14-day refund of point 1.2 takes precedence over the early-exit refund formula**
  (ADR-0030, point 8, rule 4). That rule names "the 14-day consumer withdrawal window"; whether it
  also covers business buyers, as point 1.2 does, is an open point of ADR-0030.
- **The reminder of point 1.5 is written for annual renewals.** Which of the other prepaid terms (3,
  6, 18 and 24 months) get one is an open point of ADR-0030.
- **A card-required trial** (ADR-0030, point 11, off by default) brings a notice before the first
  charge, and, under the UK subscription regime from 2027, the cooling-off period after a trial that
  the Consequences below already list.

## Rationale

1. **Most of the consumer work is already Paddle's.** In Europe, where the consumer rules are
   heaviest, Paddle is the seller: terms, withdrawal button, statutory refunds and VAT are its job.
   Allowing consumers costs OmniPost the refund leakage and a few surfaces, not a legal programme.
2. **The creator market buys as individuals.** Business-only would close the funnel Buffer, Publer
   and SocialBee rely on, without even removing Paddle's discretionary refunds.
3. **A flat 14-day refund is simpler than proportional amounts** and matches what Paddle does in
   practice (Report 4 §5).
4. **Reverse charge on format alone is a tax error waiting to happen.** Gating on `verified` puts
   OmniPost on the side of Art. 18(1).
5. **Two items of evidence is the law for a non-EU seller**, and Stripe does not do it. Keeping the
   evidence per invoice is what an OSS audit asks for.

## Alternatives Considered

- **A. Business-only** (the Hootsuite and Iconosquare model). Rejected: it shuts out hobby creators,
  the clause may not survive the objective test, and Paddle's discretionary refunds remain.
- **C. Self-handled proportional refunds** under Art. 14(3). Rejected: legally precise but
  complicated, and at odds with Paddle's flow.
- **VAT-inclusive display prices.** Rejected for the tax-exclusive convention of every competitor
  that states one; consumers still see the inclusive total before ordering.
- **Trust Stripe Tax's reverse charge.** Rejected: format is not validity.
- **Locate customers by IP only.** Rejected: one item is not enough for a non-EU seller, and IP alone
  misfires behind VPNs.
- **Ask for the country at signup.** Not chosen: no documented competitor takes tax location from a
  signup field; the billing country is captured at checkout.

## Consequences

**Positive**

- OmniPost can sell to creators and small businesses without a separate legal track in Europe.
- The tax treatment of a B2B sale on Stripe is defensible: reverse charge only on a verified number,
  location on two items of evidence.

**Negative / costs**

- **Refund leakage**: the voluntary 14-day refunds, and Paddle's discretionary refunds charged back
  with up to €20 per chargeback.
- **New surfaces OmniPost owns**: the inclusive total and order button, the cancellation flow with
  confirmation, the annual renewal reminder and the business checkbox.
- **A stored-evidence table on the Stripe path**, holding IP addresses as personal data under a
  legal-obligation basis (GDPR Art. 6(1)(c)) for 10 years, then deleted. An IP used only to choose a
  display currency is not stored.
- **Admin must warn on a configuration that moves consumer obligations** onto OmniPost.
- **The UK subscription regime** (cooling-off at sign-up, after a trial and after 12-month renewals;
  online exit) will need review when it starts in 2027.

## Open points

- **Who must provide the withdrawal button** when Paddle is the seller but the checkout sits on
  OmniPost's site is unverified (Report 4, gaps). Paddle offers one in its customer portal.
- **How Paddle treats a mid-period SaaS withdrawal** is unverified: its buyer terms and refund policy
  differ (Report 4, gaps).
- **This rests on research, not legal advice.** Local counsel should confirm the consumer
  classification and Paddle's handling of SaaS withdrawals.

## Revisit if

- Admin routes a European country to Stripe for real, which turns the warning of point 1.1 into
  work: withdrawal button, statutory refunds and VAT on the Stripe path.
- Stripe Tax starts gating the reverse charge on verification, or starts comparing two items of
  evidence.
- The EU Digital Fairness Act introduces EU-wide renewal or cancellation rules.

## Risks and Mitigations

| Risk                                                   | Mitigation                                                                                                         |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------ |
| A VAT ID that is not yet verified gets reverse-charged | Reverse charge is applied only on `verified`; any other status is charged VAT                                      |
| Location evidence on the Stripe path disagrees         | The invoice is flagged and the customer asked, or three items decide under Art. 24d                                |
| A spoofed geolocation header is used as evidence       | IP is taken only through `resolveClientIp`; `CF-IPCountry` only when the origin is reachable solely via Cloudflare |
| An operator moves a European country to Stripe unaware | Admin warns before saving that the consumer obligations become OmniPost's                                          |
| Evidence is kept past its legal basis                  | Each evidence row carries the end of its 10-year period and is deleted after it                                    |

## References

- Research: [research-2026-10-04-billing.md](../reports/research-2026-10-04-billing.md) — Report 3
  (Q1 law, Q2 Stripe Tax and Paddle data, Q3 IP geolocation, Q4 data model), Report 4 (§1
  competitors, §2 EU and UK consumer rules, §3 Paddle and Stripe coverage, §4 business-only, §5
  options).
- Specification: [billing-gateways.md](../features/billing-gateways.md).
- Pricing model: [ADR-0030](ADR-0030-pricing-model.md).
- Stripe tax IDs — https://docs.stripe.com/invoicing/customer/tax-ids · customer locations —
  https://docs.stripe.com/tax/customer-locations
- Paddle buyer terms — https://www.paddle.com/legal/buyer-terms · refund policy —
  https://www.paddle.com/legal/refund-policy · seller terms — https://www.paddle.com/legal/terms
- Directive 2011/83 (consolidated) —
  https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX:02011L0083-20220528 · Regulation
  282/2011 — https://eur-lex.europa.eu/legal-content/EN/TXT/HTML/?uri=CELEX:32011R0282
- Canon: `docs/security/SECURITY_CANON.md` §Rate Limiting (`resolveClientIp`).
