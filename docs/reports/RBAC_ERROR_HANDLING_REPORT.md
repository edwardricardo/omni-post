# RBAC Error Handling Report

Date: 2026-04-09

## Components Created

| File                                            | Purpose                                                                             |
| ----------------------------------------------- | ----------------------------------------------------------------------------------- |
| `apps/admin/lib/parseApiError.ts`               | ApiError class + `getErrorMessage`, `isPermissionDenied`, `parseApiError` utilities |
| `apps/admin/components/shared/AccessDenied.tsx` | Reusable 403 page component with i18n, icon, dashboard link                         |

## API Client Updated

`apps/admin/lib/apiClient.ts` — `http()` now throws `ApiError.fromResponse(status, body)` instead of `new Error(\`HTTP ${status}: ${text}\`)`. All callers automatically receive structured errors.

## Pages Updated (10 pages)

| Page                     | Before              | After                                            |
| ------------------------ | ------------------- | ------------------------------------------------ |
| `(dashboard)/page.tsx`   | Raw `error.message` | AccessDenied on 403, `getErrorMessage` otherwise |
| `accounts/page.tsx`      | Raw `error.message` | AccessDenied on 403, `getErrorMessage` otherwise |
| `analytics/page.tsx`     | Raw `error.message` | AccessDenied on 403, `getErrorMessage` otherwise |
| `compliance/page.tsx`    | Raw `error.message` | AccessDenied on 403, `getErrorMessage` otherwise |
| `logs/page.tsx`          | Raw `error.message` | AccessDenied on 403, `getErrorMessage` otherwise |
| `pricing/page.tsx`       | Raw `error.message` | AccessDenied on 403, `getErrorMessage` otherwise |
| `security/page.tsx`      | Raw `error.message` | AccessDenied on 403, `getErrorMessage` otherwise |
| `subscriptions/page.tsx` | Raw `error.message` | AccessDenied on 403, `getErrorMessage` otherwise |
| `users/page.tsx`         | Raw `error.message` | AccessDenied on 403, `getErrorMessage` otherwise |
| `webhooks/page.tsx`      | Raw `error.message` | AccessDenied on 403, `getErrorMessage` otherwise |

## Components Updated (5 components)

| Component                  | Before                               | After                                             |
| -------------------------- | ------------------------------------ | ------------------------------------------------- |
| `AccountBillingPanel.tsx`  | `{error.message}`                    | `{getErrorMessage(error)}`                        |
| `RbacManager.tsx`          | `setError(err.message)` + raw toast  | `setError(getErrorMessage(err))` + friendly toast |
| `MfaManager.tsx`           | `setError(err.message)` + raw toast  | `setError(getErrorMessage(err))` + friendly toast |
| `MfaSelfService.tsx`       | `err.message` in 3 toasts            | `getErrorMessage(err)`                            |
| `WebhookSubscriptions.tsx` | `setError(err.message)` in 4 catches | `setError(getErrorMessage(err))`                  |

## Hooks Updated (3 hooks)

| Hook                         | Before                                               | After                                                     |
| ---------------------------- | ---------------------------------------------------- | --------------------------------------------------------- |
| `useChangePassword.ts`       | `throw new Error(err.message)` + `err.message` toast | `throw ApiError.fromResponse()` + `getErrorMessage` toast |
| `useResetAccountPassword.ts` | `throw new Error(err.message)` + `err.message` toast | `throw ApiError.fromResponse()` + `getErrorMessage` toast |
| `useQueueManagement.ts`      | `err.message` in toast                               | `getErrorMessage(err)` in toast                           |

## Mutation Error Handlers Updated (~30 catch/onError blocks)

All across: accounts page (3), users page (4), pricing page (3), ProviderTiersTab (3), AccountTiersTab (3), CreateRoleDialog (1), RbacManager (4), MfaManager (1), PermissionGrid (1), WebhookEventsList (1), DeadLetterQueue (3), ScheduledJobsPanel (1), ProjectProvider (1).

## Error Messages Now Shown

| Error Code / Status     | User Sees                                           |
| ----------------------- | --------------------------------------------------- |
| 403 / PERMISSION_DENIED | "You don't have permission to perform this action." |
| 401 / TOKEN_EXPIRED     | "Your session has expired. Please log in again."    |
| 404 / NOT_FOUND         | "The requested resource was not found."             |
| 429 / RATE_LIMITED      | "Too many requests. Please wait a moment."          |
| 500+                    | "An unexpected error occurred. Please try again."   |
| Generic                 | "Something went wrong. Please try again."           |

## i18n Added

Namespace `errors` added to both `messages/en.json` and `messages/es.json` with 7 keys:
permissionDenied, permissionDeniedDescription, permissionDeniedAction, serverError, unknownError, goBack, goToDashboard.

## Verification

- Build: 0 TypeScript errors
- Raw `err.message` in UI code: 0 (excluding parseApiError internals, error boundary, auth SSR, tests)
- Pages with AccessDenied: 10/10
- AccessDenied component: exists
- parseApiError utility: exists
