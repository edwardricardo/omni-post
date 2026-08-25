# Proposal: Principal-derived authority

> Companion artifact: [`explore.md`](./explore.md) — 5 angles, 1 adversarial verification pass each, 31 claims refuted. Every defect below is re-verified there with file:line; this proposal re-derived every number it relies on against the tree at `main = 57374636`.

---

## 1. Why this change exists

**D4 — `GET /accounts` enumerates every tenant, and `DELETE /accounts/:accountId` destroys one. CRITICAL.**
`apps/api/src/accounts/accountRoutes.ts:188-192` runs `this.prisma.account.findMany({ orderBy, include: { projects: true } })` — **there is no `where` clause**. One request with any valid customer bearer token returns every tenant's account id, billing email, name, `maxProjects`, trial state, plus — through the nested `include` — every project row of every tenant. All five routes in the file carry `preHandler: [requireClientAuth]` and nothing else (`:359-408`). No isolation layer can rescue it: `Account` **is** the tenant, its key is `id`, not `accountId`, so it is structurally absent from `TENANT_SCOPED_MODELS` (`infra/prisma/src/extensions/tenantGuard.ts:91`; the guard passes through anything absent at `:195`), and the nested relation read rides along on the parent query uninspected because a Prisma query extension receives one `model` and mutates only `args.where` (`:186-219`). `PUT /accounts/:accountId` writes `name` and `maxProjects` by path param with no comparison to the principal. `DELETE /accounts/:accountId` (`:302-337`) resolves the _victim's_ project ids and then runs `postContent.deleteMany`, `postMedia.deleteMany` and `post.deleteMany` against them (`:314-328`) — all three models are outside the guard — before `channel.deleteMany` (which _is_ guarded, silently matches zero rows) and `account.delete` (`:335`), which then FK-fails. No transaction wraps the sequence. **Precondition: one valid customer JWT. Outcome: another tenant's posts, content and media are irreversibly gone and the caller gets a 500.**

**D1 — `GET /activity-feed` returns the entire `AuditLog` table to any authenticated customer. CRITICAL.**
`apps/api/src/audit/activityFeedRoutes.ts:79` registers it behind `requireClientAuth` alone; the file never references `request.customerUser`. `activityFeedService.ts:148-149` builds the base predicate as `{ success: true }` and `:114-122` executes `prisma.auditLog.findMany({ where, include: { user: {...} } })`. `auditLog` is deliberately outside the guard (`MULTI_TENANT_GUARDS.md:1227-1252`) and has no RLS policy. **The exploit is `GET /activity-feed` with no parameters at all.** What leaks: other tenants' account/project/post UUIDs, the action taxonomy (`Disabled MFA`, `Changed role`, `Generated API key`), and — via `include: { user: … }` — **AdminUser** id, name and email. Two traps this proposal is bound by: (a) the `accountId` query param is _not_ a tenant filter — `activityFeedService.ts:165-168` maps it to `where.resourceId` + `where.resource = "Account"`, so supplying it makes the result set _smaller_; (b) therefore feeding `principal.accountId` into that same slot is a **non-fix** that ships a near-empty feed with the leak intact. The real fix sets `where.accountId`, or routes through `AuditLogRepository.findByAccount`, which already exists and whose JSDoc already states "never from a client-supplied parameter". Two further facts make this a rebuild, not a scoping patch: the write path never populates the column for non-customer actors — `UserActionOptions` (`apps/api/src/services/AuditableService.ts:93-100`) has **no `accountId` field**; only `AccountActionOptions` (`:102-104`) adds it — so ADMIN/SYSTEM rows land NULL; and the reader joins only the AdminUser relation, so **a customer's own actions can never render an actor**. Root cause is written down as a feature: `MULTI_TENANT_GUARDS.md:1237-1243` lists `activityFeedService` among "5 **admin** readers" and concludes wrapping them would be "ceremonial". Its only route is behind `requireClientAuth`.

---

## 2. Scope, and what is deliberately out

**In scope**

| Item                                                                                                                    | Why it is here                                                                                                                                                                                                                         |
| ----------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D1 and D4, rebuilt (§4)                                                                                                 | The two owner-signed CRITICALs                                                                                                                                                                                                         |
| The mechanism — three legs (§3)                                                                                         | The class must be structurally unable to regrow; neither CRITICAL is closed by any one leg alone                                                                                                                                       |
| Fitness **#30** (actor from the wire), **#31b** (client scope with no principal awareness), new **#32** (brand forgery) | §7                                                                                                                                                                                                                                     |
| Repairing fitness **#23**                                                                                               | It has never fired once; the documented pipeline returns **0** while 16 raw-SQL sites exist (§7)                                                                                                                                       |
| The audit **write** path (`AuditableService.logUserAction`, `auditMiddleware.ts:77-92`)                                 | Without it D1's fix ships a correct and empty feed                                                                                                                                                                                     |
| Correcting `MULTI_TENANT_GUARDS.md:1227-1252`                                                                           | The canon currently certifies the leaking reader as an admin reader; leaving it standing re-breaks D1 at the next reading                                                                                                              |
| Deleting `apps/api/src/posts/optimizedPostsRoutes.ts`                                                                   | Never registered (the identifier appears only in its own `@file` header), accepts a required client `accountId`, and reaches raw SQL that bypasses the guard — it is the template for the class and it is what the #23 repair is _for_ |
| Deleting `apps/api/src/monitoring/rateLimitingDashboard.ts:120-215`                                                     | Five `/admin/*` routes with no `preHandler` at all. Inert (never instantiated), so deletion — leaving unauthenticated admin routes in a tree while the change is _about_ authorization is indefensible                                 |

**Deliberately out, each with its reason**

