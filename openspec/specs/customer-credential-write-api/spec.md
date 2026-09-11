# Customer Credential Write API — Delta Spec (password-reset-integrity / PR-2)

> **NEW capability** for change `password-reset-integrity`. Capability: **the customer-user
> repository port offers NO write that can carry a stale snapshot. Every command writes only
> the columns its name claims, and omitting a value the command requires is a COMPILE error
> rather than a silent revert.**
>
> **Why the port, and why now.** PR-1 fixes the reset by making its write a single claim, but
> it leaves `save(user, passwordHash?)` alive for six other callers, each writing 18-19
> columns from an in-memory entity. The sharpest of them is the login rehash: the upgraded
> hash is written, then the snapshot save restores the OLD hash, and the code comment states
> the stale-entity precondition while drawing the opposite conclusion. It is dormant only
> while `argon2.needsRehash` returns false — so it ARMS on the next `ARGON2_PARAMS` bump,
> which the hashing helper advertises as the safe upgrade path. A security-parameter upgrade
> that silently reverts itself is why this chains immediately instead of being backlogged.
>
> The snapshot also now carries `deletedAt` and the MFA columns, so a stale save can resurrect
> a soft-deleted customer, re-delete a restored one, or clobber state another repository owns
> under CAS discipline.
>
> RFC 2119 keywords (MUST / SHALL / SHOULD / MAY) are normative. Requirements marked
> **[MERGE-BLOCKING]** gate PR-2.
>
> **Scenario tags.** `[unit]` — vitest against a stateful fake of the **Prisma client** (never
> of the repository). `[integration]` — real-DB run through the guarded client. `[static]` —
> source inspection. `[compile-time]` — **the tag that carries this capability's core claim**:
> proven by the TypeScript compiler REJECTING a program. A runtime test cannot distinguish
> "inexpressible" from "nobody has written it yet".
>
> **Non-goals.** No schema change, no MFA behavior change, no change to which rows a query
> returns, and no migration of the admin credential path.

---

## ADDED Requirements

### Requirement: No port method writes a column its name does not claim **[MERGE-BLOCKING]**

The customer-user port SHALL expose only intention-named commands, each writing exactly the
columns it names (plus the row's own update timestamp). `save(user, passwordHash?)` and
`updatePasswordHash(...)` SHALL NOT exist after this change — neither on the port, nor on the
adapter, nor at any call site. Two ways to write one column, with neither authoritative, is
the defect; deleting the ambiguous one is the fix.

The port's documented behavior SHALL match the adapter's actual behavior. The current JSDoc
("otherwise the existing hash is preserved on update") states the OPPOSITE of what the adapter
does, and a contract that lies is worse than an undocumented one.

#### Scenario: the snapshot writers are gone from the tree [static]

- **GIVEN** the change is applied
- **WHEN** the port, the adapter, and every caller are inspected
- **THEN** no `save(` and no `updatePasswordHash(` on the customer-user repository remains anywhere

#### Scenario: every command writes exactly its named columns [unit]

- **GIVEN** a stateful Prisma-client fake and a table of (command, declared column set)
- **WHEN** each command is invoked
- **THEN** the columns present in the issued write equal the declared set for that command, with no extra column carried from the entity

#### Scenario: omitting a required value does not compile [compile-time]

- **GIVEN** a command whose contract requires a credential value (for example a creation or a password claim)
- **WHEN** a call omits that value
- **THEN** the TypeScript compiler rejects the program — the omission cannot reach runtime as a silent revert

---

### Requirement: A credential write can never revert another write's column **[MERGE-BLOCKING]**

No command SHALL overwrite `passwordHash`, `deletedAt`, or any MFA column unless that column
is the one it names. In particular, a login that upgraded a password hash SHALL leave the
UPGRADED hash stored once the whole login completes, and a soft-delete state SHALL survive
every credential and membership write.

#### Scenario: a rehashing login persists the upgraded hash [integration]

- **GIVEN** a customer user whose stored hash requires a rehash under the configured parameters, and a correct password
- **WHEN** the login completes end to end
- **THEN** the stored hash is the UPGRADED one — `argon2.verify(stored, password)` is true AND `stored` is not byte-identical to the pre-login hash

#### Scenario: recording a login touches only the login timestamp [unit]

- **GIVEN** an in-memory entity holding a hash that is already stale relative to the stored row
- **WHEN** the login is recorded
- **THEN** the stored hash is unchanged and only the login timestamp is written

#### Scenario: soft-delete state survives every credential write [unit]

- **GIVEN** a soft-deleted customer user
- **WHEN** each command in the new API is invoked against that row in turn
- **THEN** `deletedAt` is unchanged by every one of them — no command resurrects a deleted user and none re-deletes a restored one

---

### Requirement: MFA columns stay exclusively owned by the MFA repository **[MERGE-BLOCKING]**

No command in this API SHALL write `mfaEnabled`, `mfaSecret`, `mfaBackupCodes`,
`mfaBackupUsedAt`, or `mfaLastUsedTotpStep`. Those columns live on the same row but are
written by the MFA repository under compare-and-set discipline; a snapshot write from this
side silently defeats that discipline.

#### Scenario: no command names an MFA column [static]

- **GIVEN** the change is applied
- **WHEN** each command's write set is inspected
- **THEN** none includes any MFA column

---

### Requirement: Creation creates, and every command keeps a typed Result contract **[MERGE-BLOCKING]**

The creation command SHALL create a row and SHALL NOT silently update an existing one — a
duplicate SHALL fail with a typed conflict, because the upsert semantics the current code
relies on turn an invitation for an already-registered address into a silent overwrite of
that user. Every command SHALL return `Result<…, DomainError>`; no command SHALL throw across
the port boundary, and migrated callers SHALL keep typed, distinguishable failures rather
than collapsing into one internal error.

#### Scenario: creating a duplicate fails without mutating the existing row [unit]

- **GIVEN** a customer user already registered for an account and e-mail
- **WHEN** creation is attempted again for the same pair
- **THEN** a typed conflict error is returned and the existing row is unchanged in every column

#### Scenario: no command throws across the boundary [static]

- **GIVEN** the change is applied
- **WHEN** each command's signature and body are inspected
- **THEN** each returns a `Result` and no infrastructure error escapes unwrapped

#### Scenario: migrated callers keep distinguishable failures [unit]

- **GIVEN** each caller migrated off the snapshot writer
- **WHEN** its underlying write fails
- **THEN** the caller's own error contract still distinguishes the failure classes it distinguished before the migration

---

## Verification note (strict TDD — RED→GREEN)

The `[compile-time]` scenario is RED by definition before the change: today omitting the hash
type-checks and reverts silently. The rehash scenario is RED only under parameters that make
`needsRehash` true, so the test SHALL force that condition rather than wait for a production
bump — otherwise it proves nothing and the trap stays armed. The column-invariant table
replaces the current capture-only adapter test, which records arguments and therefore cannot
observe a clobber. Integration scenarios need DB + Redis via `pnpm db:up`. New and changed
code carries JSDoc `@file/@description/@layer` (fitness #9/#10); nothing new is constructed
outside the composition root (fitness #21).
