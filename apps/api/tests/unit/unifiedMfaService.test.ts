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
import { MFA_SUBJECT_TYPE, type MfaSubject } from "@ports/core";
import { MfaService } from "../../src/admin/auth/MfaService.js";
import { InMemoryMfaUserRepository } from "./helpers/InMemoryMfaUserRepository.js";
import { InMemoryAuditLogRepository } from "./helpers/InMemoryAuditLogRepository.js";

const ARGON2_PREFIX = "$argon2id$";

interface Harness {
  service: MfaService;
  adminRepo: InMemoryMfaUserRepository;
  customerRepo: InMemoryMfaUserRepository;
  audit: InMemoryAuditLogRepository;
}

function makeHarness(): Harness {
  const adminRepo = new InMemoryMfaUserRepository();
  const customerRepo = new InMemoryMfaUserRepository();
  const audit = new InMemoryAuditLogRepository();
  const service = new MfaService(adminRepo, customerRepo, audit);
  return { service, adminRepo, customerRepo, audit };
}

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

      const disable = await h.service.disableMfa(subject, authenticator.generate(secret));
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
