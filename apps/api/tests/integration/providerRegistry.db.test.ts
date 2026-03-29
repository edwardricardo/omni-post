/**
 * @file providerRegistry.db.test.ts
 * @description Integration tests for Provider Registry — Database operations.
 *   Requires real PostgreSQL with Prisma schema applied.
 * @layer integration
 */

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "@infra/prisma";
import { ProviderRegistryService } from "../../src/providers/providerRegistry.js";

const testId = `test-${Date.now()}`;
const testAccountId = `acc-${testId}`;
const testProjectId = `proj-${testId}`;

const getProviderMetadata = (providerId: string) => {
  const registry = new ProviderRegistryService();
  const metadata = registry.getProvider(providerId);
  return {
    capabilities: metadata?.capabilities || {},
    limits: metadata?.limits || {},
  };
};

describe("Provider Registry - Database Integration", () => {
  before(async () => {
    await prisma.account.create({
      data: {
        id: testAccountId,
        email: `test-${testId}@example.com`,
        name: "Test Account",
        subscription: "BASIC",
      },
    });

    await prisma.project.create({
      data: {
        id: testProjectId,
        accountId: testAccountId,
        name: "Test Project",
      },
    });
  });

  after(async () => {
    try {
      await prisma.account.delete({ where: { id: testAccountId } });
    } catch {
      // Account may already be deleted in some test scenarios
    }
  });

  it("should handle Prisma Provider enum values correctly", async () => {
    const metadata = getProviderMetadata("x");
    const connection = await prisma.providerConnection.create({
      data: {
        accountId: testAccountId,
        projectId: testProjectId,
        providerId: "X",
        providerName: "X (Twitter)",
        accountName: "@testuser",
        capabilities: metadata.capabilities,
        limits: metadata.limits,
        connectedAt: new Date(),
      },
    });

    assert.ok(connection.id, "Connection should have an id");
    assert.strictEqual(connection.providerId, "X");

    await prisma.providerConnection.delete({ where: { id: connection.id } });
  });

  it("should handle NULL vs undefined for optional fields", async () => {
    const metadata = getProviderMetadata("instagram");
    const connection = await prisma.providerConnection.create({
      data: {
        accountId: testAccountId,
        projectId: testProjectId,
        providerId: "INSTAGRAM",
        providerName: "Instagram",
        capabilities: metadata.capabilities,
        limits: metadata.limits,
      },
    });

    assert.ok(connection.id);
    assert.strictEqual(connection.accountName, null);
    assert.strictEqual(connection.accessToken, null);

    await prisma.providerConnection.delete({ where: { id: connection.id } });
  });

  it("should query ProviderConnection by provider enum", async () => {
    const xMetadata = getProviderMetadata("x");
    const instaMetadata = getProviderMetadata("instagram");

    const conn1 = await prisma.providerConnection.create({
      data: {
        accountId: testAccountId,
        projectId: testProjectId,
        providerId: "X",
        providerName: "X",
        capabilities: xMetadata.capabilities,
        limits: xMetadata.limits,
      },
    });

    const conn2 = await prisma.providerConnection.create({
      data: {
        accountId: testAccountId,
        projectId: testProjectId,
        providerId: "INSTAGRAM",
        providerName: "Instagram",
        capabilities: instaMetadata.capabilities,
        limits: instaMetadata.limits,
      },
    });

    const xConnections = await prisma.providerConnection.findMany({
      where: { providerId: "X" },
    });

    const instagramConnections = await prisma.providerConnection.findMany({
      where: { providerId: "INSTAGRAM" },
    });

    assert.ok(xConnections.some((c) => c.id === conn1.id));
    assert.ok(instagramConnections.some((c) => c.id === conn2.id));

    await prisma.providerConnection.deleteMany({
      where: { id: { in: [conn1.id, conn2.id] } },
    });
  });

  it("should update ProviderConnection with conditional spreading", async () => {
    const metadata = getProviderMetadata("facebook");
    const connection = await prisma.providerConnection.create({
      data: {
        accountId: testAccountId,
        projectId: testProjectId,
        providerId: "FACEBOOK",
        providerName: "Facebook",
        capabilities: metadata.capabilities,
        limits: metadata.limits,
      },
    });

    const accessToken = "new-access-token";
    const refreshToken: string | undefined = undefined;

    const updated = await prisma.providerConnection.update({
      where: { id: connection.id },
      data: {
        ...(accessToken !== undefined && { accessToken }),
        ...(refreshToken !== undefined && { refreshToken }),
        lastUsedAt: new Date(),
      },
    });

    assert.strictEqual(updated.accessToken, accessToken);
    assert.strictEqual(updated.refreshToken, null);
    assert.ok(updated.lastUsedAt !== null);

    await prisma.providerConnection.delete({ where: { id: connection.id } });
  });
});
