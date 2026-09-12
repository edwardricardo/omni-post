# Spec: tombstone-retention-phase-2 (SMELL-88)

> Materialized from Engram `sdd/tombstone-retention-phase-2/spec` (obs 690) WITH the
> design-mandated amendment applied (design rev 3 "SPEC AMENDMENT REQUIRED", ratified by the
> design gate): the compatibility-distinctness scenario's GIVEN is narrowed to mappings that
> full case folding does not itself collapse — CaseFolding.txt status F maps U+FB01 to "fi",
> so a ligature belongs to the SAME-digest family the spec's own C+F mandate creates
> (U+FB00-06, U+FB13-17, U+00DF, U+01C4 are the counterexample classes); fullwidth and
> superscript are the mappings that genuinely stay distinct.

Authority: proposal obs 689 (Edward's signed decisions obs 688 are binding inputs; measured surface obs 678).

## Capabilities

- **New**: `deletion-record-degradation` — full spec below (no prior spec exists for retention, so this is a FULL spec, not a delta).
- **Modified**: none. `multi-tenant-isolation` is untouched; DeletionRecord stays denylisted by design (the sweep reads cross-account under the documented `withSystemContext` seam).

[MB] marks merge-blocking requirements. No HTTP routes are added; the capability has no product read surface by design (non-goal).

---

# Deletion Record Degradation Specification

## Purpose

Once a DeletionRecord tombstone passes its own retention deadline, the plaintext `name` it holds has outlived its stated lawful basis. This capability replaces that plaintext with a keyed, versioned digest so the row survives as erasure evidence while the PII does not. It defines: the deadline sweep and its observable acceptance, the atomic per-row transition, the frozen canonicalisation and MAC contract, key-ring custody and rotation, the tick vehicle, the test-pinned verifier, and the residuals deliberately not closed here.

## Requirements

### Requirement: Overdue plaintext is degraded [MB]

The system MUST degrade every DeletionRecord whose `retainUntil` is in the past and whose `name` is non-null. Acceptance MUST be read from the `deletion_record_overdue_plaintext` gauge — never from the sweep's exit code, log line, or returned count.

#### Scenario: Seeded overdue rows drain the gauge

- GIVEN tombstones seeded with BOTH `clientUntil` AND `retainUntil` back-dated (the retention CHECK rejects a row whose `retainUntil` is under `clientUntil` + 1 year)
- AND the gauge reports a non-zero overdue count before the sweep
- WHEN the degradation sweep runs to completion
- THEN the gauge reports 0
- AND every seeded row holds a non-null `nameDigest`, a non-null `nameDigestKeyVersion`, and a null `name`

#### Scenario: Rows not yet due are untouched

- GIVEN a tombstone whose `retainUntil` is in the future
- WHEN the sweep runs
- THEN its `name` is unchanged, `nameDigest` stays null, and the gauge still counts it as not overdue

#### Scenario: Re-running degrades nothing and rewrites nothing

- GIVEN a population already fully degraded
- WHEN the sweep runs again
- THEN it degrades zero rows, the gauge stays 0, and no existing `nameDigest` or `nameDigestKeyVersion` value changes

#### Scenario: A population larger than one batch drains completely

- GIVEN more overdue rows than a single batch admits
- WHEN the sweep runs
- THEN it loops until none remain, no row is visited twice (a nulled `name` leaves the partial index by construction), and the gauge reaches 0

### Requirement: Degradation is one atomic per-row write [MB]

Each row MUST reach its degraded state through a SINGLE update that sets `name` to null, `nameDigest`, and `nameDigestKeyVersion` together. A row MUST NEVER be observable holding both a live `name` and a `nameDigest`. (The mutual-exclusion CHECK that would enforce this in the database is a filed residual; the atomic write is the code-level mitigation.)

#### Scenario: The three columns move together

- GIVEN an overdue row with a live `name`
- WHEN it is degraded
- THEN one update sets all three columns
- AND no intermediate state exists in which the digest is written while the name is still readable

#### Scenario: A failed write leaves the row wholly undegraded

- GIVEN the update for one row fails
- WHEN the sweep completes
- THEN that row still holds its original `name`, `nameDigest` is null, `nameDigestKeyVersion` is null
- AND the gauge still counts it as overdue

#### Scenario: One bad row does not abort the sweep

- GIVEN one row among many fails to degrade
- WHEN the sweep completes
- THEN the remaining overdue rows are degraded, the failure is reported with the row id only, and the run is distinguishable from a clean run

### Requirement: The canonicalisation pipeline is frozen and versioned [MB]

Before digesting, a name MUST pass exactly this pipeline: decode, flag-and-skip any codepoint unassigned in the pinned Unicode version, NFD, full case fold (CaseFolding.txt status C+F, excluding T — never `toLowerCase`), NFC, whitespace policy (every White_Space=Yes codepoint to U+0020, collapse runs, trim), UTF-8 bytes. Compatibility normalization (NFKC/NFKD) MUST NOT be used. The fold table MUST be vendored and pinned to a stated Unicode version, generated by a committed generator. The pipeline identity MUST be carried by a `canonicalisationVersion` resolvable from the row's pinned key version.

#### Scenario: Canonically equivalent and fold-equivalent spellings collapse to ONE digest

- GIVEN a known-answer vector set holding the same legal name in NFC, NFD, mixed-case, and whitespace-variant (leading, trailing, interior-run, non-ASCII-space) forms — including forms related by a full-case-fold mapping (the fi ligature U+FB01 versus "fi", sharp s, final sigma Σ/σ/ς)
- WHEN each is digested under the same key version
- THEN all produce the identical digest

#### Scenario: Names related by a compatibility mapping full case folding does not itself collapse stay distinct

- GIVEN two distinct legal names related solely by a compatibility mapping **that full case folding does not itself collapse** (a fullwidth or superscript form versus its decomposition)
- WHEN both are digested
- THEN the digests DIFFER

#### Scenario: Case folding happens after canonical reordering

- GIVEN a name whose combining marks are in unnormalized order and include the iota-subscript class (U+0345, ccc=240)
- WHEN it is digested
- THEN it matches the digest of its canonically reordered equivalent, proving the inner NFD runs before the fold

#### Scenario: The fold follows the pinned table, not the runtime's lowercase

- GIVEN inputs where full case fold and `toLowerCase` diverge (final sigma, dotted/dotless I forms)
- WHEN they are digested
- THEN the result follows the vendored full case fold, and the vector set fails if the implementation substitutes `toLowerCase`

### Requirement: The MAC construction is frozen [MB]

The MAC input MUST be `encode_string(domainTag) || encode_string(canonicalBytes)` per SP 800-185 length-prefix encoding, with domain tag `omnipost/deletion-record/name-digest/v1`. The algorithm MUST be HMAC-SHA-256 with the full 32-byte output, never truncated. `nameDigestKeyVersion` MUST remain a GLOBAL rotation counter (CI-adjudicated), and a pinned version MUST resolve the complete parameter set: key, canonicalisation version, algorithm, domain tag.

#### Scenario: Known-answer vector

- GIVEN a fixed test key, the frozen domain tag, and a fixed canonical input
- WHEN the digest is computed
- THEN the output equals the committed expected value byte for byte and is 32 bytes long

#### Scenario: Length prefixing removes separator ambiguity

- GIVEN two distinct inputs that a naive delimiter scheme would render identically (including a canonicalised name containing U+0000 or repeating the domain-tag text)
- WHEN both are digested
- THEN the digests differ

#### Scenario: A pinned version resolves everything a verifier needs

- GIVEN a degraded row carrying `nameDigestKeyVersion = N`
- WHEN a verifier resolves N
- THEN it obtains key, canonicalisation version, algorithm and domain tag from that pin alone, with no dependence on the currently active version

### Requirement: Unassigned codepoints are flagged, never digested [MB]

A name containing a codepoint unassigned in the pinned Unicode version MUST NOT be digested. The row MUST be left intact, counted as flagged, and reported with its row id only. It MUST remain in the overdue population so the gauge keeps naming it.

#### Scenario: A flagged row is left whole and stays overdue

- GIVEN an overdue row whose name holds an unassigned codepoint
- WHEN the sweep runs
- THEN the row keeps its `name`, `nameDigest` stays null, and the gauge does NOT drain to 0

#### Scenario: Flagging never leaks plaintext

- GIVEN a row is flagged
- WHEN its report line is inspected
- THEN it carries the row id and a reason, and no fragment of the name appears in any log line or metric label

#### Scenario: Flagged rows do not stall the sweep

- GIVEN a batch containing both flaggable and normal rows
- WHEN the sweep runs
- THEN every normal row is degraded, the flagged rows are counted, and the loop terminates instead of re-reading the same unflaggable batch forever

### Requirement: Rotation is append-only and round-trips [MB]

Rotation MUST be: append a new generation to the ring and bump the separate active-version pointer. New degradations MUST pin the new version; rows degraded under an earlier version MUST stay verifiable forever under their own pinned version. No ring entry MAY be removed, and a degraded row's pinned version MUST NEVER be rewritten (the plaintext it described is gone, so re-digesting is impossible by construction).

#### Scenario: Rotation round-trip

- GIVEN a row degraded under version 1
- WHEN version 2 is appended and the active pointer is bumped to 2
- THEN a newly degraded row pins version 2
- AND the version-1 row still verifies against a candidate name under version 1

#### Scenario: Rotation never rewrites an existing pin

- GIVEN degraded rows pinned at version 1 and an active pointer at version 2
- WHEN the sweep runs again
- THEN those rows are not selected, their `nameDigest` is unchanged, and their `nameDigestKeyVersion` is still 1

#### Scenario: Dropping a retired generation refuses boot

- GIVEN a ring from which version 1 has been removed while rows pinned at version 1 exist
- WHEN the process boots
- THEN boot fails with an error naming the missing version — a retired key is unusable for new digests and mandatory for verification

### Requirement: Key custody is a boot-time contract [MB]

The key ring MUST live in its own environment variable as an append-only JSON map of version to key material, with the active-version pointer as a SEPARATE non-secret configuration value. The ring MUST be validated at boot by the typed env schema with fail-fast semantics: every key at least 32 random bytes, versions contiguous from 1, and the active version present in the ring. The ring MUST be enrolled in the secret catalogue (count 29 to 30); the pointer MUST NOT be catalogued as a secret. `PLATFORM_ENCRYPTION_KEY` MUST NOT be reused for this purpose.

#### Scenario: Missing ring refuses boot

- GIVEN the ring variable is absent
- WHEN the process boots
- THEN it refuses to start with a precise error, and no partially configured degrader is registered

#### Scenario: Short or malformed key material refuses boot

- GIVEN a ring entry whose decoded key is under 32 bytes, or whose value is not valid encoded key material, or whose JSON is unparseable
- WHEN the process boots
- THEN boot fails with an error naming the offending version

#### Scenario: An inconsistent pointer or a gapped ring refuses boot

- GIVEN an active pointer naming a version absent from the ring, or a ring whose versions are not contiguous from 1
- WHEN the process boots
- THEN boot fails — it never degrades quietly to an arbitrary version

#### Scenario: Catalogue enrollment is asserted

- GIVEN the secret catalogue and its count test
- WHEN the ring is enrolled
- THEN the catalogue holds 30 entries and the count assertion moves with it, so forgetting enrollment is an automatic red

#### Scenario: The rotation runbook is the procedure the test executes

- GIVEN the documented rotation steps
- WHEN the rotation round-trip test runs
- THEN it performs those same steps, so the runbook cannot become a prescribed procedure with no runnable implementation

### Requirement: The sweep runs as a disciplined scheduled tick

The sweep MUST be registered through the background task scheduler with a stable task identifier and MUST execute inside `withSystemContext("system:<taskId>")`, naming its own task id. It MUST be unregistered on shutdown. Errors MUST reach the injected logger; a silent failure is a defect. The gauge — not the tick's success — is the standing witness.

#### Scenario: The tick declares its own tenant scope

- GIVEN the new registration in the API bootstrap
- WHEN the scheduler tick-scope suite parses it
- THEN the body wraps its work in `withSystemContext` and the reason names that tick's own task id

#### Scenario: The tick is registered and torn down

- GIVEN the process starts and later shuts down
- WHEN registration and teardown are observed
- THEN the task is registered once under its stable id and unregistered on shutdown

#### Scenario: A failing tick is loud, and the gauge still tells the truth

- GIVEN the sweep throws
- WHEN the tick completes
- THEN the error is logged through the injected logger with no plaintext name
- AND the gauge continues to report the true overdue count rather than 0

#### Scenario: An unreadable gauge reports UNKNOWN, never 0

- GIVEN the overdue provider fails at scrape time
- WHEN the gauge is collected
- THEN it reports the UNKNOWN sentinel, so a "greater than zero" alert stays silent on ignorance instead of asserting a clean population

### Requirement: A verifier exists and is test-pinned only

A `verifyNameDigest(name, row)` operation MUST exist, computing the digest of a candidate name under the ROW'S pinned version and comparing in constant time. It MUST NOT be exposed through any product route, admin surface, or DSAR endpoint in this change (that surface carries its own rate-limit and reverse-log requirements when it ships).

#### Scenario: A matching candidate verifies

- GIVEN a row degraded from a known name
- WHEN that name (in any canonically equivalent spelling) is verified against the row
- THEN verification succeeds under the row's pinned version

#### Scenario: A different name does not verify

- GIVEN the same degraded row
- WHEN a different legal name is verified against it
- THEN verification fails, and failure is reported without revealing digest bytes

#### Scenario: No product read surface is added

- GIVEN the shipped route surface
- WHEN it is inspected for a tombstone read or digest-lookup path
- THEN none exists, and the verifier is reachable only from tests

### Requirement: Residual debt is filed, not absorbed

The change MUST leave named, attributable residuals rather than silent gaps: the mutual-exclusion CHECK migration (out of scope — it would break tokenlessness), the HSM custody upgrade path, the DSAR/verification product surface, and the separately-filed defect that the prescribed re-wrap script does not exist.

#### Scenario: The mutual-exclusion residual is named with its risk

- GIVEN the shipped artifacts
- WHEN the residual list is read
- THEN it names the missing `name IS NULL <> nameDigest IS NULL` constraint, states the half-applied-row risk, and states the atomic-write mitigation

#### Scenario: The nonexistent re-wrap script gets its own row, not a copied procedure

- GIVEN the sibling key-rotation documentation that prescribes a script never written
- WHEN the rotation runbook for this capability is authored
- THEN it does not copy that procedure, and the sibling defect is filed as its own backlog row

#### Scenario: Custody and DSAR upgrades are stated as future work

- GIVEN the residual list
- WHEN HSM custody and the DSAR read surface are read
- THEN both are named as out of scope with the condition that would bring them in

### Requirement: The change is tokenless and lands at zero defect [MB]

The change MUST require no schema change and no migration. The retention-and-partial-uniques migration pinned by checksum in the audit workflow MUST stay byte-untouched. The full quality gate MUST end at zero errors and zero warnings, with the fitness suite at its declared thresholds.

#### Scenario: Schema and migrations are untouched

- GIVEN the diff
- WHEN the Prisma schema and the migrations directory are inspected
- THEN neither is modified, and the audit workflow's checksum pin on the retention migration still matches

#### Scenario: The fitness suite holds at its thresholds

- GIVEN the full fitness run
- WHEN it completes
- THEN there are no new violations: the key is read only through the typed env chokepoint (#15/#16), DeletionRecord stays denylisted and unenrolled (#39), no `$transaction` is introduced (#40), and every ratcheted baseline is unchanged or lower

#### Scenario: The new suites are reachable by a collector

- GIVEN the new unit and integration suites
- WHEN the test-reachability gate runs
- THEN the integration suite is named by the existing retention batch, so it actually executes rather than merely reading as coverage

---

## Coverage summary

| Section                       | Count                                                                                                                                                                 |
| ----------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Requirements (new capability) | 11 (8 marked [MB])                                                                                                                                                    |
| Scenarios                     | 34                                                                                                                                                                    |
| Happy paths                   | covered (drain, rotation round-trip, verify match, boot success)                                                                                                      |
| Edge cases                    | covered (unassigned codepoints, fold-collapsed vs genuinely-distinct compatibility pairs, ccc=240 reordering, final sigma, U+0000 in canonical bytes, batch overflow) |
| Error states                  | covered (failed row write, missing/short/gapped ring, removed generation, throwing tick, unreadable gauge)                                                            |
