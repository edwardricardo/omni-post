# Sprint SETTINGS-B Report — Admin Settings UI

**Date:** 2026-04-14
**Branch:** Genesis
**Commit:** d0e3537

## Objective

Build the admin portal UI for platform settings management, consuming the REST endpoints created in Sprint SETTINGS-A.

## Deliverables

### New Files (13)

| File                                                | Lines | Purpose                                                     |
| --------------------------------------------------- | ----- | ----------------------------------------------------------- |
| `apps/admin/hooks/api/useSettings.ts`               | 176   | 6 TanStack Query hooks (status, group CRUD, test, rotation) |
| `apps/admin/components/settings/constants.ts`       | 107   | CREDENTIAL_KEYS, NON_SECRET_KEYS, buildFieldDefs() helper   |
| `apps/admin/components/settings/CredentialForm.tsx` | 153   | Core reusable credential form with masked values + test     |
| `apps/admin/components/settings/OverviewTab.tsx`    | 100   | Health dashboard with clickable group cards                 |
| `apps/admin/components/settings/GatewaysTab.tsx`    | 35    | Stripe + Paddle credential forms                            |
| `apps/admin/components/settings/EmailTab.tsx`       | 29    | Resend credential form                                      |
| `apps/admin/components/settings/AiTab.tsx`          | 29    | AI provider pool credential form                            |
| `apps/admin/components/settings/StorageTab.tsx`     | 29    | S3-compatible storage credential form                       |
| `apps/admin/components/settings/PlatformTab.tsx`    | 29    | Platform identity settings                                  |
| `apps/admin/components/settings/MonitoringTab.tsx`  | 29    | Sentry monitoring settings                                  |
| `apps/admin/components/settings/SocialTab.tsx`      | 93    | 11 social providers in collapsible sections                 |
| `apps/admin/components/settings/SecurityTab.tsx`    | 91    | Encryption key rotation with confirm dialog                 |
| `apps/admin/app/(dashboard)/settings/page.tsx`      | 122   | Settings page with 9 tabs + superadmin guard                |

### Modified Files (3)

| File                                          | Change                                       |
| --------------------------------------------- | -------------------------------------------- |
| `apps/admin/components/shared/SidebarNav.tsx` | +Settings2 icon, +configuration nav group    |
| `apps/admin/messages/en.json`                 | +155 lines: settings translations + nav keys |
| `apps/admin/messages/es.json`                 | +155 lines: settings translations + nav keys |

## Architecture

```
Settings Page (superadmin only)
├── OverviewTab          → useSettingsStatus()
├── GatewaysTab          → 2x CredentialForm (STRIPE, PADDLE)
├── EmailTab             → CredentialForm (RESEND)
├── AiTab                → CredentialForm (AI_POOL)
├── StorageTab           → CredentialForm (STORAGE)
├── SocialTab            → 11x Collapsible > CredentialForm (lazy-mount)
├── PlatformTab          → CredentialForm (PLATFORM)
├── MonitoringTab        → CredentialForm (MONITORING)
└── SecurityTab          → useRotateEncryption() + ConfirmDialog
```

**CredentialForm** is the single reusable component — all tabs compose it with different group + fields. It handles:

- Fetching masked current values via `useGroupSettings(group)`
- Editing with local state (only sends modified fields)
- Save via `useUpdateGroupSettings()` with toast feedback
- Connection test via `useTestConnection()` with inline result display

## Key Decisions

1. **Lazy-mount social forms**: SocialTab uses `{open && children}` in Collapsible, so TanStack queries only fire when a section is opened (avoids 11 parallel requests).

2. **Constants mirror**: `constants.ts` mirrors `apps/api/src/settings/credentialKeys.ts` on the frontend. `buildFieldDefs()` builds typed field arrays from group + i18n translator.

3. **Superadmin guard**: Client-side check via `useCurrentUser().isSuperAdmin` + API-level 403 fallback via `isPermissionDenied(error)`.

4. **exactOptionalPropertyTypes**: All optional props include `| undefined` in type to comply with strict TypeScript config.

## Verification

- TypeScript: 0 errors (excluding pre-existing geist/font module issue)
- ESLint + Prettier: passed via pre-commit hooks
- i18n: both en.json and es.json validated as valid JSON
- 16 files committed, 1,371 lines added
