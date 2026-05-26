/**
 * @file setupRepurposeUseCases.ts
 * @description Registers AI repurpose use cases with their Prisma adapters and
 *              BullMQ dispatcher in the DI container.
 * @layer infrastructure
 */

import type { Container } from "./Container.js";
import { TOKENS } from "./types.js";
import type { PrismaClient } from "@infra/prisma";
import type { UnitOfWork } from "@core/domain/repositories/Repository.js";
import type { QueuePortRegistry } from "@ports/core";
import { QUEUE_NAMES } from "@adapters/queue-bullmq";
import { ApproveRepurposeVariantUseCase } from "@core/application/ai/ApproveRepurposeVariantUseCase.js";
import { RejectRepurposeVariantUseCase } from "@core/application/ai/RejectRepurposeVariantUseCase.js";
import { DetectRepurposeCandidatesUseCase } from "@core/application/ai/DetectRepurposeCandidatesUseCase.js";
import { DispatchDetectRepurposeUseCase } from "@core/application/ai/DispatchDetectRepurposeUseCase.js";
import { ListRepurposeProposalsQuery } from "@core/application/ai/ListRepurposeProposalsQuery.js";
import type { ChannelQueryForIngestion } from "@core/domain/repositories/ChannelQueryForIngestion.js";
import {
  GenerateRepurposeVariantsUseCase,
  type NotificationPort,
} from "@core/application/ai/GenerateRepurposeVariantsUseCase.js";
import {
  GeneratePlatformVariantsUseCase,
  type AIGeneratePort,
} from "@core/application/ai/GeneratePlatformVariantsUseCase.js";
import type { GetTopPerformersContextUseCase } from "@core/application/ai/GetTopPerformersContextUseCase.js";
import { PrismaApproveVariantAdapter } from "../repositories/PrismaApproveVariantAdapter.js";
import { PrismaRejectVariantAdapter } from "../repositories/PrismaRejectVariantAdapter.js";
import { PrismaRepurposeDetectionAdapter } from "../repositories/PrismaRepurposeDetectionAdapter.js";
import { PrismaRepurposeProposalQueryAdapter } from "../repositories/PrismaRepurposeProposalQueryAdapter.js";
import { PrismaRepurposeVariantAdapter } from "../repositories/PrismaRepurposeVariantAdapter.js";
import { BullMQRepurposeJobDispatcher } from "../repositories/BullMQRepurposeJobDispatcher.js";

/**
 * @method setupRepurposeUseCases
 * @description Register all AI repurpose use cases and their port adapters.
 */
export function setupRepurposeUseCases(container: Container): void {
  // GeneratePlatformVariantsUseCase (dependency of GenerateRepurposeVariantsUseCase)
  container.register<GeneratePlatformVariantsUseCase>(
    TOKENS.GeneratePlatformVariantsUseCase,
    () => {
      const aiService = container.resolve<AIGeneratePort>(TOKENS.AIService);
      const topPerformers = container.resolve<GetTopPerformersContextUseCase>(
        TOKENS.GetTopPerformersContextUseCase
      );
      return new GeneratePlatformVariantsUseCase(aiService, topPerformers);
    },
    true
  );

  // ApproveRepurposeVariantUseCase
  container.register<ApproveRepurposeVariantUseCase>(
    TOKENS.ApproveRepurposeVariantUseCase,
    () =>
      new ApproveRepurposeVariantUseCase(
        new PrismaApproveVariantAdapter(container.resolve<PrismaClient>(TOKENS.PrismaClient)),
        container.resolve<UnitOfWork>(TOKENS.UnitOfWork)
      ),
    true
  );

  // RejectRepurposeVariantUseCase
  container.register<RejectRepurposeVariantUseCase>(
    TOKENS.RejectRepurposeVariantUseCase,
    () =>
      new RejectRepurposeVariantUseCase(
        new PrismaRejectVariantAdapter(container.resolve<PrismaClient>(TOKENS.PrismaClient)),
        container.resolve<UnitOfWork>(TOKENS.UnitOfWork)
      ),
    true
  );

  // DetectRepurposeCandidatesUseCase
  container.register<DetectRepurposeCandidatesUseCase>(
    TOKENS.DetectRepurposeCandidatesUseCase,
    () =>
      new DetectRepurposeCandidatesUseCase(
        new PrismaRepurposeDetectionAdapter(container.resolve<PrismaClient>(TOKENS.PrismaClient)),
        new BullMQRepurposeJobDispatcher(
          container
            .resolve<QueuePortRegistry>(TOKENS.QueuePortRegistry)
            .forQueue(QUEUE_NAMES.GENERATE_REPURPOSE),
          QUEUE_NAMES.GENERATE_REPURPOSE
        ),
        container.resolve<UnitOfWork>(TOKENS.UnitOfWork)
      ),
    true
  );

  // DispatchDetectRepurposeUseCase — daily coordinator: one DETECT job per
  // account with active channels.
  container.register<DispatchDetectRepurposeUseCase>(
    TOKENS.DispatchDetectRepurposeUseCase,
    () =>
      new DispatchDetectRepurposeUseCase(
        container.resolve<ChannelQueryForIngestion>(TOKENS.ChannelQueryForIngestion),
        container
          .resolve<QueuePortRegistry>(TOKENS.QueuePortRegistry)
          .forQueue(QUEUE_NAMES.DETECT_REPURPOSE),
        QUEUE_NAMES.DETECT_REPURPOSE,
        container.resolve<UnitOfWork>(TOKENS.UnitOfWork)
      ),
    true
  );

  // ListRepurposeProposalsQuery — read-side: account-scoped proposals page.
  container.register<ListRepurposeProposalsQuery>(
    TOKENS.ListRepurposeProposalsQuery,
    () =>
      new ListRepurposeProposalsQuery(
        new PrismaRepurposeProposalQueryAdapter(
          container.resolve<PrismaClient>(TOKENS.PrismaClient)
        )
      ),
    true
  );

  // GenerateRepurposeVariantsUseCase
  container.register<GenerateRepurposeVariantsUseCase>(
    TOKENS.GenerateRepurposeVariantsUseCase,
    () => {
      const noOpNotification: NotificationPort = {
        notify: async () => {},
      };
      return new GenerateRepurposeVariantsUseCase(
        new PrismaRepurposeVariantAdapter(container.resolve<PrismaClient>(TOKENS.PrismaClient)),
        container.resolve<GeneratePlatformVariantsUseCase>(TOKENS.GeneratePlatformVariantsUseCase),
        noOpNotification,
        container.resolve<UnitOfWork>(TOKENS.UnitOfWork)
      );
    },
    true
  );
}