- **D2, D3, D5, D6, D7, D8, D10 — the immediate twin change.** These are actor-forgery defects (`changerMemberId`, `reviewerId`, `authorId`, `editorId`, `actorId`, `createdById`). They are mechanical field deletions **once the mint exists** — and only then. Doing them here means either landing them before the primitive (a patch that regrows) or doubling a diff that already carries two CRITICALs plus a guard rewrite. The twin change is not "later": it is the next change, and §7's #30 ratchet is its committed floor. **One ordering constraint travels with it and must be recorded in the twin's proposal, not lost here:** D7's invite escalation is capped _only_ while customer password reset is broken by a missing `withSystemContext`. Repairing that 500 in isolation — an obviously-correct bug fix — converts D7 into a full OWNER takeover.
- **D9 — `/health/tenant/:tenantId/project/:projectId`.** Formally out, but **this change forcibly closes it as a side effect** and cannot avoid doing so: `tenantParamPreHandler.ts:45` calls `enterTenantContext({ accountId: value })` with `request.params[paramName]`, and §3's seam makes that stop compiling. Its disposition (delete the route, or move it behind auth) is a decision this change must take rather than default — see §6, fork 3.
- **The Prisma nested-`include` gap — its own high-priority change.** `account.findMany({ include: { projects: true } })` leaks children because extensions never inspect relation reads. Scoping the _root_ to one row (§3 leg B) makes D4's specific include harmless; it does **not** close the class. Anyone reading "D4 is fixed" must not read it as "nested includes are fixed". That change's hard part is not traversal — it is knowing the tenant predicate per relation target, which is exactly what leg B's registry supplies, totally and compiler-enforced. Deferring it costs nothing and lands its missing input.
- **Enforcing the `relation` strategy on the ~37 owner-path models.** They are _classified_ here (the registry is total) but enforced under the in-flight `openspec/changes/project-scoped-tenant-guard/`, which already owns that surface. Naming a home is the condition: a `global` or unenforced entry in the registry carries a `reason` string and the owning change **in the entry itself**, so the debt lives in the executable artifact rather than in prose.
- **Collapsing the customer route surface onto a typed route factory (277 registrations across 58 files).** The gate's _declaration_ mechanism lands (§3 leg C); its _width_ does not. A several-thousand-line rewrite of every customer handler cannot be adversarially reviewed alongside two CRITICALs without one hiding the other.

---

## 3. The mechanism

### 3.0 How the panel resolved, and where it did not

Two lenses (structural irreversibility; buildability/provability) ranked **data-first** first. The third (canon fit + admin↔customer parity) ranked **middleware-first** first and put data-first second. That is a sharp disagreement and it is not a tie to be split — **it is a symptom that the class has two axes and each proposal solves one.**

- The tenant guard covers **scope** ("which rows") totally and **actor** ("who is acting, may they") not at all: D2/D3/D7 operate on rows where `accountId` already equals the caller's, so every row legitimately matches and the guard returns them forever.
- The principal/brand covers **actor** with an unforgeable type and cannot reach a query: `GET /accounts` has _no argument to brand_, and `/activity-feed`'s `accountId` maps to `where.resourceId`, so branding it is the ceremony the explore already killed (`explore.md` §1, killed-claims table).
- The route gate covers **declared authority** and, by its own honest admission, closes neither CRITICAL: `authorize.customer("audit:read")` is a perfectly valid declaration on a handler that still runs `prisma.auditLog.findMany({ where: { success: true } })`.

Both runner-up verdicts converge on the same graft, independently: judge 1 and judge 2 both arrived at "data-first's registry **plus** the brand at exactly one boundary — `enterTenantContext`". That is not a compromise; it is the seam that makes the registry's guarantee unconditional instead of "faithfully enforces whatever scope was bound, including an attacker's".

Two fatal flaws were named and are **answered, not papered over**:

- **Judge 3, against type-first leg 2:** putting `AccountScope` (declared in `apps/api/src/security/`) into `packages/core/domain/src/repositories/*` inverts the dependency direction and does not resolve — verified: `packages/core/domain/package.json` declares exactly one dependency, `@shared/types`. **Answer: the brand symbols live in `@shared/types`**, which `@core/domain` already depends on. The port signature change becomes legal; nothing crosses inward from `apps/api`.
- **Judge 1 & 2, against type-first leg 2's second half** ("ports with no unscoped sibling"): it is a one-time human audit the compiler cannot check — the exact shape that produced these defects. **Answer: that leg is not adopted.** Leg B covers it structurally: an unscoped `account.findMany()` is scoped by interposition regardless of which port, route or raw client issues it.
- **Judge 1, against middleware-first's boot-time wire-contract walk:** it only sees schemas hoisted into `routeOptions.schema`, and 497 of 499 routes keep validation inside the handler. **Answer: adopted with the missing rule** — the gate refuses at boot any `customer`- or `admin`-declared `POST`/`PATCH`/`PUT` with no declared body schema, so leaving Zod in the handler is itself a boot violation.

### 3.1 Leg A — the mint (identity)

`packages/shared/src/authority.ts` (new) declares two brands whose symbols are **`declare const`, not exported** — outside that module the type literal is unwritable, and `z.string().uuid()` (which infers `string`) and even Zod's own `.brand<"AccountScope">()` (a structurally different shape) both fail to satisfy it.

```ts
declare const scopeBrand: unique symbol;
declare const actorBrand: unique symbol;
export type AccountScope = string & { readonly [scopeBrand]: "AccountScope" };
export type ActorId = string & { readonly [actorBrand]: "ActorId" };
```

`apps/api/src/security/principal.ts` (new) holds the **only** cast sites, each immediately after signature verification, and exports one discriminated union:

```ts
export interface CustomerPrincipal {
  kind: "customer";
  actor: ActorId;
  scope: AccountScope;
  roleName: string;
  roleLevel: number;
  permissions: ReadonlySet<CustomerPermission>;
}
export interface AdminPrincipal {
  kind: "admin";
  actor: ActorId;
  permissions: ReadonlySet<Permission>;
} // NO scope field
export interface IntegrationPrincipal {
  kind: "integration";
  actor: ActorId;
  scope: AccountScope;
  keyId: string;
}
export type Principal = CustomerPrincipal | AdminPrincipal | IntegrationPrincipal;
```

`AdminPrincipal` carrying **no** `scope` is load-bearing twice: it makes "an admin route binds a tenant context" a compile error, preserving the asymmetry the explore flags as must-not-break; and it structurally kills the latent ADMIN-by-API-key path, because `integrationAuthMiddleware.ts:175` writes `role: "ADMIN"` into `request.user`, which `rbacMiddleware.ts:29-31`'s `resolveUser` reads — an `IntegrationPrincipal` cannot narrow to `AdminPrincipal`.

The decoration collapses into `apps/api/src/types/fastify.d.ts` as one **non-optional** `principal: Principal`, replacing `customerUser?` (declared, uniquely in the repo, from inside a middleware file at `customerAuthMiddleware.ts:29-33`), `auth?`, `user?`, and the three ad-hoc `request.user` redeclarations. Installed via Fastify's getter/setter decorator over a symbol slot, so an unauthenticated route that touches `request.principal` **throws** rather than reading `undefined`.

