/**
 * @file ROICalculatorAdapter.ts
 * @description Adapter bridging ROICalculatorPort to the concrete ROICalculator service.
 *              Maps between the use case's simplified input/output shapes and the
 *              infrastructure's full cost model.
 * @layer infrastructure
 */
import type { ROICalculatorPort } from "../../application/analytics/CalculateROIUseCase.js";
import type { ChannelROI } from "../../application/analytics/types.js";
import { ROICalculator } from "../../analytics/roiCalculator.js";
import type { ROICalculationOptions } from "../../analytics/roi/types.js";
import type { TimeRange, ProviderType } from "@shared/analytics";
import type { ProjectQueryRepositoryPort } from "../../domain/repositories/ProjectQueryRepository.js";
import { PrismaProjectQueryRepository } from "../repositories/PrismaProjectQueryRepository.js";
import { prisma } from "@infra/prisma";

/**
 * Adapter that implements ROICalculatorPort by delegating to ROICalculator.
 *
 * The use case accepts free-form investmentDetails; this adapter constructs
 * a CostModel from those details using sensible defaults for fields not provided.
 *
 * NOTE: @shared/analytics ProviderType uses lowercase values (twitter, instagram, …).
 * The CostModel.platformCosts map therefore uses the same lowercase keys.
 */
export class ROICalculatorAdapter implements ROICalculatorPort {
  private readonly calculator: ROICalculator;

  constructor(projectRepository?: ProjectQueryRepositoryPort) {
    // Fallback to Prisma-backed instance when not injected (e.g. DI container setup)
    const repo = projectRepository ?? new PrismaProjectQueryRepository(prisma);
    this.calculator = new ROICalculator(repo);
  }

  async calculateROI(options: {
    accountId: string;
    projectId?: string;
    timeRange: string;
    startDate?: Date;
    endDate?: Date;
    providers?: string[];
    investmentDetails?: {
      adSpend?: number;
      contentCreation?: number;
      tools?: number;
      labor?: number;
      other?: number;
    };
  }): Promise<{
    totalInvestment: number;
    totalRevenue: number;
    roi: number;
    roiPercentage: number;
    breakdown?: Record<string, unknown>;
  }> {
    const calculatorOptions: ROICalculationOptions = {
      accountId: options.accountId,
      ...(options.projectId !== undefined && { projectId: options.projectId }),
      timeRange: options.timeRange as TimeRange,
      ...(options.startDate !== undefined && { startDate: options.startDate }),
      ...(options.endDate !== undefined && { endDate: options.endDate }),
      ...(options.providers !== undefined && {
        providers: options.providers as ProviderType[],
      }),
      ...(options.investmentDetails !== undefined && {
        customCostModel: this.buildCostModel(options.investmentDetails),
      }),
    };

    const result = await this.calculator.calculateROI(calculatorOptions);

    // Compute totalInvestment from the cost breakdown.
    // CostBreakdown is a typed object — use `as unknown as Record<string, number>` to sum values
    // without adding an index signature to the infrastructure type.
    const costBreakdownRecord = result.costBreakdown as unknown as Record<string, number>;
    const totalInvestment = Object.values(costBreakdownRecord).reduce(
      (sum, v) => sum + (typeof v === "number" ? v : 0),
      0
    );

    const totalRevenue = result.totalRevenue;
    const roi = totalInvestment > 0 ? (totalRevenue - totalInvestment) / totalInvestment : 0;
    const roiPercentage = roi * 100;

    // Build a readable breakdown record from cost and revenue breakdown
    const breakdown: Record<string, unknown> = {
      costBreakdown: result.costBreakdown as unknown as Record<string, unknown>,
      revenueBreakdown: result.revenueBreakdown as unknown as Record<string, unknown>,
      roiByProvider: result.roiByProvider as unknown as Record<string, unknown>,
    };

    return {
      totalInvestment,
      totalRevenue,
      roi,
      roiPercentage,
      breakdown,
    };
  }

  async calculateChannelROI(options: {
    accountId: string;
    projectId?: string;
    timeRange: string;
    startDate?: Date;
    endDate?: Date;
  }): Promise<{
    channels: ChannelROI[];
    bestPerforming: string;
    recommendations: string[];
  }> {
    const calculatorOptions: ROICalculationOptions = {
      accountId: options.accountId,
      ...(options.projectId !== undefined && { projectId: options.projectId }),
      timeRange: options.timeRange as TimeRange,
      ...(options.startDate !== undefined && { startDate: options.startDate }),
      ...(options.endDate !== undefined && { endDate: options.endDate }),
    };

    const result = await this.calculator.calculateROI(calculatorOptions);

    // Map roiByProvider to ChannelROI array.
    // roiByProvider uses ProviderType (lowercase) as keys.
    const roiByProviderRecord = result.roiByProvider as unknown as Record<
      string,
      { cost: number; revenue: number; roi: number }
    >;
    const channels: ChannelROI[] = Object.entries(roiByProviderRecord).map(
      ([provider, metrics]) => {
        const channelRoi = metrics.roi;
        const performance = this.classifyPerformance(channelRoi);
        return {
          // The application layer ChannelROI expects uppercase provider names (ProviderType from types.ts)
          // The infrastructure uses lowercase. We cast to satisfy the type.
          channel: provider.toUpperCase() as ChannelROI["channel"],
          investment: metrics.cost,
          revenue: metrics.revenue,
          roi: channelRoi,
          performance,
        };
      }
    );

    // Best performing channel by ROI
    const best = channels.reduce<ChannelROI | undefined>((prev, curr) => {
      if (!prev) return curr;
      return curr.roi > prev.roi ? curr : prev;
    }, undefined);

    // Extract recommendation strings from the infrastructure's ROIRecommendation objects
    const recommendations = result.recommendations.map((rec) => {
      if (typeof rec === "string") return rec;
      const r = rec as { action?: string; recommendation?: string; description?: string };
      return r.action ?? r.recommendation ?? r.description ?? String(rec);
    });

    return {
      channels,
      bestPerforming: best?.channel ?? "",
      recommendations,
    };
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  /**
   * Build a cost model from ad-hoc investment detail fields.
   * Missing fields fall back to zero or minimal defaults.
   *
   * NOTE: ProviderType uses lowercase keys (twitter, instagram, etc.).
   */
  private buildCostModel(investment: {
    adSpend?: number;
    contentCreation?: number;
    tools?: number;
    labor?: number;
    other?: number;
  }) {
    const contentCreationCostPerPost = (investment.contentCreation ?? 0) / 10; // assume ~10 posts/month
    const personnelCostPerHour = (investment.labor ?? 0) / 160; // assume 160h/month
    const toolingCostPerMonth = (investment.tools ?? 0) + (investment.other ?? 0);
    const advertisingBudget = investment.adSpend;

    // Build a CostModel with zeroed-out platform costs for each provider.
    // Keys must match ProviderType (lowercase) from @shared/analytics.
    const emptyPlatformCosts: Record<ProviderType, number> = {
      twitter: 0,
      instagram: 0,
      facebook: 0,
      linkedin: 0,
      youtube: 0,
      tiktok: 0,
      pinterest: 0,
    };

    return {
      platformCosts: emptyPlatformCosts,
      contentCreationCostPerPost,
      personnelCostPerHour,
      avgTimePerPost: 2,
      toolingCostPerMonth,
      ...(advertisingBudget !== undefined && { advertisingBudget }),
    };
  }

  private classifyPerformance(roi: number): ChannelROI["performance"] {
    if (roi >= 0.5) return "excellent";
    if (roi >= 0.2) return "good";
    if (roi >= 0) return "average";
    return "poor";
  }
}
