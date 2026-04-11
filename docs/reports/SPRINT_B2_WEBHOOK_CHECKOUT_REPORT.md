# Sprint B.2 — Billing Webhook Receiver + Client Checkout Report

**Date:** 2026-04-11
**Branch:** Genesis
**Status:** COMPLETE
**Depends on:** Sprint B (Gateway Switching)

---

## Objective

Wire the existing `GatewayBillingService` methods (`handleSubscriptionCanceled`, `handleCheckoutCompleted`) to actual Stripe/Paddle webhook events. Add client-facing checkout flow so users can subscribe via their selected gateway and manage their billing through the gateway portal.

---

## Task 1 — Billing Webhook Receiver

### New File

`apps/api/src/billing/billingWebhookRoutes.ts` (263 lines)

### Endpoints

| Method | Path               | Auth                          | Purpose                       |
| ------ | ------------------ | ----------------------------- | ----------------------------- |
| POST   | `/webhooks/stripe` | None (signature verification) | Receive Stripe billing events |
| POST   | `/webhooks/paddle` | None (signature verification) | Receive Paddle billing events |

### Raw Body Strategy

Uses Fastify's scoped `addContentTypeParser` within the plugin — overrides JSON parser to `parseAs: "buffer"` ONLY for webhook routes. The rest of the app continues using the normal JSON parser.

### Event Flow

```
Stripe/Paddle webhook POST
  -> Verify signature via adapter.parseWebhookEvent({ payload: rawBody, signature })
  -> Map event type via adapter.mapEventType(event.type)
  -> Resolve accountId from gatewayCustomerId via DB lookup
  -> Route to GatewayBillingService method:
     - "subscription.canceled" -> handleSubscriptionCanceled(accountId)
     - "subscription.activated" -> handleCheckoutCompleted(accountId, customerId, subscriptionId)
     - Other events -> logged and ignored
  -> Always return HTTP 200 (even on processing errors)
```

### Helper Functions

- `extractCustomerId(data, provider)` — extracts customer ID from Stripe (`data.customer`) or Paddle (`data.customer_id`) event data
- `extractSubscriptionId(data, provider)` — extracts subscription ID from event data
- `resolveAccountId(gatewayCustomerId, provider)` — looks up `Account.id` by `gatewayCustomerId` + `gatewayProvider`

### Registration

Registered in `apps/api/src/index.ts` at line 387, BEFORE any authenticated routes — Stripe/Paddle do not send JWT tokens.

---

## Task 2 — Port Extension + Service Methods + Client API Endpoints

### Port Change

`packages/ports/src/PaymentAdapter.ts` — added `createCheckoutSession` to `IPaymentAdapter`:

```typescript
createCheckoutSession(params: {
  externalCustomerId: string;
  successUrl: string;
  cancelUrl: string;
  metadata?: Record<string, string>;
}): Promise<{ url: string }>;
```

### Adapter Implementations

**StripePaymentAdapter** — uses `stripe.checkout.sessions.create()` with `mode: "subscription"`

**PaddlePaymentAdapter** — generates checkout URL with customer auth token via `paddle.customers.generateAuthToken()`

### New GatewayBillingService Methods

| Method                  | Signature                                                                           | Purpose                                                           |
| ----------------------- | ----------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| `createCheckoutSession` | `(accountId, gatewayProvider, successUrl, cancelUrl) -> Result<{url}, SwitchError>` | Creates/retrieves gateway customer, then creates checkout session |
| `getBillingPortalUrl`   | `(accountId, returnUrl) -> Result<{url}, SwitchError>`                              | Returns gateway portal URL for managing subscription/invoices     |

`createCheckoutSession` handles customer creation automatically — if the account has no `gatewayCustomerId` or is switching gateways, it creates a new customer on the target gateway first.

### New Client API Endpoints

Added to `apps/api/src/billing/clientBillingRoutes.ts`:

| Method | Path                    | Auth              | Purpose                                                |
| ------ | ----------------------- | ----------------- | ------------------------------------------------------ |
| GET    | `/api/billing/plans`    | None (public)     | Returns active ProviderBundle records from DB          |
| POST   | `/api/billing/checkout` | requireClientAuth | Creates checkout session, returns redirect URL         |
| GET    | `/api/billing/portal`   | requireClientAuth | Returns billing portal URL for subscription management |

The plans endpoint queries `prisma.providerBundle.findMany({ where: { isActive: true } })` — reusing existing data managed by admin pricing page. Decimal fields are wrapped with `Number()`.