**Where a violation is caught:** `tsc`. **What it cannot catch:** `as unknown as AccountScope` — a brand is a type, not a capability. Policed by new fitness **#32** at a true hard-zero baseline of 0 (§7). It also cannot catch a _wrong-but-branded_ value: branding proves provenance, never correctness. Only §8's real-JWT integration proofs cover that.

Repo precedent, adopted rather than invented: the `AuditActor` discriminated union + factories (`AuditableService.ts:34-77`), whose own rationale is that "the invalid dual-FK combination cannot be constructed". `Principal` is `AuditActor` one layer up. Note explicitly what does **not** help and why the naive move was rejected: the repo _already_ has nominal ids — `AccountId extends EntityId` with a private constructor and protected members (`packages/core/domain/src/value-objects/EntityId.ts:23,152`), taken by 45 port parameter positions — and it catches nothing, because `AccountId.fromString` and `fromStringUnsafe` are **public statics** (`:160,170`). They brand _shape_, not _provenance_. The distinguishing property is not nominality; it is that the constructor set is a singleton behind token verification.

### 3.2 Leg B — the registry (scope)

`tenantGuardCheck` today consults `TENANT_SCOPED_MODELS: Set<string>` and returns unmodified for anything absent (`tenantGuard.ts:195`). **Absence means silence, so forgetting is the default state for every new model.** Replace the Set with a total classification keyed by the generated model union:

```ts
export type ScopeStrategy =
  | { kind: "column" } // accountId on the row
  | { kind: "column"; write: "global"; writeReason: string } // AuditLog: scoped reads, unfiltered writes
  | { kind: "tenantRoot" } // Account: the scope column IS `id`
  | { kind: "relation"; path: readonly [string, ...string[]] }
  | { kind: "global"; reason: string; owner?: string }; // declared, never defaulted

export const SCOPE_REGISTRY: Record<Prisma.ModelName, ScopeStrategy> = {/* 124 entries */};
```

`Prisma.ModelName` is generated (`infra/prisma/generated/prisma/client/internal/prismaNamespace.ts:386` const, `:513` type union). `Record<Prisma.ModelName, ScopeStrategy>` is therefore **exhaustive by construction**: add a model to `schema.prisma`, run `prisma generate`, and `tsc` fails until it is classified. This converts `SECURITY_CANON` §Multi-Tenant Isolation's three-step _prose_ checklist into a compile error. **No fitness grep is added for registry completeness, deliberately** — the compiler already does it, strictly better, and a regex cannot be defeated by a naming convention the way #1's original case-sensitive `*routes*` glob and #23's missing `\(` both were.

Two further corrections, both required by the strategies:

1. **Composition becomes `AND`, not key assignment.** Today the guard does `argsWithWhere.where = { ...where, accountId }` (`:215`). For a column-scoped model that is safe. For `tenantRoot`/`relation` it is not: `accountRoutes.ts:316` _already_ supplies `where.post`, and assigning over it would silently widen a targeted delete into a tenant-wide one. `args.where = { AND: [callerWhere, scopePredicate] }` is strictly safer than today's shape and is a stated precondition of the deferred nested-include change.
2. **Operation totality.** `GUARDED_OPERATIONS` (`:170`) is a second allowlist with a silent default (`:191`), and it omits `updateManyAndReturn` / `createManyAndReturn`, both of which the generated client emits. Invert it: enumerate the provably scope-free operations and **throw** on any unrecognised operation name for a non-`global` model, so a future Prisma release fails loudly on first use instead of bypassing quietly.

**Where a violation is caught:** `tsc` for classification; runtime throw/injection for queries. **Why it is unavoidable:** the extension is applied at exactly one site — `apps/api/src/infrastructure/container/setup.ts:61-64` — and the extended client is registered as `TOKENS.PrismaClient`, so all 22 files (16 of them route files) that hold a bare `container.resolve<PrismaClient>(TOKENS.PrismaClient)` — `accountRoutes.ts:355` included — are already querying through it. A developer who ignores every convention still goes through leg B. Its validity is formally coupled to fitness **#21** (no singleton import outside composition roots, currently hard-zero); say so in the canon.

