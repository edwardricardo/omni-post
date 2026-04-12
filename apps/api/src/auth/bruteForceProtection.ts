/**
 * @file bruteForceProtection.ts
 * @description Brute force protection service with progressive delay, IP/email tracking,
 *              account lockout, CAPTCHA integration support, and anomaly detection.
 * @layer infrastructure
 */

import Redis from "ioredis";
import { randomUUID } from "crypto";
import type { ApiMetrics } from "../metrics/apiMetrics.js";
import { auditService, AuditResources } from "../audit/auditService.js";
import { authLogger } from "../lib/logger.js";

export interface BruteForceConfig {
  // Failure tracking
  maxFailedAttemptsPerEmail: number;
  maxFailedAttemptsPerIp: number;
  failureWindowMinutes: number;

  // Progressive delays
  baseDelaySeconds: number;
  maxDelaySeconds: number;
  exponentialBase: number;

  // Account lockout
  lockoutThreshold: number;
  lockoutDurationMinutes: number;
  lockoutWindowHours: number;

  // IP blocking
  ipBlockThreshold: number;
  ipBlockDurationMinutes: number;

  // CAPTCHA
  captchaThreshold: number;
  captchaEnabled: boolean;

  // Anomaly detection
  anomalyDetectionEnabled: boolean;
  suspiciousActivityThreshold: number;

  /**
   * Optional key namespace prefix for Redis keys.
   * Use this to isolate multiple instances sharing the same Redis DB
   * (e.g. in tests: each test file uses a unique prefix to avoid interference).
   * Defaults to "" (no extra prefix — keys start with "bf:").
   */
  keyNamespace?: string;
}

interface LoginAttemptInfo {
  email: string;
  ipAddress: string;
  userAgent: string;
  success: boolean;
  timestamp: Date;
  delayApplied?: number;
  captchaRequired?: boolean;
  reason?: string;
}

interface ProtectionResult {
  allowed: boolean;
  delaySeconds: number;
  captchaRequired: boolean;
  reason?: string;
  attemptsRemaining?: number;
  lockoutExpiresAt?: Date;
}

interface SuspiciousActivity {
  type: "RAPID_FAILURES" | "DISTRIBUTED_ATTACK" | "CREDENTIAL_STUFFING" | "IP_HOPPING";
  severity: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
  description: string;
  metadata: Record<string, any>;
}

export class BruteForceProtection {
  private readonly redis: Redis;
  private readonly metrics: ApiMetrics;
  private readonly config: BruteForceConfig;

  // Redis key prefixes (may include a per-instance namespace for test isolation)
  private readonly EMAIL_FAILURES_PREFIX: string;
  private readonly IP_FAILURES_PREFIX: string;
  private readonly ACCOUNT_LOCKOUT_PREFIX: string;
  private readonly IP_BLOCK_PREFIX: string;
  private readonly DELAY_TRACKER_PREFIX: string;
  private readonly ANOMALY_TRACKER_PREFIX: string;
  private readonly LOGIN_ATTEMPTS_PREFIX: string;

  constructor(redis: Redis, metrics: ApiMetrics, config?: Partial<BruteForceConfig>) {
    this.redis = redis;
    this.metrics = metrics;

    this.config = {
      maxFailedAttemptsPerEmail: 5,
      maxFailedAttemptsPerIp: 20,
      failureWindowMinutes: 15,

      baseDelaySeconds: 1,
      maxDelaySeconds: 300, // 5 minutes
      exponentialBase: 2,

      lockoutThreshold: 10,
      lockoutDurationMinutes: 30,
      lockoutWindowHours: 1,

      ipBlockThreshold: 50,
      ipBlockDurationMinutes: 60,

      captchaThreshold: 3,
      captchaEnabled: true,

      anomalyDetectionEnabled: true,
      suspiciousActivityThreshold: 10,

      ...config,
    };

    const ns = this.config.keyNamespace ? `${this.config.keyNamespace}:` : "";
    this.EMAIL_FAILURES_PREFIX = `${ns}bf:email:`;
    this.IP_FAILURES_PREFIX = `${ns}bf:ip:`;
    this.ACCOUNT_LOCKOUT_PREFIX = `${ns}bf:lockout:`;
    this.IP_BLOCK_PREFIX = `${ns}bf:ipblock:`;
    this.DELAY_TRACKER_PREFIX = `${ns}bf:delay:`;
    this.ANOMALY_TRACKER_PREFIX = `${ns}bf:anomaly:`;
    this.LOGIN_ATTEMPTS_PREFIX = `${ns}login_attempts:`;

    authLogger.info(
      "Brute Force Protection initialized with progressive delays and account lockout"
    );
  }

