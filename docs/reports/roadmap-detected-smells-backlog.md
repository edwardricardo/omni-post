# Roadmap — Detected Smells Backlog

Living, trackable log of smells / anti-patterns / dead-code detected
**during** a roadmap task but **outside that task's scope**. Findings are
neither fixed inline (anti-churn) nor hidden (anti-time-bomb): they are
recorded here with a pending verdict and closed in a dedicated cleanup
sweep **after all phases are complete**.

Process:

- A finding outside the current task's scope → add an entry here, mention
  it, continue the task strictly scoped. New code still follows current
  canon so no new time bombs are introduced.
- After **Fase 0** closes: revisit the code from the Bloque B iterations
  and feed this backlog with findings.
- The **cleanup sweep** runs after **all phases** close, item-by-item,
  with the 3-question filter (origin + purpose + duplication) and an
  explicit verdict (FIX / DEFER / WONT_FIX).

Verdict legend: `PENDING` (not yet adjudicated) · `FIX` · `DEFER` ·
`WONT_FIX`.

| ID      | Origin         | Description                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | Original purpose                                                        | Verdict | Close phase                                |
| ------- | -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- | ------- | ------------------------------------------ |
| SMELL-1 | F0-API-1 recon | Old integration tests use the skip-if-API-down anti-pattern (`apps/api/tests/integration/crisisRoutes.test.ts` et al.: `console.log("⚠️ … will be skipped")` + early return) instead of the fail-loud canon used by `sagaCustomerFlow.test.ts` (`assert.ok(apiAvailable, …)`). Effect: green CI that silently tested nothing — a latent time bomb.                                                                                                                                                | Defensive test scaffolding from before the fail-loud canon was adopted. | PENDING | Post-fases sweep                           |
| SMELL-2 | F0-API-1 recon | `apps/api/src/custom-reports/customReportRoutes.ts:getAccountId()` casts `request as unknown as Record<string, unknown>` to read `request.user?.accountId` instead of the typed `request.customerUser?.accountId` exposed by `requireClientAuth`. Untyped accessor; inconsistent with the canonical customer-auth shape.                                                                                                                                                                          | Legacy accessor predating the typed `CustomerRequestUser` augmentation. | PENDING | Post-fases sweep                           |
| SMELL-3 | F0-CLI-1 recon | Repurpose variant approve/reject UI was removed from `apps/client/app/dashboard/ai/repurpose/page.tsx`: it was wired to the generic `/api/backend/approvals/:id/:action` endpoint (not repurpose-specific) and assumed a nested `variants[]` shape the real DTO does not carry. It is a forgotten-feature — a proper repurpose approve/reject API (deferred in F0-API-1; `ApproveRepurposeVariantUseCase`/`RejectRepurposeVariantUseCase` already in DI, no routes) plus its UI is a future task. | Scaffolded variant-management UI ahead of its backend contract.         | PENDING | Future repurpose-approve task / post-fases |
| SMELL-4 | F0-CLI-1 recon | AI sub-pages (`/dashboard/ai/optimizer`, `/ai/trends`, `/ai/repurpose`, `/ai/templates`, `/ai/analytics`) are not reachable from the dashboard sidebar — the nav has a single `AI` entry pointing only at `/dashboard/ai/generate` (`apps/client/app/dashboard/layout.tsx`). Global, pre-existing information-architecture gap, not repurpose-specific.                                                                                                                                           | Sidebar predates the AI sub-page expansion.                             | PENDING | Post-fases sweep                           |

## Notes

- F0-API-1's own new code follows the fail-loud canon
  (`tests/integration/repurposeRoutes.test.ts`) and the typed
  `request.customerUser` accessor — it does **not** reproduce SMELL-1 or
  SMELL-2.
- This backlog is fed continuously; absence of an entry is not evidence
  of absence — the Bloque B revisit (post-Fase 0) is a scheduled pass.