**What it cannot catch:** intra-tenant defects, entirely (every row already matches the scope); nested `include`/`select`; raw SQL (30 sites / 8 files — see #23 in §7); `apps/workers`, which runs the **raw** client in its own composition root; parent-child ownership on create for relation-scoped models.

### 3.3 The seam — `enterTenantContext(AccountScope)`

This is the single most important line in the design and it is what makes leg B unconditional. There are **exactly three** production binders (verified, not inherited — the panel's "five" is wrong):

| Binder                                               | Scope derived from              | Trustworthy |
| ---------------------------------------------------- | ------------------------------- | ----------- |
| `apps/api/src/auth/customerAuthMiddleware.ts:70`     | verified JWT claim              | yes         |
| `apps/api/src/auth/integrationAuthMiddleware.ts:222` | verified API key → DB lookup    | yes         |
| `apps/api/src/security/tenantParamPreHandler.ts:45`  | **`request.params[paramName]`** | **no**      |

`enterTenantContext(context: { accountId: AccountScope })` makes the third **stop compiling**. Without this, a perfect data layer faithfully enforces an attacker's choice of tenant. Every remaining construction site is an explicit `as AccountScope` cast, grep-able to hard-zero.

**Coordination note:** ADR-0020 and the unarchived `openspec/changes/tenant-context-at-boundaries/` establish context at entry boundaries for pre-auth SSO, admin and background surfaces. Every new binder that change introduces must mint an `AccountScope`, not pass a string. Sequencing between the two changes is a design-phase input, not a proposal-level unknown.

### 3.4 Leg C — the gate (declared authority)

One encapsulated Fastify plugin, `apps/api/src/security/authorizationGate.ts`, that (a) refuses at boot to register a route in its scope without an authorization declaration and (b) **compiles that declaration into the route's preHandler chain**. `requireClientAuth` / `requireAdminAuth` stop being exported to route files and become gate internals, so `config.authorize` is the **only** door to a `Principal`. That is capability removal, not a lint.

```ts
export type AuthorizationDecl =
  | { kind: "public"; reason: PublicReason } // closed 5-value union
  | { kind: "admin"; permissions: readonly Permission[] }
  | { kind: "adminSelf" }
  | { kind: "customer"; permissions: readonly CustomerPermission[] }
  | { kind: "customerSelf" }
  | { kind: "integration"; scopes: readonly IntegrationScope[] };

declare module "fastify" {
  interface FastifyContextConfig {
    authorize?: AuthorizationDecl;
  }
}
```

Mechanics verified: `FastifyContextConfig` is declaration-mergeable (`fastify/types/context.d.ts:4`), `routeOptions.config` is already an established per-route channel in this repo (`authRoutes.ts:334,346,358`; `customerAuthRoutes.ts:501`), and `onRoute` is synchronous and fires before schema compilation, so violations are collected there and thrown **once, with the complete list, at `onReady`** — the process does not boot. A `denyUndeclared` preHandler (403) covers routes registered after `ready()` and makes the property assertable per-request.

**`requireCustomerPermission` is a TWIN of `requirePermission`, not an extension.** Three verified reasons: `resolveUser` reads `request.auth?.user ?? request.user` (`rbacMiddleware.ts:29-31`) while `requireClientAuth` writes `request.customerUser`, so pairing them yields an unconditional 401 — and the JSDoc directly above it (`:24-28`) asserts the opposite and is _false_; `requirePermission` gates on a flat role **string**, which is the ADMIN-by-API-key vector; and **the two vocabularies collide textually** — `Permission.ts:21,22,25,26,35,36` defines `account:read`, `account:manage`, `billing:read`, `billing:manage`, `analytics:read`, `analytics:export`, and the seeded customer vocabulary defines the same literals with different meaning (admin `account:manage` = manage _any_ account; customer `account:manage` = manage _my_ account). A single resolver over one string namespace would let an admin permission satisfy a customer gate. Do **not** mirror the admin side's `SUPER_ADMIN → true` wildcard as an `OWNER → true` bypass: the seeded OWNER set is explicit and includes `account:delete`, and a wildcard implicitly grants every future permission.

**No new port is needed.** `packages/core/domain/src/repositories/CustomerRoleRepository.ts` already exposes `getSnapshotById(roleId) → CustomerRoleSnapshot` with `permissions`, and its DI token is registered. The gate needs one thin service (a mirror of `rbacService.ts`'s `CachePort.getOrSet` shape) over the port that exists.

**Enrolment, and why it is not global.** The gate is encapsulated; this change enrols exactly the route plugins it rewrites. A global hook would need a ~484-entry exemption list, which is a suppression list in precisely the shape this project's canon forbids; an **enrolment** list has the inverse polarity — it asserts what _is_ enforced, it can only grow, and CI ratchets it. Equally: declaring a permission on 277 routes is 277 security decisions over a 58-string vocabulary, and a _wrong_ declaration is strictly worse than none, because the declaration becomes the artefact reviewers trust — which is exactly the failure that produced `RemoveTeamMemberUseCase.ts:18`'s declared-and-never-read `changerMemberId`.

Anti-degeneracy: `PublicReason` is closed at five values (`health`, `docs`, `webhook-signed`, `pre-identity-auth`, `oauth-callback`), two of them structurally asserted at boot (`pre-identity-auth` requires a `config.rateLimit`; `docs` requires a `/docs` url), so `public` cannot become the escape hatch that hollows the gate out.

**Where a violation is caught:** boot (`onReady` throw), request (403), CI (a grep for `preHandler:.*require(Client|Admin)Auth` outside the gate module keeps the bypass channel closed). **What it cannot catch:** a true declaration on a lying handler — this is the biggest one and it is why legs A and B exist; scope obtained from a header or a hand-parsed URL; relation-scoped object ownership (`POST /posts/:postId/comments` under `comment:create` is fully declared, fully authorized, and still needs the handler to prove ownership of `:postId` — that is what `getProjectAccess` and `resolveOwnedProject` are for); intra-tenant hierarchy, which is relational between two entities and lives correctly in `CustomerUser.updateRole`; anything outside the enrolled scope; every non-HTTP entry point.

### 3.5 Why the seams are sound

| Seam               | Enforced where                                                                                 | Property                                                                                                   |
| ------------------ | ---------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| A → B              | `enterTenantContext(scope: AccountScope)` — `tsc`                                              | B's input can only be a mint output. Removes B's one conditional guarantee.                                |
| A → C              | The gate compiles the only preHandler that mints a `Principal`; the middlewares are unexported | On enrolled routes, C is the only door to A.                                                               |
| B under everything | `setup.ts:61-64`, one wiring site, `TOKENS.PrismaClient`                                       | B holds for enrolled routes, unenrolled routes, services, and any future route, with no adoption required. |

The three legs fail differently on purpose: **substitution** (a client value in an authority parameter) → leg A, `tsc`; **omission** (no scope parameter at all — `account.findMany()` with no `where`; `{success:true}` as the entire predicate) → leg B, interposition; **undeclared authority** (a new route with a gate nobody chose) → leg C, boot. D1 and D4 are both _omission_ defects, which is why leg A alone closes neither and why the mechanism cannot be one leg.

---

## 4. The rebuilds

### 4.1 The activity feed — rebuilt, not scoped

`activityFeedRoutes.ts` and `activityFeedService.ts` are **deleted**. The service takes a raw `PrismaClient` (a `@layer` boundary violation), its scope axis is semantically wrong (`accountId → where.resourceId`), and it is **functionally incapable of its stated purpose**: `where.userId` (`:151-153`) filters the _admin_ actor FK and the `include` joins only `user`, never `customerUser`, despite the schema carrying both relations. A customer passing its own id gets zero rows; a customer's own actions render actor-less. The only identities the endpoint _can_ display are the ones it must never display. There is no reachable correctly-scoped call today, which is why scoping it is not on the table.

**What it should be** — `GET /account/activity`, a query-side use case over the port that already exists (`AuditLogRepository.findByAccount`, whose JSDoc already specifies "the caller is responsible for binding the `accountId` from the authenticated `TenantContext`, never from a client-supplied parameter"):

- Scope: `principal.scope`. There is no scope parameter on the wire, so there is nothing to forge.
- Authority: `authorize.customer("audit:read")` — **verified present in the seeded vocabulary**, alongside `audit:export`.
- Actor hydration branches on `actorType`: CUSTOMER rows hydrate the `customerUser` relation (the thing the endpoint was supposed to do and never could); ADMIN and SYSTEM rows render a non-identifying label. **Admin PII never crosses to a customer.**
- Explicit output whitelist. No `details.url` republication — `auditMiddleware.ts:77-92` writes the full request line including query string, and the current reader renders it as the row description.

**The write path (required, not optional).** `logUserAction` gains a **required** scope of type `AccountScope | SystemScope`, adopting the `AuditActor` shape at `AuditableService.ts:34-77` rather than inventing a second one, and `auditMiddleware.ts:77-92` threads it. Today `UserActionOptions` (`:93-100`) has no `accountId` field at all, so every ADMIN/SYSTEM row lands NULL and a reader-only fix ships an empty feed. Making the scope a decision the writer must state, rather than a default it falls into, is the same move the codebase already made one field over.

**Canon correction (`MULTI_TENANT_GUARDS.md:1227-1252`).** The paragraph's reason 2 lists `activityFeedService` among "5 admin readers" — its only route is behind `requireClientAuth` — and its reason 3 ("customer scope is opt-in") is the exact sentence that authorises a customer-facing reader to opt out. The rewrite records the registry's **asymmetric strategy**: `AuditLog` is scoped for **reads** (which excludes NULL-`accountId` rows by construction — the fail-closed property T3 needs) and **global for writes** (so ADMIN/SYSTEM actors with no bound context keep writing, and no audit write starts throwing). This answers the immutable-evidence canon on its own terms — evidence is never suppressed at write time — and reduces the "wrap the admin readers" cost to `withSystemContext("admin:audit-forensics")` on the four surviving admin readers. It amends a documented canon decision, so it carries an ADR (§6, fork 4).

### 4.2 Accounts — the customer surface deleted, "my account" rebuilt

**What authorization model replaces "any authenticated customer":** none of these are customer capabilities at all, except two, and those are keyed on the principal rather than on a path param.

| Today                                              | After                                                                                                                                                                                                                                                                           |
| -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /accounts` (`:188`)                           | **Deleted.** Cross-account enumeration has no customer meaning. `admin/accountLifecycleRoutes.ts` owns it, permissioned.                                                                                                                                                        |
| `POST /accounts`, `DELETE /accounts/:accountId`    | **Deleted.** Account creation and destruction are admin capabilities; the same file already owns them.                                                                                                                                                                          |
| `GET /accounts/:accountId`                         | `GET /account` → `GetMyAccountUseCase`, keyed on `principal.scope`. **No id in the URL** — the account is not an addressable dimension for a tenant. `authorize.customer("account:read")`.                                                                                      |
| `PUT /accounts/:accountId` (`:241,:257`)           | `PATCH /account` → `UpdateMyAccountUseCase`, **UoW-wrapped** (mandatory for mutating use cases), `authorize.customer("account:manage")`.                                                                                                                                        |
| `fastify.container.resolve<PrismaClient>` (`:355`) | Dies with the file. Routes resolve use cases only (`ARCHITECTURE_CANON` §Hexagonal). Note precisely: this trips neither fitness #1 nor #21 — both return 0 — because it resolves from DI rather than importing the singleton. The broken rule is prose with no regex behind it. |

Underneath, leg B's `tenantRoot` strategy makes this durable rather than merely correct-today: `Account` gets `where.id = scope` injected on every read/where operation, so a _future_ route that forgets returns exactly one row; and `account.delete` under a bound `TenantContext` is **refused by strategy** — deleting a tenant is not a tenant-scoped operation and is only expressible under `withSystemContext`. The untransacted four-`deleteMany` cascade goes with the route; it is why today's failure mode is partial irreversible destruction rather than a clean 403.

---

## 5. Parity scope

**Customer side (the enforcement layer — this is the gap the ledger records):**

- `CustomerPrincipal` arm of the union, non-optional, branded scope and actor.
- `requireCustomerPermission` + the `CustomerPermission` vocabulary, promoted from `infra/prisma/seed.ts` to `@core/domain/auth/CustomerPermission.ts` so a typo is a compile error rather than a permanently-denied route. This mirrors a documented in-repo precedent: `Permission.ts`'s own JSDoc records the identical promotion, verbatim.
- `GET /account` + `PATCH /account`, gated on `account:read` / `account:manage`.
- `GET /account/activity`, gated on `audit:read`.
- The gate enrolled on those two plugins.
- Frontend: any client call sites for the deleted account CRUD surface go with it. Leaving a client contract that says "the client tells the server who it is" while the server ignores it is a lie in the type surface.

**Admin side:**

- `AdminPrincipal` arm — **carrying no `scope`**, which closes the latent ADMIN-by-API-key at `integrationAuthMiddleware.ts:175` structurally.
- **`rbacMiddleware.ts:24-28` — the false JSDoc.** Merge-blocking. It is the artefact that made "customers have RBAC" look true from the middleware side; the next reader will otherwise re-derive the same wrong conclusion.
- `monitoring/rateLimitingDashboard.ts:120-215` — five ungated `/admin/*` routes, inert, deleted.
- `withSystemContext("admin:audit-forensics")` on the four surviving admin `AuditLog` readers, required by the registry flip.
- `withSystemContext` on the admin `Account` readers in `admin/accountLifecycleRoutes.ts`, required by the `tenantRoot` flip. This is not speculative: `docs/architecture/ADMIN_CUSTOMER_PARITY.md:114` (C16) already records that admin routes bind no tenant context and that nine admin service files issue guarded-model queries without one — "the largest single admin-side hole in the ledger".
- The `adminSelf` declaration category exists in the vocabulary from day one even though no admin file is enrolled here, because 20 admin routes need exactly that shape and inventing a fake permission for them later is how a vocabulary rots.

**Shared, one change serving both:** the audit write path. `auditMiddleware` and `AuditableService.logUserAction` are admin-dominated writers whose NULL-`accountId` rows are precisely what would make the customer read fail closed and empty.

**Essential asymmetries, justified:**

- `AdminPrincipal` has no `scope`; `requireAdminAuth` binds no tenant context. Admin is cross-tenant by construction, and a unified `Principal` must not "helpfully" bind one, or every admin read starts failing on tenant-scoped models.
- `withSystemContext` stays admin-only. There is no customer counterpart and there must never be one.
- Cross-account audit export (`auditRoutes.ts:352-364`, gated on `AUDIT_EXPORT`, including `ipAddress`, `userAgent`, `user.email`) has no customer twin. `audit:read` on the customer side is scoped by definition.
- Account create/list/delete are admin-only. Removing them from the customer surface is not a parity gap — it corrects a surface that should never have existed on that side.

---

## 6. Product decisions the owner must confirm

1. **Who may read the activity feed, and what does it show?**
   _Recommendation:_ rebuild as `GET /account/activity`, scoped to the principal's account, gated on the seeded `audit:read` (held by higher customer roles, not every member), showing the account's own actions with customer actors hydrated, admin/system actions as a non-identifying label, and no raw request URLs.
   _Consequence of the alternative (delete outright):_ also coherent — the endpoint has zero frontend consumers today — but it leaves a genuine parity gap on a capability customers legitimately need for self-service compliance, and the admin side already has the permissioned twin. **A decision is required either way; the current behaviour is not an option.**

2. **Is account administration a customer capability at all?**
   _Recommendation:_ **no.** Create, list and delete become admin-only (`admin/accountLifecycleRoutes.ts` already owns them). The customer side keeps only "my account" read (`account:read`) and update of `name` (`account:manage`).
   _Open sub-question the owner must settle:_ `maxProjects` is currently customer-writable through `PUT /accounts/:accountId` (`:257`). _Recommendation:_ it becomes admin-only — a tenant raising its own quota is a billing-boundary bypass, not a settings change. Consequence of keeping it customer-writable: the plan limit is advisory.

3. **Should an undeclared route fail closed at startup?**
   _Recommendation:_ **yes, within enrolled scope, in this change** — an undeclared route inside the gate's scope prevents boot with the offending method+url named. **No, not globally in this change** — a global hook needs a ~484-entry exemption list, which is a suppression list; enrolment is the inverse polarity and CI ratchets it toward global.
   _Direct consequence to accept:_ `/health/tenant/:tenantId/project/:projectId` (`index.ts:727-731`) has no honest declaration once `enterTenantContext` is branded — its only preHandler is a _context binder_, not authentication, and its tenant comes from a URL segment an unauthenticated caller writes. _Recommendation:_ delete the route. Alternative: move it behind admin auth and take the tenant from a body/query with an explicit ownership check. Doing nothing is not available — the seam breaks its compile.

4. **Amending the `AuditLog` canon decision (ADR required).**
   _Recommendation:_ adopt the asymmetric strategy — `AuditLog` reads scoped through the registry, writes global — and rewrite `MULTI_TENANT_GUARDS.md:1227-1252` accordingly, replacing the false "5 admin readers" claim.
   _Consequence:_ the four surviving admin readers must wrap in `withSystemContext`; the immutable-evidence rationale survives intact because it applies to writes.

5. **Does `TenantContextMismatchError` map to 403 in this change?**
   _Recommendation:_ **yes.** Once leg B is _the_ authorization decision for scope, its failure mode cannot remain a crash: `errorHandler.ts` has **zero** mappings for `TenantContextMismatchError` / `TenantContextMissingError` (verified), so every cross-tenant rejection is currently a **500 echoing both account ids** (`tenantGuard.ts:76`).
   _Consequence:_ ~14 routes change their observable failure from 500 to 403, and several red tests assert 403 rather than 500.

---

## 7. Fitness functions

**#30 — actor identity or attribution accepted from the request. RATCHET at 13, endpoint hard-zero at the twin change.**

The explore's alternation reproduces its stated baseline of 6 exactly (`ContentHandlers.ts:71`, `taskRoutes.ts:53`, `notificationRoutes.ts:52`, `teamRoutes.ts:26,39,43`). Its own "known miss" note is correct and I extended it: adding `authorId|reviewerId|editorId|deleterId|submitterId|recipientId` finds 7 more (`approvalRoutes.ts:30,37,42,47`, `notificationRoutes.ts:46`, `commentRoutes.ts:30,36`) — **new baseline 13**.

```bash
# 30. No actor/principal identity or attribution accepted from the request. A route that
# reads WHO IS ACTING from params/query/body lets any authenticated caller name a different
# — often higher-privileged — principal, and either inherit its authority or forge
# provenance the audit trail then records as fact (CWE-639 / CWE-863). The actor is ALWAYS
# derived server-side from the authenticated principal — the pattern already used at
# accountLifecycleRoutes.ts:141, adminUserRoutes.ts:206 and rbacRoutes.ts:280. Scope:
# apps/api/src — NOT a *[Rr]outes* glob, because ContentHandlers.ts is a handler module and
# would be missed (the same case-sensitivity class of miss that fitness #1's comment
# documents). The regex requires a Zod/IdSchema declaration on the same line, so it cannot
# match a domain field, a Prisma select or a DTO of the same name — only a field the HTTP
# layer accepts from the wire. Excludes tests. RATCHET at 13.
grep -rnE "(changerMemberId|changerId|actorId|createdById|createdBy|invitedBy|performedBy|changedBy|updatedById|requestedById|onBehalfOf|asUserId|authorId|reviewerId|editorId|deleterId|submitterId|recipientId):\s*(z\.|IdSchema)" \
  apps/api/src --include="*.ts" | grep -vE "/tests/|\.test\." | wc -l   # ratchet 13
```

**This is a ratchet, not a hard-zero, and the wording must say so.** All 13 hits live in the twin change's files; none is in `accountRoutes.ts` or `activityFeedRoutes.ts`. Under the owner-signed split, this change cannot move the number. Landing the check anyway is the point: it is a regression gate on day one (a _new_ actor field anywhere trips it) and a committed floor the twin ratchets down to zero against, rather than a number the twin invents for itself. Claiming hard-zero here would be false.

**#31b — client-supplied tenant scope on a customer-authenticated surface with no principal awareness. RATCHET: 12 → 9.**

Reproduced exactly, 12 files: `brand-voice/brandVoiceRoutes.ts`, `usage/usageRoutes.ts`, `posts/optimizedPostsRoutes.ts`, `projects/projectRoutes.ts`, `accounts/accountRoutes.ts`, `audit/activityFeedRoutes.ts`, `approvals/approvalWorkflowRoutes.ts`, `brand-kit/brandKitRoutes.ts`, `approvals/approvalRoutes.ts`, `ai/promptTemplateRoutes.ts`, `tasks/taskRoutes.ts`, `team/teamRoutes.ts`.

```bash
# 31b. A customer-authenticated route file that accepts `accountId` from the wire and NEVER
# reads the authenticated principal anywhere in the file. The conjunction removes the false
# positives: a file that reads the principal is at least aware it exists, and for ENROLLED
# models the tenant guard converts a mismatch into a throw rather than a leak. A model with
# no scope strategy on its own row (auditLog, account, post, postComment, approvalRequest,
# notification) has no such backstop. RATCHET per the #1/#21 precedent.
FILES=$(grep -rl "requireClientAuth" apps/api/src --include="*.ts")
for f in $(grep -lE "accountId:\s*(z\.|IdSchema)" $FILES); do
  grep -q "customerUser" "$f" || echo "$f"
done | wc -l   # 12 -> 9 when this change lands
```

Hard-zero is not achievable and is not claimed: the naive form has a 37-line / 14-file baseline with real false positives, and #31b's own inverse profile is that a file merely _mentioning_ the principal passes. This change deletes three of the twelve — `accounts/accountRoutes.ts`, `audit/activityFeedRoutes.ts`, `posts/optimizedPostsRoutes.ts` — so it lands at **9** on day one. Note that after leg A the conjunction's second term changes spelling (`customerUser` → `principal`); the check's wording must be updated in the same commit or it silently reports every migrated file as a violation.

**#32 — brand forgery. TRUE hard-zero, baseline 0** (the types do not exist yet, so this is the only genuinely clean hard-zero in the set).

```bash
# 32. No forged authority brands. AccountScope / ActorId prove PROVENANCE (the value came
# from a verified token), which a double assertion defeats — the brands must be exported to
# be usable, so the type system cannot police this and a grep must. The only sanctioned
# construction sites are the principal factory's post-verification casts. Excludes tests.
grep -rnE "as (unknown as )?(AccountScope|ActorId)\b" \
  apps/api/src apps/workers/src packages --include="*.ts" | \
  grep -vE "/security/principal\.ts|/tests/|\.test\." | wc -l   # expect 0
```

**Repairing #23 — the guard on the guard has never fired.**

The documented pipeline greps `\.\$(queryRaw|executeRaw|queryRawUnsafe|executeRawUnsafe)\(` — demanding a **parenthesis** that the tagged-template form never has. I ran the full documented pipeline including all four audited exceptions: **count = 0**. `.github/workflows/fitness.yml` mirrors the identical broken regex, so CI is equally blind. Repairing it to match both forms (`\$queryRaw|\$executeRaw`) under the same exception list yields **16**:

| File                                                                         | Sites | Disposition                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| ---------------------------------------------------------------------------- | ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/api/src/database/DatabaseOptimizer.ts`                                 | 12    | **Audit required, not deletion.** It has live consumers beyond the dead route (`posts/postsService.ts`, `infrastructure/container/setupServices.ts`), so deleting `optimizedPostsRoutes.ts` does _not_ remove it. Its tenant-scoped readers take `accountId` as a **parameter** (`:107,:141,:178`) — which after leg A must be `AccountScope`, and the remainder are global/operational (`ANALYZE`, pool stats, index metrics) and get explicit audited-exception entries |
| `apps/api/src/infrastructure/repositories/PrismaSemanticRetrievalAdapter.ts` | 2     | Audited exception with a documented tenant predicate, matching the disposition the existing four exceptions already carry                                                                                                                                                                                                                                                                                                                                                 |
| `apps/api/src/saga/SagaManagerLifecycle.ts`                                  | 1     | Audited exception (global saga machinery)                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `apps/api/src/infrastructure/outbox/OutboxClaimService.ts`                   | 1     | Audited exception (`SELECT FOR UPDATE SKIP LOCKED`, global outbox)                                                                                                                                                                                                                                                                                                                                                                                                        |

`CLAUDE.md` §"Extending the suite" requires `count = 0` on `main` before wiring, so the repair ships **with** the audited disposition for all 16 — that audit is the work, not the regex.

---

## 8. Success criteria

Properties, each asserted by a test. Cross-tenant proofs follow `channelTenantIsolation.test.ts` verbatim (real signed JWTs, **no auth mock**, doubled negatives: HTTP status _and_ absence of the foreign payload).

**Scope**

1. Under a bound tenant context, `account.findMany()` on the guarded client returns **exactly one row** — the caller's — asserted at the **data layer**, not through a route, so the property holds for routes that do not exist yet.
2. `account.delete` under a bound tenant context is **refused**; `withSystemContext` is the only path that reaches it.
3. A customer of tenant A calling any surviving account endpoint with B's id gets 403/404 — never 200, never 500 — **and B's posts, post content and post media still exist afterwards**.
4. Tenant A's activity feed contains no row whose `accountId ≠ A`, **including rows with `accountId = NULL`** (the fail-closed case that forces `where: { accountId: A }` rather than `NOT: { accountId: B }`).
5. Tenant A's feed contains no ADMIN-actor identity and no raw request URL, for any row.
6. Tenant A's feed **renders A's own actions with an actor** — impossible today, because the reader joins only the AdminUser relation. This is the honest signal that D1's scope bug and its actor-join bug are one fix.
7. `?accountId=<B>` returns rows _about_ B's Account entity, not B's tenant — written as a contract test on the parameter's misnaming, with a fixture that seeds `resource:"Account", resourceId:B, accountId:B`. **The obvious version of this test passes on vulnerable code** (see §9).

**Identity** 8. `enterTenantContext` cannot be called with an unbranded `string` — a type-level assertion (`expectTypeOf` / `@ts-expect-error`). The repo has **zero** type-test tooling today, so this is net-new discipline; vitest ships `expectTypeOf`. 9. Every audit row written through the production writer carries either an account scope or an explicit system scope — asserted over the **real writer**, not a fixture. `auditActorPolymorphism.integration.test.ts` (never collected, SMELL-75) is wired into the batch as a free win but does **not** pre-prove this: its own fixture supplies `accountId`.

**Authority** 10. An undeclared route inside enrolled scope makes `app.ready()` **reject**, with that route's method and url in the message. 11. A route declared `authorize.customer(P)` returns 403 for a principal lacking `P`, and 200 for one holding it — **the first intra-tenant authorization proof in the codebase.** All 18 existing isolation suites are cross-tenant and lean on a guard that by construction cannot see this boundary. 12. A `customer`-declared `POST`/`PATCH`/`PUT` with no declared body schema fails boot.

**Totality** 13. Adding a model to `schema.prisma` and running `prisma generate` fails `tsc` until it is classified in `SCOPE_REGISTRY` — pinned by a deliberate negative fixture in the registry's own suite. 14. `tenantGuardCheck` — already an exported pure function (`tenantGuard.ts:170`) with an existing unit suite — is tested **directly**: given (model, operation, args, scope), assert the resulting `where`. `AND` composition preserves a caller-supplied `where.post` rather than overwriting it.

**Collector discipline (applies to all of the above):** a missing path inside a multi-file batch is silently dropped and the batch exits 0 (SMELL-74), and a fully-skipped suite reports OK because `skip` never reaches `status` (SMELL-80). After appending suites, confirm the **collected count rose, with `TIER` set** — the zero-collection guard is inert otherwise.

---

## 9. Risks (implementation only)

**Tests that would go green for the wrong reason**

1. **The `?accountId=` case as commonly drafted.** Supplying the parameter _narrows_ the query to `{resource:"Account", resourceId:B}`, so a fixture seeding a plain CUSTOMER row for B makes "no B row returned" pass **on vulnerable code**. Highest-consequence trap in the plan: it is the one case that names the parameter, and as usually written it certifies the leak.
2. **All 8 cases in `apps/api/tests/unit/activityFeedService.test.ts`.** Every one constrains by `userId`, so the unscoped path never executes, and the mock's exact-equality filter honours whatever keys the SUT sends and invents none. Adding a second tenant to that fixture changes nothing. **Only a real-DB route test catches D1.**
3. **`apps/api/tests/unit/accountRoutes.test.ts`.** `"should list all accounts successfully"` is green _today asserting the enumeration hole_. ~28 cases across five `describe` blocks die with the file — budget deleting the suite alongside the source, not discovering it mid-implementation.
4. **Anything using `tests/unit/helpers/mockAuthMiddleware.ts`** (8 consumers). It never verifies signatures, defaults `roleName` to `"OWNER"` and `accountId` to `""`. A "VIEWER cannot…" permission test written against it silently runs as OWNER; worse, a route that _did_ correctly derive scope from the principal would scope to the empty string and still pass. The default cannot simply be changed. New authorization tests sign real customer JWTs.
5. **`apps/api/tests/unit/optimizedPostsRoutes.test.ts`** — exists, and likely pins the required-`accountId` shape of a route that is never registered. It goes with the file.
6. **Any suite silently dropped from a batch** — see the collector note in §8.

**Call-site migration hazards**

- **The decoration collapse is compiler-found, which is its safety property.** Deleting the optional `customerUser?` turns every read into a hard error: 105 `= request.customerUser` bindings across 24 files and 36 `customerUser?.accountId` across 12. The hazard is _not_ missing a site — `tsc` enumerates them. The hazard is that `tsc` proves the brand is **present**, never that it is on the **right** parameter; only §8's real-JWT proofs cover that.
- **The seam breaks `tenantParamPreHandler.ts:45` by design**, and with it `/health/tenant/:tenantId/project/:projectId`. That is fork 3 in §6. Leaving an explicit `as AccountScope` there instead would trip #32 and must not be the default resolution.
- **The `tenantRoot` flip taxes admin readers.** `requireAdminAuth` binds no tenant context, so every admin read of `Account` throws `TenantContextMissingError` unless wrapped in `withSystemContext`. This is not speculative — it is the recorded outcome of the `Channel` enrollment, and `ADMIN_CUSTOMER_PARITY.md:114` already names nine admin service files issuing guarded-model queries with no bound context as "the largest single admin-side hole in the ledger". Enumerate the `Account` and `AuditLog` admin readers **before** flipping, not after.
- **The RLS parity suite is MERGE-BLOCKING and the registry breaks its arithmetic.** `apps/api/tests/integration/rls-tenant-isolation.test.ts:138-172` asserts `pg_policies` count **equals** `getTenantScopedModels().size` and a 1:1 name mapping. Four strategies invalidate both. It must be rewritten strategy-aware (`column` ⇒ policy required; `tenantRoot` ⇒ its own policy shape, since `Account` has no `accountId` column; `relation`/`global` ⇒ an explicit "no layer-2, reason" entry). This is the best isolation asset in the repo and the rewrite is the correct place to encode the taxonomy — but it is real work, and it must land before any model flips.
- **One invariant is unproven and must be pinned first.** Does the extension survive into the `Prisma.TransactionClient` inside `PrismaUnitOfWork.executeInTransaction`? Every mutating use case runs there, and the UoW calls `$transaction` on the client resolved from `TOKENS.PrismaClient` — i.e. the guarded one — which makes it _likely_ but not proven. **One integration case, before anything else is built on it.** Assuming it is exactly the shape of assumption that produced these defects.
- **The audit write path has the widest blast radius in the slice.** Making the scope required on `logUserAction` touches every `AuditableService` subclass and `auditMiddleware`, i.e. the request path of every audited route in the app — and a throw there lands inside `setImmediate`, where the catch at `auditMiddleware.ts:93-96` swallows it. A defect degrades observability globally and silently.
- **`container.resolve<PrismaClient>` stays available** — 22 files, 16 of them route files. `Token = (typeof TOKENS)[keyof typeof TOKENS]` carries no type association, so the caller supplies `T` freely, and the type system cannot close it. Leg B makes it _harmless for scope_, which is the design intent; `eslint-plugin-boundaries` (already configured) is the right tool for closing it, at a non-zero baseline, as a ramp-down — **not** a hard-zero claim in this change.
- **The gate's boot-time shape walk depends on a Fastify internal.** `onRoute` firing before schema compilation is verified against 5.10.0 but is not a public contract. Pin it with the gate's own boot test so a framework bump fails loudly rather than silently defanging the wire-field check while the gate still reports green.
- **Hot-path tooling.** Edits under `apps/api/src/auth/**`, `apps/api/src/security/**` and `infra/prisma/src/extensions/tenantGuard.ts` trigger the full 4R fan-out at pre-PR, and the pre-edit tripwire blocker fires on tripwire #5 for `Principal` as a new bounded-context-crossing type — every such edit needs a `canon-check:` citation. Budget it; do not discover it.