  /**
   * Check if login attempt should be allowed and calculate delays
   */
  async checkLoginAttempt(
    email: string,
    ipAddress: string,
    userAgent: string
  ): Promise<ProtectionResult> {
    try {
      // Check if IP is blocked
      const ipBlockResult = await this.checkIpBlock(ipAddress);
      if (!ipBlockResult.allowed) {
        return ipBlockResult;
      }

      // Check if account is locked out
      const lockoutResult = await this.checkAccountLockout(email);
      if (!lockoutResult.allowed) {
        return lockoutResult;
      }

      // Get failure counts
      const [emailFailures, ipFailures] = await Promise.all([
        this.getRecentFailures(this.EMAIL_FAILURES_PREFIX + email),
        this.getRecentFailures(this.IP_FAILURES_PREFIX + ipAddress),
      ]);

      // Calculate delay based on failures
      const emailDelay = this.calculateDelay(emailFailures);
      const ipDelay = this.calculateDelay(ipFailures);
      const delaySeconds = Math.max(emailDelay, ipDelay);

      // Check if CAPTCHA is required
      const captchaRequired =
        this.config.captchaEnabled &&
        (emailFailures >= this.config.captchaThreshold ||
          ipFailures >= this.config.captchaThreshold);

      // Log the attempt
      await this.logAttempt({
        email,
        ipAddress,
        userAgent,
        success: false, // Will be updated after actual login attempt
        timestamp: new Date(),
        delayApplied: delaySeconds,
        captchaRequired,
      });

      return {
        allowed: true,
        delaySeconds,
        captchaRequired,
        attemptsRemaining: Math.max(0, this.config.maxFailedAttemptsPerEmail - emailFailures),
      };
    } catch (error) {
      authLogger.error({ err: error }, "Error checking login attempt");
      // Fail safe - allow with minimal delay
      return {
        allowed: true,
        delaySeconds: this.config.baseDelaySeconds,
        captchaRequired: false,
        reason: "Protection system error",
      };
    }
  }

  /**
   * Record a failed login attempt
   */
  async recordFailedAttempt(
    email: string,
    ipAddress: string,
    userAgent: string,
    reason: string
  ): Promise<void> {
    const timestamp = Date.now();

    try {
      // Record email-based failure
      await this.redis
        .multi()
        .zadd(this.EMAIL_FAILURES_PREFIX + email, timestamp, timestamp)
        .expire(this.EMAIL_FAILURES_PREFIX + email, this.config.failureWindowMinutes * 60)
        .exec();

      // Record IP-based failure
      await this.redis
        .multi()
        .zadd(this.IP_FAILURES_PREFIX + ipAddress, timestamp, timestamp)
        .expire(this.IP_FAILURES_PREFIX + ipAddress, this.config.failureWindowMinutes * 60)
        .exec();

      // Update metrics
      this.metrics.metrics.securityThreats.inc({
        threat_type: "failed_login",
        endpoint: "login",
      });

      // Check for lockout conditions
      await this.checkAndApplyLockout(email, ipAddress);

      // Check for suspicious activity
      if (this.config.anomalyDetectionEnabled) {
        await this.detectSuspiciousActivity(email, ipAddress, userAgent);
      }

      // Log the failed attempt
      await this.logAttempt({
        email,
        ipAddress,
        userAgent,
        success: false,
        timestamp: new Date(),
        reason,
      });

      authLogger.warn({ email, ipAddress, reason }, "Failed login attempt recorded");
    } catch (error) {
      authLogger.error({ err: error }, "Error recording failed attempt");
    }
  }

