/**
 * @file mfaTotpSingleUse.test.ts
 * @description RED→GREEN unit specs for TOTP single-use enforcement in the unified
 *              MfaService (NIST SP 800-63B 5.1.5.2 / OWASP MFA). Parameterized over
 *              BOTH subjects (admin + customer): a given time-based OTP verifies
 *              exactly once and is rejected on replay (INVALID_TOKEN + a HIGH
 *              MFA_TOTP_REPLAY_REJECTED audit row), the next 30-second step is still
 *              accepted (rejecting a replay must never lock a user out), and reusing
 *              an already-consumed TOTP for a follow-up regenerate/disable within the
 *              same window is likewise rejected.
 * @layer infrastructure
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// Capture every logger call so the fail-closed-on-fault spec can assert an
// error was actually logged, not just swallowed.
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

/** Default TOTP time-step period in milliseconds (otplib default). */
const TOTP_STEP_MS = 30_000;

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
  repoFor(h, subject).seed({
    id: subject.id,
    email,
    ...(subject.type === MFA_SUBJECT_TYPE.CUSTOMER && { accountId: "acct-1" }),
  });
  const setup = await h.service.setupMfa(subject);
  if (!setup.ok) throw new Error(`setup failed: ${setup.error}`);
  const token = authenticator.generate(setup.value.secret);
  const verify = await h.service.verifyMfaSetup(subject, token);
  if (!verify.ok) throw new Error(`verify-setup failed: ${verify.error}`);
  return { secret: setup.value.secret, backupCodes: setup.value.backupCodes };
}

const ADMIN: MfaSubject = { type: MFA_SUBJECT_TYPE.ADMIN, id: "admin-1" };
const CUSTOMER: MfaSubject = { type: MFA_SUBJECT_TYPE.CUSTOMER, id: "cust-1" };

