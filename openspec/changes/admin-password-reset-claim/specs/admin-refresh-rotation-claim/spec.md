# Admin Refresh-Rotation Claim — Delta Spec (admin-password-reset-claim / SMELL-97)

> **NEW capability** for change `admin-password-reset-claim`. Capability: **rotating an admin
> refresh token is a CLAIM on the token being replaced — a presented refresh token mints at
> most ONE new pair, ever; a token that has already been rotated is refused on every later
> presentation; and the refusal does not depend on a cache being available.**
>
> **Why this rides in the reset slice and is not a detour.** It is the SECOND unsound member of
> the single-use-claim class, and the class gate (`single-use-claim-gate`, fitness #41) ships
> hard-zero in this same change — a gate that stops at one remaining violation is a ratchet, and
> Edward signed the hard-zero. `authServiceSession.ts` reads the session by `refreshTokenHash`
> and then rotates keyed only on `{ id: session.id }`: two presentations of the SAME refresh
> token both pass the read and both rotate. Refresh-token rotation exists precisely to make
> replay detectable; rotating on `id` rather than on the presented hash removes the one property
> that makes it worth doing.
>
> **The cache is not the guarantee.** A replayed token is caught today only when Redis is
> configured AND the replay arrives after the first request's blacklist write. Two racers that
> both pass the blacklist check before either writes are not caught at all, and with no Redis
> nothing is caught at any time. The blacklist is a latency optimisation over a guarantee that
> must live in the row.
>
> RFC 2119 keywords (MUST / SHALL / SHOULD / MAY) are normative. Requirements marked
> **[MERGE-BLOCKING]** gate the change.
>
> **Scenario tags.** `[integration]` — a real Postgres row reached through a real `AuthService`
> over real adapters; only a real row decides atomicity. `[unit]` — vitest against a stateful
> fake of the **Prisma client**, never of a repository. `[static]` — decidable by inspecting
> source or config.
>
> **Decisions already taken (Edward, 2026-09-12 pre-propose gate), stated so they are not
> re-litigated:** the rotation converts IN THIS SLICE, with its own CAS and its own racer proof;
> the blast radius of the change is therefore TWO source files; detection stops at REFUSAL.
>
> **The named limit of this capability — session-family revocation is NOT here.** OAuth 2.0
> Security BCP practice on detecting rotation reuse is to revoke the whole token family, because
> the loser of the race may be the legitimate user and the winner the attacker; after this
> capability the attacker's pair stays live in that case. Family revocation has real blast radius
> (a benign double-refresh from two browser tabs would log both out), it is a product decision,
> and it is NOT signed. This capability closes the mint-twice hole and leaves acting on the
> detection to a follow-up, which pairs with the customer-side non-rotation row (SMELL-113).
>
> **Non-goals.** The SIBLING admin endpoint: `AdminAuthService.refreshToken`
> (`apps/api/src/admin/auth/AdminAuthService.ts`, serving `POST /admin/auth/refresh`) performs
> NO rotation of the stored refresh-token hash and is therefore untouched by this capability —
> naming it by file so "the admin refresh flow is a claim now" is not read as covering it; its
> backlog row lands at close. The customer refresh flow, which likewise has no server-side
> rotation at all (SMELL-113);
> any change to fingerprint checking, session revocation, or token issuance beyond the rotation
> write itself and the per-mint `jti` the rotation claim requires to be a claim (design D9);
> any schema change — `AdminSession.refreshTokenHash` is ALREADY `@unique`
> (`infra/prisma/schema.prisma:231`) and this capability relies on that existing constraint.

---

## ADDED Requirements

### Requirement: Rotation is a claim on the token being replaced **[MERGE-BLOCKING]**

The rotation write SHALL name the PRESENTED refresh-token hash in its own predicate, together
with the session `id` and `isActive: true`. Success SHALL be gated on the matched-row count.

Because `AdminSession.refreshTokenHash` is `@unique`, the count is `0` or `1` by construction, so
`count === 1` IS the whole verdict here — the opposite situation to the reset claim in this same
change, where no unique index exists and the gate is `count > 0`. The two claims are deliberately
NOT symmetric, and each SHALL state its own reason at its own site; copying one gate onto the
other site would be wrong in one of the two places.

For a given presented refresh token at most ONE new token pair SHALL ever be issued. The
guarantee SHALL hold under the interleaving where a second presentation's deciding read happens
strictly AFTER the first's rotation has COMMITTED, under simultaneous presentations, and under
sequential replay.

#### Scenario: staggered racers mint exactly one pair [integration]

- **GIVEN** one valid admin refresh token presented twice, ordered so the second's deciding read happens deterministically AFTER the first's rotation has COMMITTED
- **WHEN** both run against the real database
- **THEN** exactly ONE call returns a token pair, the other is refused, and the stored `refreshTokenHash` is the hash of the WINNER's new refresh token

#### Scenario: simultaneous racers mint exactly one pair [integration]

- **GIVEN** one valid admin refresh token presented twice, both started before either completes
- **WHEN** both run against the real database
- **THEN** exactly ONE call returns a token pair and the stored `refreshTokenHash` matches that pair's refresh token and no other

#### Scenario: the loser's pair is never issued and never stored [integration]

- **GIVEN** either racing pair above
- **WHEN** the loser is refused
- **THEN** the loser's result carries no access token and no refresh token, and the hash of the token it would have issued appears in no row

#### Scenario: the two claims' count gates are each justified at their own site [static]

- **GIVEN** the change is applied
- **WHEN** the rotation claim and the reset claim are read together
- **THEN** the rotation states that `@unique` on `refreshTokenHash` caps the match at one row so `count === 1` is the verdict, and the reset states why `count > 0` is the correct gate in the absence of such an index

---

### Requirement: A rotated token is never accepted again **[MERGE-BLOCKING]**

Presenting a refresh token that has already been rotated SHALL be refused with a replay-shaped
rejection drawn from the method's EXISTING error union
(`INVALID_TOKEN | TOKEN_BLACKLISTED | SESSION_EXPIRED | USER_INACTIVE | DATABASE_ERROR`), and
SHALL NOT mint a pair. Which member is used is a DESIGN choice; what is normative is that the
caller is refused, receives no tokens, and that the outcome is expressible without widening the
union or adding a route mapping.

In the RACING interleavings (staggered and simultaneous), the refusal SHALL be produced by the
rotation claim itself, not by a preceding cache lookup — the claim, not the cache, is the
authority under contention, and the racer proves it with Redis structurally absent. For the
SEQUENTIAL replay of an already-rotated token, an EARLIER guard MAY answer first (measured:
the session read misses → `SESSION_EXPIRED` Redis-less; the blacklist answers `TOKEN_BLACKLISTED`
with Redis) — a pre-existing asymmetry the design records as D2, deliberately unchanged by this
change; what stays normative in every path is that the caller is refused and no pair is minted.
(Amended per verify W1, 2026-09-13: the original unqualified sentence stated a SHALL the
adjudicated implementation does not meet on the sequential path.)

#### Scenario: sequential replay is refused with no pair issued [integration]

- **GIVEN** a refresh token that a successful rotation has already replaced
- **WHEN** the same token is presented again
- **THEN** the call is refused, no token pair is returned, and the stored `refreshTokenHash` is byte-identical to the one the successful rotation stored

#### Scenario: the refusal is expressible in the existing union [static]

- **GIVEN** the change is applied
- **WHEN** `refreshTokens`' return type is compared with the pre-change tree
- **THEN** the error union is unchanged, and the replay refusal is one of its existing members

---

### Requirement: The claim, not the cache blacklist, is the authority **[MERGE-BLOCKING]**

The single-pair guarantee SHALL hold independently of the token blacklist: with the cache path
inactive — no Redis configured, or the blacklist not yet written — a replayed rotated token SHALL
still be refused and SHALL still mint no second pair.

The relative order of the blacklist write and the rotation claim SHALL be chosen so that:

- the blacklist NEVER becomes the only thing preventing a second pair;
- a REFUSED rotation does not leave observable state that a later legitimate rotation would trip
  over; and
- a SUCCESSFUL rotation never returns a pair whose own refresh token is already blacklisted.

The mechanism and the final ordering are a DESIGN choice; these three observable properties are
the requirement. Today the blacklist is written before the rotation and both racers pass the
blacklist check before either writes, which is exactly the configuration where the cache appears
to protect the flow and does not.

#### Scenario: replay is refused with the blacklist path inactive [integration]

- **GIVEN** a rotated refresh token and a service configured so the blacklist path does not run
- **WHEN** the rotated token is presented again
- **THEN** it is refused and no second pair is minted

#### Scenario: the winner's new pair is usable [integration]

- **GIVEN** a successful rotation
- **WHEN** the newly issued refresh token is presented
- **THEN** it is accepted and rotates normally — the rotation did not blacklist its own output

#### Scenario: the guarantee is not conditioned on the cache [static]

- **GIVEN** the change is applied
- **WHEN** the rotation path is inspected
- **THEN** the decision to issue a pair is taken from the claim's matched-row count, and no branch issues a pair on the strength of a blacklist lookup alone

---

### Requirement: A refused rotation changes nothing **[MERGE-BLOCKING]**

A refused rotation SHALL write no column of the session row: the stored `refreshTokenHash` and
`expiresAt` stay as the successful rotation left them, and the session SHALL remain usable by the
holder of the winning token. A replay attempt SHALL NOT be able to expire, revoke, or otherwise
degrade a live session.

#### Scenario: the refused attempt leaves the session row alone [integration]

- **GIVEN** the staggered pair above
- **WHEN** the loser is refused
- **THEN** every column of the session row equals what the winner's rotation left, and `isActive` is still true

#### Scenario: the winner's session survives the refusal [integration]

- **GIVEN** a refused replay against a session that has just rotated
- **WHEN** the winner uses its own refresh token afterwards
- **THEN** the rotation succeeds

---

### Requirement: The evidence executes in CI and is RED on the unmodified tree **[MERGE-BLOCKING]**

`apps/api/tests/integration/adminRefreshRotationClaim.integration.test.ts` SHALL be named by
EXACTLY ONE `run_batch` in `apps/api/scripts/run-tests.sh`, and fitness #30's measured unreached
count SHALL NOT rise.

The evidence SHALL be constructed so the tree at `19fb9e6a` FAILS it, by MINTING TWO PAIRS — a
green-looking red. Every single-pair assertion SHALL therefore be made against the STORED
`refreshTokenHash` and against the pairs actually returned, never against an error code and never
against which methods a double recorded: an assertion on the error code alone passes under the
defect whenever the blacklist happens to answer first.

The racing interleaving SHALL be pinned to occur BEFORE either attempt's blacklist write.
Otherwise the cache answers the second attempt and the race the proof exists to exercise never
happens — the proof would be green on the defect.

Construction is NOT from zero on this side: `apps/api/tests/auth.test.ts` already builds a real
`AuthService` over real adapters and already calls `refreshTokens`, and that recipe SHALL be
reused rather than re-derived. Unit coverage for the rotation SHALL join the existing
`apps/api/tests/unit/authService.test.ts` over a stateful Prisma-client fake.

No committed test SHALL carry `.skip` or `.only` (fitness #32).

#### Scenario: the integration file is named by exactly one batch [static]

- **GIVEN** the change is applied
- **WHEN** `apps/api/scripts/run-tests.sh` is inspected
- **THEN** `adminRefreshRotationClaim.integration.test.ts` appears in exactly one `run_batch`

#### Scenario: the interleaving is pinned before either blacklist write [static]

- **GIVEN** the racer
- **WHEN** its ordering is inspected
- **THEN** the second attempt's deciding read is pinned to happen before either attempt blacklists the presented token, and the pinning is explicit rather than dependent on timing luck

#### Scenario: the racer is RED on the unmodified tree by minting two pairs [static]

- **GIVEN** the tree at `19fb9e6a`
- **WHEN** the staggered rotation scenario is run
- **THEN** it fails with TWO issued pairs, and the failure is observed on the stored hash and the returned pairs rather than on an error code

#### Scenario: the wired suite executes and passes in CI [integration]

- **GIVEN** the integration tier running against the migrated Postgres service
- **WHEN** the batch that names the file runs
- **THEN** the suite executes with a non-zero collected-test count and passes

---

### Requirement: The benign-double-refresh cost and the deferred family revocation are documented

Two legitimate concurrent refreshes — the ordinary two-browser-tabs case — now produce one winner
and one refused caller, and the refused tab must re-authenticate. This SHALL be written down in
the spec, in the PR body, and at the refusal site, together with the deliberate stop at refusal:
this capability does NOT revoke the session family on a detected replay, so where the loser was
the legitimate user the attacker's pair stays live until it expires.

Both are accepted, named costs of a signed decision. They SHALL NOT be engineered around in this
change, and the follow-up SHALL be named so the omission is a decision on record rather than a
gap discovered later.

#### Scenario: the residuals are stated where a reader will meet them [static]

- **GIVEN** the change is applied
- **WHEN** the rotation refusal site and the PR body are inspected
- **THEN** each states that a benign concurrent refresh costs the loser a re-login, that a detected replay is refused but the family is not revoked, and that family revocation is a named follow-up

#### Scenario: the refused legitimate caller can recover [integration]

- **GIVEN** two legitimate concurrent refreshes of the same token where one is refused
- **WHEN** the refused caller re-authenticates
- **THEN** it obtains a working session, and the winner's session was never disturbed

---

## Verification note (strict TDD — RED→GREEN)

Both racing requirements are RED on the tree at `19fb9e6a` by MINTING TWO PAIRS, and the
sequential replay is red only where the blacklist does not mask it — which is why the proof pins
its interleaving before either blacklist write and asserts on the stored hash rather than on an
error code. A proof that asserts `TOKEN_BLACKLISTED` is satisfied by the defect.

Integration scenarios need Postgres + Redis via `pnpm db:up`; on the LXC box they run as single
files, heap-capped, under a `timeout` wrapper. New and changed code carries JSDoc
`@file`/`@description`/`@layer` (fitness #9/#10) and no sprint, phase or timeline reference
(fitness #8). This capability edits no schema and no migration, and consumes no
`omnipost-allow sensitive-edit` token.
