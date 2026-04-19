# Sprint Report: BILLING-V2 — Billing Completeness

## Resumen

Tres gaps de billing cerrados:

1. Dunning handler implementado — payment.failed webhooks ahora procesan correctamente
2. Invoice model y API endpoints creados para client y admin
3. Cancellation email enviado en cancelaciones regulares (no gateway-switch)

---

## Schema

Nuevo modelo `Invoice` con enum `InvoiceStatus`:

- Migración: `20260415000000_add_invoice_dunning`
- Campos: accountId, subscriptionId, gatewayProvider, gatewayInvoiceId (unique), status, amountDue, amountPaid, currency, periodStart, periodEnd, paidAt, hostedUrl, pdfUrl, attemptCount, nextRetryAt
- Relaciones: Account, AccountSubscription

---

## Archivos modificados (6)

| Archivo                                                     | Cambio                                                                                                |
| ----------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `infra/prisma/schema.prisma`                                | +Invoice model, +InvoiceStatus enum, +relaciones en Account y AccountSubscription                     |
| `apps/api/src/billing/GatewayBillingService.ts`             | +handlePaymentFailed (dunning), +handlePaymentSucceeded (recovery), +cancellation email en non-switch |
| `apps/api/src/billing/billingWebhookRoutes.ts`              | +cases payment.failed y payment.succeeded en routeBillingEvent                                        |
| `apps/api/src/billing/clientBillingRoutes.ts`               | +GET /api/billing/invoices (paginado, client auth)                                                    |
| `apps/api/src/billing/adminBillingRoutes.ts`                | +GET /api/admin/billing/invoices (paginado, filtros, admin auth)                                      |
| `apps/api/src/application/notifications/emailTemplates.tsx` | +dunningEmail (3 variantes por attempt), +subscriptionCancelledEmail                                  |
| `apps/client/hooks/api/useBilling.ts`                       | +useMyInvoices hook, +InvoiceDto type                                                                 |
| `apps/client/app/dashboard/settings/billing/page.tsx`       | +InvoiceHistory component import y render                                                             |

## Archivos creados (2)

| Archivo                                             | Descripcion                                                                           |
| --------------------------------------------------- | ------------------------------------------------------------------------------------- |
| `apps/client/components/billing/InvoiceHistory.tsx` | Tabla paginada de facturas con badges de status, links View/PDF, boton Update Payment |
| `apps/api/tests/unit/billing/dunning.test.ts`       | 11 tests para dunning, recovery, y cancellation email                                 |

---

## Endpoints nuevos

### Client

```
GET /api/billing/invoices
Auth: requireClientAuth
Query: page, limit
```

### Admin

```
GET /api/admin/billing/invoices
Auth: requireAdminAuth + BILLING_MANAGE
Query: accountId, status, page, limit
```

---

## Flujo de dunning

1. Stripe/Paddle envia webhook `invoice.payment_failed` / `transaction.payment_failed`
2. Adapter mapea a `payment.failed`, llega a `routeBillingEvent()`
3. `handlePaymentFailed()` ejecuta:
   - Lookup account por gatewayCustomerId
   - Upsert Invoice (idempotente por gatewayInvoiceId unique)
   - Attempt 1-2: transition subscription a PAST_DUE, email de aviso
   - Attempt 3+: transition a CANCELED, email de suspension
4. Cuando pago exitoso: `handlePaymentSucceeded()`
   - Upsert Invoice como PAID
   - Si subscription era PAST_DUE, recovery a ACTIVE

## Cancellation email

- `handleSubscriptionCanceled()` ahora envia email cuando NO es gateway-switch
- El email de gateway-switch existente no se modifico
- Template usa BaseEmailLayout con CTA de reactivacion

---

## Tests (11 passed)

- handlePaymentFailed: PAST_DUE transition, Invoice creation, dunning email, 3rd attempt cancel, final notice, idempotencia, ACCOUNT_NOT_FOUND
- handlePaymentSucceeded: PAID Invoice, PAST_DUE recovery
- handleSubscriptionCanceled: email non-switch, no email para switch

## Client UI

Componente `InvoiceHistory` en `apps/client/components/billing/InvoiceHistory.tsx`:

- Tabla paginada con columnas: Date, Period, Amount, Status, Actions
- Status badges con colores por estado (Paid=verde, Failed=rojo, Open=amber)
- Links: View (hostedUrl), PDF (pdfUrl), Update Payment (para PAYMENT_FAILED, redirige al billing portal)
- Paginacion Previous/Next con "Showing X-Y of Z"
- Empty state: "No invoices yet"
- Hook `useMyInvoices(page, limit)` en useBilling.ts con staleTime 60s

## Verificacion

- API build: 0 errores TS
- Client build: 0 errores TS
- Dunning tests: 11/11 passed
- Migracion: 20260415000000_add_invoice_dunning aplicada
