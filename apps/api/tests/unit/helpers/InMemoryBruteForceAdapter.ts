/**
 * @file InMemoryBruteForceAdapter.ts
 * @description Test double implementing `BruteForceProtectionPort` against an
 *   in-process map. Intended for use-case tests that need a real port instance
 *   without spinning up Redis. Behaviour mirrors `RedisBruteForceAdapter` for
 *   the canon-critical signals: account-based primary, CAPTCHA threshold,
 *   exponential delay, lockout after N fails, auto-expiry on success.
 *
 *   Lockout uses wall-clock `expiresAt`; tests that need deterministic time
 *   can stub `Date.now` via `vi.useFakeTimers()`.
 * @layer infrastructure
 */

import type {
  BruteForceProtectionPort,
  BruteForceStats,
  CheckLoginAttemptInput,
  CheckLoginAttemptResult,
  RecordAttemptInput,
} from "@ports/core";

interface InMemoryConfig {
  readonly captchaThreshold: number;
  readonly lockoutThreshold: number;
  readonly lockoutDurationMs: number;
  readonly baseDelaySeconds: number;
  readonly maxDelaySeconds: number;
  readonly exponentialBase: number;
}

const DEFAULTS: InMemoryConfig = {
  captchaThreshold: 3,
  lockoutThreshold: 10,
  lockoutDurationMs: 30 * 60 * 1000,
  baseDelaySeconds: 1,
  maxDelaySeconds: 300,
  exponentialBase: 2,
};

/**
 * @class InMemoryBruteForceAdapter
 * @description Test double for `BruteForceProtectionPort`. Use in unit/use-case
 *   tests that need a working port without Redis. Inspect counters via the
 *   `failuresFor(identifier)` / `lockoutFor(identifier)` helpers.
 */
export class InMemoryBruteForceAdapter implements BruteForceProtectionPort {
  private readonly failures = new Map<string, number>();
  private readonly lockouts = new Map<string, number>();
  private readonly config: InMemoryConfig;

  constructor(config: Partial<InMemoryConfig> = {}) {
    this.config = { ...DEFAULTS, ...config };
  }

  async checkLoginAttempt(input: CheckLoginAttemptInput): Promise<CheckLoginAttemptResult> {
    const lockoutExpiresAt = this.lockouts.get(input.identifier);
    if (lockoutExpiresAt && lockoutExpiresAt > Date.now()) {
      return {
        allowed: false,
        delaySeconds: 0,
        captchaRequired: false,
        lockoutExpiresAt: new Date(lockoutExpiresAt),
        reason: "account_lockout",
      };
    }
    if (lockoutExpiresAt && lockoutExpiresAt <= Date.now()) {
      this.lockouts.delete(input.identifier);
    }
    const failures = this.failures.get(input.identifier) ?? 0;
    return {
      allowed: true,
      delaySeconds: this.calculateDelay(failures),
      captchaRequired: failures >= this.config.captchaThreshold,
    };
  }

  async recordFailedAttempt(input: RecordAttemptInput): Promise<void> {
    const current = (this.failures.get(input.identifier) ?? 0) + 1;
    this.failures.set(input.identifier, current);
    if (current >= this.config.lockoutThreshold) {
      this.lockouts.set(input.identifier, Date.now() + this.config.lockoutDurationMs);
    }
  }

  async recordSuccessfulAttempt(input: Omit<RecordAttemptInput, "failureReason">): Promise<void> {
    this.failures.delete(input.identifier);
    this.lockouts.delete(input.identifier);
  }

  async unlockAccount(identifier: string, _byAdminId: string): Promise<boolean> {
    const wasLocked = this.lockouts.has(identifier);
    this.lockouts.delete(identifier);
    this.failures.delete(identifier);
    return wasLocked;
  }

  async unblockIp(_ip: string, _byAdminId: string): Promise<boolean> {
    return false;
  }

  async getStats(): Promise<BruteForceStats> {
    return {
      lockedAccounts: this.lockouts.size,
      blockedIps: 0,
      recentFailures: Array.from(this.failures.values()).reduce((a, b) => a + b, 0),
      suspiciousActivities: 0,
    };
  }

  failuresFor(identifier: string): number {
    return this.failures.get(identifier) ?? 0;
  }

  lockoutFor(identifier: string): Date | undefined {
    const expiresAt = this.lockouts.get(identifier);
    return expiresAt ? new Date(expiresAt) : undefined;
  }

  private calculateDelay(failures: number): number {
    if (failures <= 0) return 0;
    const delay =
      this.config.baseDelaySeconds * Math.pow(this.config.exponentialBase, failures - 1);
    return Math.min(delay, this.config.maxDelaySeconds);
  }
}
