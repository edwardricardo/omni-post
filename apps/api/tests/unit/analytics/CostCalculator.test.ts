/**
 * @file CostCalculator.test.ts
 * @description Mutation-killing tests for ROI CostCalculator — pure math.
 * @layer infrastructure
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import assert from "node:assert/strict";
import { CostCalculator } from "../../../src/analytics/roi/CostCalculator.js";

function makeCostModel(overrides: Record<string, unknown> = {}) {
  return {
    platformCosts: {
      X: 0,
      INSTAGRAM: 0,
      FACEBOOK: 0,
      LINKEDIN: 29,
      YOUTUBE: 0,
      TIKTOK: 0,
      PINTEREST: 0,
      SNAPCHAT: 0,
      TELEGRAM: 0,
      BLUESKY: 0,
      THREADS: 0,
    },
    contentCreationCostPerPost: 25,
    personnelCostPerHour: 50,
    avgTimePerPost: 0.5,
    toolingCostPerMonth: 199,
    advertisingBudget: 0,
    ...overrides,
  };
}

function makePost(provider = "twitter") {
  return {
    provider,
    publishedAt: new Date(),
    metrics: { impressions: 100, engagement: 10 },
  } as any;
}

describe("CostCalculator", () => {
  let calc: CostCalculator;

  beforeEach(() => {
    vi.clearAllMocks();
    calc = new CostCalculator();
  });

  describe("calculateCosts", () => {
    it("calculates content creation costs based on post count", () => {
      const posts = [makePost(), makePost(), makePost()];
      const model = makeCostModel();
      const start = new Date("2025-01-01");
      const end = new Date("2025-01-31");

      const result = calc.calculateCosts(posts, model as any, start, end);

      assert.equal(result.contentCreationCosts, 75); // 3 * 25
    });

    it("calculates personnel costs correctly", () => {
      const posts = [makePost(), makePost()];
      const model = makeCostModel({ personnelCostPerHour: 60, avgTimePerPost: 1 });
      const start = new Date("2025-01-01");
      const end = new Date("2025-01-31");

      const result = calc.calculateCosts(posts, model as any, start, end);

      assert.equal(result.personnelCosts, 120); // 2 * 1 * 60
    });

    it("scales tooling costs by time period", () => {
      const model = makeCostModel({ toolingCostPerMonth: 100 });
      const start = new Date("2025-01-01");
      const end = new Date("2025-03-02"); // ~60 days = 2 months

      const result = calc.calculateCosts([], model as any, start, end);

      assert.ok(result.toolingCosts > 100); // more than 1 month
      assert.ok(result.toolingCosts < 300); // less than 3 months
    });

    it("uses advertisingBudget as-is", () => {
      const model = makeCostModel({ advertisingBudget: 500 });
      const result = calc.calculateCosts(
        [],
        model as any,
        new Date("2025-01-01"),
        new Date("2025-01-31")
      );

      assert.equal(result.advertisingCosts, 500);
    });

    it("defaults advertisingCosts to 0 when not set", () => {
      const model = makeCostModel({ advertisingBudget: undefined });
      const result = calc.calculateCosts(
        [],
        model as any,
        new Date("2025-01-01"),
        new Date("2025-01-31")
      );

      assert.equal(result.advertisingCosts, 0);
    });

    it("sets otherCosts to 0", () => {
      const result = calc.calculateCosts(
        [],
        makeCostModel() as any,
        new Date("2025-01-01"),
        new Date("2025-01-31")
      );
      assert.equal(result.otherCosts, 0);
    });

    it("calculates platform costs scaled by time period", () => {
      const model = makeCostModel({ platformCosts: { X: 0, LINKEDIN: 30 } });
      const start = new Date("2025-01-01");
      const end = new Date("2025-01-31"); // ~30 days = 1 month

      const result = calc.calculateCosts([], model as any, start, end);

      assert.ok(result.platformCosts.LINKEDIN !== undefined);
      // ~30 * (30/30) = ~30
      assert.ok(Math.abs((result.platformCosts as any).LINKEDIN - 30) < 2);
    });
  });

  describe("calculateCostAttribution", () => {
    it("returns percentage that sums to ~100%", async () => {
      const posts = [makePost(), makePost()];
      const model = makeCostModel();
      const start = new Date("2025-01-01");
      const end = new Date("2025-01-31");

      const attr = await calc.calculateCostAttribution(posts, model as any, start, end);

      const totalPct = Object.values(attr).reduce((sum, v) => sum + v.percentage, 0);
      assert.ok(Math.abs(totalPct - 100) < 0.1);
    });

    it("returns 0 percentages when total cost is 0", async () => {
      const model = makeCostModel({
        contentCreationCostPerPost: 0,
        personnelCostPerHour: 0,
        toolingCostPerMonth: 0,
        platformCosts: {},
        advertisingBudget: 0,
      });

      const attr = await calc.calculateCostAttribution(
        [],
        model as any,
        new Date("2025-01-01"),
        new Date("2025-01-31")
      );

      for (const val of Object.values(attr)) {
        assert.equal(val.percentage, 0);
      }
    });

    it("includes all 5 cost categories", async () => {
      const attr = await calc.calculateCostAttribution(
        [makePost()],
        makeCostModel() as any,
        new Date("2025-01-01"),
        new Date("2025-01-31")
      );

      expect(Object.keys(attr)).toContain("Content Creation");
      expect(Object.keys(attr)).toContain("Personnel");
      expect(Object.keys(attr)).toContain("Platform Subscriptions");
      expect(Object.keys(attr)).toContain("Tools & Software");
      expect(Object.keys(attr)).toContain("Advertising");
    });
  });

  describe("calculateProviderCosts", () => {
    it("sums platform + content + personnel costs for a provider", () => {
      const posts = [makePost("linkedin"), makePost("linkedin")];
      const model = makeCostModel({
        platformCosts: { linkedin: 29 },
        contentCreationCostPerPost: 10,
        personnelCostPerHour: 40,
        avgTimePerPost: 0.5,
      });

      const cost = calc.calculateProviderCosts(posts, "linkedin" as any, model as any);

      // 29 (platform) + 2*10 (content) + 2*0.5*40 (personnel) = 29+20+40 = 89
      assert.equal(cost, 89);
    });

    it("defaults platform cost to 0 for unknown provider", () => {
      const cost = calc.calculateProviderCosts([], "unknown" as any, makeCostModel() as any);
      assert.equal(cost, 0);
    });
  });

  describe("getDefaultCostModel", () => {
    it("returns default cost model with expected values", () => {
      const model = calc.getDefaultCostModel();
      assert.equal(model.contentCreationCostPerPost, 25);
      assert.equal(model.personnelCostPerHour, 50);
      assert.equal(model.avgTimePerPost, 0.5);
      assert.equal(model.toolingCostPerMonth, 199);
      assert.equal(model.advertisingBudget, 0);
    });

    it("includes LinkedIn premium cost", () => {
      const model = calc.getDefaultCostModel();
      assert.equal(model.platformCosts.LINKEDIN, 29);
    });

    it("has free organic for X", () => {
      const model = calc.getDefaultCostModel();
      assert.equal(model.platformCosts.X, 0);
    });
  });
});
