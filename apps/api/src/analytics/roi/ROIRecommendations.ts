/**
 * @file ROIRecommendations.ts
 * @description Generates actionable ROI recommendations by analyzing performance gaps
 *              and prioritizing optimization opportunities.
 * @layer infrastructure
 */

import type { ROIRecommendation, RecommendationInput } from "./types";

export class ROIRecommendations {
  /**
   * Generate comprehensive ROI recommendations
   */
  generateROIRecommendations(data: RecommendationInput): ROIRecommendation[] {
    const recommendations: ROIRecommendation[] = [];

    // Analyze overall ROI performance
    this.addOverallROIRecommendation(data, recommendations);

    // Analyze provider performance
    this.addProviderPerformanceRecommendation(data, recommendations);

    // Analyze cost structure
    this.addCostStructureRecommendation(data, recommendations);

    // Analyze revenue optimization opportunities
    this.addRevenueOptimizationRecommendation(data, recommendations);

    // Sort by priority
    return this.sortRecommendationsByPriority(recommendations);
  }

  /**
   * Add overall ROI performance recommendation
   */
  private addOverallROIRecommendation(
    data: RecommendationInput,
    recommendations: ROIRecommendation[]
  ): void {
    if (data.roi < 50) {
      recommendations.push({
        type: "revenue_optimization",
        description: `Your current ROI of ${data.roi.toFixed(1)}% is below optimal levels. Focus on improving conversion rates and content quality.`,
        currentROI: data.roi,
        projectedROI: data.roi * 1.5,
        implementation: [
          "Optimize high-performing content types",
          "Improve call-to-action placement",
          "A/B test different content formats",
          "Focus on platforms with highest ROI",
        ],
        priority: "high",
      });
    }
  }

  /**
   * Add provider performance recommendation
   */
  private addProviderPerformanceRecommendation(
    data: RecommendationInput,
    recommendations: ROIRecommendation[]
  ): void {
    const sortedProviders = Object.entries(data.roiByProvider).sort(
      ([, a], [, b]) => b.roi - a.roi
    );

    if (sortedProviders.length > 1) {
      const [bestProvider, bestMetric] = sortedProviders[0]!; // Safe since length > 1
      const [worstProvider, worstMetric] = sortedProviders[sortedProviders.length - 1]!; // Safe since length > 1

      if (bestMetric.roi > worstMetric.roi * 2) {
        recommendations.push({
          type: "budget_reallocation",
          description: `${bestProvider} generates ${bestMetric.roi.toFixed(1)}% ROI compared to ${worstProvider}'s ${worstMetric.roi.toFixed(1)}%. Consider reallocating budget.`,
          currentROI: data.roi,
          projectedROI: data.roi * 1.3,
          implementation: [
            `Increase content production on ${bestProvider} by 40%`,
            `Reduce spend on ${worstProvider} by 30%`,
            "Analyze successful patterns on top-performing platform",
            "Test similar strategies across other platforms",
          ],
          priority: "medium",
        });
      }
    }
  }

  /**
   * Add cost structure recommendation
   */
  private addCostStructureRecommendation(
    data: RecommendationInput,
    recommendations: ROIRecommendation[]
  ): void {
    const totalCostBreakdown = Object.values(data.costBreakdown).reduce(
      (sum, cost) => sum + cost,
      0
    );
    const personnelPercentage = (data.costBreakdown.personnelCosts / totalCostBreakdown) * 100;

    if (personnelPercentage > 60) {
      recommendations.push({
        type: "cost_reduction",
        description: `Personnel costs represent ${personnelPercentage.toFixed(1)}% of total costs. Consider automation and efficiency improvements.`,
        currentROI: data.roi,
        projectedROI: data.roi * 1.2,
        implementation: [
          "Implement content scheduling automation",
          "Use AI tools for content creation assistance",
          "Batch content creation processes",
          "Establish content templates and workflows",
        ],
        priority: "medium",
      });
    }
  }

  /**
   * Add revenue optimization recommendation
   */
  private addRevenueOptimizationRecommendation(
    data: RecommendationInput,
    recommendations: ROIRecommendation[]
  ): void {
    if (data.revenueBreakdown.directSales < data.revenueBreakdown.brandAwareness) {
      recommendations.push({
        type: "revenue_optimization",
        description:
          "Brand awareness value exceeds direct sales. Focus on conversion optimization to maximize revenue potential.",
        currentROI: data.roi,
        projectedROI: data.roi * 1.8,
        implementation: [
          "Add clear call-to-actions to high-performing posts",
          "Create landing pages for social media traffic",
          "Implement lead magnets and email capture",
          "Develop retargeting campaigns for engaged users",
        ],
        priority: "high",
      });
    }
  }

  /**
   * Sort recommendations by priority
   */
  private sortRecommendationsByPriority(recommendations: ROIRecommendation[]): ROIRecommendation[] {
    const priorityOrder = { high: 3, medium: 2, low: 1 };
    return recommendations.sort((a, b) => priorityOrder[b.priority] - priorityOrder[a.priority]);
  }

  /**
   * Filter recommendations by type
   */
  filterByType(
    recommendations: ROIRecommendation[],
    type: ROIRecommendation["type"]
  ): ROIRecommendation[] {
    return recommendations.filter((rec) => rec.type === type);
  }

  /**
   * Get high priority recommendations only
   */
  getHighPriorityRecommendations(recommendations: ROIRecommendation[]): ROIRecommendation[] {
    return recommendations.filter((rec) => rec.priority === "high");
  }
}
