# Research: billing currency, tax evidence and consumer sales (2026-10-04)

- **Date**: 2026-10-04
- **Purpose**: the evidence behind the owner's payment-gateway decisions of 2026-10-04, recorded in
  [ADR-0024](../technical/ADR-0024-billing-currency-and-price-catalog.md),
  [ADR-0025](../technical/ADR-0025-payment-gateway-selection-and-country-routing.md),
  [ADR-0026](../technical/ADR-0026-non-payment-lifecycle.md) and
  [ADR-0027](../technical/ADR-0027-consumer-sales-and-tax-handling.md), and specified in
  [billing-gateways.md](../features/billing-gateways.md).
- **Method**: four read-only research workers, each answering one question for Edward. Their
  reports are reproduced below **verbatim**, each under its own heading, in the order they were
  produced. Only markdown formatting was adjusted so prettier accepts the file (table padding, list
  markers); no wording, figure or URL was changed. The reports keep their own headings, so some
  headings repeat across reports (`Sources`, `Gaps`, `Key Learnings`).
- **This is research, not legal advice.** The reports quote statutes, regulations and gateway terms
  as read on 2026-10-04. Local counsel should confirm anything a decision rests on legally, as
  Report 4 itself says.

## Evidence labels

Each report states its own legend at its top. The labels differ in spelling but map onto three
levels:

| Level                                                                    | Report 1 (competitors) | Report 2 (currency) | Report 3 (location and tax) | Report 4 (B2B vs B2C) |
| ------------------------------------------------------------------------ | ---------------------- | ------------------- | --------------------------- | --------------------- |
| Read in the primary source                                               | `V`                    | `V`                 | `V`                         | `[V]`                 |
| Primary source seen only through a search-engine snippet                 | `S`                    | `V-s`               | `P`                         | (not used)            |
| Unverified: third party, secondary source, or the worker's own inference | `U`                    | `A`                 | `A`                         | `[U]`                 |

## Contents

1. Competitor billing: currency, price lists and tax display (13 social-media-management tools).
2. Currency conversion: gateways, exchange-rate sources, money libraries, EU display law.
3. Customer location for SaaS tax and display: EU, UK and US rules, Stripe, Paddle, IP geolocation.
4. Business-only versus consumers too: competitors, EU and UK consumer rules, Paddle and Stripe
   coverage.

---

## Report 1: Competitor billing, currency and tax display

Worker report `competitor-billing-currency-tax.md`, reproduced verbatim.

## Competitor billing research: currency, price lists and tax display (2026-10-04)

All 13 competitors are covered. **The pattern:** nearly all of them bill in USD only. Where a competitor offers more than one currency, it sets a separate round price list for each currency by hand rather than converting from USD. Every competitor that states its tax policy shows prices **tax-exclusive**, and that includes the EU-based ones. None of the 13 shows VAT-inclusive prices.

**Evidence labels:**

- **V**: VERIFIED. I read it on the primary page.
- **S**: I read the primary page's text through a search-engine snippet because the page returned 403 to my fetch. The text is still first-party, but I did not read the whole page.
- **U**: UNVERIFIED. It comes from a third party or is my inference.

The bracketed codes point to the source list below.

### Comparison table

| Competitor (HQ)                                                               | 1. Currencies and how they are chosen                                                                                                                                                                                                                                   | 2. Fixed list or converted                                                                                                          | 3. Tax display and handling                                                                                                                                                                                                                                       | 4. Processor / merchant of record                                                                                                          | 5. Location data asked, and when                                                                                          |
| ----------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------- |
| **Buffer** (US, U)                                                            | USD only. "Not possible to change the billing currency" [B1 V]                                                                                                                                                                                                          | Not applicable (one currency)                                                                                                       | "All of our pricing is tax exclusive"; tax is a separate invoice line. VAT is charged to UK consumers; UK businesses get reverse charge by entering a VAT number. Sales tax in about 20 US states. The page does not mention EU VAT [B1 V]                        | Stripe; Buffer is the merchant [B3 V]                                                                                                      | VAT number entered by the customer. When it is asked is unknown [B1 V]                                                    |
| **Hootsuite** (Canada, U; it supplies a W-8BEN form rather than a W-9 [H2 V]) | Unclear. The plans page template reads "Prices displayed in ___", which suggests a currency filled in dynamically, but the German FAQ quotes "99 $" [H3 V]. A third party says USD regardless of location [H5 U]                                                        | Unknown. The payment terms say "differences in prices may apply, including because of exchange rates" [H4 V]                        | Prices "do not include applicable taxes" [H3 V]. Charges VAT/GST in the EU, UK, Norway, Switzerland, South Africa, Australia, New Zealand, Singapore, Canada and about 18 US states. Entering a VAT number removes VAT from future invoices [H1, H2 V]            | Not disclosed. Takes cards and PayPal [H1 V]                                                                                               | "Your account billing address determines your tax rate" [H2 V]                                                            |
| **Sprout Social** (US)                                                        | USD only: "All transactions are in USD" [S1 S]. The UK contract says amounts are "denominated in United States dollars" unless an order form says otherwise [S3 V]                                                                                                      | Not applicable                                                                                                                      | Tax charged by billing address in certain US states, plus GST/HST in Canada [S2 S]. The customer pays applicable taxes and must gross up any withholding [S3 V]                                                                                                   | Unknown                                                                                                                                    | Billing address [S2 S]                                                                                                    |
| **Later** (Canada, S)                                                         | USD only: "Prices are billed in USD" [L1 V]                                                                                                                                                                                                                             | Not applicable                                                                                                                      | "Applicable taxes are extra" [L1 V]; shown separately on receipts [L2 S]. Canadian sales tax today; VAT being rolled out globally, with an EU VAT update article [L2, L3 S]                                                                                       | Unknown                                                                                                                                    | Mailing address sets the tax location; a VAT ID can be entered "during sign up or in your account settings" [L2 S]        |
| **Metricool** (Madrid, Spain, V)                                              | EUR or USD only, via a toggle on the pricing page; the customer chooses "when you subscribe. No other currencies" [M1, M4 V]                                                                                                                                            | **Fixed, hand-set, round prices in each currency**, not conversions: Starter €16 vs $20, Advanced €43 vs $53, annual billing [M1 V] | Prices "do not include any applicable VAT", which is calculated before purchase [M1, M2 V]. Spanish customers always pay VAT. EU businesses with a VAT number validated in VIES pay none (reverse charge). **Customers outside the EU are charged no VAT** [M3 V] | Not named. Takes cards and PayPal; Metricool itself issues the invoices [M2, M4 V]                                                         | At contracting: name, company, VAT number, full address and country. Tax follows the country in Plan & Billing [M2, M3 V] |
| **Agorapulse** (France; inferred from its "Europe (except France)" VAT rule)  | The English and French pricing pages both show only $ [A1 V]. The FAQ quotes minimums as "€/$3,576" and "€/$6,000" [A3 V]                                                                                                                                               | **The same number in both currencies (€X = $X)** [A3 V]                                                                             | "All fees quoted… are exclusive of VAT or any other taxes" [A2 V]. In Europe outside France, a valid VAT number removes VAT; otherwise the customer's country rate applies [A3 V]                                                                                 | Chargebee for invoicing [A2 V]; Adyen and PayPal as payment gateways [A4 V]. Agorapulse is the merchant                                    | VAT number at subscription; billing details can be edited later [A3 V]                                                    |
| **Publer** (Tirana, Albania and Wyoming, US; S)                               | The customer is assigned PayPro Global or Paddle "depending on where you are located" [P2 V]. Currency is unknown                                                                                                                                                       | Unknown                                                                                                                             | "VAT… will be automatically charged on top of the prices you see" [P1 V]; prices exclude VAT [P3 S]                                                                                                                                                               | **PayPro Global and Paddle as merchants of record** [P1 V, P3 S]                                                                           | VAT number when starting the subscription; on Paddle it can be added after two payments [P2 V]                            |
| **SocialBee** (SocialBee Labs SRL, Romania; S)                                | Prices shown in USD [SB1 V]. "Prices might differ due to currency conversions" at checkout [SB2 S]                                                                                                                                                                      | **Converted** at checkout by FastSpring (S/U)                                                                                       | Prices "don't include VAT, GST, or other regional taxes", which are added at checkout by location [SB1 V]                                                                                                                                                         | **FastSpring as payment processor and reseller (merchant of record)**; card statements read "FS* SocialBee Labs SRL" [SB2 S]               | VAT ID at checkout [SB2 S]                                                                                                |
| **Sendible** (UK, U)                                                          | USD, GBP or EUR via a selector [SD1 V]. The currency can be changed only before the first payment [SD2 S]                                                                                                                                                               | Unknown: the per-currency amounts are drawn by JavaScript and did not render                                                        | UK customers are billed VAT [SD2 S]. EU VAT is not mentioned                                                                                                                                                                                                      | Unknown                                                                                                                                    | Currency chosen at signup or checkout [SD2 S]                                                                             |
| **Vista Social** (US, U)                                                      | USD only [VS1 S]                                                                                                                                                                                                                                                        | Not applicable                                                                                                                      | The pricing page says nothing about tax [VS2 V]                                                                                                                                                                                                                   | **Stripe** customer billing portal [VS3 S]                                                                                                 | Billing address and VAT details in Billing settings [VS3 S]                                                               |
| **Planable** (contracts as Planable, Inc., Delaware [PL3 V])                  | "Prices displayed in U.S. Dollars" [PL1 V]                                                                                                                                                                                                                              | Not applicable                                                                                                                      | Prices "do not include applicable taxes" [PL1 V]; tax is a separate invoice line [PL3 V]. Charges EU and UK VAT to consumers; a VAT number removes it from **subsequent** invoices [PL2 S]                                                                        | **Stripe** [PL1 V]                                                                                                                         | VAT number on the billing page [PL2 S]                                                                                    |
| **Loomly** (US, U)                                                            | USD; the bank converts [LO2 S]                                                                                                                                                                                                                                          | Not applicable                                                                                                                      | "Sales tax may apply depending on your billing address" [LO1 V]                                                                                                                                                                                                   | Unknown                                                                                                                                    | Billing address. VAT number, tax ID or EIN optional for the invoice [LO1 V, LO2 S]                                        |
| **Iconosquare** (Limoges, France, SAS; S)                                     | EUR on the page I fetched ("From €9/month") [I1 V]. A third party also lists USD [I5 U]. Its terms let it change "the currencies of prices displayed" [I2 V]. Paddle lets it "switch on new currencies in 5 minutes"; it ran a localized checkout test in Brazil [I3 V] | **Hand-set round prices**: €33 vs $39 and €69 vs $79 [I5 U]                                                                         | The pricing page says nothing about tax [I1 V]                                                                                                                                                                                                                    | **Paddle**: 13,000+ subscriptions migrated [I3 V]. That this makes Paddle the merchant of record is my inference from how Paddle works (U) | Signup asks for name, company and timezone but no country [I2 V]. VAT number when subscribing [I4 V]                      |

