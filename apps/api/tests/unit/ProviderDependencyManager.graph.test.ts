import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { ProviderDependencyManager } from "../../src/orchestration/ProviderDependencyManager.js";
import type { ProviderDependency } from "@shared/orchestration";
import type { ProviderId } from "../../src/providers/providerAdapter.interface";
import {
  MockPrismaClient,
  MockRedis,
  MockEventService,
} from "./ProviderDependencyManager.test-helpers.js";

describe("ProviderDependencyManager - Graph Construction", { concurrency: 1 }, () => {
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

  afterEach(() => {
    mockRedis.clear();
    mockEventService.clear();
  });

  it("should initialize dependency graph with simple providers", async () => {
    const providers: ProviderId[] = ["twitter", "facebook", "instagram"];
    const dependencies: ProviderDependency[] = [];

    const result = await manager.buildDependencyGraph(providers, dependencies);

    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.value.nodes.size, 3);
      assert.equal(result.value.hasCycles, false);
      assert.equal(result.value.executionOrder.length, 3);
      assert.equal(result.value.readyNodes.size, 3); // All ready since no dependencies
    }
  });

  it("should build dependency graph with simple chain", async () => {
    const providers: ProviderId[] = ["twitter", "facebook", "instagram"];
    const dependencies: ProviderDependency[] = [
      {
        providerId: "facebook",
        dependsOn: ["twitter"],
      },
      {
        providerId: "instagram",
        dependsOn: ["facebook"],
      },
    ];

    const result = await manager.buildDependencyGraph(providers, dependencies);

    assert.equal(result.ok, true);
    if (result.ok) {
      const graph = result.value;
      assert.equal(graph.nodes.size, 3);
      assert.equal(graph.hasCycles, false);

      // Check dependencies
      const twitterNode = graph.nodes.get("twitter");
      const facebookNode = graph.nodes.get("facebook");
      const instagramNode = graph.nodes.get("instagram");

      assert.equal(twitterNode?.dependencies.size, 0);
      assert.equal(facebookNode?.dependencies.size, 1);
      assert.equal(instagramNode?.dependencies.size, 1);

      // Check dependents
      assert.equal(twitterNode?.dependents.size, 1);
      assert.equal(facebookNode?.dependents.size, 1);
      assert.equal(instagramNode?.dependents.size, 0);

      // Only twitter should be initially ready
      assert.equal(graph.readyNodes.size, 1);
      assert.equal(graph.readyNodes.has("twitter"), true);
    }
  });

  it("should handle multiple independent dependency chains", async () => {
    const providers: ProviderId[] = ["twitter", "facebook", "instagram", "linkedin"];
    const dependencies: ProviderDependency[] = [
      {
        providerId: "facebook",
        dependsOn: ["twitter"],
      },
      {
        providerId: "linkedin",
        dependsOn: ["instagram"],
      },
    ];

    const result = await manager.buildDependencyGraph(providers, dependencies);

    assert.equal(result.ok, true);
    if (result.ok) {
      const graph = result.value;
      assert.equal(graph.nodes.size, 4);

      // Twitter and Instagram should both be ready (roots of chains)
      assert.equal(graph.readyNodes.size, 2);
      assert.equal(graph.readyNodes.has("twitter"), true);
      assert.equal(graph.readyNodes.has("instagram"), true);
    }
  });

  it("should fail when dependency provider not found", async () => {
    const providers: ProviderId[] = ["twitter", "facebook"];
    const dependencies: ProviderDependency[] = [
      {
        providerId: "facebook",
        dependsOn: ["instagram"], // Not in providers list
      },
    ];

    const result = await manager.buildDependencyGraph(providers, dependencies);

    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.error.type, "validation");
      assert.match(result.error.message, /Dependency provider not found/);
    }
  });

  it("should fail when provider not found in dependency", async () => {
    const providers: ProviderId[] = ["twitter"];
    const dependencies: ProviderDependency[] = [
      {
        providerId: "facebook", // Not in providers list
        dependsOn: ["twitter"],
      },
    ];

    const result = await manager.buildDependencyGraph(providers, dependencies);

    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.error.type, "validation");
      assert.match(result.error.message, /Provider not found in dependency/);
    }
  });
});

