/**
 * @file RedisBruteForceAdapter.ts
 * @description Redis-backed implementation of `BruteForceProtectionPort`.
 *
 *   Canon properties:
 *
 *   1. **Account-based primary** (identifier counter); IP throttle supletoria
 *      with high threshold (~100) so shared NAT / proxies don't false-positive.
 *   2. **Exponential backoff** with auto-expiry (1s → 300s cap, 30min window).
 *   3. **CAPTCHA threshold = 3** failures.
 *   4. **forgot-password bypass** — `isBypassForRecovery(identifier)` is
 *      OUT OF SCOPE for the adapter: the recovery flow MUST NOT call
 *      `checkLoginAttempt` (the caller controls bypass).
 *   5. **No `redis.keys()` O(N)** — `getStats` uses explicit counters
 *      (`bf:stats:*`) updated atomically on each lockout/block emit.
 *   6. **`AuditService` injection** — every state-changing call emits an
 *      audit event for the durable trail.
 *
 *   **Fail-open on Redis outage** (anti-DoS canon, OWASP Auth Cheat Sheet):
 *   try/catch wraps every Redis call. On error: `allowed=true`, warning log,
 *   metric increment, attempt proceeds without throttle. Operational alerting
 *   on the warning metric is REQUIRED.
 * @layer infrastructure
 */

import type { Redis } from "ioredis";
import type {
  BruteForceProtectionPort,
  CheckLoginAttemptInput,
  CheckLoginAttemptResult,
  RecordAttemptInput,
  BruteForceStats,
} from "@ports/core";
import { AuditResources, type AuditService } from "../../audit/auditService.js";
import type { ApiMetrics } from "../../metrics/apiMetrics.js";
import { authLogger } from "../../lib/logger.js";

/**
 * Tunable thresholds. Defaults align with NIST SP 800-63B-4 (rate-limit
 * + throttling) and OWASP Auth Cheat Sheet (CAPTCHA after few failures,
 * auto-expiry lockout).
 */
export interface RedisBruteForceConfig {
  /** Account-based: per-identifier failure threshold for the rate-limit
   * window (drives `attemptsRemaining`). Default 5. */
  readonly maxFailedAttemptsPerIdentifier: number;
  /** IP-based: high-threshold supletoria. Default 100 (canon: avoid
   * false-positive on shared NAT/proxies). */
  readonly maxFailedAttemptsPerIp: number;
  /** Rolling window over which failures are counted. Default 15 min. */
  readonly failureWindowMinutes: number;

  /** Exponential delay base (s). Default 1. */
  readonly baseDelaySeconds: number;
  /** Exponential delay cap (s). Default 300 (5 min, DoS-conscious). */
  readonly maxDelaySeconds: number;
  /** Exponential base multiplier. Default 2 (1s → 2s → 4s → 8s → ...). */
  readonly exponentialBase: number;

  /** Per-identifier failure count that triggers account lockout. Default 10. */
  readonly lockoutThreshold: number;
  /** Lockout TTL in minutes (auto-expiry, DoS-conscious). Default 30. */
  readonly lockoutDurationMinutes: number;

  /** IP-based block threshold (very high — supletoria). Default 200. */
  readonly ipBlockThreshold: number;
  /** IP block TTL in minutes. Default 60. */
  readonly ipBlockDurationMinutes: number;

  /** Failure count at which the `captchaRequired` flag flips on. Default 3. */
  readonly captchaThreshold: number;

  /** Optional namespace prefix to isolate Redis keys between instances
   * (e.g. per-test isolation). Empty by default. */
  readonly keyNamespace?: string;
}

const DEFAULT_CONFIG: RedisBruteForceConfig = {
  maxFailedAttemptsPerIdentifier: 5,
  maxFailedAttemptsPerIp: 100,
  failureWindowMinutes: 15,
  baseDelaySeconds: 1,
  maxDelaySeconds: 300,
  exponentialBase: 2,
  lockoutThreshold: 10,
  lockoutDurationMinutes: 30,
  ipBlockThreshold: 200,
  ipBlockDurationMinutes: 60,
  captchaThreshold: 3,
};