### Synthesis

**(a) Currency**

- **US and Canadian companies:** USD only, almost without exception. That covers Buffer, Sprout, Later, Vista Social and Loomly. Hootsuite is probably the same (U). The bank does the conversion.
- **EU and UK companies:** two or three currencies, usually EUR plus USD. Metricool, Iconosquare and Agorapulse use EUR/USD; Sendible adds GBP. The currency is fixed per subscription. Metricool asks for it at subscription and Sendible locks it after the first payment.
- **Being EU-rooted does not guarantee EUR.** SocialBee (Romania) shows only USD. Planable, often seen as Romanian, contracts through a Delaware company and bills USD through Stripe.

**(b) Fixed lists or converted**

- Every multi-currency competitor I could check uses **hand-set lists with round numbers**:
  - Metricool: €16 vs $20.
  - Iconosquare: €33 vs $39 (U).
  - Agorapulse goes further, using the **same numerals** in both currencies (€/$3,576).
- No competitor's pricing page shows an exact FX conversion.
- Conversion only shows up inside a merchant-of-record checkout. SocialBee (FastSpring) says prices "might differ due to currency conversions". Paddle supports both approaches: automatic conversion or per-country price overrides, with overrides taking precedence [PD V].

**(c) Tax display**

- **Tax-exclusive everywhere, in the US and the EU alike.** Every competitor that states a policy shows prices before tax: Buffer, Hootsuite, Later, Metricool, Agorapulse, Publer, SocialBee and Planable. Loomly says tax "may apply" by address; Sprout's contract makes the customer pay taxes on top. Vista Social and Iconosquare's pricing page say nothing.
- This is the B2B convention, and even the Spanish and French vendors follow it.
- **This conflicts with Stripe's recommended "Automatic" setting**, which makes prices exclusive for USD/CAD and **inclusive for every other currency**. A `tax_behavior` set to exclusive or inclusive cannot be changed later [ST V]. If OmniPost's EUR prices are created under that default, they will be VAT-inclusive, unlike every competitor.

### Surprising findings

1. **Tax coverage is uneven, even among the big names:**
   - Buffer's tax article covers UK VAT and US states only, with nothing on EU VAT.
   - Sendible mentions only UK VAT.
   - Later is only now rolling out EU VAT.
   - Metricool charges no VAT to anyone outside the EU, UK included.
   - Hootsuite has the widest coverage: EU, UK, Norway, Switzerland, South Africa, Australia, New Zealand, Singapore, Canada and US states.
2. **Merchants of record are used mostly by smaller or EU/Balkan-rooted companies:**
   - Publer uses Paddle and PayPro Global.
   - SocialBee uses FastSpring.
   - Iconosquare moved to Paddle.
   - The larger players are their own merchant: Buffer and Vista Social through Stripe, Agorapulse through Chargebee with Adyen.
3. **The VAT number is collected at subscription or checkout, not at signup.** The one exception is Later, which offers it at signup too. Planable and Hootsuite apply a VAT number only to _future_ invoices.
4. **Withholding gross-up clauses** (the customer pays extra so the vendor receives the full amount after withholding tax) appear in Agorapulse's and Sprout's terms.

### Sources

- [B1] https://support.buffer.com/article/544-why-was-i-charged-that-your-bill-taxes-and-vat-explained
- [B2] https://buffer.com/pricing
- [B3] https://support.buffer.com/article/537-accepted-payment-methods
- [H1] https://help.hootsuite.com/hc/en-us/articles/1260804249590-Billing-FAQ
- [H2] https://help.hootsuite.com/hc/en-us/articles/205126640--Billing-FAQ
- [H3] https://www.hootsuite.com/plans and https://www.hootsuite.com/de/plans
- [H4] https://www.hootsuite.com/legal/payment-terms
- [H5] https://wise.com/gb/blog/hootsuite-pricing
- [S1] https://support.sproutsocial.com/hc/en-us/articles/360018982151-Sprout-Social-Billing-Resources-Common-Questions
- [S2] https://support.sproutsocial.com/hc/en-us/articles/360000030303-Sales-Tax-FAQ
- [S3] https://sproutsocial.com/legal/service-subscription-agreement/uk/
- [L1] https://later.com/pricing/
- [L2] https://help.later.com/hc/en-us/articles/360042489094-Later-Sales-Tax-VAT-Information
- [L3] https://help.later.com/hc/en-us/articles/27249669623575-EU-VAT-Update
- [M1] https://metricool.com/pricing/
- [M2] https://metricool.com/legal-terms/
- [M3] https://help.metricool.com/why-am-i-being-charged-vat-on-my-invoice-1t57v
- [M4] https://help.metricool.com/available-payment-methods-in-metricool-0siw2
- [A1] https://www.agorapulse.com/pricing/ and https://www.agorapulse.com/fr/tarifs/
- [A2] https://www.agorapulse.com/terms-of-service/
- [A3] https://support.agorapulse.com/en/articles/12097076-billing-frequently-asked-questions-faq
- [A4] https://www.chargebee.com/customers/agorapulse/
- [P1] https://publer.com/help/en/article/what-payment-methods-do-you-accept-9ns850/
- [P2] https://publer.com/help/en/article/how-to-add-vat-gst-or-tax-number-w6z1yj/
- [P3] https://publer.com/terms
- [SB1] https://socialbee.com/pricing/
- [SB2] https://help.socialbee.com/hc/en-us/articles/29979072098455-FastSpring-The-Payment-Processor-We-re-Using
- [SD1] https://www.sendible.com/pricing2
- [SD2] https://support.sendible.com/hc/en-us/articles/20350734143389-Subscription-payments
- [VS1] https://support.vistasocial.com/hc/en-us/articles/16789411820187-What-currency-does-Vista-Social-bill-in
- [VS2] https://vistasocial.com/pricing
- [VS3] https://support.vistasocial.com/hc/en-us/articles/4409614491547-Changing-your-subscription-or-billing-details
- [PL1] https://planable.io/pricing/
- [PL2] https://help.planable.io/hc/en-us/articles/21715326751004-Is-my-Planable-plan-subject-to-tax
- [PL3] https://planable.io/terms/
- [LO1] https://www.loomly.com/pricing
- [LO2] https://loomly.zendesk.com/hc/en-us/sections/38823734075035-Billing
- [I1] https://www.iconosquare.com/plans-and-pricing
- [I2] https://www.iconosquare.com/terms-of-subscription
- [I3] https://www.paddle.com/customers/iconosquare-subscription-migration
- [I4] https://support.iconosquare.com/my-vat-number-isn-t-being-accepted-when-i-try-to-subscribe-to-a-plan
- [I5] https://thetoolsverse.com/tools/iconosquare-social-media-analytics
- [ST] https://docs.stripe.com/tax/products-prices-tax-codes-tax-behavior
- [PD] https://developer.paddle.com/build/products/offer-localized-pricing/

### Gaps

- **Hootsuite:** which currencies it actually bills in, and whether visitors outside the US see local prices. The plans page fills the currency in client-side.
- **Sendible:** its GBP and EUR amounts (also drawn client-side).
- **Payment processor unknown:** Sprout, Later, Loomly and Hootsuite.
- **Third-party only:** Iconosquare's USD prices.
- **Blocked pages:** several help centres returned 403 (Sprout, Later, Sendible, Vista Social, Planable, SocialBee). For those, the S-rated facts rely on search snippets of the first-party text.

## Key Learnings

