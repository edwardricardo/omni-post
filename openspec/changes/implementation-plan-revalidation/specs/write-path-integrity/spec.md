# Write-Path Integrity — Specification (§2F + §2G confirmed-fix end state)

> The END STATE the confirmed §2F write-path fixes plus the §2G CI-gate
> requirement MUST satisfy. Applies only to leads Phase A confirmed. RFC 2119
> keywords are normative.

## Requirements

### Requirement: Publishing is idempotent (no double-post)

A crash between provider-OK and the OK-log MUST NOT re-publish the post on retry.
The publish path MUST be idempotent so a single scheduled post results in exactly
one provider publication (WRK-DOUBLE-POST).

#### Scenario: retry after partial success does not re-post

- GIVEN a publish where the provider succeeded but the process crashed before logging success
- WHEN the job is retried
- THEN no second provider publication occurs; the post is recorded published once

### Requirement: OAuth token refresh is wired into the publish flow

The publish flow MUST invoke the `OAuthTokenRefresher` so expired tokens are
refreshed before the provider call, with no double-refresh race. This is the
explicit precondition for F1-API-4 (Canva OAuth) (OAUTH-REFRESH-UNWIRED).

#### Scenario: expired token is refreshed before publish

- GIVEN a channel whose access token is expired but whose refresh token is valid
- WHEN a publish job runs
- THEN the token is refreshed and the publish proceeds with the fresh token

#### Scenario: concurrent publishes do not double-refresh

- GIVEN two publishes for the same channel with an expired token
- WHEN both run concurrently
- THEN the refresh executes without a double-refresh race (single effective refresh)

### Requirement: Channel is flagged for re-auth on credential failure

When a provider credential failure occurs during publish, the worker MUST set
`needsReauth` so the channel surfaces as broken instead of failing silently
(WRK-NO-REAUTH).

#### Scenario: credential failure flags re-auth

- GIVEN a publish that fails due to invalid/expired credentials with no refresh available
- WHEN the failure is handled
- THEN the channel is marked `needsReauth`

### Requirement: Saga persists accountId as accountId

A saga MUST persist its `accountId` as the tenant-identity field, never as
`userId`. The tenant identity MUST be correct end-to-end (SAGA-ACCOUNTID-AS-USERID
is a tenancy-correctness bug, not type-debt).

#### Scenario: saga record carries correct tenant identity

- GIVEN a saga started for tenant A
- WHEN the saga state is persisted
- THEN the persisted `accountId` equals tenant A's accountId and is not stored in the `userId` field

### Requirement: Confirmed fixes have a CI gate that cannot silently regress (§2G)

The regression net for the confirmed §2A/§2C/§2F fixes MUST execute in CI. The
16 dead integration files (incl. RLS multi-tenant isolation, publishing-saga E2E)
MUST be wired into CI so a future regression fails the build. The CI gate MUST be
wired WITH the fix, not after.

#### Scenario: integration regression net runs on PRs

- GIVEN the IDOR/auth/write-path regression tests merged with their fixes
- WHEN CI runs on a pull request
- THEN those integration tests (including RLS isolation) execute and a regression makes CI red
