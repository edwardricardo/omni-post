import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { ProviderDependencyManager } from "../../src/orchestration/ProviderDependencyManager.js";
import type { ProviderDependency } from "@shared/orchestration";
import type { ProviderId } from "../../src/providers/providerAdapter.interface";
import {
  MockPrismaClient,
  MockRedis,
  MockEventService,
  createMockRetryPolicy,
  createMockPublishResult,
} from "./ProviderDependencyManager.test-helpers.js";

describe("ProviderDependencyManager - Dependency Validation", { concurrency: 1 }, () => {
  let manager: ProviderDependencyManager;
  let mockPrisma: MockPrismaClient;
  let mockRedis: MockRedis;
  let mockEventService: MockEventService;

  beforeEach(() => {
    mockPrisma = new MockPrismaClient();
    mockRedis = new MockRedis();
    mockEventService = new MockEventService();

    manager = new ProviderDependencyManager({
      prisma: mockPrisma as any,
      redis: mockRedis as any,
      eventService: mockEventService as any,
    });
  });

  it("should detect self-dependencies", async () => {
    const providers: ProviderId[] = ["twitter", "facebook"];
    const dependencies: ProviderDependency[] = [
      {
        providerId: "twitter",
        dependsOn: ["twitter"], // Self-dependency
      },
    ];

    const validation = await manager.validateDependencies(providers, dependencies);

    assert.equal(validation.isValid, false);
    assert.ok(validation.errors.some((e) => e.includes("Self-dependency")));
  });

  it("should detect missing providers in dependencies", async () => {
    const providers: ProviderId[] = ["twitter", "facebook"];
    const dependencies: ProviderDependency[] = [
      {
        providerId: "instagram", // Not in providers list
        dependsOn: ["twitter"],
      },
    ];

    const validation = await manager.validateDependencies(providers, dependencies);

    assert.equal(validation.isValid, false);
    assert.ok(
      validation.errors.some((e) => e.includes("Referenced provider not in execution list"))
    );
  });

  it("should warn about deep dependency chains", async () => {
    const providers: ProviderId[] = ["p1", "p2", "p3", "p4", "p5", "p6", "p7"];
    const dependencies: ProviderDependency[] = [
      { providerId: "p2", dependsOn: ["p1"] },
      { providerId: "p3", dependsOn: ["p2"] },
      { providerId: "p4", dependsOn: ["p3"] },
      { providerId: "p5", dependsOn: ["p4"] },
      { providerId: "p6", dependsOn: ["p5"] },
      { providerId: "p7", dependsOn: ["p6"] },
    ];

    const validation = await manager.validateDependencies(providers, dependencies);

    assert.ok(validation.warnings.some((w) => w.includes("Deep dependency chain")));
  });

  it("should suggest SIMULTANEOUS strategy for isolated providers", async () => {
    const providers: ProviderId[] = ["twitter", "facebook", "instagram"];
    const dependencies: ProviderDependency[] = [
      {
        providerId: "twitter",
        dependsOn: ["facebook"],
      },
    ];

    const validation = await manager.validateDependencies(providers, dependencies);

    // Instagram has no dependencies or dependents
    assert.ok(validation.suggestions.some((s) => s.includes("instagram")));
    assert.ok(validation.suggestions.some((s) => s.includes("SIMULTANEOUS")));
  });

  it("should validate clean dependency configuration", async () => {
    const providers: ProviderId[] = ["twitter", "facebook", "instagram"];
    const dependencies: ProviderDependency[] = [
      {
        providerId: "facebook",
        dependsOn: ["twitter"],
      },
    ];

    const validation = await manager.validateDependencies(providers, dependencies);

    assert.equal(validation.isValid, true);
    assert.equal(validation.errors.length, 0);
  });
});

