# Sprint 8 Report — Revenue & Growth

Date: 2026-03-30

## Summary

| Batch | Feature                 | Status | Tests  |
| ----- | ----------------------- | ------ | ------ |
| 1     | Provider-based billing  | Done   | 15     |
| 2     | Integration marketplace | Done   | 0 (UI) |
| 3     | Referral program        | Done   | 6      |

## Batch 1 — Provider-Based Billing

PricingCalculator domain service (pure, zero infrastructure):

- calculateCustomPrice(): provider tier x account multiplier
- calculateBundlePrice(): bundle price x account multiplier
- findCheaperBundle(): recommends cheaper bundle when applicable

Pricing tiers (stored in DB, never hardcoded):

- Provider: $12 (1) / $10 (2-3) / $8 (4-6) / $6 (7+)
- Account: x1.0 (1st) / x0.80 (2-3) / x0.65 (4-9) / x0.50 (10+)

Bundles: Creator $25 / Social Pro $32 / Agency Full $55

Schema: ProviderPricingTier, AccountPricingTier, ProviderBundle, BundleFeatureFlag, AccountSubscription, SubscriptionPriceHistory

Client: /dashboard/settings/billing (configurator with bundles + custom tabs)
Admin: /dashboard/pricing (tier management + MRR dashboard)

## Batch 2 — Integration Marketplace

Registry: 9 integrations (7 live, 2 coming soon)
Categories: automation, crm, storage, security
Page: /dashboard/integrations
Sidebar: Integrations link added

## Batch 3 — Referral Program

Use cases: GetOrCreateReferralCode, TrackReferralSignup
Schema: ReferralCode, Referral models
Reward: 30 days free per conversion
Page: /dashboard/settings/referral

## Totals

| Metric        | Before | After | Delta |
| ------------- | ------ | ----- | ----- |
| Test files    | 341    | 343   | +2    |
| Tests passing | 7,072  | 7,093 | +21   |
| Client pages  | 40     | 43    | +3    |
| Admin pages   | 12     | 13    | +1    |
| Prisma models | 86     | 95    | +9    |

## Build and Test

| Check                   | Result                            |
| ----------------------- | --------------------------------- |
| TypeScript build        | 0 errors, 9/9 tasks               |
| All tests               | 343 files, 7,093 passed, 0 failed |
| Architecture boundaries | Clean                             |