/** Redis key for the durable stats counters (incremented per lockout/block). */
const STATS_LOCKOUT_TOTAL = "bf:stats:lockout-total";
const STATS_IP_BLOCK_TOTAL = "bf:stats:ip-block-total";
const STATS_RECENT_FAILURES = "bf:stats:recent-failures";
const STATS_SUSPICIOUS = "bf:stats:suspicious-total";

export class RedisBruteForceAdapter implements BruteForceProtectionPort {
  private readonly config: RedisBruteForceConfig;
  private readonly emailFailuresPrefix: string;
  private readonly ipFailuresPrefix: string;
  private readonly accountLockoutPrefix: string;
  private readonly ipBlockPrefix: string;

  constructor(
    private readonly redis: Redis,
    private readonly auditService: AuditService,
    private readonly metrics: ApiMetrics,
    config: Partial<RedisBruteForceConfig> = {}
  ) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    const ns = this.config.keyNamespace ? `${this.config.keyNamespace}:` : "";
    this.emailFailuresPrefix = `${ns}bf:email:`;
    this.ipFailuresPrefix = `${ns}bf:ip:`;
    this.accountLockoutPrefix = `${ns}bf:lockout:`;
    this.ipBlockPrefix = `${ns}bf:ipblock:`;
  }

  async checkLoginAttempt(input: CheckLoginAttemptInput): Promise<CheckLoginAttemptResult> {
    const { identifier, ip } = input;
    try {
      // IP block check (supletoria, high threshold).
      const ipBlock = await this.checkIpBlock(ip);
      if (ipBlock) {
        this.metrics.metrics.securityThreats.inc({
          threat_type: "blocked_ip_attempt",
          endpoint: "login",
        });
        return {
          allowed: false,
          delaySeconds: 0,
          captchaRequired: false,
          lockoutExpiresAt: ipBlock,
          reason: "ip_block",
        };
      }

      // Account lockout check (primary canon).
      const lockoutExpiresAt = await this.checkAccountLockout(identifier);
      if (lockoutExpiresAt) {
        this.metrics.metrics.securityThreats.inc({
          threat_type: "lockout_attempt",
          endpoint: "login",
        });
        return {
          allowed: false,
          delaySeconds: 0,
          captchaRequired: false,
          lockoutExpiresAt,
          reason: "account_lockout",
        };
      }

      // Compute throttle + captcha signals from current counters.
      const [identifierFailures, ipFailures] = await Promise.all([
        this.getRecentFailures(this.emailFailuresPrefix + identifier),
        this.getRecentFailures(this.ipFailuresPrefix + ip),
      ]);
      const delaySeconds = this.calculateDelay(identifierFailures);
      const captchaRequired =
        identifierFailures >= this.config.captchaThreshold ||
        ipFailures >= this.config.captchaThreshold;

      return {
        allowed: true,
        delaySeconds,
        captchaRequired,
      };
    } catch (error) {
      // Fail-open: allow login, log warning, emit metric (anti-DoS canon).
      authLogger.warn(
        { err: error, identifier, ip },
        "BF adapter: Redis outage on checkLoginAttempt — failing open (anti-DoS)"
      );
      this.metrics.metrics.securityThreats.inc({
        threat_type: "bf_adapter_failure",
        endpoint: "login",
      });
      return { allowed: true, delaySeconds: 0, captchaRequired: false };
    }
  }

  async recordFailedAttempt(input: RecordAttemptInput): Promise<void> {
    const { identifier, ip, userAgent, failureReason } = input;
    const timestamp = Date.now();
    try {
      // Per-identifier counter (sorted-set timestamps for window-based count).
      await this.redis
        .multi()
        .zadd(this.emailFailuresPrefix + identifier, timestamp, `${timestamp}-${Math.random()}`)
        .expire(this.emailFailuresPrefix + identifier, this.config.failureWindowMinutes * 60)
        .exec();

      // Per-IP supletoria counter.
      await this.redis
        .multi()
        .zadd(this.ipFailuresPrefix + ip, timestamp, `${timestamp}-${Math.random()}`)
        .expire(this.ipFailuresPrefix + ip, this.config.failureWindowMinutes * 60)
        .exec();

      this.metrics.metrics.securityThreats.inc({
        threat_type: "failed_login",
        endpoint: "login",
      });
      await this.redis.incr(STATS_RECENT_FAILURES);
      await this.redis.expire(STATS_RECENT_FAILURES, this.config.failureWindowMinutes * 60);

      // Lockout check (account primary).
      await this.checkAndApplyAccountLockout(identifier);
      // IP block check (supletoria).
      await this.checkAndApplyIpBlock(ip);

      // Audit trail (durable).
      await this.auditService.log({
        action: "LOGIN_FAILURE",
        resource: AuditResources.USER,
        details: { identifier, ip, userAgent, reason: failureReason ?? "unspecified" },
        success: false,
      });
    } catch (error) {
      authLogger.warn(
        { err: error, identifier, ip },
        "BF adapter: Redis outage on recordFailedAttempt — best-effort, attempt proceeds"
      );
    }
  }

  async recordSuccessfulAttempt(input: Omit<RecordAttemptInput, "failureReason">): Promise<void> {
    const { identifier, ip, userAgent } = input;
    try {
      await Promise.all([
        this.redis.del(this.emailFailuresPrefix + identifier),
        this.redis.del(this.accountLockoutPrefix + identifier),
        // IP counter kept (IP could be compromised across multiple targets).
      ]);

      await this.auditService.log({
        action: "LOGIN_SUCCESS",
        resource: AuditResources.USER,
        details: { identifier, ip, userAgent },
        success: true,
      });
    } catch (error) {
      authLogger.warn(
        { err: error, identifier, ip },
        "BF adapter: Redis outage on recordSuccessfulAttempt — best-effort"
      );
    }
  }

  async unlockAccount(identifier: string, byAdminId: string): Promise<boolean> {
    try {
      const wasLocked = await this.redis.exists(this.accountLockoutPrefix + identifier);
      if (!wasLocked) return false;

      await Promise.all([
        this.redis.del(this.accountLockoutPrefix + identifier),
        this.redis.del(this.emailFailuresPrefix + identifier),
      ]);

      await this.auditService.log({
        userId: byAdminId,
        action: "ACCOUNT_UNLOCKED",
        resource: AuditResources.USER,
        details: { identifier, adminOverride: true },
        success: true,
      });
      authLogger.info({ identifier, byAdminId }, "Account unlocked by admin");
      return true;
    } catch (error) {
      authLogger.error({ err: error, identifier }, "BF adapter: error in unlockAccount");
      return false;
    }
  }

  async unblockIp(ip: string, byAdminId: string): Promise<boolean> {
    try {
      const wasBlocked = await this.redis.exists(this.ipBlockPrefix + ip);
      if (!wasBlocked) return false;

      await Promise.all([
        this.redis.del(this.ipBlockPrefix + ip),
        this.redis.del(this.ipFailuresPrefix + ip),
      ]);

      await this.auditService.log({
        userId: byAdminId,
        action: "IP_UNBLOCKED",
        resource: "IP_ADDRESS",
        details: { ip, adminOverride: true },
        success: true,
      });
      authLogger.info({ ip, byAdminId }, "IP unblocked by admin");
      return true;
    } catch (error) {
      authLogger.error({ err: error, ip }, "BF adapter: error in unblockIp");
      return false;
    }
  }

  async getStats(): Promise<BruteForceStats> {
    // Canon: no redis.keys() O(N). Counters maintained explicitly on each
    // lockout / block emit. Stats reflect cumulative totals + window-based
    // failures (TTL'd).
    try {
      const [lockoutTotal, ipBlockTotal, recentFailures, suspicious] = await Promise.all([
        this.redis.get(STATS_LOCKOUT_TOTAL),
        this.redis.get(STATS_IP_BLOCK_TOTAL),
        this.redis.get(STATS_RECENT_FAILURES),
        this.redis.get(STATS_SUSPICIOUS),
      ]);
      return {
        lockedAccounts: parseInt(lockoutTotal ?? "0", 10),
        blockedIps: parseInt(ipBlockTotal ?? "0", 10),
        recentFailures: parseInt(recentFailures ?? "0", 10),
        suspiciousActivities: parseInt(suspicious ?? "0", 10),
      };
    } catch (error) {
      authLogger.warn({ err: error }, "BF adapter: error reading stats counters");
      return { lockedAccounts: 0, blockedIps: 0, recentFailures: 0, suspiciousActivities: 0 };
    }
  }

  // ─── Private helpers ────────────────────────────────────────────────────

  private async checkAccountLockout(identifier: string): Promise<Date | undefined> {
    const raw = await this.redis.get(this.accountLockoutPrefix + identifier);
    if (!raw) return undefined;
    try {
      const { expiresAt } = JSON.parse(raw) as { expiresAt: string };
      const date = new Date(expiresAt);
      if (date > new Date()) return date;
      await this.redis.del(this.accountLockoutPrefix + identifier);
      return undefined;
    } catch {
      // Malformed lockout data → drop it.
      await this.redis.del(this.accountLockoutPrefix + identifier);
      return undefined;
    }
  }

  private async checkIpBlock(ip: string): Promise<Date | undefined> {
    const raw = await this.redis.get(this.ipBlockPrefix + ip);
    if (!raw) return undefined;
    try {
      const { expiresAt } = JSON.parse(raw) as { expiresAt: string };
      const date = new Date(expiresAt);
      if (date > new Date()) return date;
      await this.redis.del(this.ipBlockPrefix + ip);
      return undefined;
    } catch {
      await this.redis.del(this.ipBlockPrefix + ip);
      return undefined;
    }
  }

  private async getRecentFailures(key: string): Promise<number> {
    const cutoff = Date.now() - this.config.failureWindowMinutes * 60 * 1000;
    return this.redis.zcount(key, cutoff, "+inf");
  }

  private calculateDelay(failures: number): number {
    if (failures <= 0) return 0;
    const delay =
      this.config.baseDelaySeconds * Math.pow(this.config.exponentialBase, failures - 1);
    return Math.min(delay, this.config.maxDelaySeconds);
  }

  private async checkAndApplyAccountLockout(identifier: string): Promise<void> {
    const failures = await this.getRecentFailures(this.emailFailuresPrefix + identifier);
    if (failures < this.config.lockoutThreshold) return;

    const expiresAt = new Date(Date.now() + this.config.lockoutDurationMinutes * 60 * 1000);
    await this.redis.setex(
      this.accountLockoutPrefix + identifier,
      this.config.lockoutDurationMinutes * 60,
      JSON.stringify({ expiresAt: expiresAt.toISOString(), reason: "brute_force_threshold" })
    );
    await this.redis.incr(STATS_LOCKOUT_TOTAL);

    await this.auditService.log({
      action: "ACCOUNT_LOCKED",
      resource: AuditResources.USER,
      details: {
        identifier,
        reason: "brute_force_threshold",
        failureCount: failures,
        lockoutMinutes: this.config.lockoutDurationMinutes,
      },
      success: true,
    });
    this.metrics.metrics.securityThreats.inc({
      threat_type: "account_locked",
      endpoint: "login",
    });
    authLogger.warn({ identifier, failures }, "Account locked by BF protection");
  }

  private async checkAndApplyIpBlock(ip: string): Promise<void> {
    const failures = await this.getRecentFailures(this.ipFailuresPrefix + ip);
    if (failures < this.config.ipBlockThreshold) return;

    const expiresAt = new Date(Date.now() + this.config.ipBlockDurationMinutes * 60 * 1000);
    await this.redis.setex(
      this.ipBlockPrefix + ip,
      this.config.ipBlockDurationMinutes * 60,
      JSON.stringify({ expiresAt: expiresAt.toISOString(), reason: "ip_threshold" })
    );
    await this.redis.incr(STATS_IP_BLOCK_TOTAL);

    await this.auditService.log({
      action: "IP_BLOCKED",
      resource: "IP_ADDRESS",
      details: {
        ip,
        reason: "brute_force_ip_threshold",
        failureCount: failures,
      },
      success: true,
    });
    this.metrics.metrics.securityThreats.inc({
      threat_type: "ip_blocked",
      endpoint: "login",
    });
    authLogger.warn({ ip, failures }, "IP blocked by BF protection");
  }
}
