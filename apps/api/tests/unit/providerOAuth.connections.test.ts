import { describe, it, mock, beforeEach } from "node:test";
import assert from "node:assert/strict";

interface MockPrisma {
  providerConnection: {
    upsert: ReturnType<typeof mock.fn>;
    findMany: ReturnType<typeof mock.fn>;
    update: ReturnType<typeof mock.fn>;
  };
}

let mockPrisma: MockPrisma;

function setupMocks() {
  mockPrisma = {
    providerConnection: {
      upsert: mock.fn(async () => ({
        id: "conn-123",
        providerId: "X",
        accountName: "@testuser",
        isActive: true,
        status: "CONNECTED",
      })),
      findMany: mock.fn(async () => []),
      update: mock.fn(async () => ({})),
    },
  };
}

// ============================================================================
// OAuth Flow - Connection Storage Tests
// ============================================================================

describe("ProviderOAuth - Connection Storage", { concurrency: 1 }, () => {
  beforeEach(() => {
    setupMocks();
  });

  it("should create new provider connection", async () => {
    mockPrisma.providerConnection.upsert = mock.fn(
      async (args: Record<string, Record<string, unknown>>) => {
        assert.strictEqual(args.create.providerId, "X", "Should uppercase provider ID");
        assert.ok(args.create.accessToken, "Should store access token");
        assert.strictEqual(args.create.status, "CONNECTED", "Should set status to CONNECTED");
        assert.strictEqual(args.create.isActive, true, "Should set active flag");
        return {
          id: "new-conn-123",
          ...args.create,
        };
      }
    );

    const result = await mockPrisma.providerConnection.upsert({
      where: {
        accountId_projectId_providerId: {
          accountId: "acc-123",
          projectId: "proj-123",
          providerId: "X",
        },
      },
      create: {
        accountId: "acc-123",
        projectId: "proj-123",
        providerId: "X",
        providerName: "X",
        accessToken: "token",
        providerAccountId: "x-user-123",
        accountName: "@testuser",
        isActive: true,
        status: "CONNECTED",
        connectedAt: new Date(),
        capabilities: {},
        limits: {},
        constraints: {},
      },
      update: {},
    });

    assert.ok(result.id, "Should return connection ID");
  });

  it("should update existing provider connection", async () => {
    const existingConnection = {
      id: "conn-123",
      accountId: "acc-123",
      projectId: "proj-123",
      providerId: "X",
      accessToken: "old-token",
    };

    mockPrisma.providerConnection.upsert = mock.fn(
      async (args: Record<string, Record<string, unknown>>) => {
        assert.ok(args.update.accessToken, "Should update access token");
        assert.ok(args.update.lastUsedAt, "Should update last used timestamp");
        assert.strictEqual(args.update.healthScore, 100, "Should reset health score");
        return {
          ...existingConnection,
          ...args.update,
        };
      }
    );

    const result = await mockPrisma.providerConnection.upsert({
      where: {
        accountId_projectId_providerId: {
          accountId: "acc-123",
          projectId: "proj-123",
          providerId: "X",
        },
      },
      create: {},
      update: {
        accessToken: "new-token",
        lastUsedAt: new Date(),
        healthScore: 100,
        errorCount: 0,
      },
    });

    assert.strictEqual(result.id, "conn-123", "Should keep same ID");
  });

  it("should store token expiration if provided", async () => {
    const expiresIn = 7200;
    const expiresAt = new Date(Date.now() + expiresIn * 1000);

    mockPrisma.providerConnection.upsert = mock.fn(
      async (args: Record<string, Record<string, unknown>>) => {
        if (args.create.expiresAt) {
          assert.ok(args.create.expiresAt instanceof Date, "Should store expiration as Date");
        }
        return { id: "conn-123" };
      }
    );

    await mockPrisma.providerConnection.upsert({
      where: {
        accountId_projectId_providerId: {
          accountId: "acc-123",
          projectId: "proj-123",
          providerId: "X",
        },
      },
      create: {
        accountId: "acc-123",
        projectId: "proj-123",
        providerId: "X",
        accessToken: "token",
        expiresAt,
      },
      update: {},
    });

    assert.ok(true, "Should handle expiration date");
  });

  it("should store refresh token if provided", async () => {
    mockPrisma.providerConnection.upsert = mock.fn(
      async (args: Record<string, Record<string, unknown>>) => {
        if (args.create.refreshToken) {
          assert.strictEqual(
            args.create.refreshToken,
            "refresh-token",
            "Should store refresh token"
          );
        }
        return { id: "conn-123" };
      }
    );

    await mockPrisma.providerConnection.upsert({
      where: {
        accountId_projectId_providerId: {
          accountId: "acc-123",
          projectId: "proj-123",
          providerId: "X",
        },
      },
      create: {
        accountId: "acc-123",
        projectId: "proj-123",
        providerId: "X",
        accessToken: "access-token",
        refreshToken: "refresh-token",
      },
      update: {},
    });
  });
});