1. Among 13 social-media-management competitors checked on 2026-10-04, every one that states a tax policy displays prices tax-exclusive, including the EU-based Metricool and Agorapulse.
2. US- and Canada-based competitors (Buffer, Sprout Social, Later, Vista Social, Loomly) bill in USD only, while EU/UK vendors (Metricool, Iconosquare, Agorapulse, Sendible) offer EUR/USD and sometimes GBP as a per-subscription choice.
3. Multi-currency competitors use hand-set round price lists per currency (Metricool €16 vs $20; Agorapulse identical €/$ figures), not FX conversions.
4. Stripe's recommended "Automatic" tax behavior makes non-USD/CAD prices tax-inclusive, and a price's tax_behavior cannot be changed once set to inclusive or exclusive.
5. Publer (Paddle and PayPro Global), SocialBee (FastSpring) and Iconosquare (Paddle) use a merchant of record, while Buffer, Vista Social and Planable bill as their own merchant through Stripe.

---

## Report 2: Currency conversion

Worker report `currency-conversion.md`, reproduced verbatim.

## Currency conversion for OmniPost: research findings (as of 2026-10-04)

Legend: **V** means I read it in the source (pages, statute text, npm, live API probes). **V-s** means it comes only from a search snippet of the primary source. **A** means assumed, my own analysis or unverified. This is not legal advice.

### 1. What the gateways offer

**Stripe (OmniPost is merchant of record)**

- **Presentment vs settlement (V):** the presentment currency is the currency the customer is charged in. The settlement currency is your bank's currency. If the charge currency differs from the customer's card currency, "their bank or card issuer might charge the customer a foreign exchange fee." https://docs.stripe.com/currencies
- **Conversion fee when presentment ≠ settlement (V):** "+1% if currency conversion is required" on the US pricing page, "+2%" on the Ireland page. https://stripe.com/pricing · https://stripe.com/ie/pricing
- **Manual multi-currency prices (`currency_options`) (V):**
  - Example from the docs: `currency=usd unit_amount=1000 currency_options[eur][unit_amount]=950`.
  - Checkout localizes automatically only if every price, shipping rate and discount carries that currency. A `currency` parameter forces a currency.
  - Manual currencies override Adaptive Pricing for that currency.
  - Stripe "recommends using Adaptive Pricing instead of manual currency prices."
  - Source: https://docs.stripe.com/payments/checkout/localize-prices/manual-currency-prices.md?payment-ui=stripe-hosted
- **Creating subscriptions directly (V-s):** you must pass `currency` to pick one of the price's currencies; otherwise the price's default currency is used. https://docs.stripe.com/products-prices/how-products-and-prices-work
- **Customers are single-currency (V):** "You can't have two active subscriptions with different currencies." https://docs.stripe.com/invoicing/multi-currency-customers
- **Adaptive Pricing (V):**
  - Stripe picks the presentment currency with machine learning.
  - Rate: "Stripe uses the mid-market exchange rate and applies a fee". The rate is guaranteed for 24 h.
  - Fee: "You pay 0%. Your customers pay 2–4%." The fee is built into the rate and Stripe decides it.
  - The PaymentIntent stays in your integration currency (USD) and carries `presentment_details`.
  - Refunds use the original rate.
  - Restrictions: not available for "Elements with the Payment Intents API"; the price currency must be one of your settlement currencies; not applied when `currency_options` already defines that currency, or with `capture_method=manual`.
  - Adaptive Pricing "is always enabled for Payment Links." For Checkout it is a Dashboard toggle.
  - Source: https://docs.stripe.com/payments/currencies/localize-prices/adaptive-pricing.md?payment-ui=stripe-hosted
- **Adaptive Pricing for subscriptions (V):**
  - Covers new cross-border subscriptions on Checkout, Payment Links and Elements with Checkout Sessions.
  - It "will use real-time exchange rates for each billing cycle, resulting in varying local prices." An optional "stability buffer of at least 4%" exists.
  - "Stripe won't send any communications to your customers regarding price changes."
  - Source: https://support.stripe.com/questions/adaptive-pricing-for-subscriptions
- **Contradiction:** for cross-border subscriptions, the docs page lists cards, Link, Apple Pay and Google Pay. The FAQ lists "Cards, Apple Pay, and Link". The fee is "2–4%" in the docs but "starting at 2%" on the pricing page.

**Paddle Billing (Paddle is merchant of record)**

- **Which price a buyer sees (V):** Paddle uses this order: (1) a country-specific override (`unit_price_overrides`, made of `country_codes` plus a `unit_price` with `amount` and `currency_code`); (2) the automatically converted local price; (3) the base price.
  - Auto-conversion is switched on per currency under Settings > Currencies.
  - "Paddle automatically handles conversion into your balance currency."
  - Source: https://developer.paddle.com/build/products/offer-localized-pricing/
- **Currencies (V):** over 30 payment currencies, EUR included. Balance currencies are USD, EUR, GBP, AUD and CAD. https://developer.paddle.com/concepts/sell/supported-currencies/
- **Country detection (V):** checkout geolocates the buyer, and if the buyer changes country Paddle re-localizes. Existing subscriptions keep their currency: "Future renewals … are in the subscription currency as normal." https://developer.paddle.com/changelog/2024/presented-currency-changes/
- **Subscription currency (V-s):** `currency_code` means "Transactions for this subscription are created in this currency." It must be USD, EUR or GBP if `collection_mode` is manual. https://developer.paddle.com/api-reference/subscriptions/get-subscription/
- **Pricing-page API (V):** the pricing-preview endpoint is "Typically used for building pricing pages". It localizes prices and computes tax from an IP or country and returns formatted totals. https://developer.paddle.com/api-reference/pricing-preview/preview-prices
- **Amounts (V-s):** amounts are strings in the lowest denomination and "must be a valid integer". https://developer.paddle.com/api-reference/prices/create-price/
- **Fees:**
  - 5% + 50¢, described as "all-inclusive", with no separate FX line (V). https://www.paddle.com/pricing
  - A margin of up to 1.5% applies only if you take a payout in a currency other than your balance currency (V-s). https://www.paddle.com/help/manage/get-paid/can-i-be-paid-in-my-local-currency
  - The spread inside auto-conversion rates is not disclosed. A "2–3% above mid-market" figure comes only from a competitor's blog (A). https://dodopayments.com/blogs/paddle-fees-explained
- **GAP:** Paddle does not document whether an auto-converted subscription amount is re-converted at each renewal or fixed at creation. Auto-converted prices are not round numbers (e.g. "€9.38" for $10); the usual fix is overrides. https://www.boathouse.co/knowledge/setting-clean-prices-for-international-markets-using-paddle

**Showing EUR but charging USD, versus charging EUR — EU law**

- **Who counts as a consumer (V):** the Consumer Rights Directive 2011/83/EU defines a consumer as a "natural person … acting for purposes which are outside his trade, business". B2B buyers are outside its scope.
- **Total price (V):** Art. 6(1)(e) requires the "total price … inclusive of taxes" and, for subscriptions, "the total costs per billing period".
- **Before the order button (V):** Art. 8(2) requires those details "in a clear and prominent manner, and directly before the consumer places his order", plus an "order with obligation to pay" button. Text read from the Publications Office copy (CELEX 32011L0083); eur-lex itself blocks automated fetches.
- **Price Indication Directive 98/6/EC (V):** it does not apply. The Commission says it "does not apply to services (including digital services) or to digital content". https://commission.europa.eu/law/law-topic/consumer-protection-law/unfair-commercial-practices-and-price-indication/price-indication-directive_en (guidance 2021/C 526/02)
- **Unfair Commercial Practices Directive 2005/29/EC (V):** Art. 7(4)(c) makes "the price inclusive of taxes" material information in an invitation to purchase. Art. 6(1)(d) covers misleading information about "the price or the manner in which the price is calculated".
- **Regulation 2019/518, Art. 3a (V):** payment service providers and point-of-sale currency-conversion providers must disclose their mark-up over the ECB reference rate before payment.
  - (A) This puts the burden on the card issuer, not on a merchant that charges USD.
  - GAP: whether Stripe Adaptive Pricing falls under this rule. Stripe only says it helps "facilitate compliance".
- **My assessment (A):**
  - An EUR figure labelled as approximate is defensible if the binding USD total, with VAT, is shown before the order button.
  - Presenting EUR as _the_ price and then charging USD risks being a misleading action.
  - GAP: I found no EU text that addresses foreign-currency estimates directly. National rules (e.g. the German price-indication ordinance PAngV) were not checked.
- **Trap (A, from the facts above):** if Stripe Adaptive Pricing or Paddle auto-conversion stays on, each checkout shows its own EUR number. That number will differ from OmniPost's page and from the other gateway.

### 2. Exchange-rate sources

- **ECB (V):**
  - Published "around 16:00 CET every working day, except on TARGET closing days", from a 14:10 CET concertation. No weekend rates.
  - Disclaimer: "published for information purposes only. Using the rates for transaction purposes is strongly discouraged." https://www.ecb.europa.eu/stats/policy_and_exchange_rates/euro_reference_exchange_rates/html/index.en.html
  - Endpoints I probed:
    - `https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml` returned USD 1.1225 for 2026-10-02.
    - `https://data-api.ecb.europa.eu/service/data/EXR/D.USD.EUR.SP00.A?lastNObservations=1&format=csvdata` returned the same.
  - Licence: free reuse, "irrespective of any subsequent commercial or non-commercial use"; you must quote the source ("Source: ECB statistics") and must not modify the data. https://www.ecb.europa.eu/stats/ecb_statistics/governance_and_quality_framework/html/usage_policy.en.html
