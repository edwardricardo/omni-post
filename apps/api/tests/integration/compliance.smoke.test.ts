/**
 * Tier 7 — Compliance smoke tests (customer-facing scope)
 *
 * GDPR / LGPD / CCPA Data Subject Access Request submission. The audit log
 * surface (read / export / cleanup) is admin-only and lands in Tier 6 once
 * the admin auth helper is in place.
 *
 * Coverage:
 *   - POST /compliance/dsar (public — happy + validation + persistence)
 *
 * @file compliance.smoke.test.ts
 * @description Tier 7 compliance smoke E2E
 * @layer infrastructure
 */

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { createTestPrismaClient } from "@infra/prisma";
import type { PrismaClient } from "@infra/prisma";
import { checkApiAvailable } from "../testUtils.js";
import { apiPost, expectError, API_BASE_URL } from "./helpers/index.js";

describe("Tier 7 — Compliance smoke (DSAR)", () => {
  let prisma: PrismaClient;
  const createdEmails: string[] = [];

  before(async () => {
    const apiAvailable = await checkApiAvailable();
    assert.ok(
      apiAvailable,
      `API not reachable at ${API_BASE_URL} — start \`pnpm dev\` before running smoke tests`
    );
    prisma = createTestPrismaClient();
  });

  after(async () => {
    if (!prisma) return;
    try {
      if (createdEmails.length > 0) {
        await prisma.dsarRequest.deleteMany({
          where: { requestorEmail: { in: createdEmails } },
        });
      }
    } finally {
      await prisma.$disconnect();
    }
  });

  it("submits DSAR EXPORT request and persists DsarRequest row (201)", async () => {
    const email = `dsar-smk-${Date.now()}@test.local`;
    createdEmails.push(email);

    const result = await apiPost<{
      data: { id: string; status: string };
    }>("/compliance/dsar", {
      email,
      name: "Smoke Tester",
      type: "EXPORT",
      jurisdiction: "GDPR",
    });

    assert.strictEqual(result.status, 201, `body: ${JSON.stringify(result.body)}`);
    assert.ok(result.body?.data.id, "DsarRequest id returned");

    // Verify persisted
    const dsar = await prisma.dsarRequest.findFirst({
      where: { requestorEmail: email },
      select: { type: true, status: true, jurisdiction: true },
    });
    assert.ok(dsar, "DsarRequest persisted");
    assert.strictEqual(dsar?.type, "EXPORT");
    assert.strictEqual(dsar?.jurisdiction, "GDPR");
  });

  it("submits DSAR DELETION request (201)", async () => {
    const email = `dsar-del-${Date.now()}@test.local`;
    createdEmails.push(email);

    const result = await apiPost("/compliance/dsar", {
      email,
      type: "DELETION",
      jurisdiction: "CCPA",
    });
    assert.strictEqual(result.status, 201, `body: ${JSON.stringify(result.body)}`);
  });

  it("rejects DSAR with malformed email (400)", async () => {
    const result = await apiPost("/compliance/dsar", {
      email: "not-an-email",
      type: "EXPORT",
    });
    expectError(result, 400);
  });

  it("rejects DSAR with invalid type enum (400)", async () => {
    const result = await apiPost("/compliance/dsar", {
      email: `bad-type-${Date.now()}@test.local`,
      type: "INVALID",
    });
    expectError(result, 400);
  });

  it("rejects DSAR with invalid jurisdiction enum (400)", async () => {
    const result = await apiPost("/compliance/dsar", {
      email: `bad-juris-${Date.now()}@test.local`,
      type: "ACCESS",
      jurisdiction: "MARS",
    });
    expectError(result, 400);
  });
});