describe("MfaService TOTP single-use", () => {
  let h: Harness;

  beforeEach(() => {
    loggerCalls.length = 0;
    h = makeHarness();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe.each([
    ["admin", ADMIN, "admin@example.com"],
    ["customer", CUSTOMER, "customer@example.com"],
  ] as const)("subject: %s", (_label, subject, email) => {
    it("accepts a TOTP once and rejects the same TOTP on replay", async () => {
      const { secret } = await enroll(h, subject, email);
      const token = authenticator.generate(secret);

      const first = await h.service.verifyMfaToken(subject, token);
      expect(first.ok && first.value.verified).toBe(true);
      expect(first.ok && first.value.usedBackupCode).toBe(false);

      const replay = await h.service.verifyMfaToken(subject, token);
      expect(replay.ok).toBe(false);
      expect(!replay.ok && replay.error).toBe("INVALID_TOKEN");
    });

    it("audits a HIGH MFA_TOTP_REPLAY_REJECTED event on replay", async () => {
      const { secret } = await enroll(h, subject, email);
      const token = authenticator.generate(secret);

      await h.service.verifyMfaToken(subject, token);
      await h.service.verifyMfaToken(subject, token);

      const row = h.audit.rows.find((r) => r.action === "MFA_TOTP_REPLAY_REJECTED");
      expect(row).toBeDefined();
      expect((row?.details as { severity?: string })?.severity).toBe("HIGH");
    });

    it("still accepts the NEXT 30-second step after a claim (no lockout)", async () => {
      const { secret } = await enroll(h, subject, email);

      const base = new Date("2026-07-10T00:00:00.000Z");
      vi.useFakeTimers();
      vi.setSystemTime(base);

      const firstToken = authenticator.generate(secret);
      const first = await h.service.verifyMfaToken(subject, firstToken);
      expect(first.ok && first.value.verified).toBe(true);

      // Advance to the next TOTP time step: its step index is strictly greater
      // than the claimed one, so it must be accepted (a rejected replay must
      // never lock the user out of the very next code).
      vi.setSystemTime(new Date(base.getTime() + TOTP_STEP_MS));
      const nextToken = authenticator.generate(secret);
      expect(nextToken).not.toBe(firstToken);

      const next = await h.service.verifyMfaToken(subject, nextToken);
      expect(next.ok && next.value.verified).toBe(true);
    });

    it("rejects reusing a consumed TOTP for a follow-up regenerate within the window", async () => {
      const { secret } = await enroll(h, subject, email);
      const token = authenticator.generate(secret);

      const login = await h.service.verifyMfaToken(subject, token);
      expect(login.ok).toBe(true);

      const regen = await h.service.regenerateBackupCodes(subject, token);
      expect(regen.ok).toBe(false);
      expect(!regen.ok && regen.error).toBe("INVALID_TOKEN");
    });

    it("rejects reusing a consumed TOTP for a follow-up disable within the window", async () => {
      const { secret } = await enroll(h, subject, email);
      const token = authenticator.generate(secret);

      const login = await h.service.verifyMfaToken(subject, token);
      expect(login.ok).toBe(true);

      const disable = await h.service.disableMfa(subject, token);
      expect(disable.ok).toBe(false);
      expect(!disable.ok && disable.error).toBe("INVALID_TOKEN");
    });

    it("surfaces a genuine TOTP computation fault as DATABASE_ERROR, never a silent INVALID_TOKEN (fail-closed on corrupt secret)", async () => {
      // A corrupted mfaSecret — a byte value outside the base32-decodable ASCII
      // range (char code 200), simulating on-disk corruption — makes otplib's
      // checkDelta throw synchronously rather than return null. A genuine fault
      // must surface as a real error: falling through to the backup-code path
      // and returning INVALID_TOKEN would be indistinguishable from "the user
      // typed a wrong code", locking the user out with no operator-visible signal.
      const corruptSecret = `SECRET${String.fromCharCode(200)}X`;
      repoFor(h, subject).seed({
        id: subject.id,
        email,
        mfaEnabled: true,
        mfaSecret: corruptSecret,
        ...(subject.type === MFA_SUBJECT_TYPE.CUSTOMER && { accountId: "acct-1" }),
      });

      const result = await h.service.verifyMfaToken(subject, "123456");

      expect(result.ok).toBe(false);
      expect(!result.ok && result.error).toBe("DATABASE_ERROR");
      expect(loggerCalls.length).toBeGreaterThan(0);
    });

    it("still accepts a step STRICTLY GREATER than a future-clock-skewed claim (bounded recovery, never a bypass)", async () => {
      // Accepted tradeoff (documentation-by-test, not a defect): a device whose
      // clock runs ahead can present a token for currentCounter+2 (the edge of
      // TOTP_WINDOW=2), which gets CLAIMED as the accepted step. A token for a
      // LOWER step presented afterwards — the true current step, or the step
      // right after it — is then rejected as a replay, because monotonicity is
      // exactly the invariant that closes the single-use hole this slice fixes:
      // accepting an older in-window step after a newer one would reopen it.
      // The user is never locked out permanently — only until the wall clock
      // advances strictly past the claimed (skewed) step, bounded by at most
      // TOTP_WINDOW steps (≤60s here), and a step beyond that IS accepted. This
      // is a bounded, self-inflicted delay for a skewed device — never an
      // authentication bypass — so it is documented by this test, not "fixed".
      const { secret } = await enroll(h, subject, email);

      const base = new Date("2026-07-10T00:00:00.000Z");
      vi.useFakeTimers();
      vi.setSystemTime(base);

      // otplib encodes the token relative to `authenticator.options.epoch`
      // (defaults to the real Date.now()), so a "future clock" token is
      // simulated by generating with an explicit future epoch while the
      // service's own clock (faked via vi.setSystemTime) stays at `base`.
      const futureEpoch = base.getTime() + 2 * TOTP_STEP_MS;
      const skewedToken = authenticator.clone({ epoch: futureEpoch }).generate(secret);

      const claimed = await h.service.verifyMfaToken(subject, skewedToken);
      expect(claimed.ok && claimed.value.verified).toBe(true);

      // The TRUE current-step token (the device's real clock, i.e. `base`) is
      // now a lower step than the claimed future one — rejected as a replay,
      // not accepted, even though the user never actually used it before.
      const currentToken = authenticator.generate(secret);
      const lowerStepAttempt = await h.service.verifyMfaToken(subject, currentToken);
      expect(lowerStepAttempt.ok).toBe(false);
      expect(!lowerStepAttempt.ok && lowerStepAttempt.error).toBe("INVALID_TOKEN");

      // Once the wall clock advances strictly past the claimed (skewed) step,
      // recovery is automatic — bounded delay, never a permanent lockout.
      vi.setSystemTime(new Date(futureEpoch + TOTP_STEP_MS));
      const recoveryToken = authenticator.generate(secret);
      const recovered = await h.service.verifyMfaToken(subject, recoveryToken);
      expect(recovered.ok && recovered.value.verified).toBe(true);
    });
  });
});
