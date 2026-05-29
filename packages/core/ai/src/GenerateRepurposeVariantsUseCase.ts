/**
 * @file GenerateRepurposeVariantsUseCase.ts
 * @description Generates platform-native variants for a repurpose proposal
 *              using the source post content as the brief.
 * @layer application
 */

import { type Result, ok, err } from "@shared/types";
import { type UseCase, UseCaseError, USE_CASE_ERRORS } from "@core/application/UseCase.js";
import type { UnitOfWork } from "@core/domain/repositories/Repository.js";
import type { GeneratePlatformVariantsUseCase } from "./GeneratePlatformVariantsUseCase.js";

export interface GenerateRepurposeInput {
  proposalId: string;
}

export interface GenerateRepurposeOutput {
  variantsCreated: number;
}

export interface RepurposeVariantPort {
  loadProposal(proposalId: string): Promise<{
    id: string;
    accountId: string;
    sourcePostId: string;
    sourcePlatform: string;
  } | null>;
  getPostContent(postId: string): Promise<string | null>;
  getConnectedPlatforms(accountId: string): Promise<string[]>;
  createVariant(params: {
    proposalId: string;
    platform: string;
    content: string;
    hashtags: string[];
  }): Promise<void>;
  /**
   * Platforms that already have a persisted variant for this proposal.
   * Enables idempotent (re)processing — only missing platforms regenerate.
   */
  existingVariantPlatforms(proposalId: string): Promise<string[]>;
}

export interface NotificationPort {
  notify(params: {
    accountId: string;
    title: string;
    body: string;
    resourceType: string;
    resourceId: string;
  }): Promise<void>;
}

export class GenerateRepurposeVariantsUseCase implements UseCase<
  GenerateRepurposeInput,
  GenerateRepurposeOutput,
  UseCaseError
> {
  constructor(
    private readonly port: RepurposeVariantPort,
    private readonly platformVariants: GeneratePlatformVariantsUseCase,
    private readonly notificationPort?: NotificationPort,
    private readonly unitOfWork?: UnitOfWork
  ) {}

  async execute(
    input: GenerateRepurposeInput
  ): Promise<Result<GenerateRepurposeOutput, UseCaseError>> {
    const doWork = async (): Promise<Result<GenerateRepurposeOutput, UseCaseError>> => {
      const proposal = await this.port.loadProposal(input.proposalId);
      if (!proposal) {
        return err(new UseCaseError("Proposal not found", USE_CASE_ERRORS.NOT_FOUND));
      }

      const content = await this.port.getPostContent(proposal.sourcePostId);
      if (!content) {
        return err(new UseCaseError("Source post content not found", USE_CASE_ERRORS.NOT_FOUND));
      }

      const connectedPlatforms = await this.port.getConnectedPlatforms(proposal.accountId);
      const targetPlatforms = connectedPlatforms.filter((p) => p !== proposal.sourcePlatform);

      if (targetPlatforms.length === 0) {
        return ok({ variantsCreated: 0 });
      }

      const variantsResult = await this.platformVariants.execute({
        accountId: proposal.accountId,
        brief: content,
        platforms: targetPlatforms,
        usePerformanceData: true,
      });

      if (!variantsResult.ok) {
        return ok({ variantsCreated: 0 });
      }

      for (const variant of variantsResult.value.variants) {
        await this.port.createVariant({
          proposalId: input.proposalId,
          platform: variant.platform,
          content: variant.content,
          hashtags: variant.hashtags,
        });
      }

      if (this.notificationPort) {
        await this.notificationPort.notify({
          accountId: proposal.accountId,
          title: "Repurpose opportunity detected",
          body: `Your ${proposal.sourcePlatform} post is performing exceptionally. We've prepared ${variantsResult.value.variants.length} repurposed versions.`,
          resourceType: "repurpose_proposal",
          resourceId: input.proposalId,
        });
      }

      return ok({ variantsCreated: variantsResult.value.variants.length });
    };

    try {
      if (this.unitOfWork) {
        let result: Result<GenerateRepurposeOutput, UseCaseError> = ok({ variantsCreated: 0 });
        await this.unitOfWork.executeInTransaction(async () => {
          result = await doWork();
        });
        return result;
      }
      return await doWork();
    } catch (error: unknown) {
      return err(
        new UseCaseError(
          "Failed to generate repurpose variants",
          USE_CASE_ERRORS.INTERNAL_ERROR,
          error instanceof Error ? error : undefined
        )
      );
    }
  }
}