  /**
   * Record a successful login attempt
   */
  async recordSuccessfulAttempt(
    email: string,
    ipAddress: string,
    userAgent: string
  ): Promise<void> {
    try {
      // Clear recent failures for this email and IP
      await Promise.all([
        this.redis.del(this.EMAIL_FAILURES_PREFIX + email),
        this.redis.del(this.IP_FAILURES_PREFIX + ipAddress),
      ]);

      // Log successful attempt
      await this.logAttempt({
        email,
        ipAddress,
        userAgent,
        success: true,
        timestamp: new Date(),
      });

      authLogger.info({ email, ipAddress }, "Successful login recorded");
    } catch (error) {
      authLogger.error({ err: error }, "Error recording successful attempt");
    }
  }

  /**
   * Check if account is currently locked out
   */
  async checkAccountLockout(email: string): Promise<ProtectionResult> {
    try {
      const lockoutInfo = await this.redis.get(this.ACCOUNT_LOCKOUT_PREFIX + email);

      if (lockoutInfo) {
        const { expiresAt, reason: _reason } = JSON.parse(lockoutInfo);
        const expirationDate = new Date(expiresAt);

        if (expirationDate > new Date()) {
          this.metrics.metrics.securityThreats.inc({
            threat_type: "lockout_attempt",
            endpoint: "login",
          });

          return {
            allowed: false,
            delaySeconds: 0,
            captchaRequired: false,
            reason: "Account temporarily locked",
            lockoutExpiresAt: expirationDate,
          };
        } else {
          // Lockout expired, remove it
          await this.redis.del(this.ACCOUNT_LOCKOUT_PREFIX + email);
        }
      }

      return {
        allowed: true,
        delaySeconds: 0,
        captchaRequired: false,
      };
    } catch (error) {
      authLogger.error({ err: error }, "Error checking account lockout");
      return {
        allowed: true,
        delaySeconds: 0,
        captchaRequired: false,
      };
    }
  }

  /**
   * Check if IP is currently blocked
   */
  async checkIpBlock(ipAddress: string): Promise<ProtectionResult> {
    try {
      const blockInfo = await this.redis.get(this.IP_BLOCK_PREFIX + ipAddress);

      if (blockInfo) {
        const { expiresAt, reason: _reason } = JSON.parse(blockInfo);
        const expirationDate = new Date(expiresAt);

        if (expirationDate > new Date()) {
          this.metrics.metrics.securityThreats.inc({
            threat_type: "blocked_ip_attempt",
            endpoint: "login",
          });

          return {
            allowed: false,
            delaySeconds: 0,
            captchaRequired: false,
            reason: "IP address temporarily blocked",
            lockoutExpiresAt: expirationDate,
          };
        } else {
          // Block expired, remove it
          await this.redis.del(this.IP_BLOCK_PREFIX + ipAddress);
        }
      }

      return {
        allowed: true,
        delaySeconds: 0,
        captchaRequired: false,
      };
    } catch (error) {
      authLogger.error({ err: error }, "Error checking IP block");
      return {
        allowed: true,
        delaySeconds: 0,
        captchaRequired: false,
      };
    }
  }

  /**
   * Manually unlock account (admin override)
   */
  async unlockAccount(email: string, adminUserId: string): Promise<boolean> {
    try {
      const wasLocked = await this.redis.exists(this.ACCOUNT_LOCKOUT_PREFIX + email);

      if (wasLocked) {
        await Promise.all([
          this.redis.del(this.ACCOUNT_LOCKOUT_PREFIX + email),
          this.redis.del(this.EMAIL_FAILURES_PREFIX + email),
        ]);

        // Log admin unlock
        await auditService.log({
          userId: adminUserId,
          action: "ACCOUNT_UNLOCKED",
          resource: AuditResources.USER,
          details: {
            unlockedEmail: email,
            adminOverride: true,
          },
          success: true,
        });

        authLogger.info({ email, adminUserId }, "Account unlocked by admin");
        return true;
      }

      return false;
    } catch (error) {
      authLogger.error({ err: error }, "Error unlocking account");
      return false;
    }
  }

