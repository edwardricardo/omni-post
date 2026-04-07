# Admin Bugs + i18n Migration Report

**Date:** 2026-04-05

---

## Bug Fixes

| Bug                              | Root Cause                                                             | Fix                                                                                  | Verified         |
| -------------------------------- | ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------ | ---------------- |
| Trial shows when isOnTrial=false | No bug — backend conditional spreading correct, frontend guard correct | Confirmed via code review                                                            | No change needed |
| Wrong order Last Login/Trial     | Last Login field missing from billing panel                            | Added `lastLoginAt` prop, displays between plan badges and trial info                | Visual           |
| Save button no feedback          | Missing `onError`/`onSuccess` toast handlers in tier mutation          | Added toast feedback on both success and error in ProviderTiersTab + AccountTiersTab | Toast shows      |

---

## i18n Migration

| Item              | Before                                    | After                                                |
| ----------------- | ----------------------------------------- | ---------------------------------------------------- |
| Library           | Custom React Context (`I18nProvider.tsx`) | next-intl 4.9.0                                      |
| Server support    | None (client-only)                        | `getMessages()` + `getLocale()` in Server Components |
| Client support    | `useTranslation()` custom hook            | `useTranslations()` from next-intl                   |
| Locale detection  | localStorage                              | `NEXT_LOCALE` cookie + `Accept-Language` header      |
| Language switcher | localStorage + React state                | Cookie + page reload                                 |
| Route structure   | No change needed                          | No `[locale]/` — uses `localePrefix: never` approach |

### Files created

- `apps/admin/i18n/request.ts` — next-intl server config with locale validation

### Files modified

- `apps/admin/next.config.mjs` — Added `createNextIntlPlugin` wrapper
- `apps/admin/app/layout.tsx` — `NextIntlClientProvider` replaces `I18nProvider`
- `apps/admin/components/shared/SidebarNav.tsx` — `useTranslations("nav")` + cookie-based switcher
- `apps/admin/app/(dashboard)/page.tsx` — `useTranslations("nav")`
- `apps/admin/app/(dashboard)/accounts/page.tsx` — `useTranslations("nav")` + passes `lastLoginAt` to billing panel
- `apps/admin/app/(dashboard)/subscriptions/page.tsx` — `useTranslations("nav")`
- `apps/admin/components/accounts/AccountBillingPanel.tsx` — Added `lastLoginAt` prop + display
- `apps/admin/components/pricing/ProviderTiersTab.tsx` — Added toast on save success/error
- `apps/admin/components/pricing/AccountTiersTab.tsx` — Added toast on save success/error
- `apps/admin/messages/en.json` — Expanded with `pages` namespace
- `apps/admin/messages/es.json` — Expanded with `pages` namespace

### Files deleted

- `apps/admin/providers/I18nProvider.tsx` — Replaced by next-intl
- `apps/admin/hooks/useTranslation.ts` — Replaced by `useTranslations` from next-intl

---

## Build: 0 errors, FULL TURBO