- **Frankfurter (V):**
  - Code is MIT (GitHub API). No key needed, "rate-limited to prevent abuse", self-hostable with Docker, no SLA.
  - v2 data "blended across all providers" (104 sources). Use `/v2/providers/ecb/rates` for ECB only. Rates fall "under each provider's terms." https://frankfurter.dev/docs/
  - Probe: v2 USD→EUR gave 0.88595 dated 2026-10-04, a Sunday. v1 gave 0.89087 dated 2026-10-02, which is exactly 1/1.1225. So the blended v2 rate is not the ECB rate.
- **Open Exchange Rates (V):** Free plan 1,000 requests/month, hourly, USD base only. $12/month for 10k; $47/month for 100k every 30 min; $97/month unlimited every 5 min. https://openexchangerates.org/signup — whether the free plan allows commercial use is UNVERIFIED (the terms page was not read).
- **exchangerate.host (V):** now an APILayer product. Free plan 100 requests/month, daily, no commercial use. $14.99/month for 10k hourly with commercial use. https://exchangerate.host/product
- **Fixer (V):** APILayer. Free 100 calls/month, hourly, "Non-Commercial". $14.99 for 10k with commercial use. https://fixer.io/product
- **currencylayer (V):** APILayer. Free 100 calls/month, daily, no commercial use. $14.99 for 10k. https://currencylayer.com/product
- **XE (V):** $799/year for 10k requests/month at daily rates, up to $4,499/year. Free trial available. https://www.xe.com/xecurrencydata/
- **Wise (V-s):** `GET /v1/rates` with a bearer token, including history. Needs a Wise account; display terms UNVERIFIED. https://docs.wise.com/api-reference/rate
- **Stripe FX Quotes API (V):** 1% per transaction. It locks a rate for charging, so it is not meant for display. https://stripe.com/pricing

### 3. Money libraries and the canon

- **Storage canon (V):** both gateways store money as integers in minor units plus an ISO 4217 code. Stripe: "1000 to charge 10 USD", with zero-decimal currencies listed. Paddle: integer strings. Store exchange rates as decimal strings, never as floats (A).
- **Dinero.js (V, npm):** v2 is **stable**. 2.0.0 shipped 2026-03-02 and `latest` is 2.0.2, MIT. It is immutable and works in minor units. `convert()` takes scaled rates (`{ amount: 89, scale: 2 }`, "you shouldn't use floats") and offers rounding helpers such as `halfEven` and `halfUp`. https://dinerojs.com/api/conversions/convert
- **Other packages (V, npm):** currency.js 2.0.4 was last published 2021-05-19, so it is stale. big.js 7.0.1, decimal.js 10.6.0 and bignumber.js 11.1.5 are good choices for rate arithmetic.
- **Display (V):** `Intl.NumberFormat` with `style: 'currency'` takes its fraction digits from ISO 4217. Its default `roundingMode` is `halfExpand` (half away from zero); `halfEven` is available. https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Intl/NumberFormat/NumberFormat
- **Rounding precedent (V):** the EU euro-changeover regulation 1103/97 says "exactly half-way, the sum is rounded up"; conversion rates use six significant figures and "cannot be rounded or truncated". https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=legissum:l25025
  - (A) For a displayed estimate, round half-up once at the end. Banker's rounding (half-even) is an accounting-ledger choice, not something the law requires.
- **Labelling (A, no standard found):** for example "≈ €13.87 (approx., billed as US$15.00)", showing the rate date.

### 4. What other SaaS companies do

- **Buffer, a direct competitor (V):** "All Buffer subscriptions are billed in U.S. dollars (USD), regardless of your location"; "your bank or card provider will handle the currency conversion"; the currency cannot be changed. https://support.buffer.com/article/544-why-was-i-charged-that-your-bill-taxes-and-vat-explained
- **Slack (V):** location detected at workspace creation sets the billing currency (GBP, EUR, INR, JPY or USD); changes go through support. https://slack.com/help/articles/115004062808-Supported-billing-currencies
  - The EUR price list (€6.75 Pro / €15 Business+ annual) is V-s only; my fetch from a US IP showed only US$7.25 / US$15.
  - If accurate, Business+ is €15 = $15: a hand-set price, not a converted one.
- **Figma (V):** bills new subscriptions in GBP, CAD, EUR, JPY or USD. Changing currency goes through sales, and the credit balance is converted "based on current exchange rates". https://help.figma.com/hc/en-us/articles/13496718847255-Supported-billing-currencies — the ¥1,800 ≈ $12 example is V-s.
- **Pattern (A):** established SaaS either charges USD only (Buffer) or keeps fixed per-currency price lists (Slack, Figma). Live conversion appears mainly through the gateways (Stripe Adaptive Pricing, Paddle auto-conversion).

### 5. Recommendation sketch (A)

There is a real fork, and the owner should choose:

- **A. Display-only EUR, charge USD (the owner's stated decision; Buffer's model plus an estimate)**
  - Turn Stripe Adaptive Pricing off for Checkout. Payment Links always have it on, so avoid them.
  - Keep EUR auto-conversion off in Paddle, with no EUR overrides.
  - Both gateways then charge the identical USD price.
  - Show the EUR figure as approximate, with the binding USD total (VAT included) before the order button.
  - Cost: EU buyers see a USD line on their card statement plus their issuer's FX fee, so the EUR shown is never exactly what they pay.
- **B. USD stays the accounting currency; EU buyers are charged a fixed EUR price list (the Slack/Figma model)**
  - Keep one price catalog in the domain: plan → {USD, EUR} amounts in minor units.
  - Sync it to Stripe as `currency_options[eur]`, with `currency: 'eur'` on subscriptions.
  - Sync it to Paddle as `unit_price_overrides` for EU country codes, with the same EUR integer.
  - Prices are identical, round (charm prices), and stable at renewal. FX is only needed for reporting.
  - Stripe adds a 1–2% conversion fee unless an EUR settlement account is added. Paddle includes conversion in its fee.
- **C. Let each gateway convert (rejected):** Stripe re-converts every billing cycle with a 2–4% customer fee; Paddle's rate is not disclosed. The two can never match.

**Where the rate lives (for A, or for reporting in B)**

- **Port:** `ExchangeRatePort` in `packages/ports`, exposing `getRate(base, quote): Promise<Result<ExchangeRate, FxUnavailableError>>`, where `ExchangeRate = { base, quote, rate: decimal string, asOf, source: 'ECB' }`.
- **Adapter:** `EcbExchangeRateAdapter` in `packages/adapters`, reading the ECB XML or data API, or Frankfurter pinned to `providers=ecb`.
- **Cache:** `CachePort` with key `fx:USD:EUR` and a TTL of about 26 h.
- **Refresh:** a daily `BackgroundTaskScheduler` task shortly after 16:15 CET, with retries.
- **When the source is down:**
  - Serve the last good rate and show its `asOf` date.
  - Three to four stale days are normal over weekends and TARGET holidays.
  - Past a threshold (e.g. 7 days), hide the EUR estimate and show USD only.
  - Never block checkout, because neither A nor B computes a charged amount from the live rate. This matches the ECB's warning against using its rates for transactions.

**Side note (V, npm; out of scope):** the latest SDKs are `stripe` 23.0.0 and `@paddle/paddle-node-sdk` 3.10.0, versus the installed 21.x and 3.6.1.

### Gaps

- How Paddle handles renewal amounts for auto-converted subscriptions.
- Whether Regulation 2019/518 applies to Stripe Adaptive Pricing.
- National price-display rules (e.g. Germany).
- Open Exchange Rates free-plan commercial terms.
- Slack and Figma's exact EUR/JPY amounts.

## Key Learnings

1. Stripe Adaptive Pricing re-converts subscription renewals at the real-time rate each billing cycle, with a 2–4% fee paid by the customer, so local renewal prices fluctuate.
2. Stripe customers are single-currency: a customer cannot have two active subscriptions in different currencies, and subscriptions created via the API need an explicit `currency` to use a price's `currency_options`.
3. Paddle chooses the localized price as country override first, then automatic conversion, then base price, and renewals stay in the subscription's `currency_code`.
4. The ECB publishes reference rates around 16:00 CET on TARGET working days only; reuse is free (including commercial) if the source is quoted, but the ECB discourages using them for transactions.
5. Frankfurter v2 blends 104 providers by default, so its USD/EUR rate differs from the ECB rate unless the request is pinned to `/v2/providers/ecb/rates`.

---

## Report 3: Customer location and tax evidence

Worker report `customer-location-tax-evidence.md`, reproduced verbatim.

# Customer location for SaaS tax and display: what the rules require (research, 2026-10-04)

Each claim below is marked **V** if I read it in the cited source, **P** if I saw it only in a search-result summary of that source, and **A** if it is assumed or unverified.

## Q1. What the law requires

### EU VAT

**Place of supply**

