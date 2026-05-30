/**
 * @file BruteForceProtectionPort.ts
 * @description Port for brute-force / credential-stuffing protection across
 *   customer + admin login. Canon-aligned per NIST SP 800-63B-4 > rate-limiting
 *   + OWASP Authentication Cheat Sheet:
 *
 *   - **Account-based primary**: counter keyed by identifier (email/username)
 *     so an attacker rotating IPs cannot bypass. IP throttle is supletoria
 *     (high threshold) to deter blast-radius without false-positives on
 *     shared NAT / proxies.
 *   - **Exponential backoff with auto-expiry**: progressive delays (1s → 300s
 *     cap) that expire on success or after a lockout window. DoS-conscious:
 *     attacking someone else's account doesn't indefinitely block them.
 *   - **CAPTCHA after N**: signalled via `captchaRequired` after a few
 *     failures (canon: not preventive on first attempt, defense-in-depth).
 *   - **forgot-password bypass**: account-recovery flow must proceed even
 *     while locked (anti-DoS canon — attacker MUST NOT be able to lock a
 *     victim out of recovery).
 *   - **Fail-open on adapter outage**: if the underlying store (Redis) is
 *     unreachable, return `allowed=true` and emit a warning + metric. Anti-DoS
 *     (alternative: every Redis blip locks everyone out → worse DoS surface).
 *     Operational alerting on the warning metric is REQUIRED.
 *
 *   References:
 *   - NIST SP 800-63B-4 > Rate Limiting — verifier SHALL implement per-account
 *     limit, prefers throttling over hard lockout.
 *   - OWASP Auth Cheat Sheet > Account Lockout — counter per account not IP;
 *     auto-expiry; CAPTCHA after few failures; MFA is defense #1.
 * @layer domain
 */

/**
 * Input for checking whether a login attempt should proceed.
 */
export interface CheckLoginAttemptInput {
  /** Account identifier (email or username). Canon-primary key for the
   * counter — IP rotation does not bypass. */
  readonly identifier: string;
  /** Source IP. Used for supletoria IP throttle (high threshold) and
   * anomaly detection (rapid distributed attempts from one identifier
   * across many IPs). */
  readonly ip: string;
  /** Source user-agent. Persisted for audit + anomaly signals (e.g. tooling
   * fingerprints). */
  readonly userAgent: string;
}

/**
 * Outcome of a brute-force check. The caller (login use-case) MUST honour
 * `allowed` (hard gate) and SHOULD honour `delaySeconds` (await before
 * answering, to throttle the attacker) and `captchaRequired` (signal the
 * client to challenge).
 */
export interface CheckLoginAttemptResult {
  /** Whether the login attempt may proceed. False when the account is in
   * lockout, the IP is blocked, or anomaly detection tripped. */
  readonly allowed: boolean;
  /** Exponential throttle delay the caller SHOULD await before responding.
   * 0 means no throttle. Capped at 300s per canon (DoS-conscious). */
  readonly delaySeconds: number;
  /** Whether the response should request a CAPTCHA challenge from the
   * client. Becomes true after N failures (defense-in-depth, not
   * preventive). */
  readonly captchaRequired: boolean;
  /** When `allowed=false`, the moment the lockout/block expires. Useful
   * for showing "try again at HH:MM" to legitimate users locked by an
   * attacker. */
  readonly lockoutExpiresAt?: Date;
  /** Machine-readable reason when `allowed=false`. */
  readonly reason?: "rate_limit" | "account_lockout" | "ip_block" | "anomaly";
}

/**
 * Input for recording a login attempt outcome (failed or successful).
 * Identifier-keyed; IP + userAgent are forensic metadata.
 */
export interface RecordAttemptInput {
  readonly identifier: string;
  readonly ip: string;
  readonly userAgent: string;
  /** For failed attempts only — short machine-readable reason
   * (e.g., `"INVALID_PASSWORD"`, `"USER_NOT_FOUND"`, `"MFA_FAILED"`).
   * Drives the audit trail; NOT echoed to the client (enumeration risk). */
  readonly failureReason?: string;
}

/**
 * Aggregated counts for ops introspection / dashboard. Per-process or
 * per-cluster depending on the adapter — see adapter docs for exact scope.
 */
export interface BruteForceStats {
  readonly lockedAccounts: number;
  readonly blockedIps: number;
  readonly recentFailures: number;
  readonly suspiciousActivities: number;
}

/**
 * Port interface for brute-force protection. Canonical surface for both
 * customer (`LoginCustomerUseCase`) and admin (`AdminAuthService.login`)
 * login flows. The adapter encapsulates the storage backend (Redis for
 * throttle state) and the audit trail (via injected `AuditService`).
 *
 * Implementations MUST be safe to inject as a singleton; per-call state
 * is the responsibility of the storage backend.
 */
export interface BruteForceProtectionPort {
  /**
   * Decide whether a login attempt should proceed, and signal CAPTCHA /
   * throttle to the caller. Idempotent — call once per attempt before
   * verifying credentials.
   */
  checkLoginAttempt(input: CheckLoginAttemptInput): Promise<CheckLoginAttemptResult>;

  /**
   * Record a failed attempt. Increments per-identifier + per-IP counters,
   * computes the next exponential delay, sets lockout if the threshold is
   * crossed, and emits an audit event (via the injected `AuditService`)
   * for the durable trail.
   */
  recordFailedAttempt(input: RecordAttemptInput): Promise<void>;

  /**
   * Record a successful attempt. Resets per-identifier counters (clears
   * delay + captcha flag), keeps IP throttle (IP could still be
   * compromised across multiple targets), and emits an audit event.
   */
  recordSuccessfulAttempt(input: Omit<RecordAttemptInput, "failureReason">): Promise<void>;

  /**
   * Admin override: clear the lockout for an account. Records an audit
   * event attributing the unlock to `byAdminId`.
   *
   * @returns `true` if a lockout was actually cleared, `false` if no
   *   lockout was active (idempotent).
   */
  unlockAccount(identifier: string, byAdminId: string): Promise<boolean>;

  /**
   * Admin override: clear the IP block for a source IP. Records an audit
   * event attributing the unblock to `byAdminId`.
   */
  unblockIp(ip: string, byAdminId: string): Promise<boolean>;

  /**
   * Aggregated counts for ops dashboards. Cost varies by adapter; the
   * Redis adapter MUST NOT use `KEYS *` patterns (O(N)) — see adapter docs.
   */
  getStats(): Promise<BruteForceStats>;
}