`GET /api/billing/invoices` was **postponed** — no `Invoice` model exists in the Prisma schema. Users can view invoices through the gateway portal (Stripe/Paddle) via the "Manage Billing" button.

---

## Task 3 — Client Frontend Wiring

### New Hooks

Added to `apps/client/hooks/api/useBilling.ts` (3 new hooks, 3 existing):

| Hook                  | Type        | Endpoint                                 |
| --------------------- | ----------- | ---------------------------------------- |
| `useAvailablePlans()` | useQuery    | GET `/api/backend/api/billing/plans`     |
| `useCheckout()`       | useMutation | POST `/api/backend/api/billing/checkout` |
| `useBillingPortal()`  | useMutation | GET `/api/backend/api/billing/portal`    |

All hooks use `credentials: "include"` — the client proxy injects Bearer token from httpOnly cookie automatically. No manual token management needed.

`useCheckout` redirects via `window.location.href` (external URL — not Next.js router).

### Billing Page Changes

`apps/client/app/dashboard/settings/billing/page.tsx`:

1. **Bundle cards now use real data** — `useAvailablePlans()` fetches active bundles from DB with loading skeletons. Falls back to hardcoded BUNDLES if API unavailable.

2. **"Contact support" buttons replaced** with "Subscribe" buttons that call `useCheckout()` with the account's active gateway provider.

3. **Success/cancel banners** — detects `?success=true` or `?canceled=true` URL params after gateway redirect. Shows green/yellow banner respectively. Auto-clears params after 5 seconds via `router.replace`.

4. **"Manage Billing" button** — shown when account has an active subscription (no pending switch). Calls `useBillingPortal()` to redirect to Stripe/Paddle portal for invoice viewing, payment method updates, and subscription management.

---

## Files Summary

### New (1)

| File                                           | Lines | Purpose                          |
| ---------------------------------------------- | ----- | -------------------------------- |
| `apps/api/src/billing/billingWebhookRoutes.ts` | 263   | Stripe + Paddle webhook receiver |

### Modified (7)

| File                                                          | Changes                                                                                |
| ------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| `packages/ports/src/PaymentAdapter.ts`                        | +`createCheckoutSession` method to interface                                           |
| `apps/api/src/infrastructure/billing/StripePaymentAdapter.ts` | +`createCheckoutSession` implementation                                                |
| `apps/api/src/infrastructure/billing/PaddlePaymentAdapter.ts` | +`createCheckoutSession` implementation                                                |
| `apps/api/src/billing/GatewayBillingService.ts`               | +`createCheckoutSession` + `getBillingPortalUrl` methods (685 lines total)             |
| `apps/api/src/billing/clientBillingRoutes.ts`                 | +3 endpoints: GET plans, POST checkout, GET portal (233 lines total)                   |
| `apps/api/src/index.ts`                                       | +webhook routes registration before auth middleware                                    |
| `apps/client/hooks/api/useBilling.ts`                         | +3 hooks: useAvailablePlans, useCheckout, useBillingPortal (224 lines total)           |
| `apps/client/app/dashboard/settings/billing/page.tsx`         | Real data, checkout redirect, success/cancel banners, manage billing (691 lines total) |

---

## Quality Gates

| Check                             | Result                                             |
| --------------------------------- | -------------------------------------------------- |
| TypeScript build                  | 9/9 tasks, 0 errors                                |
| ESLint                            | 0 errors, 0 warnings                               |
| `any` count in new/modified files | 0                                                  |
| `throw` in GatewayBillingService  | 0                                                  |
| Max file length                   | 691 lines (billing page) — under 800 limit         |
| Webhook routes before auth        | Line 387 in index.ts, before line 388 (authRoutes) |

---

## Known Limitations

1. **Invoice endpoint postponed** — `GET /api/billing/invoices` not implemented because no `Invoice` model exists in Prisma schema. Users view invoices via gateway portal.
2. **Gateway selection for checkout** — currently uses the account's active gateway provider. First-time users without a subscription default to Stripe. A dedicated gateway selector in the checkout flow could be added later.
3. **Webhook idempotency** — events are processed but not deduplicated. If Stripe/Paddle retries a webhook, the same event may be processed twice. `handleSubscriptionCanceled` and `handleCheckoutCompleted` are designed to be idempotent (check current state before acting).
4. **No webhook event logging** — events are processed in-memory. A webhook event log table could be added for debugging and audit trail.
