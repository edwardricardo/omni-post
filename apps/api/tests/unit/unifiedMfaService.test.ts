/**
 * @file unifiedMfaService.test.ts
 * @description RED→GREEN unit specs for the unified, port-based MfaService. Both
 *              admin and customer subjects run the identical lifecycle through
 *              injected MfaUserRepositoryPort fakes: setup issues hashed codes,
 *              backup-code login is single-use, regenerate invalidates old codes,
 *              adminForceDisable clears + audits without secrets, status hides
 *              secret material, and no operation logs a secret. Anchors the three
 *              capabilities the incomplete new service lacked.
 * @layer infrastructure
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

// Capture every logger call so the no-secret-logging spec can inspect payloads.
const loggerCalls: unknown[][] = [];
vi.mock("../../src/lib/logger.js", () => {
  const record =
    () =>
    (...args: unknown[]): void => {
      loggerCalls.push(args);
    };
  const silent = {
    info: record(),
    warn: record(),
    error: record(),
    debug: record(),
    trace: record(),
    fatal: record(),
    child: (): unknown => silent,
  };
  return { logger: silent, authLogger: silent };
});

import { authenticator } from "otplib";
import { ok, err, type Result } from "@shared/types";
import { MFA_SUBJECT_TYPE, type MfaSubject, type MfaUserRecord } from "@ports/core";
import { MfaService } from "../../src/admin/auth/MfaService.js";
import type { ApiMetrics } from "../../src/metrics/apiMetrics.js";
import { InMemoryMfaUserRepository } from "./helpers/InMemoryMfaUserRepository.js";
import { InMemoryAuditLogRepository } from "./helpers/InMemoryAuditLogRepository.js";

const ARGON2_PREFIX = "$argon2id$";

/**
 * Repository double whose `markBackupCodeUsed` always loses the compare-and-swap
 * race — the code verified, but a concurrent verification of the SAME code
 * committed first, so the single-use mark reports ALREADY_USED. Everything else
 * behaves like the in-memory fake, so setup + enable still work.
 */
class RaceLosingMfaUserRepository extends InMemoryMfaUserRepository {
  override async markBackupCodeUsed(): Promise<Result<void, "NOT_FOUND" | "ALREADY_USED">> {
    return err("ALREADY_USED");
  }
}

/**
 * The staggered interleaving at unit scale: `findById` hands back the current
 * record and THEN lets a "concurrent" verification claim an index, so the
 * service's deciding read is already stale when the argon2 loop ends. The claim,
 * not the service's own filter, decides the outcome — and when the claimed index
 * is the one this caller presents, the refusal comes from the claim's state
 * check with no write attempted.
 */
class ConcurrentClaimMfaUserRepository extends InMemoryMfaUserRepository {
  private pendingIndex: number | null = null;

  /** Arm a concurrent claim of `codeIndex`, fired right after the next read. */
  claimAfterNextRead(codeIndex: number): void {
    this.pendingIndex = codeIndex;
  }

  override async findById(userId: string): Promise<Result<MfaUserRecord, "NOT_FOUND">> {
    const found = await super.findById(userId);
    const index = this.pendingIndex;
    if (index !== null && found.ok) {
      this.pendingIndex = null;
      await super.markBackupCodeUsed(userId, index, new Date("2026-06-06T06:06:06.000Z"));
    }
    return found;
  }
}

/**
 * The used-index filter, neutered: `findById` reports an EMPTY used-map while the
 * stored state keeps every real claim, so the service cannot skip an
 * already-consumed index and the verdict can only come from the claim.
 */
class FilterBlindMfaUserRepository extends InMemoryMfaUserRepository {
  override async findById(userId: string): Promise<Result<MfaUserRecord, "NOT_FOUND">> {
    const found = await super.findById(userId);
    if (!found.ok) return found;
    return ok({ ...found.value, mfaBackupUsedAt: {} });
  }
}

interface Harness {
  service: MfaService;
  adminRepo: InMemoryMfaUserRepository;
  customerRepo: InMemoryMfaUserRepository;
  audit: InMemoryAuditLogRepository;
  securityThreatsInc: ReturnType<typeof vi.fn>;
}

interface HarnessOptions {
  adminRepo?: InMemoryMfaUserRepository;
  customerRepo?: InMemoryMfaUserRepository;
}