  /**
   * Manually unblock IP address (admin override)
   */
  async unblockIpAddress(ipAddress: string, adminUserId: string): Promise<boolean> {
    try {
      const wasBlocked = await this.redis.exists(this.IP_BLOCK_PREFIX + ipAddress);

      if (wasBlocked) {
        await Promise.all([
          this.redis.del(this.IP_BLOCK_PREFIX + ipAddress),
          this.redis.del(this.IP_FAILURES_PREFIX + ipAddress),
        ]);

        // Log admin unblock
        await auditService.log({
          userId: adminUserId,
          action: "IP_UNBLOCKED",
          resource: "IP_ADDRESS",
          details: {
            unblockedIp: ipAddress,
            adminOverride: true,
          },
          success: true,
        });

        authLogger.info({ ipAddress, adminUserId }, "IP address unblocked by admin");
        return true;
      }

      return false;
    } catch (error) {
      authLogger.error({ err: error }, "Error unblocking IP");
      return false;
    }
  }

  /**
   * Get protection statistics for monitoring
   */
  async getProtectionStats(): Promise<{
    lockedAccounts: number;
    blockedIps: number;
    recentFailures: number;
    suspiciousActivities: number;
  }> {
    try {
      const [lockedAccounts, blockedIps] = await Promise.all([
        this.redis.keys(this.ACCOUNT_LOCKOUT_PREFIX + "*"),
        this.redis.keys(this.IP_BLOCK_PREFIX + "*"),
      ]);

      // Count recent failures across all tracked entities
      const failureKeys = await this.redis.keys(this.EMAIL_FAILURES_PREFIX + "*");
      let recentFailures = 0;

      for (const key of failureKeys.slice(0, 100)) {
        // Limit to prevent performance issues
        const count = await this.redis.zcard(key);
        recentFailures += count;
      }

      const suspiciousActivities = (await this.redis.keys(this.ANOMALY_TRACKER_PREFIX + "*"))
        .length;

      return {
        lockedAccounts: lockedAccounts.length,
        blockedIps: blockedIps.length,
        recentFailures,
        suspiciousActivities,
      };
    } catch (error) {
      authLogger.error({ err: error }, "Error getting protection stats");
      return {
        lockedAccounts: 0,
        blockedIps: 0,
        recentFailures: 0,
        suspiciousActivities: 0,
      };
    }
  }

  // Private helper methods

  private async getRecentFailures(key: string): Promise<number> {
    const cutoff = Date.now() - this.config.failureWindowMinutes * 60 * 1000;
    return this.redis.zcount(key, cutoff, "+inf");
  }

  private calculateDelay(failures: number): number {
    if (failures === 0) return 0;

    const delay =
      this.config.baseDelaySeconds * Math.pow(this.config.exponentialBase, failures - 1);
    return Math.min(delay, this.config.maxDelaySeconds);
  }

  private async checkAndApplyLockout(email: string, ipAddress: string): Promise<void> {
    try {
      // Check email-based lockout
      const emailFailures = await this.getRecentFailures(this.EMAIL_FAILURES_PREFIX + email);

      if (emailFailures >= this.config.lockoutThreshold) {
        const expiresAt = new Date(Date.now() + this.config.lockoutDurationMinutes * 60 * 1000);

        await this.redis.setex(
          this.ACCOUNT_LOCKOUT_PREFIX + email,
          this.config.lockoutDurationMinutes * 60,
          JSON.stringify({
            expiresAt: expiresAt.toISOString(),
            reason: "Too many failed login attempts",
            timestamp: new Date().toISOString(),
          })
        );

        // Log lockout
        await auditService.log({
          action: "ACCOUNT_LOCKED",
          resource: AuditResources.USER,
          details: {
            email,
            reason: "Brute force protection",
            failureCount: emailFailures,
            lockoutDuration: this.config.lockoutDurationMinutes,
          },
          success: true,
        });

        this.metrics.metrics.securityThreats.inc({
          threat_type: "account_locked",
          endpoint: "brute_force_protection",
        });

        authLogger.warn(
          { email, failureCount: emailFailures },
          "Account locked due to repeated failures"
        );
      }

      // Check IP-based blocking
      const ipFailures = await this.getRecentFailures(this.IP_FAILURES_PREFIX + ipAddress);

      if (ipFailures >= this.config.ipBlockThreshold) {
        const expiresAt = new Date(Date.now() + this.config.ipBlockDurationMinutes * 60 * 1000);

        await this.redis.setex(
          this.IP_BLOCK_PREFIX + ipAddress,
          this.config.ipBlockDurationMinutes * 60,
          JSON.stringify({
            expiresAt: expiresAt.toISOString(),
            reason: "Too many failed login attempts from IP",
            timestamp: new Date().toISOString(),
          })
        );

        // Log IP block
        await auditService.log({
          action: "IP_BLOCKED",
          resource: "IP_ADDRESS",
          details: {
            ipAddress,
            reason: "Brute force protection",
            failureCount: ipFailures,
            blockDuration: this.config.ipBlockDurationMinutes,
          },
          ipAddress,
          success: true,
        });

        this.metrics.metrics.securityThreats.inc({
          threat_type: "ip_blocked",
          endpoint: "brute_force_protection",
        });

        authLogger.warn(
          { ipAddress, failureCount: ipFailures },
          "IP address blocked due to repeated failures"
        );
      }
    } catch (error) {
      authLogger.error({ err: error }, "Error applying lockout");
    }
  }

