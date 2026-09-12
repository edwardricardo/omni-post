# Proposal: tombstone-retention-phase-2 (SMELL-88)

> Materialized from Engram `sdd/tombstone-retention-phase-2/proposal` (obs 689).

Base: main. Inputs: explore obs 678, research obs 680, Edward's signed decisions obs 688 (binding, not re-opened).

## Intent

DeletionRecord retains plaintext PII (`name`) past its own stated lawful basis — the degradation deadline (`retainUntil` + partial index) enforces nothing, both writers keep growing the population, and no row is overdue before 2027-08-30, so this is the window to ship the job before the first irreversible run.

## Scope (Trabajo | Qué arregla)

| Trabajo                                                                                                                                                                                                                                                                 | Qué arregla                                                                                                                                                                                         |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Key ring env: `DELETION_NAME_DIGEST_KEY_RING` (JSON `{version→key}`) + `DELETION_NAME_DIGEST_ACTIVE_VERSION` pointer; Zod fail-fast (each key ≥32 random bytes per RFC 2104; versions contiguous from 1; active exists; entries never deleted — NIST deactivated state) | Own HMAC key per signed (a)/(b): Art. 4(5) separation (key in process env, never beside the tombstones), no PLATFORM_ENCRYPTION_KEY reuse, rotation = append + pointer bump                         |
| secretCatalog entry for the ring (29→30; the pointer is non-secret config, NOT catalogued) + SECRETS.md rotation runbook that is real prose proven by the round-trip test                                                                                               | Forgetting enrollment is an automatic red; the runbook never repeats the nonexistent re-wrap-script defect                                                                                          |
| Canonicalisation + digest module with frozen contract (below), `verifyNameDigest` via `timingSafeEqual` (webhookSignature precedent), vendored CaseFolding.txt-derived fold table (generated, Unicode-version-pinned) + generator script                                | A digest bug is undetectable once plaintext is gone; the contract and test vectors are pinned BEFORE the first run; Node has no full-casefold primitive — this names the implementation             |
| Degrader service (OutboxCleaner shape) + scheduled tick per signed (c): `withSystemContext("system:deletion-record-degrader")`, self-draining loop on the partial index; per row ONE atomic UPDATE `{name: null, nameDigest, nameDigestKeyVersion}`                     | Overdue plaintext actually degrades; the single UPDATE closes the half-applied-row hole in code (no `$transaction` → fitness #40 untouched); processed rows leave the partial index by construction |
| Integration: extend existing `integration:retention` batch — seeded rows with BOTH `clientUntil` AND `retainUntil` back-dated (CHECK rejects otherwise; precedent `deletionRecordRetentionFloor.test.ts:193-212`) → gauge drains to 0; rotation round-trip              | Signed acceptance is the gauge draining, never "the job exits 0"; CI seeding is the only proof until 2027                                                                                           |

## Frozen digest contract (the four open points, resolved)

Pipeline: decode → **flag-and-skip any codepoint unassigned in the pinned Unicode version** → **NFD** → **full case fold** (CaseFolding.txt status C+F, excluding T; never `toLowerCase`) → **NFC** → whitespace policy (White_Space=Yes → U+0020, collapse runs, trim — PROJECT decision, no standards backing, documented as such) → UTF-8 bytes.
MAC input: `encode_string(domainTag) || encode_string(canonicalBytes)` per SP 800-185; domainTag `omnipost/deletion-record/name-digest/v1`. HMAC-SHA-256, full 32-byte output, no truncation. `nameDigestKeyVersion` = ring version (stays a GLOBAL rotation counter — CI-adjudicated). The env ring carries key material only; a code-level frozen table `RING_PARAMETERS[version] = {algorithm, canonicalisationVersion, domainTag}` completes the full parameter set so a pin resolves everything needed to verify forever.

1. **NFD inner, NFC frozen.** Equivalence class = Unicode D145 canonical caseless match, `NFD(toCasefold(NFD(X)))` — inner NFD is load-bearing: unnormalized combining-mark order (the U+0345 class, ccc=240) folds to a non-equivalent result if folded before canonical reordering. The final serialization is NFC per W3C charmod-norm (content form; what browsers/forms deliver): a canonical class has exactly one NFC form, so the switch is representation-only, and both primaries are honored without contradiction. Never NFKC/NFKD — compatibility matches are unfalsifiable in a legal-evidence artifact.
2. **Length-prefix, not 0x00.** SP 800-185 `encode_string` is the NIST-citable form and eliminates the ambiguity CLASS structurally — a canonicalised name can still contain U+0000, so a 0x00 separator rests on an assumption; length-prefixing rests on none. Cost: a few lines.
3. **Unassigned codepoints: flag, never digest.** UAX #15 stability holds only for assigned codepoints. A row whose name contains a codepoint unassigned in the PINNED table version is logged (row id only, no plaintext), counted, and LEFT in the partial index — the gauge keeps naming it, matching the repo's honest-instrument posture (-1 UNKNOWN, never a reassuring 0). Expected volume ≈ 0 for human names; one ever appearing warrants human adjudication anyway. This carve-out is what makes ICU-backed `String.prototype.normalize` safe across Node upgrades: for assigned codepoints, normalization is stable forever. (Post-gate: the pin is **UCD 17.0.0** — the MEASURED runner reality, Edward-signed; a node major never pins ICU.)
4. **HMAC-SHA-256 over argon2id.** The in-tree contract is CI-pinned as "keyed HMAC" (schema doc-comment + audit.yml Squawk adjudication on the sha256-pinned migration) and EDPB §89 itself prefers keyed one-way functions. The dominant risk — leaked ring + DB dump → retroactive dictionary reversal of low-entropy names — is mitigated where EDPB puts it: secret ENTROPY (§88; 256-bit random key makes keyless brute force impossible, so the attack REQUIRES the env leak) and custody separation (§85-86; a DB dump alone reverses nothing). Argon2id-with-pepper would only slow, not prevent, a joint-compromise dictionary walk over a small name space, while costing non-standard shape, expensive verification forever, and contradiction of the pinned design language. Tradeoff accepted and stated.

## Capabilities

### New

- `deletion-record-degradation`: the degradation contract — canonical pipeline + ring + sweep + flag path + gauge-based acceptance + rotation round-trip.

### Modified

- None. No retention spec exists in `openspec/specs/`; `multi-tenant-isolation` is unchanged (DeletionRecord stays denylisted by design — the job reads cross-account under `withSystemContext`, the documented seam).

## Approach

100% tokenless except the /.env-pattern edits (two Edward-authorized windows executed at apply): columns + partial index exist; schema/migrations untouched; the audit.yml pinned migration is not edited. Key through the boot Zod chokepoint (fitness #15/#16 satisfied by construction). Tick registered in `index.ts` — the `schedulerTickTenantScope` suite enforces the `withSystemContext` wrap automatically. The sweep is self-draining (nulling `name` exits the partial index) with a per-tick exclusion set for flagged/failed rows (design-gate C1 corrective).

## Non-goals

- Mutual-exclusion CHECK (`name IS NULL <> nameDigest IS NULL`) — needs a migration; filed (SMELL-105); mitigated in code by the single atomic UPDATE.
- HSM custody — future upgrade per EDPB measures list (SMELL-106).
- DSAR/read/verification product surface — this change ships only the test-pinned `verifyNameDigest` (SMELL-107).
- The nonexistent re-wrap script — separate pre-existing defect (SMELL-104); its procedure is NOT copied.
- Tenant-guard enrollment of DeletionRecord (fitness #39 already satisfied via denylist).

## Risks

| Risk                                                                                                | Likelihood | Mitigation                                                                                                                                     |
| --------------------------------------------------------------------------------------------------- | ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| Ring leak + low-entropy names → retroactive dictionary reversal (dominant; no remediation post-run) | Low        | 256-bit entropy; custody separation; no reverse surface shipped; residual on joint env+DB compromise stated honestly (SMELL-106); HSM = future |
| Half-applied row holds name AND digest                                                              | Low        | Single atomic UPDATE; CHECK residual filed (SMELL-105)                                                                                         |
| Silent tick                                                                                         | Med        | The gauge is the witness — acceptance and alerting read the gauge, never exit codes                                                            |
| Unicode-version drift changes digests across runtimes                                               | Low        | Pinned vendored fold table (UCD 17.0.0); unassigned flagged; output canary + numeric version floor                                             |
| Digest bug undetectable after plaintext destruction                                                 | Med        | Contract + test vectors frozen BEFORE first run; `verifyNameDigest` + rotation round-trip pin the full parameter set                           |
| Production never exercises the job until 2027-08-30                                                 | High       | Seeded back-dated rows (both dates) in CI are the standing proof                                                                               |

## Rollback

Pre-first-run: revert the PRs — purely additive, no schema. Post-run: degraded rows are irreversible BY DESIGN; rollback stops further degradation and restores no plaintext; existing digests stay verifiable forever because ring entries are never deleted.

## Success Criteria

- [x] `deletion_record_overdue_plaintext` DRAINS to 0 on seeded back-dated rows, in the existing `integration:retention` batch.
- [x] Rotation round-trip proven: digest under v1 → append v2 + bump pointer → v1 row still verifies under its pinned version.
- [x] secretCatalog test green at 30; SECRETS.md runbook steps are the steps the round-trip test executes (seam stated honestly).
- [x] No plaintext name in any log line (unit-pinned); flag path logs row id only.
- [x] `schedulerTickTenantScope` suite green with the new tick; schema/migrations byte-untouched; audit.yml pin intact; fitness suite 0 new violations.

## The debatable point

Choosing HMAC-SHA-256 accepts that a JOINT ring+DB compromise makes low-entropy names dictionary-recoverable with no remediation; the counterweights are the CI-pinned in-tree contract, EDPB's own preference for keyed one-way functions, entropy+custody as the load-bearing mitigations, and cheap eternal verification. Also open to challenge: shipping `verifyNameDigest` with no product read surface — the alternative (no verifier at all) would leave the digest contract untestable after the first run, which is worse.