function makeHarness(options: HarnessOptions = {}): Harness {
  const adminRepo = options.adminRepo ?? new InMemoryMfaUserRepository();
  const customerRepo = options.customerRepo ?? new InMemoryMfaUserRepository();
  const audit = new InMemoryAuditLogRepository();
  const securityThreatsInc = vi.fn();
  // Shaped like the live collector the composition root injects
  // (`metrics.metrics.securityThreats.inc`), per the RedisBruteForceAdapter and
  // fileUploadValidator precedents.
  const metrics = {
    metrics: { securityThreats: { inc: securityThreatsInc } },
  } as unknown as ApiMetrics;
  const service = new MfaService(adminRepo, customerRepo, audit, undefined, metrics);
  return { service, adminRepo, customerRepo, audit, securityThreatsInc };
}

const REUSE_THREAT_LABELS = {
  threat_type: "mfa_backup_code_reuse",
  endpoint: "mfa_verify",
} as const;

function repoFor(h: Harness, subject: MfaSubject): InMemoryMfaUserRepository {
  return subject.type === MFA_SUBJECT_TYPE.CUSTOMER ? h.customerRepo : h.adminRepo;
}

/** Enroll a subject end-to-end and return the plaintext secret + backup codes. */
async function enroll(
  h: Harness,
  subject: MfaSubject,
  email: string
): Promise<{ secret: string; backupCodes: string[] }> {
  repoFor(h, subject).seed({ id: subject.id, email });
  const setup = await h.service.setupMfa(subject);
  if (!setup.ok) throw new Error(`setup failed: ${setup.error}`);
  const token = authenticator.generate(setup.value.secret);
  const verify = await h.service.verifyMfaSetup(subject, token);
  if (!verify.ok) throw new Error(`verify-setup failed: ${verify.error}`);
  return { secret: setup.value.secret, backupCodes: setup.value.backupCodes };
}

const ADMIN: MfaSubject = { type: MFA_SUBJECT_TYPE.ADMIN, id: "admin-1" };
const CUSTOMER: MfaSubject = { type: MFA_SUBJECT_TYPE.CUSTOMER, id: "cust-1" };

