/**
 * @file data-retention.integration.test.ts
 * @description Integration tests E2E para `DataRetentionService.runRetentionCleanup`
 *   (> 4.3 Phase A1 Normalization Roadmap). Verifica con Postgres real que:
 *
 *   1. AuditLog rows con `createdAt` más viejas que `auditLogRetentionDays`
 *      son borradas; las dentro del window NO.
 *   2. DsarRequest rows con `status=PENDING` y `deadlineAt < now` son marcadas
 *      `EXPIRED`; las on-time NO.
 *
 *   El DoD > 4.3 original pedía 3 E2E tests — el 3ro (DSAR EXPORT real dump)
 *   queda en > 4.3.b PENDING porque requiere S3 integration + tenant data
 *   serializer (multi-table dump) que no existen hoy.
 *
 *   Pre-requisite: `pnpm db:up` (Postgres). Sin DB up, el test falla loud
 *   (no skip silencioso) per la canon "Never skip tests because services
 *   are down — start them".
 *
 *   Workstream: §4.3 Normalization Roadmap Phase A1.
 *
 * @layer infrastructure
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "@infra/prisma";
import { runRetentionForTest } from "./helpers/runRetentionForTest.js";

const TEST_TAG = "RETENTION_E2E";

// State preservation: stash existing GdprSettings before tweaking; restore after.
let stashedGdprSettings: {
  id: string;
  enableAutoDataDeletion: boolean;
  auditLogRetentionDays: number;
} | null = null;

const FIFTY_DAYS_MS = 50 * 24 * 60 * 60 * 1000;
const ONE_DAY_MS = 24 * 60 * 60 * 1000;

function daysAgo(days: number): Date {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000);
}

function daysAhead(days: number): Date {
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000);
}

describe("Data retention E2E — §4.3 Phase A1", () => {
  before(async () => {
    // Stash existing GdprSettings (singleton).
    const existing = await prisma.gdprSettings.findFirst();
    if (existing) {
      stashedGdprSettings = {
        id: existing.id,
        enableAutoDataDeletion: existing.enableAutoDataDeletion,
        auditLogRetentionDays: existing.auditLogRetentionDays,
      };
      await prisma.gdprSettings.update({
        where: { id: existing.id },
        data: { enableAutoDataDeletion: true, auditLogRetentionDays: 30 },
      });
    } else {
      await prisma.gdprSettings.create({
        data: {
          enableAutoDataDeletion: true,
          auditLogRetentionDays: 30,
          dataRetentionDays: 365,
          dsarResponseDays: 30,
        },
      });
    }
  });

  after(async () => {
    // Clean up test seed data.
    await prisma.auditLog.deleteMany({
      where: { action: { startsWith: TEST_TAG } },
    });
    await prisma.dsarRequest.deleteMany({
      where: { requestorEmail: { startsWith: TEST_TAG.toLowerCase() } },
    });

    // Restore or delete GdprSettings.
    if (stashedGdprSettings) {
      await prisma.gdprSettings.update({
        where: { id: stashedGdprSettings.id },
        data: {
          enableAutoDataDeletion: stashedGdprSettings.enableAutoDataDeletion,
          auditLogRetentionDays: stashedGdprSettings.auditLogRetentionDays,
        },
      });
    } else {
      // Was created in before() — delete only the test-created singleton.
      await prisma.gdprSettings.deleteMany({});
    }

    await prisma.$disconnect();
  });

  describe("AuditLog retention", () => {
    it("deletes AuditLog rows older than auditLogRetentionDays; preserves recent", async () => {
      // Window is 30 days. Insert old (100d) + recent (10d).
      const old = await prisma.auditLog.create({
        data: {
          action: `${TEST_TAG}_old`,
          resource: "Test",
          success: true,
          createdAt: daysAgo(100),
        },
      });
      const recent = await prisma.auditLog.create({
        data: {
          action: `${TEST_TAG}_recent`,
          resource: "Test",
          success: true,
          createdAt: daysAgo(10),
        },
      });

      const result = await runRetentionForTest();

      const oldStill = await prisma.auditLog.findUnique({ where: { id: old.id } });
      const recentStill = await prisma.auditLog.findUnique({ where: { id: recent.id } });

      assert.strictEqual(oldStill, null, "Old (100d) AuditLog should be deleted");
      assert.ok(recentStill, "Recent (10d) AuditLog should NOT be deleted");
      assert.ok(
        result.auditLogsDeleted >= 1,
        `Expected ≥1 audit log deleted, got ${result.auditLogsDeleted}`
      );
    });
  });

  describe("DsarRequest expiration", () => {
    it("marks PENDING DSAR requests past deadline as EXPIRED; preserves on-time", async () => {
      const overdue = await prisma.dsarRequest.create({
        data: {
          requestorEmail: `${TEST_TAG.toLowerCase()}_overdue@test.local`,
          type: "ACCESS",
          status: "PENDING",
          deadlineAt: daysAgo(1),
        },
      });
      const onTime = await prisma.dsarRequest.create({
        data: {
          requestorEmail: `${TEST_TAG.toLowerCase()}_ontime@test.local`,
          type: "ACCESS",
          status: "PENDING",
          deadlineAt: daysAhead(5),
        },
      });

      const result = await runRetentionForTest();

      const overdueUpdated = await prisma.dsarRequest.findUnique({
        where: { id: overdue.id },
      });
      const onTimeUnchanged = await prisma.dsarRequest.findUnique({
        where: { id: onTime.id },
      });

      assert.ok(overdueUpdated, "Overdue DSAR row should still exist");
      assert.strictEqual(overdueUpdated.status, "EXPIRED", "Overdue DSAR should be marked EXPIRED");
      assert.ok(onTimeUnchanged, "On-time DSAR row should still exist");
      assert.strictEqual(onTimeUnchanged.status, "PENDING", "On-time DSAR should remain PENDING");
      assert.ok(
        result.expiredDsarRequests >= 1,
        `Expected ≥1 DSAR expired, got ${result.expiredDsarRequests}`
      );
    });
  });
});

// Silence "unused" warnings for date constants intended for future use.
void FIFTY_DAYS_MS;
void ONE_DAY_MS;
