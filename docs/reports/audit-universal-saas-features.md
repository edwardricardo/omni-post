# AUDIT REPORT — Universal SaaS Features

Date: 2026-04-14

---

## 1. Authentication & Sessions

| Feature                     | Status      | Evidence                                                                                                                                                     | Gap                                         |
| --------------------------- | ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------- |
| Session timeout enforcement | Partial     | `adminAuthConfig.ts:42` hardcodes 30min. `SecuritySettings` model exists in schema (L2975) with `sessionTimeoutMinutes` but is never read at runtime         | Config in DB is dead — timeout is hardcoded |
| Remember me                 | Implemented | `SessionManager.ts:36-40` creates 30-day vs 7-day sessions. `loginSchema` accepts `rememberMe`. `TokenService.ts:46-49` generates conditional refresh tokens | None                                        |
| Token refresh               | Implemented | `POST /admin/auth/refresh` (adminAuthRoutes.ts:521). Admin proxy at `app/api/auth/refresh/route.ts`. Full chain: CSRF + session DB check + token rotation    | None                                        |

## 2. User Management

| Feature               | Status  | Evidence                                                                                                                                                                                                         | Gap                                     |
| --------------------- | ------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------- |
| User invitation flow  | Partial | `InviteTeamMemberUseCase.ts` exists, routes wired at `teamRoutes.ts:287`. But no email sent — only creates DB record. Admin creates users with temp password (no invite email)                                   | No invitation email notification        |
| User avatar / profile | Missing | No `avatar`, `profilePicture` or `photo` field on AdminUser, TeamMember, or CustomerUser in Prisma schema                                                                                                        | Completely absent from data model       |
| User preferences      | Partial | `AdminUser.timezone/locale` fields exist (schema L142-143). `NotificationPreference` model (L357-365) with routes at `notificationRoutes.ts:251-293`. But timezone/locale not user-editable — no update endpoint | Timezone/locale stored but not editable |

## 3. Billing

| Feature                  | Status  | Evidence                                                                                                                                                                                 | Gap                                            |
| ------------------------ | ------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------- |
| Dunning (failed payment) | Missing | Stripe/Paddle map `payment_failed` events (StripePaymentAdapter.ts:184) but no handler processes them. `PAST_DUE` status in enum but never set. No retry logic, no customer notification | Webhooks routed but not handled                |
| Invoice history          | Missing | No `Invoice` model in Prisma schema. No `/invoices` endpoint. Clients redirected to Stripe/Paddle portal via `GET /api/billing/portal`                                                   | No native invoice system                       |
| Cancellation flow        | Partial | `GatewayBillingService.ts:274-337` handles cancellation. Supports immediate and period-end. Email only sent for gateway-switch cancellations (L321-326)                                  | No email for regular subscription cancellation |

## 4. Communication

| Feature                       | Status  | Evidence                                                                                                                                                                                                       | Gap                                                 |
| ----------------------------- | ------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------- |
| Welcome email on registration | Partial | `accountLifecycleService.ts:144-146` has placeholder: "Future: integrate email service". `RegisterCustomerUseCase.ts` sends no email                                                                           | Stub only — not implemented                         |
| Email templates inventory     | Partial | 5 templates in `emailTemplates.tsx`: approvalRequested, approvalDecision, taskAssigned, mention, passwordReset. + referralRewardEmail.tsx. Only 3 actually called via `SendEmailNotificationService.ts:63-111` | taskAssigned and referralReward templates not wired |
| System announcements          | Missing | Maintenance page shows queue health only. No admin-to-client broadcast mechanism. `NotificationBroadcaster.ts` is SSE for logged-in users, not system announcements                                            | No announcement/downtime communication              |

## 5. Security

| Feature            | Status      | Evidence                                                                                                                                                                                            | Gap                                          |
| ------------------ | ----------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------- |
| CORS configuration | Implemented | `securityHeaders.ts:39-380` SecurityManager. `index.ts:266-280` registers @fastify/cors with explicit allowedOrigins, credentials=true, SameSite enforcement                                        | None                                         |
| Security headers   | Implemented | @fastify/helmet 13.0.1 registered. HSTS 1yr, X-Frame-Options: DENY, CSP, nosniff, Permissions-Policy. Custom headers via `addCustomHeaders()` L201-229                                              | None                                         |
| CSRF protection    | Partial     | `AdminSession.csrfToken` field (schema L175). Cookies set SameSite=strict, httpOnly, secure. Token generated on login. But no validation middleware found for CSRF token on state-changing requests | Token generated but enforcement unclear      |
| IP allowlist       | Partial     | `SecuritySettings.ipAllowlistEnabled` + `ipAllowlist` in schema (L2983-2984). Admin can configure via compliance routes. But no middleware enforces it — settings stored, never checked             | Feature dead — config saved but not enforced |
| XSS protection     | Implemented | `isomorphic-dompurify` in API. `inputValidation.ts:23-41` checks XSS patterns. `ServerTemplateEngine.ts` sanitizes via DOMPurify. CSP headers also applied                                          | Minor: not all input paths confirmed         |