describe("Unified MfaService", () => {
  let h: Harness;

  beforeEach(() => {
    loggerCalls.length = 0;
    h = makeHarness();
  });

  describe.each([
    ["admin", ADMIN, "admin@example.com"],
    ["customer", CUSTOMER, "customer@example.com"],
  ] as const)("subject parity: %s", (_label, subject, email) => {
    it("runs the full MFA lifecycle for the subject", async () => {
      const { secret, backupCodes } = await enroll(h, subject, email);

      const status = await h.service.getMfaStatus(subject);
      expect(status.ok && status.value.enabled).toBe(true);
      expect(status.ok && status.value.backupCodesCount).toBe(backupCodes.length);

      const regen = await h.service.regenerateBackupCodes(subject, authenticator.generate(secret));
      expect(regen.ok).toBe(true);
      if (!regen.ok) return;

      const login = await h.service.verifyMfaToken(subject, regen.value[0] as string);
      expect(login.ok && login.value.verified).toBe(true);

      // Disable with a DISTINCT unused backup code. The regenerate above already
      // claimed the current TOTP time step, and TOTP single-use now rejects any
      // reuse of that step within its window, so disabling with a fresh TOTP in
      // the same window would (correctly) fail — a backup code keeps the
      // lifecycle assertion focused on disable, not TOTP replay.
      const disable = await h.service.disableMfa(subject, regen.value[1] as string);
      expect(disable.ok).toBe(true);
      const after = await h.service.getMfaStatus(subject);
      expect(after.ok && after.value.enabled).toBe(false);
    });

    it("setup issues a TOTP secret and hashed backup codes returned once", async () => {
      repoFor(h, subject).seed({ id: subject.id, email });
      const setup = await h.service.setupMfa(subject);

      expect(setup.ok).toBe(true);
      if (!setup.ok) return;
      expect(setup.value.secret).toBeTruthy();
      expect(setup.value.qrCodeUrl.startsWith("data:image/")).toBe(true);
      expect(setup.value.backupCodes.length).toBe(8);
      for (const code of setup.value.backupCodes) {
        expect(code).toMatch(/^[0-9A-F]{8}$/);
      }
      const stored = repoFor(h, subject).raw(subject.id);
      expect(stored?.mfaBackupCodes.length).toBe(8);
      for (const hashed of stored?.mfaBackupCodes ?? []) {
        expect(hashed.startsWith(ARGON2_PREFIX)).toBe(true);
        expect(setup.value.backupCodes).not.toContain(hashed);
      }
    });

    it("logs in with a valid unused backup code and marks it single-use", async () => {
      const { backupCodes } = await enroll(h, subject, email);
      const code = backupCodes[2] as string;

      const first = await h.service.verifyMfaToken(subject, code);
      expect(first.ok).toBe(true);
      expect(first.ok && first.value.verified).toBe(true);
      expect(first.ok && first.value.usedBackupCode).toBe(true);

      const stored = repoFor(h, subject).raw(subject.id);
      expect(Object.keys(stored?.mfaBackupUsedAt ?? {})).toContain("2");

      const reuse = await h.service.verifyMfaToken(subject, code);
      expect(reuse.ok).toBe(false);
      expect(!reuse.ok && reuse.error).toBe("INVALID_TOKEN");
    });

    it("rejects an unknown backup code", async () => {
      await enroll(h, subject, email);
      const result = await h.service.verifyMfaToken(subject, "DEADBEEF");
      expect(result.ok).toBe(false);
      expect(!result.ok && result.error).toBe("INVALID_TOKEN");
    });

    it("regenerate invalidates old codes and issues working new ones", async () => {
      const { secret, backupCodes } = await enroll(h, subject, email);
      const oldCode = backupCodes[0] as string;

      const regen = await h.service.regenerateBackupCodes(subject, authenticator.generate(secret));
      expect(regen.ok).toBe(true);
      if (!regen.ok) return;

      const oldAttempt = await h.service.verifyMfaToken(subject, oldCode);
      expect(oldAttempt.ok).toBe(false);

      const newAttempt = await h.service.verifyMfaToken(subject, regen.value[0] as string);
      expect(newAttempt.ok).toBe(true);
      expect(newAttempt.ok && newAttempt.value.usedBackupCode).toBe(true);
    });

    it("adminForceDisable clears MFA and audits the ACTING ADMIN as actor (subject is the resource), no secret", async () => {
      const { secret } = await enroll(h, subject, email);

      const result = await h.service.adminForceDisable(subject, { id: "actor-admin" });
      expect(result.ok).toBe(true);

      const stored = repoFor(h, subject).raw(subject.id);
      expect(stored?.mfaEnabled).toBe(false);
      expect(stored?.mfaSecret).toBeNull();
      expect(stored?.mfaBackupCodes.length).toBe(0);

      const forceRow = h.audit.rows.find((r) => r.action === "MFA_ADMIN_FORCE_DISABLED");
      expect(forceRow).toBeDefined();
      // The audit ACTOR is always the acting admin — regardless of the
      // disabled subject's type. The subject is the resource, never the
      // actor: it only appears in `details.subjectId`.
      expect(forceRow?.actorType).toBe("ADMIN");
      expect(forceRow?.userId).toBe("actor-admin");
      expect(forceRow?.customerUserId).toBeNull();
      const payload = JSON.stringify(forceRow);
      expect(payload).toContain("actor-admin");
      expect(payload).toContain(subject.id);
      expect(payload).not.toContain(secret);
    });

    it("status reports enrollment without leaking secret material", async () => {
      const { secret, backupCodes } = await enroll(h, subject, email);

      const status = await h.service.getMfaStatus(subject);
      expect(status.ok).toBe(true);
      if (!status.ok) return;
      expect(status.value.enabled).toBe(true);
      expect(status.value.backupCodesCount).toBe(backupCodes.length);
      const payload = JSON.stringify(status.value);
      expect(payload).not.toContain(secret);
      for (const code of backupCodes) {
        expect(payload).not.toContain(code);
      }
    });
  });

  it("verifies a current TOTP and rejects an invalid one", async () => {
    const { secret } = await enroll(h, ADMIN, "admin@example.com");
    const good = await h.service.verifyMfaToken(ADMIN, authenticator.generate(secret));
    expect(good.ok && good.value.verified).toBe(true);
    expect(good.ok && good.value.usedBackupCode).toBe(false);

    const bad = await h.service.verifyMfaToken(ADMIN, "000000");
    expect(bad.ok).toBe(false);
  });

  it("rejects a backup code as INVALID_TOKEN (never success) when the claim is refused by a lost write", async () => {
    // Two step-1 logins (two challenge jtis) submit the SAME backup code
    // concurrently: both read it unused, both verify the hash, but the atomic
    // claim lets exactly one win. The loser MUST be rejected as an invalid token
    // — a refused claim can never mint a session from an already-consumed code
    // (nor surface as an opaque DATABASE_ERROR that the login step would still
    // turn into a hard failure with the wrong signal).
    const h2 = makeHarness({ customerRepo: new RaceLosingMfaUserRepository() });
    const { backupCodes } = await enroll(h2, CUSTOMER, "race@example.com");

    const result = await h2.service.verifyMfaToken(CUSTOMER, backupCodes[0] as string);

    expect(result.ok).toBe(false);
    expect(!result.ok && result.error).toBe("INVALID_TOKEN");

    const rejected = h2.audit.rows.filter((r) => r.action === "MFA_BACKUP_CODE_REUSE_REJECTED");
    expect(rejected).toHaveLength(1);
    expect((rejected[0]?.details as { severity?: string } | undefined)?.severity).toBe("HIGH");
    expect(h2.securityThreatsInc).toHaveBeenCalledWith(REUSE_THREAT_LABELS);
  });

  it("alarms and increments the metric on a refusal that never reached a write", async () => {
    // The staggered interleaving: a concurrent verification claims the SAME code
    // after this caller's deciding read, so the service's own filter still sees
    // it unused and the refusal comes from the claim's state check with no write
    // attempted. That refusal must alarm exactly as the lost-write refusal above
    // — the emission branches on the claim's verdict, never on its cause.
    const adminRepo = new ConcurrentClaimMfaUserRepository();
    const h2 = makeHarness({ adminRepo });
    const { backupCodes } = await enroll(h2, ADMIN, "staggered@example.com");
    adminRepo.claimAfterNextRead(0);

    const result = await h2.service.verifyMfaToken(ADMIN, backupCodes[0] as string);

    expect(result.ok).toBe(false);
    expect(!result.ok && result.error).toBe("INVALID_TOKEN");

    const rejected = h2.audit.rows.filter((r) => r.action === "MFA_BACKUP_CODE_REUSE_REJECTED");
    expect(rejected).toHaveLength(1);
    expect((rejected[0]?.details as { severity?: string } | undefined)?.severity).toBe("HIGH");
    expect(h2.securityThreatsInc).toHaveBeenCalledWith(REUSE_THREAT_LABELS);
    expect(h2.securityThreatsInc).toHaveBeenCalledTimes(1);
  });

  it("emits the reuse event with no secret material in its payload", async () => {
    const adminRepo = new ConcurrentClaimMfaUserRepository();
    const h2 = makeHarness({ adminRepo });
    const { secret, backupCodes } = await enroll(h2, ADMIN, "no-secrets@example.com");
    const storedHash = adminRepo.raw(ADMIN.id)?.mfaBackupCodes[0] as string;
    adminRepo.claimAfterNextRead(0);

    await h2.service.verifyMfaToken(ADMIN, backupCodes[0] as string);

    const rejected = h2.audit.rows.find((r) => r.action === "MFA_BACKUP_CODE_REUSE_REJECTED");
    expect(rejected).toBeTruthy();
    const payload = JSON.stringify(rejected);
    expect(payload).toContain(ADMIN.id);
    expect(payload).not.toContain(secret);
    expect(payload).not.toContain(storedHash);
    for (const code of backupCodes) {
      expect(payload).not.toContain(code);
    }
  });

  it("audits a remaining count read back from post-claim state, not from the deciding read", async () => {
    // A sibling index is claimed inside this caller's argon2 window, so the
    // pre-verification snapshot is stale by the time the claim commits: the
    // audited count must reflect what the claim persisted.
    const adminRepo = new ConcurrentClaimMfaUserRepository();
    const h2 = makeHarness({ adminRepo });
    const { backupCodes } = await enroll(h2, ADMIN, "remaining@example.com");
    adminRepo.claimAfterNextRead(1);

    const result = await h2.service.verifyMfaToken(ADMIN, backupCodes[0] as string);

    expect(result.ok && result.value.verified).toBe(true);
    const consumed = adminRepo.raw(ADMIN.id)?.mfaBackupUsedAt ?? {};
    expect(Object.keys(consumed).sort()).toEqual(["0", "1"]);
    const used = h2.audit.rows.find((r) => r.action === "MFA_BACKUP_CODE_USED");
    const staleCount = backupCodes.length - 1;
    expect((used?.details as { remainingCodes?: number } | undefined)?.remainingCodes).toBe(
      backupCodes.length - 2
    );
    expect((used?.details as { remainingCodes?: number } | undefined)?.remainingCodes).not.toBe(
      staleCount
    );
  });

  it("keeps the single-use verdict when the used-index filter is neutered in the harness", async () => {
    // The filter is an argon2-cost optimisation, not the control: deprived of its
    // input it changes cost and nothing else — the claim still refuses the
    // already-consumed code.
    const adminRepo = new FilterBlindMfaUserRepository();
    const h2 = makeHarness({ adminRepo });
    const { backupCodes } = await enroll(h2, ADMIN, "filter-blind@example.com");

    const first = await h2.service.verifyMfaToken(ADMIN, backupCodes[0] as string);
    const replay = await h2.service.verifyMfaToken(ADMIN, backupCodes[0] as string);

    expect(first.ok && first.value.verified).toBe(true);
    expect(replay.ok).toBe(false);
    expect(!replay.ok && replay.error).toBe("INVALID_TOKEN");
    expect(Object.keys(adminRepo.raw(ADMIN.id)?.mfaBackupUsedAt ?? {})).toEqual(["0"]);
    expect(h2.securityThreatsInc).toHaveBeenCalledWith(REUSE_THREAT_LABELS);
  });

  it("returns USER_NOT_FOUND for an unknown subject", async () => {
    const status = await h.service.getMfaStatus({ type: MFA_SUBJECT_TYPE.ADMIN, id: "ghost" });
    expect(status.ok).toBe(false);
    expect(!status.ok && status.error).toBe("USER_NOT_FOUND");
  });

  it("never logs the TOTP secret or a backup code across the lifecycle", async () => {
    const { secret, backupCodes } = await enroll(h, ADMIN, "admin@example.com");
    await h.service.verifyMfaToken(ADMIN, backupCodes[0] as string);
    await h.service.regenerateBackupCodes(ADMIN, authenticator.generate(secret));
    await h.service.adminForceDisable(ADMIN, { id: "actor-admin" });

    const logged = JSON.stringify(loggerCalls);
    expect(logged).not.toContain(secret);
    for (const code of backupCodes) {
      expect(logged).not.toContain(code);
    }
  });

  it("a self-service customer operation still audits as the customer actor (not the admin)", async () => {
    const { secret } = await enroll(h, CUSTOMER, "customer@example.com");

    const result = await h.service.disableMfa(CUSTOMER, authenticator.generate(secret));
    expect(result.ok).toBe(true);

    const disableRow = h.audit.rows.find((r) => r.action === "MFA_DISABLED");
    expect(disableRow).toBeDefined();
    expect(disableRow?.actorType).toBe("CUSTOMER");
    expect(disableRow?.customerUserId).toBe(CUSTOMER.id);
    expect(disableRow?.userId).toBeNull();
  });

  it("logs no secret material on the error path when the repository write throws mid-operation", async () => {
    const { secret, backupCodes } = await enroll(h, ADMIN, "admin@example.com");

    // Force the mutating write to throw so the service's catch-block error
    // log is exercised — covering the previously untested error branch.
    const clearMfaSpy = vi
      .spyOn(h.adminRepo, "clearMfa")
      .mockRejectedValueOnce(new Error("DB write failed"));

    const result = await h.service.disableMfa(ADMIN, authenticator.generate(secret));

    expect(result.ok).toBe(false);
    expect(!result.ok && result.error).toBe("DATABASE_ERROR");

    const logged = JSON.stringify(loggerCalls);
    expect(logged).not.toContain(secret);
    for (const code of backupCodes) {
      expect(logged).not.toContain(code);
    }

    clearMfaSpy.mockRestore();
  });
});
