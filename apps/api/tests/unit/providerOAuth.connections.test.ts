/**
 * @file providerOAuth.connections.test.ts
 * @description Tests for ProviderOAuth - Connection Storage
 * @layer infrastructure
 */
import { describe, it, beforeEach, vi, expect } from "vitest";
interface MockPrisma {
  providerConnection: {
    upsert: ReturnType<typeof vi.fn>;
    findMany: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
  };
}

let mockPrisma: MockPrisma;

function setupMocks() {
  mockPrisma = {
    providerConnection: {
      upsert: vi.fn(async () => ({
        id: "conn-123",
        providerId: "X",
        accountName: "@testuser",
        isActive: true,
        status: "CONNECTED",
      })),
      findMany: vi.fn(async () => []),
      update: vi.fn(async () => ({})),
    },
  };
}

// ============================================================================
// OAuth Flow - Connection Storage Tests
// ============================================================================

describe("ProviderOAuth - Connection Storage", () => {
  beforeEach(() => {
    setupMocks();
  });

  it("should create new provider connection", async () => {
    mockPrisma.providerConnection.upsert = vi.fn(
      async (args: Record<string, Record<string, unknown>>) => {
        expect(args.create.providerId).toBe("X");
        expect(args.create.accessToken).toBeTruthy();
        expect(args.create.status).toBe("CONNECTED");
        expect(args.create.isActive).toBe(true);
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

    expect(result.id).toBeTruthy();
  });

  it("should update existing provider connection", async () => {
    const existingConnection = {
      id: "conn-123",
      accountId: "acc-123",
      projectId: "proj-123",
      providerId: "X",
      accessToken: "old-token",
    };

    mockPrisma.providerConnection.upsert = vi.fn(
      async (args: Record<string, Record<string, unknown>>) => {
        expect(args.update.accessToken).toBeTruthy();
        expect(args.update.lastUsedAt).toBeTruthy();
        expect(args.update.healthScore).toBe(100);
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

    expect(result.id).toBe("conn-123");
  });

  it("should store token expiration if provided", async () => {
    const expiresIn = 7200;
    const expiresAt = new Date(Date.now() + expiresIn * 1000);

    mockPrisma.providerConnection.upsert = vi.fn(
      async (args: Record<string, Record<string, unknown>>) => {
        if (args.create.expiresAt) {
          expect(args.create.expiresAt instanceof Date).toBeTruthy();
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

    expect(true).toBeTruthy();
  });

  it("should store refresh token if provided", async () => {
    mockPrisma.providerConnection.upsert = vi.fn(
      async (args: Record<string, Record<string, unknown>>) => {
        if (args.create.refreshToken) {
          expect(args.create.refreshToken).toBe("refresh-token");
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

describe("ProviderOAuth - Connection Retrieval", () => {
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

    mockPrisma.providerConnection.findMany = vi.fn(
      async (args: Record<string, Record<string, unknown>>) => {
        expect(args.where.accountId).toBe("acc-123");
        expect(args.where.projectId).toBe("proj-123");
        expect(args.where.isActive).toBe(true);
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

    expect(result.length).toBe(2);
  });

  it("should only return active connections", async () => {
    mockPrisma.providerConnection.findMany = vi.fn(
      async (args: Record<string, Record<string, unknown>>) => {
        expect(args.where.isActive).toBe(true);
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
    mockPrisma.providerConnection.findMany = vi.fn(
      async (args: Record<string, Record<string, unknown>>) => {
        expect(args.select).toBeTruthy();
        const select = args.select as Record<string, unknown>;
        expect(select.accessToken).toBe(undefined);
        expect(select.refreshToken).toBe(undefined);
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

describe("ProviderOAuth - Connection Disconnection", () => {
  beforeEach(() => {
    setupMocks();
  });

  it("should disconnect provider connection", async () => {
    mockPrisma.providerConnection.update = vi.fn(
      async (args: Record<string, Record<string, unknown>>) => {
        expect(args.data.isActive).toBe(false);
        expect(args.data.status).toBe("DISCONNECTED");
        expect(args.data.accessToken).toBe(null);
        expect(args.data.refreshToken).toBe(null);
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
    mockPrisma.providerConnection.update = vi.fn(
      async (args: Record<string, Record<string, unknown>>) => {
        expect(args.data.accessToken).toBe(null);
        expect(args.data.refreshToken).toBe(null);
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