  private async detectSuspiciousActivity(
    email: string,
    ipAddress: string,
    userAgent: string
  ): Promise<void> {
    try {
      // Detect rapid failures from single IP
      const recentIpFailures = await this.getRecentFailures(this.IP_FAILURES_PREFIX + ipAddress);

      if (recentIpFailures >= this.config.suspiciousActivityThreshold) {
        await this.reportSuspiciousActivity({
          type: "RAPID_FAILURES",
          severity: "HIGH",
          description: `Rapid login failures from IP ${ipAddress}`,
          metadata: {
            ipAddress,
            email,
            failureCount: recentIpFailures,
            userAgent,
          },
        });
      }

      // Detect distributed attacks (same email from multiple IPs)
      const emailPattern = this.EMAIL_FAILURES_PREFIX + email + "*";
      const emailKeys = await this.redis.keys(emailPattern);

      if (emailKeys.length > 5) {
        // Same email attempted from 5+ different contexts
        await this.reportSuspiciousActivity({
          type: "DISTRIBUTED_ATTACK",
          severity: "CRITICAL",
          description: `Distributed attack detected against email ${email}`,
          metadata: {
            email,
            sourceCount: emailKeys.length,
            currentIp: ipAddress,
          },
        });
      }
    } catch (error) {
      authLogger.error({ err: error }, "Error detecting suspicious activity");
    }
  }

  private async reportSuspiciousActivity(activity: SuspiciousActivity): Promise<void> {
    try {
      const key = `${this.ANOMALY_TRACKER_PREFIX}${Date.now()}_${activity.type}`;

      await this.redis.setex(
        key,
        24 * 60 * 60,
        JSON.stringify({
          ...activity,
          timestamp: new Date().toISOString(),
          id: randomUUID(),
        })
      );

      // Log suspicious activity
      await auditService.log({
        action: "SUSPICIOUS_ACTIVITY_DETECTED",
        resource: "SECURITY",
        details: {
          activityType: activity.type,
          severity: activity.severity,
          description: activity.description,
          metadata: activity.metadata,
        },
        success: true,
      });

      // Update metrics
      this.metrics.metrics.securityThreats.inc({
        threat_type: activity.type.toLowerCase(),
        endpoint: "brute_force_protection",
      });

      authLogger.warn(
        {
          activityType: activity.type,
          severity: activity.severity,
          description: activity.description,
        },
        "Suspicious activity detected"
      );
    } catch (error) {
      authLogger.error({ err: error }, "Error reporting suspicious activity");
    }
  }

  private async logAttempt(attempt: LoginAttemptInfo): Promise<void> {
    try {
      // Store attempt for analysis — key includes namespace for test isolation
      const key = `${this.LOGIN_ATTEMPTS_PREFIX}${attempt.email}:${new Date().toISOString().split("T")[0]}`;
      await this.redis.lpush(key, JSON.stringify(attempt));
      await this.redis.expire(key, 7 * 24 * 60 * 60); // Keep for 7 days
      await this.redis.ltrim(key, 0, 999); // Keep last 1000 attempts
    } catch (error) {
      authLogger.error({ err: error }, "Error logging attempt");
    }
  }
}
