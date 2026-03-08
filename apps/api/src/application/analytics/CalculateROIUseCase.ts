/**
 * Application Layer - Calculate ROI Use Case
 *
 * Part of Sprint 11: TDD Implementation
 * Calculates return on investment for social media activities using
 * rule-based formulas (investment vs. revenue ratios). No ML involved.
 */

import { type Result, ok, err } from "@shared/types";
import { type UseCase, UseCaseError, USE_CASE_ERRORS } from "../UseCase.js";
import type { CalculateROIInput, CalculateROIOutput, ChannelROI, ProviderType } from "./types.js";

/**
 * ROI Calculator interface (port)
 */
export interface ROICalculatorPort {
  calculateROI(options: {
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
  }>;

  calculateChannelROI?(options: {
    accountId: string;
    projectId?: string;
    timeRange: string;
    startDate?: Date;
    endDate?: Date;
  }): Promise<{
    channels: ChannelROI[];
    bestPerforming: string;
    recommendations: string[];
  }>;
}

/**
 * Calculate ROI Use Case
 *
 * Calculates return on investment for social media marketing activities,
 * including per-channel breakdown and recommendations.
 */
export class CalculateROIUseCase
  implements UseCase<CalculateROIInput, CalculateROIOutput, UseCaseError>
{
  constructor(private readonly roiCalculator: ROICalculatorPort) {}

  async execute(input: CalculateROIInput): Promise<Result<CalculateROIOutput, UseCaseError>> {
    // Validate account ID
    if (!input.accountId || input.accountId.trim().length === 0) {
      return err(new UseCaseError("Account ID is required", USE_CASE_ERRORS.VALIDATION_FAILED));
    }

    // Validate time range
    const validTimeRanges = ["7d", "30d", "90d", "1y", "custom"];
    if (!validTimeRanges.includes(input.timeRange)) {
      return err(
        new UseCaseError(
          `Invalid time range. Must be one of: ${validTimeRanges.join(", ")}`,
          USE_CASE_ERRORS.VALIDATION_FAILED
        )
      );
    }

    try {
      // Calculate overall ROI
      const roiResult = await this.roiCalculator.calculateROI({
        accountId: input.accountId,
        ...(input.projectId !== undefined && { projectId: input.projectId }),
        timeRange: input.timeRange,
        ...(input.startDate && { startDate: new Date(input.startDate) }),
        ...(input.endDate && { endDate: new Date(input.endDate) }),
        ...(input.providers !== undefined && { providers: input.providers }),
        ...(input.investmentDetails !== undefined && {
          investmentDetails: input.investmentDetails,
        }),
      });

      // Calculate per-channel ROI if requested
      let channelBreakdown: ChannelROI[] | undefined;
      let bestPerformingChannel: ProviderType | undefined;
      let recommendations: string[] | undefined;

      if (input.byChannel && this.roiCalculator.calculateChannelROI) {
        const channelResult = await this.roiCalculator.calculateChannelROI({
          accountId: input.accountId,
          ...(input.projectId !== undefined && { projectId: input.projectId }),
          timeRange: input.timeRange,
          ...(input.startDate && { startDate: new Date(input.startDate) }),
          ...(input.endDate && { endDate: new Date(input.endDate) }),
        });

        channelBreakdown = channelResult.channels;
        bestPerformingChannel = channelResult.bestPerforming as ProviderType;
        recommendations = channelResult.recommendations;
      }

      return ok({
        totalInvestment: roiResult.totalInvestment,
        totalRevenue: roiResult.totalRevenue,
        roi: roiResult.roi,
        roiPercentage: roiResult.roiPercentage,
        ...(roiResult.breakdown !== undefined && { breakdown: roiResult.breakdown }),
        ...(channelBreakdown !== undefined && { channelBreakdown }),
        ...(bestPerformingChannel !== undefined && { bestPerformingChannel }),
        ...(recommendations !== undefined && { recommendations }),
      });
    } catch (error) {
      return err(
        new UseCaseError(
          `Failed to calculate ROI: ${error instanceof Error ? error.message : "Unknown error"}`,
          USE_CASE_ERRORS.INTERNAL_ERROR
        )
      );
    }
  }
}