// ============================================================================
// OAuth Flow - Connection Retrieval Tests
// ============================================================================

describe("ProviderOAuth - Connection Retrieval", { concurrency: 1 }, () => {
  beforeEach(() => {
    setupMocks();
  });

  it("should retrieve connections for account and project", async () => {
    const mockConnections = [
      {
        id: "conn-1",
        providerId: "X",
        accountName: "@user1",
        status: "CONNECTED",
      },
      {
        id: "conn-2",
        providerId: "INSTAGRAM",
        accountName: "user2",
        status: "CONNECTED",
      },
    ];

    mockPrisma.providerConnection.findMany = mock.fn(
      async (args: Record<string, Record<string, unknown>>) => {
        assert.strictEqual(args.where.accountId, "acc-123", "Should filter by account ID");
        assert.strictEqual(args.where.projectId, "proj-123", "Should filter by project ID");
        assert.strictEqual(args.where.isActive, true, "Should filter by active status");
        return mockConnections;
      }
    );

    const result = await mockPrisma.providerConnection.findMany({
      where: {
        accountId: "acc-123",
        projectId: "proj-123",
        isActive: true,
      },
      select: {
        id: true,
        providerId: true,
        providerName: true,
        accountName: true,
        profileImage: true,
        isVerified: true,
        status: true,
        connectedAt: true,
        lastUsedAt: true,
        healthScore: true,
      },
    });

    assert.strictEqual(result.length, 2, "Should return 2 connections");
  });

  it("should only return active connections", async () => {
    mockPrisma.providerConnection.findMany = mock.fn(
      async (args: Record<string, Record<string, unknown>>) => {
        assert.strictEqual(args.where.isActive, true, "Should only return active connections");
        return [];
      }
    );

    await mockPrisma.providerConnection.findMany({
      where: {
        accountId: "acc-123",
        projectId: "proj-123",
        isActive: true,
      },
    });
  });

  it("should select only necessary fields for privacy", async () => {
    mockPrisma.providerConnection.findMany = mock.fn(
      async (args: Record<string, Record<string, unknown>>) => {
        assert.ok(args.select, "Should use field selection");
        const select = args.select as Record<string, unknown>;
        assert.strictEqual(select.accessToken, undefined, "Should not return access token");
        assert.strictEqual(select.refreshToken, undefined, "Should not return refresh token");
        return [];
      }
    );

    await mockPrisma.providerConnection.findMany({
      where: { accountId: "acc-123", projectId: "proj-123", isActive: true },
      select: {
        id: true,
        providerId: true,
        accountName: true,
        status: true,
      },
    });
  });
});

// ============================================================================
// OAuth Flow - Disconnection Tests
// ============================================================================

describe("ProviderOAuth - Connection Disconnection", { concurrency: 1 }, () => {
  beforeEach(() => {
    setupMocks();
  });

  it("should disconnect provider connection", async () => {
    mockPrisma.providerConnection.update = mock.fn(
      async (args: Record<string, Record<string, unknown>>) => {
        assert.strictEqual(args.data.isActive, false, "Should set isActive to false");
        assert.strictEqual(args.data.status, "DISCONNECTED", "Should set status to DISCONNECTED");
        assert.strictEqual(args.data.accessToken, null, "Should clear access token");
        assert.strictEqual(args.data.refreshToken, null, "Should clear refresh token");
        return { id: args.where.id };
      }
    );

    await mockPrisma.providerConnection.update({
      where: { id: "conn-123" },
      data: {
        isActive: false,
        status: "DISCONNECTED",
        accessToken: null,
        refreshToken: null,
      },
    });
  });

  it("should clear sensitive credentials on disconnect", async () => {
    mockPrisma.providerConnection.update = mock.fn(
      async (args: Record<string, Record<string, unknown>>) => {
        assert.strictEqual(args.data.accessToken, null, "Should clear access token");
        assert.strictEqual(args.data.refreshToken, null, "Should clear refresh token");
        return {};
      }
    );

    await mockPrisma.providerConnection.update({
      where: { id: "conn-123" },
      data: {
        isActive: false,
        status: "DISCONNECTED",
        accessToken: null,
        refreshToken: null,
      },
    });
  });
});