- B2B: the business customer accounts for the VAT through reverse charge. You check the VAT number in VIES. (V) https://europa.eu/youreurope/business/finance-and-tax/vat/cross-border-vat/index_en.htm
- B2C: telecommunications, broadcasting and electronic services are always taxed in the customer's country. (V, same page)
- Reg. 282/2011 Art. 18(1): the seller may treat the customer as a business only once the customer has given a VAT number **and** the seller has confirmed it is valid. (V) https://eur-lex.europa.eu/legal-content/EN/TXT/HTML/?uri=CELEX:32011R0282
- Art. 18(2): if the customer gave no VAT number, the seller may treat them as a consumer (V, same page).

**Evidence of where the customer is** (Arts. 24a–24f, inserted by Reg. 1042/2013) (V) https://eur-lex.europa.eu/legal-content/EN/TXT/HTML/?uri=CELEX:32013R1042

- **24a**: the service is provided at a physical place such as a wi‑fi hotspot or hotel → the customer is presumed to be there.
- **24b(a)–(c)**: presumptions from the fixed landline, the SIM's mobile country code, or the decoder card.
- **24b(d)** applies to normal web SaaS. The customer is where **two items of non-contradictory evidence from Art. 24f** say they are.
- **24d**: the seller may rebut a presumption with **three** non-contradictory items. Tax authorities may rebut it if there are signs of abuse.
- **24f, the evidence list**:
  - billing address
  - IP address or other geolocation
  - bank details: account location or the billing address the bank holds
  - SIM country code
  - landline location
  - "other commercially relevant information"

**The one-item simplification (Reg. 2017/2459, from 2019)** (V) https://eur-lex.europa.eu/legal-content/EN/TXT/HTML/?uri=CELEX:32017R2459

- Supplies of up to **€100,000 a year** need only **one** item, and it must come from a third party (Art. 24f points a–e).
- It applies only to supplies made "from his business establishment or a fixed establishment located in a Member State". A seller with no EU establishment therefore cannot use it.
- That reading is my interpretation (A), but Quaderno says the same: "non-EU sellers must always gather two non-contradictory pieces of evidence" (V) https://support.quaderno.io/article/547-collecting-location-evidence
- I found no Commission document that says this explicitly. **This is a gap.**

**Registration threshold** (Commission OSS guide) (V) https://vat-one-stop-shop.ec.europa.eu/document/download/a316a98a-3b2b-4991-a9c0-3b5905d369fc_en?filename=OSS_guidelines_en.pdf

- The €10,000 threshold applies only to a seller established in **a single Member State**.
- A non-EU seller registers in the non-Union OSS from the **first euro**. It may choose any Member State and gets an "EUxxxyyyyyz" number.
- Stripe's EU tax page says the same: "from your first sale". (V) https://docs.stripe.com/tax/supported-countries/european-union

**Records**

- OSS records must include "information used to determine the place where the customer is established…" (Art. 63c).
- They must be kept **10 years from the end of the year** of the transaction, and supplied electronically on request (V, OSS guide).

### UK VAT (HMRC)

Source (V), page last updated 2022‑03‑28: https://www.gov.uk/guidance/the-vat-rules-if-you-supply-digital-services-to-private-consumers

- Same idea as the EU: **two pieces of evidence**. Accepted pieces are billing address, IP address, bank details, SIM country code, landline location and other commercially relevant information.
- If the two pieces conflict, you "must contact the consumer" to resolve it.
- A sale is B2B only if the customer gave a valid VAT number.
- Businesses not established in the UK register from the **first taxable supply**; no threshold applies. (P) https://www.gov.uk/hmrc-internal-manuals/vat-registration-manual/vatreg37150

### US sales tax

- **Economic nexus** (after Wayfair) is mostly $100k in sales or 200 transactions; Texas and California use $500k. (P) https://stripe.com/guides/introduction-to-us-sales-tax-and-economic-nexus
- **States that tax SaaS**, per Stripe's guide (page dated 2026‑07‑22) (V) https://stripe.com/resources/more/software-sales-tax-for-saas-companies:
  - Fully: AL, AZ, CT, DC, HI, KY, LA, MD, MA, NM, NY, PA, RI, SC, SD, TN, TX (80% taxable), UT, VT, WA, WV.
  - Ohio taxes business use only; Iowa taxes personal use only.
  - The page says California is "generally not taxable until 2027". (A — I could not verify this.)
