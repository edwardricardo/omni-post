/**
 * @file DetectRepurposeCandidatesUseCase.ts
 * @description Scans for posts that significantly outperformed their account
 *              average and creates repurpose proposals. Runs after analytics ingestion.
 * @layer application
 */

import { type Result, ok, err } from "@shared/types";
import { type UseCase, UseCaseError, USE_CASE_ERRORS } from "../UseCase.js";
import type { UnitOfWork } from "@core/domain/repositories/Repository.js";

const REPURPOSE_THRESHOLD = 2.0;
const MAX_POST_AGE_DAYS = 30;

export interface DetectRepurposeInput {
  accountId: string;
}

export interface DetectRepurposeOutput {
  detected: number;
  alreadyProposed: number;
}

export interface RepurposeDetectionPort {
  getAccountAvgEngagement(accountId: string, sinceDays: number): Promise<number>;
  getHighPerformers(params: {
    accountId: string;
    minEngagementRate: number;
    sinceDays: number;
  }): Promise<
    Array<{
      postId: string;
      platform: string;
      engagementRate: number;
      content: string;
    }>
  >;
  proposalExistsForPost(postId: string): Promise<boolean>;
  createProposal(params: {
    accountId: string;
    sourcePostId: string;
    sourcePlatform: string;
    engagementRate: number;
    engagementMultiplier: number;
  }): Promise<string>;
}

export interface RepurposeJobDispatcher {
  dispatchGenerateVariants(proposalId: string): Promise<void>;
}

export class DetectRepurposeCandidatesUseCase implements UseCase<
  DetectRepurposeInput,
  DetectRepurposeOutput,
  UseCaseError
> {
  constructor(
    private readonly port: RepurposeDetectionPort,
    private readonly dispatcher: RepurposeJobDispatcher,
    private readonly unitOfWork?: UnitOfWork
  ) {}

  async execute(input: DetectRepurposeInput): Promise<Result<DetectRepurposeOutput, UseCaseError>> {
    const doWork = async (): Promise<Result<DetectRepurposeOutput, UseCaseError>> => {
      const avgEngagement = await this.port.getAccountAvgEngagement(
        input.accountId,
        MAX_POST_AGE_DAYS
      );

      if (avgEngagement <= 0) {
        return ok({ detected: 0, alreadyProposed: 0 });
      }

      const threshold = avgEngagement * REPURPOSE_THRESHOLD;
      const candidates = await this.port.getHighPerformers({
        accountId: input.accountId,
        minEngagementRate: threshold,
        sinceDays: MAX_POST_AGE_DAYS,
      });

      let detected = 0;
      let alreadyProposed = 0;

      for (const candidate of candidates) {
        const exists = await this.port.proposalExistsForPost(candidate.postId);
        if (exists) {
          alreadyProposed++;
          continue;
        }

        const multiplier = Math.round((candidate.engagementRate / avgEngagement) * 100) / 100;

        const proposalId = await this.port.createProposal({
          accountId: input.accountId,
          sourcePostId: candidate.postId,
          sourcePlatform: candidate.platform,
          engagementRate: candidate.engagementRate,
          engagementMultiplier: multiplier,
        });

        await this.dispatcher.dispatchGenerateVariants(proposalId);
        detected++;
      }

      return ok({ detected, alreadyProposed });
    };

    try {
      if (this.unitOfWork) {
        let result: Result<DetectRepurposeOutput, UseCaseError> = ok({
          detected: 0,
          alreadyProposed: 0,
        });
        await this.unitOfWork.executeInTransaction(async () => {
          result = await doWork();
        });
        return result;
      }
      return await doWork();
    } catch (error: unknown) {
      return err(
        new UseCaseError(
          "Failed to detect repurpose candidates",
          USE_CASE_ERRORS.INTERNAL_ERROR,
          error instanceof Error ? error : undefined
        )
      );
    }
  }
}
