# Runbook — `MfaBackupCodeReuseRejected`

> Alert: `prometheus/alerts/api.yml`
> Metric: `api_security_threats_total{threat_type="mfa_backup_code_reuse", endpoint="mfa_verify"}`
> **Routing pending OBS-6** (Master Plan §5.2, roadmap §4.2.c): today ALL the rules of this repo are EVALUATED but not delivered — the `alertmanagers:` block of `prometheus/prometheus.yml` is commented out. Nobody receives a push notification for this; someone has to look at it.

## Symptom

A backup code claim was refused at least once in the last 15 minutes. The
MFA service emitted the audit event `MFA_BACKUP_CODE_REUSE_REJECTED` (severity
HIGH) and incremented the threat counter. The refused attempt never gets a session: the
verification ends in `INVALID_TOKEN`.

## Severity: WARNING

The alert is `warning` even though the audit event is HIGH. The reason is the false positive
documented below: an isolated refusal may be a collision between legitimate claims
rather than an attack. A sustained refusal is a signal and escalates per the last section.

## Expected volume profile

This point is the main difference from the previous behavior, and it is worth reading
before interpreting the series.

- **Before**: the HIGH event was emitted only when the write lost the race, that
  is, only in the interleaving in which the attack had already failed.
- **Now**: the event is emitted on **every refusal the adapter returns**, whatever
  interleaving produced it — the staggered attack, concurrent reuse and replays
  against an already stale snapshot.
- Sequential replays against a fresh snapshot are still filtered in the service (the
  argon2 cost optimization) and end as `MFA_VERIFICATION_FAILED` (MEDIUM), as
  before.

Consequently the steady-state volume stays near zero, and **any sustained emission
is a signal, not noise**. The threshold is tuned here, in the alert rule, never by
suppressing the emission in the code.

## Step-by-step diagnosis

1. **Isolate the subject**: search `AuditLog` for the rows with
   `action = "MFA_BACKUP_CODE_REUSE_REJECTED"` from the last 15 minutes. The row identifies
   the subject (admin or customer) and the account; it holds no TOTP secret, backup code or hash.
2. **Count the attempts per subject**: a single isolated refusal for one subject is compatible with
   the false positive below. Several refusals for the same subject, or refusals for several
   subjects in the same window, are not.
3. **Correlate with successful logins**: check whether the same code was consumed successfully
   immediately before the refusal. A successful consumption followed by a refusal of the same index
   is exactly the signature of the staggered attack — the attacker presented an already used code.
4. **Check the origin**: correlate the IPs and user agents of the attempts. A successful
   consumption and a refusal from different origins indicate the recovery credential is
   compromised.
5. **Check the whole series**: in Prometheus, `increase(api_security_threats_total{threat_type="mfa_backup_code_reuse"}[1h])`
   to see whether it is a one-off spike or a trend.

## Accepted false positive — collision between sibling claims

Two concurrent verifications of the **same user** that consume backup codes of **different
indexes** can collide: one wins and the other is refused. In that case:

- the code of the refused call **is not left consumed**;
- the alert is emitted although that attempt did not deserve it;
- **the right response is for the user to retry**, and the retry succeeds.

It is a small availability problem, never a lost credential, and it has existed in identical
form since before this change. It is deliberately left unresolved here: widening the scope
to remove it would trade a single-concern security fix for an availability
convenience.

## Remediation

- **Confirmed reuse** (a prior successful consumption of the same index, or different
  origins): treat the subject's backup codes as compromised. Regenerate the full set
  (`regenerateBackupCodes` invalidates every previous code) and notify the user.
- **Suspected account compromise**: besides regenerating, review the subject's active
  sessions and force a re-login.
- **Isolated refusal, with no prior successful consumption of the same index**: most likely the
  collision between siblings. Confirm that the user could complete the login on the retry, and
  close with no further action.
- **Sustained emission with no single subject**: check whether a client is automatically
  retrying a failed verification; an automatic retry of the claim violates the
  port's contract, which requires refusing and not retrying.

## When to escalate

- Confirmed reuse on an admin subject → escalate immediately to the security
  team.
- More than one subject affected in the same window → a possible campaign; escalate.
- Sustained emission for more than an hour with no identified cause → escalate to the backend team.

## Links

- Alert rule: `prometheus/alerts/api.yml` (`MfaBackupCodeReuseRejected`)
- Claim contract: `packages/ports/src/MfaUserRepositoryPort.ts` (`markBackupCodeUsed`)
- Emission: `apps/api/src/admin/auth/MfaService.ts` (`verifyMfaToken`)
- Counter: `apps/api/src/metrics/apiMetrics.ts` (`securityThreats`)