describe("ProviderDependencyManager - Retry Delay Calculation", { concurrency: 1 }, () => {
  let manager: ProviderDependencyManager;

  before(() => {
    const mockPrisma = new MockPrismaClient();
    const mockRedis = new MockRedis();
    const mockEventService = new MockEventService();

    manager = new ProviderDependencyManager({
      prisma: mockPrisma as any,
      redis: mockRedis as any,
      eventService: mockEventService as any,
    });
  });

  it("should calculate linear backoff correctly", () => {
    const policy = createMockRetryPolicy({
      backoffStrategy: "linear",
      baseDelay: 1000,
      maxDelay: 10000,
    });

    assert.equal(manager.calculateRetryDelay(0, policy), 1000); // 1000 * (0 + 1)
    assert.equal(manager.calculateRetryDelay(1, policy), 2000); // 1000 * (1 + 1)
    assert.equal(manager.calculateRetryDelay(2, policy), 3000); // 1000 * (2 + 1)
  });

  it("should calculate exponential backoff correctly", () => {
    const policy = createMockRetryPolicy({
      backoffStrategy: "exponential",
      baseDelay: 1000,
      maxDelay: 20000,
    });

    assert.equal(manager.calculateRetryDelay(0, policy), 1000); // 1000 * 2^0
    assert.equal(manager.calculateRetryDelay(1, policy), 2000); // 1000 * 2^1
    assert.equal(manager.calculateRetryDelay(2, policy), 4000); // 1000 * 2^2
    assert.equal(manager.calculateRetryDelay(3, policy), 8000); // 1000 * 2^3
    assert.equal(manager.calculateRetryDelay(4, policy), 16000); // 1000 * 2^4
  });

  it("should calculate fixed backoff correctly", () => {
    const policy = createMockRetryPolicy({
      backoffStrategy: "fixed",
      baseDelay: 5000,
      maxDelay: 10000,
    });

    assert.equal(manager.calculateRetryDelay(0, policy), 5000);
    assert.equal(manager.calculateRetryDelay(1, policy), 5000);
    assert.equal(manager.calculateRetryDelay(5, policy), 5000);
  });

  it("should respect maxDelay limit", () => {
    const policy = createMockRetryPolicy({
      backoffStrategy: "exponential",
      baseDelay: 1000,
      maxDelay: 5000,
    });

    // 1000 * 2^10 = 1024000, but should be capped at 5000
    assert.equal(manager.calculateRetryDelay(10, policy), 5000);
  });
});

describe("ProviderDependencyManager - Status Updates and Propagation", { concurrency: 1 }, () => {
  let manager: ProviderDependencyManager;
  let mockPrisma: MockPrismaClient;
  let mockRedis: MockRedis;
  let mockEventService: MockEventService;

  beforeEach(() => {
    mockPrisma = new MockPrismaClient();
    mockRedis = new MockRedis();
    mockEventService = new MockEventService();

    manager = new ProviderDependencyManager({
      prisma: mockPrisma as any,
      redis: mockRedis as any,
      eventService: mockEventService as any,
    });
  });

  it("should update provider status to running and remove from ready nodes", async () => {
    const providers: ProviderId[] = ["twitter", "facebook"];
    const dependencies: ProviderDependency[] = [];

    const graphResult = await manager.buildDependencyGraph(providers, dependencies);
    assert.equal(graphResult.ok, true);

    if (graphResult.ok) {
      const graphId = "test-graph-1";
      (manager as any).activeDependencyGraphs.set(graphId, graphResult.value);

      const updateResult = await manager.updateProviderStatus(graphId, "twitter", "running");

      assert.equal(updateResult.ok, true);

      const graph = (manager as any).activeDependencyGraphs.get(graphId);
      const node = graph.nodes.get("twitter");

      assert.equal(node.status, "running");
      assert.equal(graph.readyNodes.has("twitter"), false);
    }
  });

  it("should propagate completion to make dependents ready", async () => {
    const providers: ProviderId[] = ["twitter", "facebook"];
    const dependencies: ProviderDependency[] = [
      {
        providerId: "facebook",
        dependsOn: ["twitter"],
      },
    ];

    const graphResult = await manager.buildDependencyGraph(providers, dependencies);
    assert.equal(graphResult.ok, true);

    if (graphResult.ok) {
      const graphId = "test-graph-2";
      (manager as any).activeDependencyGraphs.set(graphId, graphResult.value);

      const result = createMockPublishResult("twitter", "success");

      await manager.updateProviderStatus(graphId, "twitter", "completed", result);

      const graph = (manager as any).activeDependencyGraphs.get(graphId);

      // Facebook should now be ready
      assert.equal(graph.readyNodes.has("facebook"), true);
    }
  });

  it("should fail when graph not found", async () => {
    const result = await manager.updateProviderStatus("non-existent-graph", "twitter", "running");

    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.error.type, "validation");
      assert.match(result.error.message, /Dependency graph not found/);
    }
  });

  it("should fail when provider not in graph", async () => {
    const providers: ProviderId[] = ["twitter"];
    const dependencies: ProviderDependency[] = [];

    const graphResult = await manager.buildDependencyGraph(providers, dependencies);
    assert.equal(graphResult.ok, true);

    if (graphResult.ok) {
      const graphId = "test-graph-3";
      (manager as any).activeDependencyGraphs.set(graphId, graphResult.value);

      const result = await manager.updateProviderStatus(graphId, "facebook", "running");

      assert.equal(result.ok, false);
      if (!result.ok) {
        assert.equal(result.error.type, "validation");
        assert.match(result.error.message, /Provider not found in graph/);
      }
    }
  });
});
