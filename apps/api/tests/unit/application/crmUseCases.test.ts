/**
 * @file crmUseCases.test.ts
 * @description Unit tests for CRM use cases: Connect, Disconnect, LogActivity, GetConnections.
 * @layer application
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { ConnectCrmUseCase } from "@core/application/crm/ConnectCrmUseCase.js";
import { DisconnectCrmUseCase } from "@core/application/crm/DisconnectCrmUseCase.js";
import { LogCrmActivityUseCase } from "@core/application/crm/LogCrmActivityUseCase.js";
import { GetCrmConnectionsQuery } from "@core/application/crm/GetCrmConnectionsQuery.js";

// Mock repositories
function createMockCrmConnectionRepo() {
  return {
    save: vi.fn(async (data: Record<string, unknown>) => ({
      ok: true,
      value: { id: "conn-1", ...data },
    })),
    findByAccountId: vi.fn(async () => [
      {
        id: "conn-1",
        accountId: "acc-1",
        platform: "HUBSPOT",
        isActive: true,
        lastSyncAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ]),
    findByAccountAndPlatform: vi.fn(async () => ({
      ok: true,
      value: {
        id: "conn-1",
        accountId: "acc-1",
        platform: "HUBSPOT",
        isActive: true,
      },
    })),
    deactivate: vi.fn(async () => ({ ok: true, value: undefined })),
    findById: vi.fn(async () => ({ ok: true, value: null })),
  };
}

function createMockCrmActivityRepo() {
  return {
    save: vi.fn(async (data: Record<string, unknown>) => ({
      ok: true,
      value: { id: "act-1", ...data },
    })),
    findUnsyncedByAccountId: vi.fn(async () => []),
    markSynced: vi.fn(async () => ({ ok: true, value: undefined })),
  };
}

describe("ConnectCrmUseCase", () => {
  let useCase: ConnectCrmUseCase;
  let mockRepo: ReturnType<typeof createMockCrmConnectionRepo>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockRepo = createMockCrmConnectionRepo();
    useCase = new ConnectCrmUseCase(mockRepo as never);
  });

  it("creates connection with valid HUBSPOT input", async () => {
    const result = await useCase.execute({
      accountId: "acc-1",
      platform: "HUBSPOT",
      accessToken: "tok-123",
      portalId: "12345",
    });
    expect(result.ok).toBe(true);
    expect(mockRepo.save).toHaveBeenCalledTimes(1);
  });

  it("creates connection with valid SALESFORCE input", async () => {
    const result = await useCase.execute({
      accountId: "acc-1",
      platform: "SALESFORCE",
      accessToken: "sf-tok",
      instanceUrl: "https://na1.salesforce.com",
    });
    expect(result.ok).toBe(true);
  });

  it("rejects unsupported platform", async () => {
    const result = await useCase.execute({
      accountId: "acc-1",
      platform: "PIPEDRIVE",
      accessToken: "tok",
    });
    expect(result.ok).toBe(false);
  });

  it("rejects empty accessToken", async () => {
    const result = await useCase.execute({
      accountId: "acc-1",
      platform: "HUBSPOT",
      accessToken: "",
    });
    expect(result.ok).toBe(false);
  });

  it("rejects empty accountId", async () => {
    const result = await useCase.execute({
      accountId: "",
      platform: "HUBSPOT",
      accessToken: "tok",
    });
    expect(result.ok).toBe(false);
  });
});

describe("DisconnectCrmUseCase", () => {
  let useCase: DisconnectCrmUseCase;
  let mockRepo: ReturnType<typeof createMockCrmConnectionRepo>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockRepo = createMockCrmConnectionRepo();
    // findByAccountAndPlatform returns connection data (not Result)
    mockRepo.findByAccountAndPlatform.mockResolvedValue({
      id: "conn-1",
      accountId: "acc-1",
      platform: "HUBSPOT",
      isActive: true,
      accessToken: "tok",
    });
    useCase = new DisconnectCrmUseCase(mockRepo as never);
  });

  it("deactivates connection by setting isActive false via save", async () => {
    const result = await useCase.execute({
      accountId: "acc-1",
      platform: "HUBSPOT",
    });
    expect(result.ok).toBe(true);
    expect(mockRepo.save).toHaveBeenCalledWith(expect.objectContaining({ isActive: false }));
  });

  it("returns not found when connection doesn't exist", async () => {
    mockRepo.findByAccountAndPlatform.mockResolvedValue(null);
    const result = await useCase.execute({
      accountId: "acc-1",
      platform: "HUBSPOT",
    });
    expect(result.ok).toBe(false);
  });
});

describe("LogCrmActivityUseCase", () => {
  let useCase: LogCrmActivityUseCase;
  let mockRepo: ReturnType<typeof createMockCrmActivityRepo>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockRepo = createMockCrmActivityRepo();
    useCase = new LogCrmActivityUseCase(mockRepo as never);
  });

  it("creates activity for POST_PUBLISHED", async () => {
    const result = await useCase.execute({
      accountId: "acc-1",
      platform: "HUBSPOT",
      type: "POST_PUBLISHED",
      title: "Post published on Instagram",
      occurredAt: new Date(),
      postId: "post-1",
    });
    expect(result.ok).toBe(true);
    expect(mockRepo.save).toHaveBeenCalledTimes(1);
  });

  it("creates activity with contactEmail", async () => {
    const result = await useCase.execute({
      accountId: "acc-1",
      platform: "SALESFORCE",
      type: "CAMPAIGN_CREATED",
      title: "Campaign launched",
      occurredAt: new Date(),
      contactEmail: "contact@example.com",
      campaignId: "camp-1",
    });
    expect(result.ok).toBe(true);
  });

  it("rejects unsupported activity type", async () => {
    const result = await useCase.execute({
      accountId: "acc-1",
      platform: "HUBSPOT",
      type: "INVALID_TYPE",
      title: "Something",
      occurredAt: new Date(),
    });
    expect(result.ok).toBe(false);
  });

  it("rejects empty title", async () => {
    const result = await useCase.execute({
      accountId: "acc-1",
      platform: "HUBSPOT",
      type: "POST_PUBLISHED",
      title: "",
      occurredAt: new Date(),
    });
    expect(result.ok).toBe(false);
  });
});

describe("GetCrmConnectionsQuery", () => {
  let query: GetCrmConnectionsQuery;
  let mockRepo: ReturnType<typeof createMockCrmConnectionRepo>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockRepo = createMockCrmConnectionRepo();
    query = new GetCrmConnectionsQuery(mockRepo as never);
  });

  it("returns connections for account", async () => {
    const result = await query.execute({ accountId: "acc-1" });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toHaveLength(1);
      expect(result.value[0].platform).toBe("HUBSPOT");
    }
  });

  it("returns empty array for account with no connections", async () => {
    mockRepo.findByAccountId.mockResolvedValue([]);
    const result = await query.execute({ accountId: "acc-2" });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toHaveLength(0);
    }
  });
});
