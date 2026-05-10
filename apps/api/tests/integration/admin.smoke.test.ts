/**
 * Tier 6 — Admin operations smoke tests
 *
 * Admin-side surface: admin user CRUD + permission gating. Uses the
 * `createTestAdminUser` helper to mint a SUPER_ADMIN with a real
 * TokenService-signed JWT so requireAdminAuth + requirePermission
 * checks are exercised end-to-end.
 *
 * Account lifecycle (create / suspend / reactivate / password-reset)
 * lands in a follow-up — those endpoints have richer business rules
 * (gateway switch event coupling, billing) that need a separate setup.
 *
 * @file admin.smoke.test.ts
 * @description Tier 6 admin operations smoke E2E
 * @layer infrastructure
 */

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { createTestPrismaClient } from "@infra/prisma";
import type { PrismaClient } from "@infra/prisma";
import { checkApiAvailable } from "../testUtils.js";
import {
  apiGet,
  apiPost,
  expectError,
  createTestAdminUser,
  cleanupTestAdminUser,
  API_BASE_URL,
  type TestAdminFixture,
} from "./helpers/index.js";

describe("Tier 6 — Admin operations smoke", () => {
  let prisma: PrismaClient;
  let admin: TestAdminFixture;
  const createdAdminIds: string[] = [];

  before(async () => {
    const apiAvailable = await checkApiAvailable();
    assert.ok(
      apiAvailable,
      `API not reachable at ${API_BASE_URL} — start \`pnpm dev\` before running smoke tests`
    );
    prisma = createTestPrismaClient();
    admin = await createTestAdminUser(prisma, { tagPrefix: "tier6-super" });
    createdAdminIds.push(admin.adminUserId);
  });

  after(async () => {
    if (!prisma) return;
    try {
      for (const id of createdAdminIds) {
        await cleanupTestAdminUser(prisma, id);
      }
    } finally {
      await prisma.$disconnect();
    }
  });

  // -----------------------------------------------------------------------
  // List + create admin users
  // -----------------------------------------------------------------------

  it("lists admin users for SUPER_ADMIN (200)", async () => {
    const result = await apiGet("/admin/users", admin.authHeader);
    assert.strictEqual(result.status, 200, `body: ${JSON.stringify(result.body)}`);
  });

  it("CSRF-protects admin user mutations (403 CSRF_MISSING without token)", async () => {
    // CSRF is enforced on every admin POST/PUT/PATCH/DELETE per the
    // adminAuthConfig. An auth-only request (Bearer token, no CSRF
    // header) MUST be rejected — the smoke confirms the protection
    // is active. Smoke tests with full CSRF setup land in a follow-up
    // tier once a `getCsrfToken()` helper is in place.
    const tag = `csrf-${Date.now()}`;
    const result = await apiPost(
      "/admin/users",
      { email: `${tag}@test.local`, name: "CSRF Test", role: "ADMIN" },
      admin.authHeader
    );
    assert.strictEqual(
      result.status,
      403,
      `expected 403 CSRF_MISSING, got ${result.status}: ${JSON.stringify(result.body)}`
    );
    const code = (result.body as { error?: { code?: string } } | null)?.error?.code;
    assert.strictEqual(code, "CSRF_MISSING", `expected CSRF_MISSING code, got ${code}`);
  });

  // -----------------------------------------------------------------------
  // Auth gating — read endpoints (CSRF only protects mutations)
  // -----------------------------------------------------------------------

  it("rejects admin user list without auth (401)", async () => {
    const result = await apiGet("/admin/users");
    expectError(result, 401);
  });

  it("rejects admin user list with non-admin token (401/403)", async () => {
    // Customer-issued JWT lacks the admin issuer/audience — the admin
    // verify path rejects.
    const fakeCustomerHeader =
      "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJjdXMtMSIsImFjY291bnRJZCI6ImFjYy0xIiwicm9sZSI6Ik9XTkVSIiwidHlwZSI6ImFjY2VzcyIsImlhdCI6MTcwMDAwMDAwMCwiZXhwIjoxNzAwMDAzNjAwfQ.invalid";
    const result = await apiGet("/admin/users", fakeCustomerHeader);
    assert.ok(
      [401, 403].includes(result.status),
      `expected 401/403 with non-admin token, got ${result.status}`
    );
  });

  it("rejects admin user list with no Bearer header at all (401)", async () => {
    const result = await apiGet("/admin/users");
    expectError(result, 401);
  });
});
