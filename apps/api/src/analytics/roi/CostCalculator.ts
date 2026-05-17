/**
 * @file CostCalculator.ts
 * @description Calculates cost breakdowns by category, cost attribution analysis,
 *              and platform and personnel cost calculations.
 * @layer infrastructure
 */

import type { CostBreakdown, CostModel, ProviderType, PostDataPoint } from "./types";

export class CostCalculator {
  /**
   * Calculate comprehensive cost breakdown
   */
  calculateCosts(
    postsData: PostDataPoint[],
    costModel: CostModel,
    startDate: Date,
    endDate: Date
  ): CostBreakdown {
    const totalPosts = postsData.length;
    const timePeriodDays = (endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24);
    const monthlyMultiplier = timePeriodDays / 30;

    // Calculate platform costs
    const platformCosts = Object.entries(costModel.platformCosts).reduce(
      (acc, [provider, cost]) => {
        acc[provider as ProviderType] = cost * monthlyMultiplier;
        return acc;
      },
      {} as Record<ProviderType, number>
    );

    return {
      platformCosts,
      contentCreationCosts: totalPosts * costModel.contentCreationCostPerPost,
      toolingCosts: costModel.toolingCostPerMonth * monthlyMultiplier,
      personnelCosts: totalPosts * costModel.avgTimePerPost * costModel.personnelCostPerHour,
      advertisingCosts: costModel.advertisingBudget || 0,
      otherCosts: 0,
    };
  }

  /**
   * Calculate cost attribution for different activities
   */
  async calculateCostAttribution(
    postsData: PostDataPoint[],
    costModel: CostModel,
    startDate: Date,
    endDate: Date
  ): Promise<Record<string, { cost: number; percentage: number }>> {
    const totalPosts = postsData.length;

    // Calculate time period for monthly costs
    const timePeriodDays = (endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24);
    const monthlyMultiplier = timePeriodDays / 30;

    const costs = {
      "Content Creation": totalPosts * costModel.contentCreationCostPerPost,
      Personnel: totalPosts * costModel.avgTimePerPost * costModel.personnelCostPerHour,
      "Platform Subscriptions":
        Object.values(costModel.platformCosts).reduce((sum, cost) => sum + cost, 0) *
        monthlyMultiplier,
      "Tools & Software": costModel.toolingCostPerMonth * monthlyMultiplier,
      Advertising: costModel.advertisingBudget || 0,
    };

    const totalCost = Object.values(costs).reduce((sum, cost) => sum + cost, 0);

    const attribution: Record<string, { cost: number; percentage: number }> = {};
    for (const [category, cost] of Object.entries(costs)) {
      attribution[category] = {
        cost,
        percentage: totalCost > 0 ? (cost / totalCost) * 100 : 0,
      };
    }

    return attribution;
  }

  /**
   * Calculate provider-specific costs
   */
  calculateProviderCosts(
    providerPosts: PostDataPoint[],
    provider: ProviderType,
    costModel: CostModel
  ): number {
    const platformCost = costModel.platformCosts[provider] || 0;
    const contentCost = providerPosts.length * costModel.contentCreationCostPerPost;
    const personnelCost =
      providerPosts.length * costModel.avgTimePerPost * costModel.personnelCostPerHour;

    return platformCost + contentCost + personnelCost;
  }

  /**
   * Get default cost model
   */
  getDefaultCostModel(): CostModel {
    return {
      platformCosts: {
        X: 0, // Free organic
        INSTAGRAM: 0,
        FACEBOOK: 0,
        LINKEDIN: 29, // LinkedIn Premium
        YOUTUBE: 0,
        TIKTOK: 0,
        PINTEREST: 0,
        SNAPCHAT: 0,
        TELEGRAM: 0,
        BLUESKY: 0,
        THREADS: 0,
      },
      contentCreationCostPerPost: 25, // Average cost to create content
      personnelCostPerHour: 50, // Social media manager rate
      avgTimePerPost: 0.5, // 30 minutes per post
      toolingCostPerMonth: 199, // Social media tools
      advertisingBudget: 0,
    };
  }
}