- **Which address counts**: the Streamlined Sales Tax rules use this order (V, Washington's statute RCW 82.32.730) https://app.leg.wa.gov/RCW/default.aspx?cite=82.32.730
  1. where the customer receives the service
  2. the address in the seller's business records
  3. an address obtained during the sale, **including the payment instrument's address**
  4. the seller's origin

  In practice this means the billing or service address. Stripe advises **not** relying on IP for US customers, because local rates vary within a state (V, Stripe customer-locations page below).

### Other regimes, one line each

- **Canada**: the GST/HST simplified regime applies above CAD 30,000 in 12 months. The customer is in Canada when **two or more** indicators (billing address, IP, bank details, SIM, home address) point there (P). https://www.canada.ca/en/revenue-agency/services/tax/businesses/topics/gst-hst-businesses/digital-economy-gsthst/find-out-need-register/cross-border-threshold-amounts.html
- **Australia**: offshore sellers of digital services register at AUD 75,000. A business customer's ABN plus a statement that it is GST-registered removes the GST (P). https://www.ato.gov.au/businesses-and-organisations/gst-excise-and-indirect-taxes/gst/in-detail/rules-for-specific-transactions/international-transactions/australian-consumers-importing-goods-and-services
- **India**: since 2023‑10‑01, foreign OIDAR (online services) sellers must register when serving any unregistered recipient (A — secondary sources only). https://www.india-briefing.com/news/indias-oidar-taxation-shift-key-changes-effective-october-1-2023-29757.html/

## Q2. What data is collected, and when

### Stripe Tax

Source (V): https://docs.stripe.com/tax/customer-locations

- Stripe uses a **single address**. For Billing and Subscriptions the order is:
  1. shipping address
  2. billing address (`customer.address`)
  3. billing details of the payment method
  4. `customer.tax.ip_address`
- If billing details are incomplete it combines the **card issuer's country** with the postal code.
- Minimum address:
  - EU and elsewhere: country alone is enough. A postal code is needed only to detect excluded territories such as Vatican City or Ceuta.
  - US: postal code at least; a full address is recommended.
  - Canada and India: country plus postal code or province.
- `tax.validate_location=immediately` rejects a bad location at save time. Without a valid location, subscription invoices finalize **with no tax**.
- Checkout and Payment Links collect the address themselves.

**On EU evidence**, Stripe states (V) https://docs.stripe.com/tax/supported-countries/european-union:

> "Stripe Tax prioritizes a single address … instead of comparing two pieces of non-conflicting evidence. However, we store and retain all location evidence used in the transaction on the Customer object."

So the two-piece check is **your job** on the Stripe path, because you are the merchant of record.

**VAT IDs** (V) https://docs.stripe.com/invoicing/customer/tax-ids

- Stripe checks EU numbers against VIES and UK numbers against HMRC. It reports `verification.status`: `pending`, `verified`, `unverified` or `unavailable`.
- **However**, Stripe Tax applies reverse charge "when the tax ID has the required number format, **regardless of the government verification result**." You must gate reverse charge on `verified` yourself.

### Paddle (merchant of record)

- Checkout asks only for **country, plus postal code or region in some countries**. It "doesn't require a full address". Postal code is required "for tax calculation, fraud prevention, and banking compliance" (V). https://developer.paddle.com/concepts/sell/supported-countries-locales/
  - The full list of countries needing a postal code was not visible; I saw AU marked yes. **This is a gap.**
- Its reports give two country fields (V) https://developer.paddle.com/build/reports/checkouts/:
  - `customer_country_code` is "resolved from the customer's entered country, falling back to their IP-derived country".
  - `customer_ip_country_code` "may differ from the customer's billing country, for example when using a VPN".
- Paddle carries "all the tax-related risk". Cross-border B2B customers avoid VAT by entering a **valid** VAT ID (V). https://www.paddle.com/help/sell/tax/how-paddle-handles-vat-on-your-behalf
- Paddle does **not** publish its internal evidence or mismatch policy. **This is a gap.**

### Competitors

None of the documented ones takes tax location from a signup field. All use the **billing address or billing country captured at subscription or checkout**.

| Competitor    | What determines tax                                     | Currency                      | Other notes                                                                                                                                                                                                              |
| ------------- | ------------------------------------------------------- | ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Buffer        | billing address; VAT number "at checkout"               | USD only for everyone         | collects in listed US states, UK and other VAT countries (V) https://support.buffer.com/en-us/articles/why-was-i-charged-that-your-bill-taxes-and-vat-explained-YMilE1mo8m                                               |
| Hootsuite     | "Your account billing address determines your tax rate" | —                             | VAT in EU, UK, NO, ZA, CH (V) https://help.hootsuite.com/hc/en-us/articles/1260804249590-Billing-FAQ                                                                                                                     |
| Sprout Social | billing address                                         | USD only                      | trial signup shows only an email field; no country (V) https://sproutsocial.com/trial/; tax facts (P) https://support.sproutsocial.com/hc/en-us/articles/360000030303-Sales-Tax-FAQ                                      |
| Later         | "mailing address", or the address on the payment method | —                             | VAT ID can be given "during sign up" or later (P — page returned 403) https://help.later.com/hc/en-us/articles/360042489094-Later-Sales-Tax-VAT-Information                                                              |
| Metricool     | country selected in Plan & Billing                      | customer **picks EUR or USD** | VAT-free only with a VIES-validated number (P) https://help.metricool.com/metricools-billing-and-tax-information-stmai                                                                                                   |
| Agorapulse    | billing info                                            | —                             | **cross-checks**: "Your country is verified with your IP address, billing information, and credit card postal code" (V) https://support.agorapulse.com/en/articles/12097076-billing-frequently-asked-questions-faq       |
| Publer        | handled by the gateway (both are merchants of record)   | —                             | assigned by location to **Paddle or PayPro**: "Depending on where you are located, you will be assigned to one of our payment providers" (V) https://publer.com/help/en/article/how-to-add-vat-gst-or-tax-number-w6z1yj/ |
| Vista Social  | billing details on a Stripe-powered page                | —                             | (P)                                                                                                                                                                                                                      |

What I could not verify: whether signup forms ask for country. They are rendered by JavaScript or an auth flow, so I could not read them.

## Q3. IP geolocation

**It is used for both purposes.**

- As **tax evidence**: IP is an Art. 24f item in the EU and is accepted by HMRC and Canada.
- As a **price-display hint**: Paddle.js uses IP to pick the localized price, and the customer can change the preselected country (V). https://developer.paddle.com/build/products/offer-localized-pricing/
- Stripe Adaptive Pricing infers the presentment currency with machine learning. The customer pays a 2–4% FX fee and the merchant settles in its own integration currency (USD). It does **not** convert to a currency you already priced in `currency_options`. For cross-border subscriptions it supports cards, Link, Apple Pay and Google Pay only (V). https://docs.stripe.com/payments/currencies/localize-prices/adaptive-pricing.md?payment-ui=stripe-hosted
- Stripe warns IP is imprecise in the US and more reliable in the EU (V).

**When the countries disagree**

- **Quaderno** logs billing country, IP and card or bank country, marks a mismatch as conflicting, and tells you to contact the customer for more evidence (V).
- **Agorapulse** cross-checks IP, billing info and card postal code (V).
- **HMRC** says to contact the consumer (V).
- **EU Art. 24d** lets the seller decide on three items (V).
- **Paddle** gives entered country priority over IP (V).
- **VPNs** are the documented false positive, and are why IP should break ties rather than decide on its own.
- **Cloudflare** sends `CF-IPCountry: T1` for Tor and `XX` when it does not know (P). https://developers.cloudflare.com/fundamentals/reference/http-headers/

**Common sources**

| Source                    | Cost and terms                                                                                                                                                                                                                                                                                    |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Cloudflare `CF-IPCountry` | free on every plan; "an estimate", no accuracy SLA (V) https://developers.cloudflare.com/network/ip-geolocation/                                                                                                                                                                                  |
| MaxMind GeoLite2          | free for "internal business purposes"; attribution required; old copies must be destroyed within 30 days of a new release; may not be used to locate a household or individual. EULA updated 2026‑02‑12 (V) https://www.maxmind.com/en/geolite2/eula. The paid GeoIP2 product was not researched. |
| IPinfo Lite               | country plus ASN, unlimited, CC BY‑SA 4.0, commercial use with attribution (P) https://ipinfo.io/lite                                                                                                                                                                                             |
| ip-api                    | the free endpoint is **non-commercial only**, 45 requests per minute, no HTTPS; Pro is required for commercial use (P) https://ip-api.com/                                                                                                                                                        |

**Repository note (A):** `CF-IPCountry` is a request header. It is only trustworthy if the origin can be reached solely through Cloudflare. That is the same class of risk as the X-Forwarded-For problem the security canon covers. Derive any IP through `resolveClientIp` and the trusted-proxy model.

**GDPR**

- An IP address is personal data (CJEU C‑582/14 _Breyer_; GDPR Recital 30). https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX%3A62014CJ0582
- Evidence kept for VAT has a legal-obligation basis, Art. 6(1)(c) (V). https://eur-lex.europa.eu/legal-content/EN/TXT/HTML/?uri=CELEX:32016R0679
  - Keep it with the transaction for the 10 years VAT/OSS requires, then delete it.
- An IP used only to choose display currency needs no storage. Data minimisation (Art. 5(1)(c)) argues for looking it up per request and discarding it.

**Other EU rules that bear on price display**

- **Geo-blocking Regulation 2018/302** (P/V) https://digital-strategy.ec.europa.eu/en/news/10-key-features-geo-blocking-regulation
  - You may not redirect a visitor to a country version without their **explicit consent**, and the original version must stay accessible.
  - Different prices per Member State are allowed if offered on a non-discriminatory basis.
  - It also covers non-EU traders who sell into the EU.
  - Consequence: IP may **preselect** EUR, but the user must be able to switch.
- **Consumer Rights Directive 2011/83 Art. 6(1)(e)**: before a consumer is bound, they must see the total price **including taxes**, per billing period for subscriptions (P). https://eur-lex.europa.eu/eli/dir/2011/83/oj/eng
  - Showing a EUR estimate while charging USD is a risk to check.

## Q4. Recommended minimum data model (sketch — needs your decision)

**At signup: collect nothing geographic and mandatory.** That matches every competitor I could document. At most, derive an IP country hint from `resolveClientIp` → Cloudflare or GeoLite2/IPinfo Lite, used only to preselect EUR or USD and not stored as evidence. Keep the user's override as `displayCurrency` on the account.

**A `BillingProfile` per Account, captured at first checkout:**

- `billingCountry`: ISO‑3166 alpha‑2, required.
- `postalCode`: required for US, CA, IN and AU. For US, also `state`, `line1` and `city`, because Stripe recommends a full US address.
- `customerType`: `individual` or `business`.
- `taxId`, `taxIdType`, `taxIdStatus` (`pending`, `verified`, `unverified` or `unavailable`) and `taxIdVerifiedAt`.
- `gateway` (`stripe` or `paddle`) and the gateway's customer ID.

**Reverse charge only when `taxIdStatus = verified`**, because Stripe applies it on number format alone.

**A per-invoice `TaxLocationEvidence` table, append-only, Stripe path only.** One row per item:

- `type`: billing address, IP or card country
- `country`
- `source`
- `capturedAt`
- the raw IP

Keep each row 10 years from the end of the year of the transaction.

- **Rule**: at least two items agree → accept. Otherwise flag the invoice and ask the customer, or use three items under Art. 24d.
- **The second item**: card issuer country from the PaymentMethod, or the IP, alongside the billing country.

**On the Paddle path**, Paddle collects and keeps the evidence. Mirror `customer_country_code` and `customer_ip_country_code` from webhooks for reporting and for keeping both gateways consistent.

**Decision for you:**

- Option 1: EU customers are **charged** in EUR. This uses Stripe `currency_options` or Adaptive Pricing, and Paddle price overrides. Accounting stays in USD.
- Option 2: EUR is **displayed only**, and the customer is charged USD.

Option 1 fits CRD Art. 6(1)(e) better.

## Contradictions and gaps

1. Stripe says it uses "a single address" yet also "store[s] all location evidence". It is unclear what is actually stored.
2. Stripe applies reverse charge on number format alone, which conflicts with the confirmation of validity that Art. 18(1) requires.
3. I found no Commission text saying explicitly that non-EU sellers cannot use the €100k one-item rule. It is inferred from the Art. 24b wording, and Quaderno agrees.
4. The Stripe claim that California SaaS is "not taxable until 2027" is unverified.
5. Paddle's full list of countries requiring a postal code, and its internal mismatch policy, are not published.
6. **OmniPost's own country of establishment is unknown**, and it decides the scheme: non-Union OSS from the first euro, or the €10k threshold plus Union OSS.

## Key Learnings

1. Under EU Implementing Regulation 282/2011 Art. 24b(d), a seller of electronically supplied services needs two non-contradictory items from the Art. 24f list (billing address, IP address, bank details, SIM country code, landline location, other commercially relevant information) to fix a consumer's location.
2. The €100,000 one-item evidence simplification in Art. 24b applies only to supplies made from an establishment in a Member State, and a non-EU seller registers in the non-Union OSS from the first euro.
3. Stripe Tax picks a single customer address (shipping, then billing, then payment-method details, then `tax.ip_address`) instead of comparing two pieces of EU evidence, so the merchant must keep the second piece itself.
4. Stripe Tax applies reverse charge whenever a tax ID has the right format, regardless of the VIES result, so reverse charge must be gated on `verification.status = verified`.
5. Paddle checkout collects only country plus a postal code or region in some countries, resolves country from the entered value with IP as fallback, and reports `customer_ip_country_code` separately because VPNs cause mismatches.

---

## Report 4: Business-only or consumers too

Worker report `b2b-vs-b2c-consumer-rules.md`, reproduced verbatim.

## OmniPost: should it sell to businesses only, or to consumers too? Research findings (2026-10-04)

[V] means I read it in the source. [U] means unverified, secondary, or my own inference. EUR-Lex blocks automated fetches, so I read the EU texts through the Publications Office copies (publications.europa.eu/resource/celex/…). The links below point to EUR-Lex.

### 1. How competitors handle this

| Tool          | Who may buy                                                                                                                                                                | Free plan or trial                                                  | Refunds                                                                                                                                                            | Cancellation                                         |
| ------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------- |
| Hootsuite     | **Business only**: "only…for business and professional reasons and not for individual purposes (e.g. personal, family or household purposes)"; 18+ [V]                     | 14-day trial, no free plan [V]                                      | None; you "must continue to pay for the rest of your plan term" [V]                                                                                                | Rest of term is paid [V]                             |
| Sprout Social | Built for entities ("on behalf of a company…"); 18+. No explicit business-only clause found [V]                                                                            | 30-day trial [V]                                                    | None, except a prorated refund if Sprout breaches its terms and doesn't fix it [V]                                                                                 | 30 days' notice before term end [V]                  |
| Iconosquare   | **Professionals only**: "the Customer acknowledges…they have no right of withdrawal" because both parties "act…as professionals" (terms dated 30/09/2022) [V]              | 14-day trial [V]                                                    | Discretionary: 7 days (monthly) or 30 days (annual) [V]                                                                                                            | Any time [V]                                         |
| Metricool     | Customer is a "professional or company… for a purpose related to their trade, business, job or profession" [V]                                                             | Free plan [V]                                                       | Terms say no refunds in the current cycle. The help centre gives a **15-day withdrawal on the first purchase only**, not on renewals [V; the two sources conflict] | End of period [V]                                    |
| Agorapulse    | Framed as for "businesses and agencies"; French law; no consumer clause [V]                                                                                                | 30-day trial, no free plan [V]                                      | Only on uncured breach [V]                                                                                                                                         | Any time; remaining fees still due [V]               |
| Sendible      | Cites the Supply of Goods and Services Act 1982, the UK business-to-business statute, so B2B framing [V; the inference is mine]                                            | 14-day trial [V]                                                    | "Absolutely no refunds" [V]                                                                                                                                        | Ends 1 day before the paid period ends [V]           |
| Vista Social  | New York law, no consumer clause [V]                                                                                                                                       | 14-day trial, no free plan [V]                                      | None [V]                                                                                                                                                           | End of period; annual plans need 30 days' notice [V] |
| Buffer        | 18+; no business restriction found [V]                                                                                                                                     | **Free plan (3 channels)**, 14-day trial, aimed at creators [V]     | "non-refundable unless otherwise specifically provided" [V]                                                                                                        | Before the renewal date [V]                          |
| Later         | 13+; ages 13–17 need parental approval [V]. The terms page also contains "personal use… not… commercial" text, apparently from another brand's terms (Mavrck) [V, unclear] | 14-day trial; Starter plan for creators [V]                         | "case-by-case… sole discretion" [V]                                                                                                                                | Before renewal [V]                                   |
| Publer        | Not read (redirect loop) [U]                                                                                                                                               | **Free plan, 3 accounts** [V]                                       | **Full refund within 14 days of each web payment; prorated afterwards** [V]                                                                                        | —                                                    |
| SocialBee     | 16+ [V]                                                                                                                                                                    | 14-day trial; Bootstrap plan "for freelancers and solopreneurs" [V] | **30-day money-back on the first purchase**, not renewals [V]. A 14-day consumer withdrawal clause appears in the parent company's (WebPros) PDF terms [U]         | End of cycle [V]                                     |
| Planable      | 18+, English law [V]                                                                                                                                                       | 50 free posts with no time limit [V]                                | "All sales are final"; the help centre allows exceptional refunds within 14 days of a first payment or an annual renewal [V]                                       | —                                                    |
| Loomly        | Run by Bending Spoons (Italy); separate EEA/UK/Swiss terms dated 1 Oct 2026; individuals allowed [V]                                                                       | Trial [V]                                                           | Non-refundable in the terms; the help centre gives full refunds within 20 days (monthly) or 60 days (annual) [V]                                                   | End of period [V]                                    |
|               |                                                                                                                                                                            |                                                                     | The text of the EEA/UK 14-day withdrawal clause (section 4.9) was cut off in my fetch [U]                                                                          |                                                      |

Sources: https://www.hootsuite.com/legal/terms · https://www.hootsuite.com/plans · https://sproutsocial.com/terms/ · https://sproutsocial.com/pricing/ · https://www.iconosquare.com/terms-of-subscription · https://metricool.com/legal-terms/ · https://help.metricool.com/metricool-refund-policy-0lrpo · https://www.agorapulse.com/terms-of-service/ · https://www.agorapulse.com/pricing/ · https://www.sendible.com/terms · https://vistasocial.com/terms/ · https://vistasocial.com/pricing/ · https://buffer.com/terms · https://buffer.com/pricing · https://later.com/terms/ · https://later.com/pricing/ · https://publer.com/help/en/article/what-is-the-refund-policy-lflgew/ · https://publer.com/help/en/article/what-is-included-in-publer-free-dliovh/ · https://socialbee.com/terms-of-service/ · https://socialbee.com/pricing/ · https://planable.io/terms/ · https://planable.io/pricing/ · https://help.planable.io/hc/en-us/articles/21715384970012-Refund-Policy · https://www.loomly.com/terms/en · https://intercom.help/loomly/en/articles/1906075-what-is-your-refund-policy

**The pattern:**

- **Tools aimed at teams and enterprises** (Hootsuite, Sprout, Agorapulse, Iconosquare, Sendible, Vista Social, partly Metricool) present themselves as business-only, give no refunds, and offer trials but no free plan.
- **Tools aimed at creators** (Buffer, Later, Publer, SocialBee, Loomly) accept individuals and offer a free plan or a cheap tier. Several give voluntary money-back windows of 14 days or more, which in practice cover the cost of the EU withdrawal right.

### 2. EU and UK consumer rules if OmniPost sells to consumers

**SaaS is a "digital service", not "digital content".**

- Directive 2011/83 Art. 2(16) uses the definition in Directive 2019/770 Art. 2(2): a service that "allows the consumer to create, process, store or access data in digital form", or to share or interact with data [V].
- Recital 19 of 2019/770 names "software-as-a-service… and social media" [V].
- Recital 30 of 2019/2161 says the withdrawal rules apply so the consumer can "test the service" for 14 days [V].
- https://eur-lex.europa.eu/eli/dir/2019/770/oj · https://eur-lex.europa.eu/eli/dir/2019/2161/oj

**Withdrawal right (Directive 2011/83).** https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX:02011L0083-20220528

- The consumer has 14 days, starting on the day the contract is concluded (Art. 9(1) and 9(2)(a)) [V].
- If the service starts during those 14 days at the consumer's express request, with the acknowledgement required by Art. 8(8), and the consumer then withdraws, they pay "an amount which is in proportion to what has been provided" (Art. 14(3)) [V].
- If OmniPost does not get that express request, or does not give the withdrawal information, the consumer pays nothing (Art. 14(4)(a)) [V].
- The right is lost only once the service has been **fully performed** with prior consent and acknowledgement (Art. 16(a)) [V]. For a monthly or annual subscription that never happens within 14 days.
- The rule that the right ends as soon as performance starts (Art. 16(m)) covers **digital content only** [V].

**Information and ordering.**

- The total price must include taxes and, for a subscription, the total cost per billing period (Art. 6(1)(e)) [V].
- The duration and how to terminate must be stated (Art. 6(1)(o)) [V].
- Directly before the order, the key information must be shown, and the order button must say "order with obligation to pay" or something equally clear. Otherwise "the consumer shall not be bound" (Art. 8(2)) [V].
- A consumer is "any natural person… acting for purposes which are outside his trade, business, craft or profession" (Art. 2(1)) [V].
- A contract with mixed purposes counts as a consumer contract if the business purpose is "not predominant" (recital 17) [V].

**Withdrawal function (button).** https://eur-lex.europa.eu/eli/dir/2023/2673/oj

- Directive 2023/2673 adds Art. 11a: a function labelled "withdraw from contract here", available throughout the withdrawal period, then a "confirm withdrawal" step, then an acknowledgement on a durable medium [V].
- Member States had to apply it **from 19 June 2026** (Art. 2) [V].
- Germany implemented it as § 356a BGB ("Vertrag widerrufen" / "Widerruf bestätigen"), published in BGBl. 2026 I Nr. 28 and in force from 19 June 2026 [V]. https://www.gesetze-im-internet.de/bgb/__356a.html · https://www.noerr.com/de/insights/umsetzungsgesetz-zum-widerrufsbutton-veroeffentlicht

**Cancellation buttons and automatic renewal (national rules).**

- Germany § 312k BGB: consumer subscriptions sold online need a "Verträge hier kündigen" button and a "jetzt kündigen" confirmation [V]. https://www.gesetze-im-internet.de/bgb/__312k.html
- Germany § 309 Nr. 9 BGB: initial term of at most 2 years; tacit renewal only into an open-ended contract with at most one month's notice [V]. https://www.gesetze-im-internet.de/bgb/__309.html
- France L215-1-1: "résiliation en trois clics" since 1 June 2023, for consumers and non-professionals [U; secondary source]. https://laglasse-avocat.fr/fr/blog/resiliation-en-3-clics-obligation-legale
- There is no EU-wide auto-renewal rule yet. The Digital Fairness Act proposal is expected around Q4 2026 [U]. https://www.osborneclarke.com/insights/eu-digital-fairness-act-unpacked-digital-contracts

**UK.**

- Consumer Contracts Regulations 2013:
  - reg 4: a consumer acts "wholly or mainly outside" their trade [V];
  - reg 36: services may start early only on express request; the right ends only on full performance; otherwise the consumer pays a proportionate amount [V];
  - reg 37: for digital content, the right is lost once supply starts with consent and acknowledgement [V];
  - the UK never adopted the EU "digital service" category, so whether SaaS counts as a service or as digital content is open [U].
  - https://www.legislation.gov.uk/uksi/2013/3134/regulation/36 · /regulation/37
- DMCC Act 2024 subscription regime:
  - It adds a 14-day cooling-off at sign-up and another after a trial ends or a contract of 12 months or more renews, plus "if a consumer can sign up online, they must be able to exit online" [V].
  - The government response (2 Apr 2026) said "spring 2027" [V]. https://www.gov.uk/government/consultations/consultation-on-the-implementation-of-the-new-subscription-contracts-regime/outcome/government-response-to-consultation-on-the-implementation-of-the-new-subscription-contracts-regime-web-accessible-version
  - The PM's press release of 9 Aug 2026 says **January 2027** [V via mirror; the gov.uk original was not read]. https://www.ukpol.co.uk/press-release-prime-minister-starts-roll-out-of-everyday-fixes-on-the-cost-of-living-ending-rip-off-discounts-and-subscription-traps-august-2026/ · https://wiggin.co.uk/insight/digital-markets-competition-and-consumer-act-tracker/

### 3. What Paddle and Stripe each cover

**Paddle (Paddle is the seller and the trader towards the buyer).**

- **Buyer terms** (updated 31 Mar 2026; https://www.paddle.com/legal/buyer-terms):
  - Business = use "in connection with their trade, business, craft or profession" [V].
  - EU/EEA/UK consumers may withdraw within 14 days. The terms say the right ends once the buyer starts "using or benefiting from the Product" after agreeing to early access (s.15) [V].
  - Subscriptions can be cancelled "with effect from the end of your current billing period" [V].
- **Refund policy** (https://www.paddle.com/legal/refund-policy):
  - "all Transactions are non-refundable" unless the law requires otherwise [V].
  - Paddle may refund within 14 days at its own discretion [V].
  - "An online withdrawal button is available in the Paddle Customer Portal" [V].
  - After a free trial ends, a fresh 14-day withdrawal period starts [V].
  - UK annual renewals get a new 14-day period (s.2.2.3) [V].
  - The waiver is limited to "digital content Products"; no proportional deduction is described [V].
- **Seller agreement** (updated 8 Oct 2025; https://www.paddle.com/legal/terms):
  - Paddle may refund in full if the buyer asks "within 14 days… of the date on which the subscription was last renewed and Paddle determines, in its sole discretion…", or if the law requires it (s.10.2) [V].
  - Paddle then recovers from OmniPost the refund, its fees, and up to €20 per chargeback (s.10.4) [V].
  - OmniPost may not invoice buyers directly (s.10.1) [V].
- **What this means for OmniPost** [U, inference]:
  - Paddle carries the formal consumer-law work for its regions: terms, withdrawal button, statutory refunds.
  - OmniPost carries the cost, including discretionary refunds after renewals. That applies **to business buyers too**, so going B2B-only does not remove refund exposure in Paddle regions.
  - In practice the refund is probably the full amount, not a proportional one.

**Stripe (OmniPost is the merchant).**

- OmniPost is "solely responsible for… refunds, returns" (s.2). It must "maintain… a fair and neutral refund and exchange policy" (s.3.8). It is liable for disputes (s.5.2) [V]. https://stripe.com/legal/ssa-services-terms
- Stripe provides only the mechanics: immediate or end-of-period cancellation, prorated credits, refunds [V]. https://docs.stripe.com/billing/subscriptions/cancel
- In US Stripe regions, California's auto-renewal law was expanded from 1 Jul 2025 [U]. The FTC's click-to-cancel rule was struck down on 8 Jul 2025 [U]. https://btlaw.com/en/insights/alerts/2025/california-expands-automatic-renewal-law-new-requirements-now-in-effect · https://www.gtlaw.com/en/insights/2025/7/eighth-circuit-vacates-ftcs-click-to-cancel-rule

### 4. What business-only (B2B-only) takes in practice

- **Terms clause plus a checkout statement**, as Hootsuite and Iconosquare do (above).
- **A clause does not settle consumer status.** The test is objective, based on the contract's nature and purpose (CJEU C-110/14 Costea, para 21 [V]; C-498/16 Schrems, para 29 [V]). https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX:62014CJ0110 · https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX:62016CJ0498
- **What helps:** a customer who gives the "legitimate impression" of acting for business, such as business details or mentioning VAT recovery, may lose consumer protection (CJEU C-464/01 Gruber, paras 51–53) [V; that ruling is about court jurisdiction, so its use for consumer-contract law is my inference]. https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX:62001CJ0464
- **VAT is a separate question.** Without a validated VAT number, the supplier "may regard a customer… as a non-taxable person" and charge local VAT (Reg. 282/2011 Art. 18(1)–(2)) [V]. https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX:32011R0282
  - A VAT number therefore cannot be the gate: many micro-businesses and creators under small-business VAT thresholds have none, yet are still traders for consumer law [U].
  - Paddle's checkout already has an optional "Add Tax Number" step (business name and VAT ID, then reverse charge) [V]. https://developer.paddle.com/changelog/2023/hide-tax-number-option-paddlejs/
- **Is it realistic?** Partly [U]. Creators who earn from their content are mostly traders. Hobbyists are consumers. A business-only stance gives up the free-plan/creator funnel that Buffer, Publer and SocialBee rely on.

### 5. Recommendation sketch [U, my judgement]

- **Option A, business-only (Hootsuite/Iconosquare model).**
  - Gains: simplest terms, no statutory withdrawal, no end-of-term refunds.
  - Costs: shuts out hobby creators; a clause that may not hold up against the objective test; Paddle discretionary refunds still apply.
- **Option B, allow consumers with specific mechanics (preferred).**
  1. EU/UK/CH/NO consumers go **only** through Paddle, which supplies the buyer terms, the withdrawal button and the statutory refunds.
  2. Offer a **voluntary 14-day full refund on the first paid payment, and after a trial converts** (Publer model). This is simpler than calculating Art. 14(3) proportional amounts and matches what Paddle does in practice.
  3. Show VAT-inclusive prices and "order with obligation to pay" wording on any consumer surface OmniPost controls.
  4. Cancellation online at end of period with a confirmation step. This satisfies § 312k, L215-1-1 and the DMCC.
  5. Renewal reminders for annual plans, ready for the UK regime in January 2027. Keep minimum terms at or under 2 years with no tacit fixed-term renewals in Germany.
  6. Optional "I'm buying as a business" checkbox plus VAT ID for business buyers.
  - Trade-offs: some refund leakage, and a small UX and terms effort. Most of that is already absorbed by Paddle.
- **Option C, self-handled proportional refunds:** legally precise, but complicated and at odds with Paddle's flow. Not recommended.

### Contradictions and gaps

- **UK commencement date:** January 2027 (August 2026 press release, read via a mirror) versus spring 2027 (April 2026 government response). The later statement probably prevails.
- **Paddle's own documents differ:** the buyer terms extinguish the right on "using or benefiting", while the refund policy limits that to digital content. CRD Art. 16(a) keeps the right alive for services until full performance. How Paddle treats a mid-period SaaS withdrawal is unverified.
- **Who must provide the withdrawal button** when Paddle is the seller but the checkout sits on OmniPost's site: unverified. Paddle offers one in its customer portal.
- **Not fully read:** Metricool (terms vs help centre conflict); Later's eligibility (the page mixes brands); Loomly s.4.9; the eligibility clauses of Publer, SocialBee and Vista Social; France L215-1-1 on Légifrance; gov.uk's original August 2026 release.
- This is research, not legal advice. Local counsel should confirm the consumer classification and Paddle's handling of SaaS withdrawals.

## Key Learnings

1. Under Directive 2011/83 as amended by 2019/2161, SaaS is a "digital service", so the EU 14-day withdrawal right lasts until full performance and the consumer owes only a proportional amount (Art. 14(3), 16(a)), unlike digital content (Art. 16(m)).
2. The EU withdrawal-function button (Art. 11a, Directive 2023/2673) applies from 19 June 2026, and Germany implemented it as § 356a BGB.
3. Paddle's seller agreement s.10.2 lets Paddle refund any buyer, including businesses, within 14 days of purchase or of the last subscription renewal at its own discretion, and s.10.4 charges the refund back to the vendor.
4. Hootsuite and Iconosquare restrict use to businesses or professionals, while Buffer, Publer and SocialBee accept individuals and offer free plans or money-back windows of 14–30 days.
5. EU consumer status is decided objectively (CJEU Costea C-110/14, Schrems C-498/16), so a business-only clause does not settle it, and VAT-number status under Reg. 282/2011 Art. 18 is a separate question.
