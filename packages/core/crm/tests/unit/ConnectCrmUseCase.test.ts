/**
 * @file ConnectCrmUseCase.test.ts
 * @description Unit tests for ConnectCrmUseCase — validates platform, accessToken,
 *   and upsert persistence for CRM connections.
 * @layer infrastructure
 */

import { describe, it, vi, beforeEach } from "vitest";
import assert from "node:assert/strict";
import { ConnectCrmUseCase } from "../../src/ConnectCrmUseCase.js";
import type { CrmConnectionData } from "@core/domain/repositories/CrmConnectionRepository.js";

const makeCrmConnectionData = (overrides?: Partial<CrmConnectionData>): CrmConnectionData => ({
  id: "crm-uuid-001",
  accountId: "acct-uuid-001",
  platform: "HUBSPOT",
  isActive: true,
  accessToken: "dummy-access-token",
  refreshToken: null,
  tokenExpiresAt: null,
  portalId: null,
  instanceUrl: null,
  sandboxMode: false,
  syncContacts: true,
  syncActivities: true,
  lastSyncAt: null,
  createdAt: new Date("2024-01-01T00:00:00Z"),
  updatedAt: new Date("2024-01-01T00:00:00Z"),
  ...overrides,
});

const makeRepo = () => ({
  save: vi.fn().mockResolvedValue(makeCrmConnectionData()),
  findByAccountId: vi.fn(),
  findById: vi.fn(),
  delete: vi.fn(),
  logActivity: vi.fn(),
});

describe("ConnectCrmUseCase", () => {
  let repo: ReturnType<typeof makeRepo>;
  let useCase: ConnectCrmUseCase;

  beforeEach(() => {
    vi.clearAllMocks();
    repo = makeRepo();
    useCase = new ConnectCrmUseCase(repo);
  });

  it("returns ok with CRM connection data when input is valid", async () => {
    const result = await useCase.execute({
      accountId: "acct-uuid-001",
      platform: "HUBSPOT",
      accessToken: "dummy-access-token",
    });
    assert.ok(result.ok, "Expected ok result");
    assert.strictEqual(result.value.platform, "HUBSPOT");
    assert.strictEqual(result.value.isActive, true);
  });

  it("returns ok with SALESFORCE connection", async () => {
    repo.save.mockResolvedValue(makeCrmConnectionData({ platform: "SALESFORCE" }));
    const result = await useCase.execute({
      accountId: "acct-uuid-001",
      platform: "SALESFORCE",
      accessToken: "dummy-sf-access-token",
      instanceUrl: "https://org.salesforce.com",
    });
    assert.ok(result.ok, "Expected ok result");
    assert.strictEqual(result.value.platform, "SALESFORCE");
  });

  it("returns VALIDATION_FAILED when accountId is empty", async () => {
    const result = await useCase.execute({
      accountId: "",
      platform: "HUBSPOT",
      accessToken: "dummy-access-token",
    });
    assert.ok(!result.ok, "Expected err result");
    assert.strictEqual(result.error.code, "VALIDATION_FAILED");
  });

  it("returns VALIDATION_FAILED when platform is not HUBSPOT or SALESFORCE", async () => {
    const result = await useCase.execute({
      accountId: "acct-uuid-001",
      platform: "UNSUPPORTED_CRM",
      accessToken: "dummy-access-token",
    });
    assert.ok(!result.ok, "Expected err result");
    assert.strictEqual(result.error.code, "VALIDATION_FAILED");
  });

  it("returns VALIDATION_FAILED when accessToken is empty", async () => {
    const result = await useCase.execute({
      accountId: "acct-uuid-001",
      platform: "HUBSPOT",
      accessToken: "   ",
    });
    assert.ok(!result.ok, "Expected err result");
    assert.strictEqual(result.error.code, "VALIDATION_FAILED");
  });
});
