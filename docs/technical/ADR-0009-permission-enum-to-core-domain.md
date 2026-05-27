# ADR-0009: Promote `Permission` enum to `@core/domain/auth/`

- **Status**: Accepted
- **Date**: 2026-05-27
- **Deciders**: Platform engineering
- **Supersedes**: —
- **Superseded by**: —

## Context

Until S4.4 the `Permission` enum lived in
`apps/api/src/auth/rbacService.ts` (~22 string-valued members:
`USER_READ`, `BILLING_MANAGE`, `AUDIT_READ`, etc.). It was imported by
**28 consumer files** across admin routes, billing routes, compliance
routes, middleware, saga, and the RBAC infrastructure itself.

Two structural problems:

1. **Wrong layer for a domain concept.** `Permission` is canonical
   domain knowledge: it appears in audit log rows on the wire, in
   `RolePermission` table rows, and in admin-facing config. It is
   NOT a Fastify concern. Yet it sat in an `apps/api` module
   (`rbacService.ts`) that carries Fastify cache adapter wiring and
   audit helpers.
2. **Blocked the `roleManagementService` move to `@core/application`
   (S4.4).** `roleManagementService.ts` was `@layer application` but
   imported `Permission` from a sibling `@layer infrastructure` file
   — a layer-direction violation. We could not relocate the service
   to `@core/application/auth/` without either:
   - (a) moving `Permission` to `@core/domain/auth/`, or
   - (b) inlining the enum at the use-case site (loses the single
     source of truth).

We chose (a) during the S4.4 commit (`ee8d4a0`).

## Decision

**Promote `Permission` to `packages/core/domain/src/auth/Permission.ts`.
Keep `rbacService.ts` in `apps/api/src/auth/` (it stays as the
infrastructure-side service with Fastify/cache wiring) without a
re-export shim — every consumer imports directly from
`@core/domain/auth/Permission.js`.**

### S5 burn-down

Initial S4.4 commit added a re-export shim
(`export { Permission }`) in `rbacService.ts` so the 28 existing
imports kept resolving. S5 (`1734890`) burned down the shim:
sed-batched repoint of all 28 consumers from
`./rbacService.js` / `../auth/rbacService.js` /
`../../auth/rbacService.js` → `@core/domain/auth/Permission.js`, then
deleted the re-export.

### Companion change

`rbacService.ts` `@layer` tag flipped from `application` to
`infrastructure` (S5) — it stays in apps/api with infra-flavored
wiring; the canon promotion is the enum, not the service.

## Rationale

1. **Single source of truth where it canonically belongs.**
   `Permission` is referenced on the wire (audit logs,
   `RolePermission` rows) and in admin config. `@core/domain` is the
   natural home — it's exposed without any infrastructure leak.
2. **Unblocks `RoleManagementService` move.** S4.4 relocated
   `roleManagementService` to `@core/application/auth/`; it could
   import `Permission` directly from `@core/domain/auth/Permission.js`
   without violating the layer direction.
3. **Decoupled from Fastify cache infrastructure.** Test code can
   import `Permission` without booting `RbacService` /
   `CachePort` / `AdminUserRepository`.
4. **Burn-down (S5) eliminates the shim.** The temporary re-export
   in S4.4 was deliberate to avoid breaking 28 consumers in one
   commit. S5 closed the loop: all 28 import directly, no
   structural hint that `Permission` ever lived elsewhere.

## Alternatives Considered

- **Inline `Permission` at each consumer site** (just use string
  literals in route preHandlers). Rejected: loses the single source
  of truth, makes RBAC config audit nearly impossible.
- **Keep `Permission` in `apps/api`, copy it into
  `roleManagementService.ts` as a private const.** Rejected: same
  issue as above + dual definition inevitably drifts.
- **Move BOTH `Permission` AND `RbacService` to `@core/application/
auth/`.** Considered. Rejected: `RbacService` has heavy Fastify-
  adjacent wiring (CachePort namespace, audit emitter, request-
  context-aware checks) that doesn't belong in a framework-free
  application layer. Splitting `Permission` (domain) from
  `RbacService` (infrastructure) was the cleaner cut.

## Consequences

**Positive**

- `Permission` is reachable from `@core/application/auth/` use cases
  without layer-direction violation.
- 28 consumer imports converge to a single canonical path
  (`@core/domain/auth/Permission.js`).
- No re-export shim in `rbacService.ts` after S5 — codebase has zero
  back-compat layer for this enum.
- `roleManagementService` successfully moved to `@core/application/
auth/RoleManagementService.ts` (S4.4 commit `ee8d4a0`).

**Negative / costs**

- One-time sed-batch over 28 files (S5 commit `1734890`).
- Devs accustomed to `import { Permission } from ".../rbacService.js"`
  must learn the new path — usually IDE auto-import handles it.

## Revisit if

If the customer-side ever introduces a parallel
`CustomerPermission` enum (currently only admins have RBAC
permissions in this system), we revisit whether to consolidate or
keep them separate. Customer permissions today are coarser-grained
(roles like `OWNER`, `EDITOR`, `VIEWER` per project), not the fine-
grained admin `Permission` enum.

## Risks and Mitigations

| Risk                                                                   | Mitigation                                                                                                                                                                                          |
| ---------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Future enum drift (someone redefines `Permission` locally)             | TypeScript will error on duplicate enum name; CI typecheck catches it.                                                                                                                              |
| Old import paths reappear after burn-down                              | sed-batch update of 28 consumers + ADR pin documenting the canonical path. Code review heuristic: `import { Permission }` from anywhere other than `@core/domain/auth/Permission.js` is a red flag. |
| Cascade rename of permission values (e.g., `USER_READ` → `USERS_READ`) | Permission values are strings used on the wire (audit logs, DB rows). Renames are SemVer-major and require backfill + DB migration. The enum-value strings are intentionally stable.                |

## References

- S4.4 commit `ee8d4a0` — relocation of `roleManagementService` +
  promotion of `Permission`
- S5 commit `1734890` — burn-down of the re-export shim
- OmniPost `docs/architecture/NORMALIZATION_ROADMAP.md §0.1` — the
  "@core/application boundary clean cut" tension
- ADR-0011 — application-services-to-core workstream closure
- File: `packages/core/domain/src/auth/Permission.ts`
- File: `apps/api/src/auth/rbacService.ts` (post-S5)
