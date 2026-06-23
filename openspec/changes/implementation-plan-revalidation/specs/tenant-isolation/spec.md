# Tenant Isolation — Specification (§2A confirmed-fix end state)

> The END STATE every CONFIRMED §2A IDOR fix MUST satisfy. Authored as the
> fixed-state contract for Phase A; each requirement applies ONLY to leads that
> Phase A confirmed. Refuted leads are recorded not-a-defect and acquire no
> requirement. RFC 2119 keywords are normative.

## Requirements

### Requirement: Project-scoped reads and writes assert caller tenant

Every accountId-scoped read/write on a project-scoped entity (the root-cause
class `ARCH-PROJECT-SCOPED-GUARD-GAP`) MUST assert the caller's tenant via
`callerAccountId` before returning or mutating data. The system MUST NOT rely on
ad-hoc per-route checks; the gate MUST be consistent across list, get, update,
and delete. Cross-tenant access MUST return not-found or forbidden — never the
other tenant's data.

#### Scenario: Cross-tenant get is denied

- GIVEN a resource owned by tenant A and a caller authenticated as tenant B
- WHEN tenant B requests get/update/delete on that resource by id
- THEN the system returns not-found or forbidden and performs no mutation

#### Scenario: Unscoped list is tenant-filtered

- GIVEN posts exist for multiple tenants
- WHEN a caller lists posts without a projectId filter
- THEN only the caller's own tenant rows are returned

### Requirement: Posts subsystem is tenant-gated

`GET /posts`, `GET/DELETE /posts/:id`, list-by-projectId, and `DeletePostUseCase`
MUST enforce a `callerAccountId` owner gate. `GET /posts` MUST NOT enumerate all
tenants' posts (IDOR-POSTS).

#### Scenario: Delete of another tenant's post fails

- GIVEN post P owned by tenant A
- WHEN tenant B calls `DELETE /posts/P`
- THEN the delete is rejected and P remains intact

### Requirement: Accounts subsystem checks token accountId

`/accounts/*` get/list/update/delete MUST verify the token `accountId` against
the target, blocking cross-tenant CRUD. `updateAccount` MUST NOT let a customer
raise `maxProjects` (billing-quota tamper).

#### Scenario: Quota tamper is rejected

- GIVEN a customer-role caller on their own account
- WHEN they submit an `updateAccount` raising `maxProjects`
- THEN the field change is rejected

### Requirement: Analytics, TrackedLink, ScheduledReport, Notifications, Recurring, Comments are tenant-isolated

Each surface MUST enforce tenant ownership: analytics `GET /analytics/project/:projectId`
gets a preHandler and `getDashboard` verifies `accountId` ownership (and routes
through a port, not `this.prisma`); TrackedLink, RecurringPost, and Comments get
tenant isolation; ScheduledReport rejects cross-tenant access and attacker-chosen
`recipients`; `POST /notifications` rejects arbitrary `recipientId`; Comments
reject `authorId`/`editorId` spoof from the request body.

#### Scenario: Per-surface cross-tenant access denied

- GIVEN a resource on each listed surface owned by tenant A
- WHEN tenant B accesses it (read, write, or inject)
- THEN access is denied and identity fields from the body are ignored in favor of the authenticated principal

### Requirement: Each confirmed fix has a regression test under CI

Every confirmed §2A fix MUST ship with a regression test asserting cross-tenant
denial, and that test MUST execute in CI (coupled to §2G — see write-path spec).

#### Scenario: Regression test runs in CI

- GIVEN a confirmed IDOR fix merged
- WHEN CI runs on the PR
- THEN the cross-tenant denial test executes and must pass for the gate to be green
