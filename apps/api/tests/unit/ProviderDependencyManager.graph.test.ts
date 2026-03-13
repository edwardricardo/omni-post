import { describe, it, beforeEach, afterEach, expect } from "vitest";
import { ProviderDependencyManager } from "../../src/orchestration/ProviderDependencyManager.js";
import type { ProviderDependency } from "@shared/orchestration";
import type { ProviderId } from "../../src/providers/providerAdapter.interface";
import {
  MockPrismaClient,
  MockRedis,
  MockEventService,
} from "./ProviderDependencyManager.test-helpers.js";

describe("ProviderDependencyManager - Graph Construction", () => {
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

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.nodes.size).toBe(3);
      expect(result.value.hasCycles).toBe(false);
      expect(result.value.executionOrder.length).toBe(3);
      expect(result.value.readyNodes.size).toBe(3); // All ready since no dependencies
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

    expect(result.ok).toBe(true);
    if (result.ok) {
      const graph = result.value;
      expect(graph.nodes.size).toBe(3);
      expect(graph.hasCycles).toBe(false);

      // Check dependencies
      const twitterNode = graph.nodes.get("twitter");
      const facebookNode = graph.nodes.get("facebook");
      const instagramNode = graph.nodes.get("instagram");

      expect(twitterNode?.dependencies.size).toBe(0);
      expect(facebookNode?.dependencies.size).toBe(1);
      expect(instagramNode?.dependencies.size).toBe(1);

      // Check dependents
      expect(twitterNode?.dependents.size).toBe(1);
      expect(facebookNode?.dependents.size).toBe(1);
      expect(instagramNode?.dependents.size).toBe(0);

      // Only twitter should be initially ready
      expect(graph.readyNodes.size).toBe(1);
      expect(graph.readyNodes.has("twitter")).toBe(true);
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

    expect(result.ok).toBe(true);
    if (result.ok) {
      const graph = result.value;
      expect(graph.nodes.size).toBe(4);

      // Twitter and Instagram should both be ready (roots of chains)
      expect(graph.readyNodes.size).toBe(2);
      expect(graph.readyNodes.has("twitter")).toBe(true);
      expect(graph.readyNodes.has("instagram")).toBe(true);
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

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.type).toBe("validation");
      expect(result.error.message).toMatch(/Dependency provider not found/);
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

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.type).toBe("validation");
      expect(result.error.message).toMatch(/Provider not found in dependency/);
    }
  });
});

describe("ProviderDependencyManager - Cycle Detection", () => {
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

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.type).toBe("validation");
      expect(result.error.message).toMatch(/Circular dependencies detected/);
      expect(result.error.context?.cycle).toBeTruthy();
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

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.message).toMatch(/Circular dependencies detected/);
      const cycle = result.error.context?.cycle as string[];
      expect(cycle.length >= 3).toBeTruthy();
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

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.message).toMatch(/Circular dependencies detected/);
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

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.hasCycles).toBe(false);
    }
  });
});

describe("ProviderDependencyManager - Topological Sort", () => {
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

    expect(result.ok).toBe(true);
    if (result.ok) {
      const order = result.value.executionOrder;
      expect(order.length).toBe(3);

      // Twitter must come before Facebook
      const twitterIdx = order.indexOf("twitter");
      const facebookIdx = order.indexOf("facebook");
      const instagramIdx = order.indexOf("instagram");

      expect(twitterIdx < facebookIdx).toBeTruthy();
      expect(facebookIdx < instagramIdx).toBeTruthy();
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

    expect(result.ok).toBe(true);
    if (result.ok) {
      const order = result.value.executionOrder;
      expect(order.length).toBe(4);

      const twitterIdx = order.indexOf("twitter");
      const facebookIdx = order.indexOf("facebook");
      const instagramIdx = order.indexOf("instagram");
      const linkedinIdx = order.indexOf("linkedin");

      // Twitter must come first
      expect(twitterIdx < facebookIdx).toBeTruthy();
      expect(twitterIdx < instagramIdx).toBeTruthy();

      // LinkedIn must come last
      expect(facebookIdx < linkedinIdx).toBeTruthy();
      expect(instagramIdx < linkedinIdx).toBeTruthy();
    }
  });
});
