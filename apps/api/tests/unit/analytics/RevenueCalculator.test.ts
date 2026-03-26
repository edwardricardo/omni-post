/**
 * @file RevenueCalculator.test.ts
 * @description Mutation-killing tests for ROI RevenueCalculator.
 * @layer test
 */

import { describe, it, vi, beforeEach } from "vitest";
import assert from "node:assert/strict";
import { RevenueCalculator } from "../../../src/analytics/roi/RevenueCalculator.js";

function makeAnalytics(views = 1000, engagement = 100) {
  return {
    views,
    engagement,
    likes: engagement,
    comments: 0,
    shares: 0,
    date: new Date().toISOString(),
  } as any;
}

function makeConversion(type: string, value: number) {
  return { conversion_type: type, value, date: new Date().toISOString() } as any;
}

describe("RevenueCalculator", () => {
  let calc: RevenueCalculator;

  beforeEach(() => {
    vi.clearAllMocks();
    calc = new RevenueCalculator();
  });

  describe("getDefaultRevenueModel", () => {
    it("returns model with conversionRate 2.5", () => {
      assert.equal(calc.getDefaultRevenueModel().conversionRate, 2.5);
    });

    it("returns model with averageOrderValue 85", () => {
      assert.equal(calc.getDefaultRevenueModel().averageOrderValue, 85);
    });

    it("returns model with customerLifetimeValue 450", () => {
      assert.equal(calc.getDefaultRevenueModel().customerLifetimeValue, 450);
    });

    it("returns model with brandAwarenessValue 0.002", () => {
      assert.equal(calc.getDefaultRevenueModel().brandAwarenessValue, 0.002);
    });

    it("returns model with leadGenerationValue 15", () => {
      assert.equal(calc.getDefaultRevenueModel().leadGenerationValue, 15);
    });

    it("returns model with organicTrafficValue 0.5", () => {
      assert.equal(calc.getDefaultRevenueModel().organicTrafficValue, 0.5);
    });
  });

  describe("calculateRevenue", () => {
    const model = {
      conversionRate: 2.5,
      averageOrderValue: 85,
      customerLifetimeValue: 450,
      brandAwarenessValue: 0.01,
      leadGenerationValue: 10,
      organicTrafficValue: 1,
    };

    it("sums directSales from sale conversions", () => {
      const conversions = [makeConversion("sale", 100), makeConversion("sale", 200)];
      const result = calc.calculateRevenue([], conversions, model as any);
      assert.equal(result.directSales, 300);
    });

    it("calculates leadGeneration from lead+signup conversions", () => {
      const conversions = [
        makeConversion("lead", 0),
        makeConversion("signup", 0),
        makeConversion("sale", 50),
      ];
      const result = calc.calculateRevenue([], conversions, model as any);
      assert.equal(result.leadGeneration, 20); // 2 leads × $10
    });

    it("calculates brandAwareness from views", () => {
      const analytics = [makeAnalytics(10000)];
      const result = calc.calculateRevenue(analytics, [], model as any);
      assert.equal(result.brandAwareness, 100); // 10000 × 0.01
    });

    it("calculates organicTraffic from estimated clicks", () => {
      const analytics = [makeAnalytics(10000)];
      const result = calc.calculateRevenue(analytics, [], model as any);
      // 10000 × 0.02 CTR = 200 clicks × $1 = 200
      assert.equal(result.organicTraffic, 200);
    });

    it("returns 0 paidTraffic", () => {
      const result = calc.calculateRevenue([], [], model as any);
      assert.equal(result.paidTraffic, 0);
    });

    it("returns 0 for all fields with empty data", () => {
      const result = calc.calculateRevenue([], [], model as any);
      assert.equal(result.directSales, 0);
      assert.equal(result.leadGeneration, 0);
    });
  });

  describe("calculateProviderRevenue", () => {
    const model = { brandAwarenessValue: 0.01, organicTrafficValue: 0.5 } as any;

    it("sums conversion values + brand awareness + organic", () => {
      const analytics = [makeAnalytics(1000)];
      const conversions = [makeConversion("sale", 50)];
      const revenue = calc.calculateProviderRevenue(analytics, conversions, model);
      // 50 (direct) + 1000×0.01 (brand) + floor(1000×0.02)×0.5 (organic) = 50+10+10 = 70
      assert.equal(revenue, 70);
    });

    it("returns 0 with no data", () => {
      assert.equal(calc.calculateProviderRevenue([], [], model), 0);
    });
  });

  describe("calculateEstimatedClicks", () => {
    it("uses 2% CTR by default", () => {
      const analytics = [makeAnalytics(1000)];
      assert.equal(calc.calculateEstimatedClicks(analytics), 20); // floor(1000×0.02)
    });

    it("accepts custom CTR", () => {
      const analytics = [makeAnalytics(1000)];
      assert.equal(calc.calculateEstimatedClicks(analytics, 0.05), 50); // floor(1000×0.05)
    });

    it("floors the result", () => {
      const analytics = [makeAnalytics(33)];
      assert.equal(calc.calculateEstimatedClicks(analytics), 0); // floor(33×0.02) = 0
    });

    it("returns 0 for empty data", () => {
      assert.equal(calc.calculateEstimatedClicks([]), 0);
    });
  });

  describe("calculateTotalRevenue", () => {
    it("sums all revenue sources", () => {
      const breakdown = {
        directSales: 100,
        leadGeneration: 50,
        brandAwareness: 20,
        customerRetention: 10,
        organicTraffic: 5,
        paidTraffic: 0,
      };
      assert.equal(calc.calculateTotalRevenue(breakdown), 185);
    });

    it("returns 0 for all-zero breakdown", () => {
      const breakdown = {
        directSales: 0,
        leadGeneration: 0,
        brandAwareness: 0,
        customerRetention: 0,
        organicTraffic: 0,
        paidTraffic: 0,
      };
      assert.equal(calc.calculateTotalRevenue(breakdown), 0);
    });
  });
});