## 6. Operations

| Feature                     | Status      | Evidence                                                                                                                                                                         | Gap                                                   |
| --------------------------- | ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------- |
| Sentry error tracking       | Missing     | Credential keys support `sentryDsn` in MONITORING group. But no @sentry packages installed in any app. No `Sentry.init()` call anywhere. Error handler does not export to Sentry | Schema-only — not integrated                          |
| Graceful shutdown           | Implemented | `index.ts:628-644` SIGINT handler: stops OutboxRelay, OutboxCleaner, SagaIntegration, Fastify, DB. Workers have matching SIGTERM handlers                                        | None                                                  |
| Database connection pooling | Partial     | `ConnectionManager.ts:14-39` has pooling config interface. Prisma handles pooling implicitly. No explicit `connectionLimit` in DATABASE_URL                                      | Relies on Prisma defaults — not explicitly configured |

## 7. Onboarding

| Feature                | Status  | Evidence                                                                                                                               | Gap                                           |
| ---------------------- | ------- | -------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------- |
| Admin first-run wizard | Missing | 0 files matching onboard/setup/wizard in admin app. Dashboard loads immediately, no setup detection                                    | No guided initial configuration               |
| Empty states (client)  | Partial | `EmptyState.tsx` in content library (7 files, 12 occurrences). Most app sections lack empty state guidance                             | Inconsistent — only content library covered   |
| Client onboarding flow | Missing | Registration creates account + trial + tokens, redirects to dashboard. No `isNewUser` flag, no `/onboarding` route, no setup checklist | Users skip to full dashboard with no guidance |

---

## PRIORITY GAPS

### CRITICAL

1. **IP allowlist not enforced** — Config stored in DB but no middleware reads it. Security feature is dead code.
2. **Dunning not implemented** — Payment failure webhooks routed but unhandled. No retry, no PAST_DUE transition, no customer notification. Revenue loss risk.

### HIGH

3. **Sentry not integrated** — No error tracking in production. Credential support exists but no SDK installed or initialized.
4. **Welcome email missing** — New customers get no email. Placeholder only in accountLifecycleService.
5. **Client onboarding absent** — New users land on full dashboard with no guidance. No setup checklist, no first-run wizard.
6. **Invoice history missing** — No Invoice model. Clients must use external Stripe/Paddle portal.

### MEDIUM

7. **Session timeout hardcoded** — DB SecuritySettings.sessionTimeoutMinutes ignored. Admins can't change timeout without code deploy.
8. **CSRF token not validated** — Token generated in sessions but no middleware verifies it on mutations. SameSite=strict mitigates partially.
9. **Cancellation email missing** — Only gateway-switch cancels send email. Regular subscription cancellation is silent.
10. **User invitation no email** — Team invite creates DB record only. Invited user never notified.
11. **Admin first-run wizard missing** — New admin deployments have no guided setup.

### LOW

12. **User avatar missing** — No profile picture field in any user model.
13. **Timezone/locale not editable** — Fields exist in DB but no update endpoint.
14. **Email templates partially wired** — taskAssigned and referralReward templates exist but aren't called.
15. **Empty states inconsistent** — Only content library has empty state component.
16. **DB pooling implicit** — No explicit connectionLimit configuration.
17. **System announcements missing** — No admin broadcast mechanism for downtime communication.

---

## RECOMMENDED SPRINT GROUPINGS

### Sprint SEC-FIX (Security Hardening) — CRITICAL

- IP allowlist middleware enforcement
- CSRF token validation middleware
- Sentry SDK installation + init in API/workers/admin/client

### Sprint BILLING-V2 (Billing Completeness) — CRITICAL/HIGH

- Dunning handler (payment.failed webhook to PAST_DUE transition to retry to notification)
- Invoice model + API endpoints + client UI
- Cancellation email for regular subscriptions

### Sprint ONBOARD (Onboarding & Communication) — HIGH

- Welcome email on client registration
- Client onboarding flow (setup checklist, connect providers, first post)
- Admin first-run setup wizard
- Wire remaining email templates (taskAssigned, referralReward)

### Sprint UX-POLISH (User Experience) — MEDIUM/LOW

- Session timeout from DB SecuritySettings
- Team invitation email
- User avatar field + upload
- Timezone/locale preference editing
- Empty states across client app
- System announcement mechanism