describe("ProviderDependencyManager - Cycle Detection", { concurrency: 1 }, () => {
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

  it("should detect simple circular dependency A->B->A", async () => {
    const providers: ProviderId[] = ["twitter", "facebook"];
    const dependencies: ProviderDependency[] = [
      {
        providerId: "twitter",
        dependsOn: ["facebook"],
      },
      {
        providerId: "facebook",
        dependsOn: ["twitter"],
      },
    ];

    const result = await manager.buildDependencyGraph(providers, dependencies);

    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.error.type, "validation");
      assert.match(result.error.message, /Circular dependencies detected/);
      assert.ok(result.error.context?.cycle);
    }
  });

  it("should detect complex circular dependency A->B->C->A", async () => {
    const providers: ProviderId[] = ["twitter", "facebook", "instagram"];
    const dependencies: ProviderDependency[] = [
      {
        providerId: "twitter",
        dependsOn: ["instagram"],
      },
      {
        providerId: "facebook",
        dependsOn: ["twitter"],
      },
      {
        providerId: "instagram",
        dependsOn: ["facebook"],
      },
    ];

    const result = await manager.buildDependencyGraph(providers, dependencies);

    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.match(result.error.message, /Circular dependencies detected/);
      const cycle = result.error.context?.cycle as string[];
      assert.ok(cycle.length >= 3);
    }
  });

  it("should detect self-referencing cycle A->A", async () => {
    const providers: ProviderId[] = ["twitter"];
    const dependencies: ProviderDependency[] = [
      {
        providerId: "twitter",
        dependsOn: ["twitter"],
      },
    ];

    const result = await manager.buildDependencyGraph(providers, dependencies);

    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.match(result.error.message, /Circular dependencies detected/);
    }
  });

  it("should not report cycles in valid DAG", async () => {
    const providers: ProviderId[] = ["twitter", "facebook", "instagram", "linkedin"];
    const dependencies: ProviderDependency[] = [
      {
        providerId: "facebook",
        dependsOn: ["twitter"],
      },
      {
        providerId: "instagram",
        dependsOn: ["twitter"],
      },
      {
        providerId: "linkedin",
        dependsOn: ["facebook", "instagram"],
      },
    ];

    const result = await manager.buildDependencyGraph(providers, dependencies);

    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.value.hasCycles, false);
    }
  });
});

describe("ProviderDependencyManager - Topological Sort", { concurrency: 1 }, () => {
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

  it("should compute correct execution order for linear chain", async () => {
    const providers: ProviderId[] = ["twitter", "facebook", "instagram"];
    const dependencies: ProviderDependency[] = [
      {
        providerId: "facebook",
        dependsOn: ["twitter"],
      },
      {
        providerId: "instagram",
        dependsOn: ["facebook"],
      },
    ];

    const result = await manager.buildDependencyGraph(providers, dependencies);

    assert.equal(result.ok, true);
    if (result.ok) {
      const order = result.value.executionOrder;
      assert.equal(order.length, 3);

      // Twitter must come before Facebook
      const twitterIdx = order.indexOf("twitter");
      const facebookIdx = order.indexOf("facebook");
      const instagramIdx = order.indexOf("instagram");

      assert.ok(twitterIdx < facebookIdx);
      assert.ok(facebookIdx < instagramIdx);
    }
  });

  it("should compute valid execution order for diamond dependency", async () => {
    const providers: ProviderId[] = ["twitter", "facebook", "instagram", "linkedin"];
    const dependencies: ProviderDependency[] = [
      {
        providerId: "facebook",
        dependsOn: ["twitter"],
      },
      {
        providerId: "instagram",
        dependsOn: ["twitter"],
      },
      {
        providerId: "linkedin",
        dependsOn: ["facebook", "instagram"],
      },
    ];

    const result = await manager.buildDependencyGraph(providers, dependencies);

    assert.equal(result.ok, true);
    if (result.ok) {
      const order = result.value.executionOrder;
      assert.equal(order.length, 4);

      const twitterIdx = order.indexOf("twitter");
      const facebookIdx = order.indexOf("facebook");
      const instagramIdx = order.indexOf("instagram");
      const linkedinIdx = order.indexOf("linkedin");

      // Twitter must come first
      assert.ok(twitterIdx < facebookIdx);
      assert.ok(twitterIdx < instagramIdx);

      // LinkedIn must come last
      assert.ok(facebookIdx < linkedinIdx);
      assert.ok(instagramIdx < linkedinIdx);
    }
  });
});
