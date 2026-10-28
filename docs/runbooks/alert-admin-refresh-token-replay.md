# Runbook — `AdminRefreshTokenReplayRejected`

> Alert: `prometheus/alerts/api.yml`
> Metric: `api_security_threats_total{threat_type="admin_refresh_token_replay", endpoint="admin_auth_refresh"}`
> **Routing pending §4.2.c**: today ALL the rules of this repo are EVALUATED but not delivered — the `alertmanagers:` block of `prometheus/prometheus.yml` is commented out. Nobody receives a push notification for this; someone has to look at it.

## Symptom

The refresh token rotation claim (`AuthServiceSession.refreshTokens`) refused at least
one attempt in the last 15 minutes because the presented token HAD ALREADY been rotated. The
service emitted the audit event with `reason = "ROTATED_TOKEN_REPLAYED"` (severity
HIGH) and incremented the threat counter. The refused attempt gets no new pair:
it ends in `TOKEN_BLACKLISTED`, and the pair it got as far as minting is never written to any row.

## Severity: WARNING

The alert is `warning` even though the audit event is HIGH, because of the false positive
documented below: an isolated refusal is compatible with two tabs refreshing at the
same time. A sustained refusal is a signal and escalates per the last section.

## Expected volume profile

Read this BEFORE interpreting the series. Honesty matters more here than reassurance:
this series **is not at zero by construction**, and the reason is a scope decision that
was taken knowingly.

- **Steady state: near zero.** A normal refresh rotates its own token and does not present it
  again.
- **An in-flight revocation does NOT emit this series.** A logout, an administrative revocation or
  a mass revocation that commits between the read and the write of the claim also makes
  the claim match zero rows. That is an ordinary sign-out, not an attack: the
  code tells it apart with a re-read of the row and audits it as
  `SESSION_REVOKED_MIDFLIGHT` (MEDIUM), **without** touching the counter. If that re-read comes
  late (the revocation commits AFTER it), the verdict falls on the noisy side and is
  reported as a replay — the conservative direction, chosen on purpose.
- **Two tabs refreshing at the same time CAN emit it.** It is the false positive below.
- **The token family is NOT revoked on a detection.** See "What this alert does NOT do".

## Accepted false positive — simultaneous refresh from two clients

Two tabs (or a tab and a background call) of the **same admin** can present
the same refresh token almost at once. One wins the rotation and the other is refused. In that case:

- the loser's pair **is never stored** and no credential is left dangling;
- the alert is emitted although that attempt did not deserve it;
- **the right response is for the user to sign in again** in that tab.

It is an availability problem, never a lost credential. It is deliberately left unresolved
here.

## What this alert does NOT do — deferred family revocation

A detected replay is refused but **does not revoke the rest of the session family**. If the
one who lost the race was the legitimate holder, the attacker's pair stays alive until it
expires. Acting on the detection (revoking the family, in the style of OAuth refresh-token
reuse detection) is work of its own and goes together with the customer refresh flow,
which today has no server-side rotation at all: **SMELL-113**. Until that work
lands, the remediation below is MANUAL.

## Step-by-step diagnosis

1. **Isolate the subject**: search `AuditLog` for the rows of the last 15 minutes whose
   `details.reason` is `ROTATED_TOKEN_REPLAYED`. The row carries `details.tokenHash` (the
   first 16 hex of the SHA-256 of the presented token — never the token) and, if the client
   sent them, the fingerprint hash, the IP and the user agent.
2. **Separate it from in-flight revocation**: count, in the same window, the rows with
   `reason = "SESSION_REVOKED_MIDFLIGHT"`. If they dominate, what you have is normal session
   rotation and not a replay; that series does not feed the counter.
3. **Count by `tokenHash`**: a single refusal for one `tokenHash` is compatible with the
   false positive above. Several refusals of the same hash, or refusals of several hashes in
   the same window, are not.
4. **Check the origin**: compare the IP and user agent of the refusal against those of the
   successful rotation immediately before it (the `SESSION_CREATED` event with `category: AUTHENTICATION`,
   severity LOW, which does carry `sessionId`). Different origins = the refresh token is
   compromised.
5. **Check the whole series**: in Prometheus,
   `increase(api_security_threats_total{threat_type="admin_refresh_token_replay"}[1h])` to
   tell a one-off spike from a trend.

## Remediation

- **Confirmed replay** (different origins, or several refusals of the same hash): treat the
  session as compromised. Revoke ALL of the admin's sessions
  (`AuthService.revokeAllSessions`) and force a re-login; family revocation is not
  automatic (see above).
- **Suspected account compromise**: besides revoking, review MFA and consider a password
  reset.
- **Isolated refusal, same origin, same user agent**: almost certainly the simultaneous refresh.
  Confirm that the admin could sign in again, and close with no further action.
- **Sustained emission with no single subject**: check whether a client automatically retries a
  failed refresh. An automatic retry on an already rotated token produces exactly this
  series and is not an attack; it is a client bug.

## When to escalate

- A confirmed replay on any admin subject → escalate immediately to the security
  team (the admin surface is the most privileged in the system).
- More than one `tokenHash` affected in the same window → a possible campaign; escalate.
- Sustained emission for more than an hour with no identified cause → escalate to the backend team.

## Links

- Alert rule: `prometheus/alerts/api.yml` (`AdminRefreshTokenReplayRejected`)
- Emission: `apps/api/src/auth/authServiceSession.ts` (`refreshTokens`)
- Counter: `apps/api/src/metrics/apiMetrics.ts` (`securityThreats`)
- Sibling alert, same shape: `docs/runbooks/alert-mfa-backup-code-reuse.md`
