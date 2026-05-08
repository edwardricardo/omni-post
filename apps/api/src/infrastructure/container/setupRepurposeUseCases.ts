/**
 * @file setupRepurposeUseCases.ts
 * @description Registers AI repurpose use cases with their Prisma adapters and
 *              BullMQ dispatcher in the DI container.
 * @layer infrastructure
 */

import type { Container } from "./Container.js";
import { TOKENS } from "./types.js";
import type { UnitOfWork } from "../../domain/repositories/Repository.js";
import type { QueuePortRegistry } from "@ports/core";
import { QUEUE_NAMES } from "@adapters/queue-bullmq";
import { ApproveRepurposeVariantUseCase } from "../../application/ai/ApproveRepurposeVariantUseCase.js";
import { RejectRepurposeVariantUseCase } from "../../application/ai/RejectRepurposeVariantUseCase.js";
import { DetectRepurposeCandidatesUseCase } from "../../application/ai/DetectRepurposeCandidatesUseCase.js";
import {
  GenerateRepurposeVariantsUseCase,
  type NotificationPort,
} from "../../application/ai/GenerateRepurposeVariantsUseCase.js";
import {
  GeneratePlatformVariantsUseCase,
  type AIGeneratePort,
} from "../../application/ai/GeneratePlatformVariantsUseCase.js";
import type { GetTopPerformersContextUseCase } from "../../application/ai/GetTopPerformersContextUseCase.js";
import { PrismaApproveVariantAdapter } from "../repositories/PrismaApproveVariantAdapter.js";
import { PrismaRejectVariantAdapter } from "../repositories/PrismaRejectVariantAdapter.js";
import { PrismaRepurposeDetectionAdapter } from "../repositories/PrismaRepurposeDetectionAdapter.js";
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
        new PrismaApproveVariantAdapter(),
        container.resolve<UnitOfWork>(TOKENS.UnitOfWork)
      ),
    true
  );

  // RejectRepurposeVariantUseCase
  container.register<RejectRepurposeVariantUseCase>(
    TOKENS.RejectRepurposeVariantUseCase,
    () =>
      new RejectRepurposeVariantUseCase(
        new PrismaRejectVariantAdapter(),
        container.resolve<UnitOfWork>(TOKENS.UnitOfWork)
      ),
    true
  );

  // DetectRepurposeCandidatesUseCase
  container.register<DetectRepurposeCandidatesUseCase>(
    TOKENS.DetectRepurposeCandidatesUseCase,
    () =>
      new DetectRepurposeCandidatesUseCase(
        new PrismaRepurposeDetectionAdapter(),
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

  // GenerateRepurposeVariantsUseCase
  container.register<GenerateRepurposeVariantsUseCase>(
    TOKENS.GenerateRepurposeVariantsUseCase,
    () => {
      const noOpNotification: NotificationPort = {
        notify: async () => {},
      };
      return new GenerateRepurposeVariantsUseCase(
        new PrismaRepurposeVariantAdapter(),
        container.resolve<GeneratePlatformVariantsUseCase>(TOKENS.GeneratePlatformVariantsUseCase),
        noOpNotification,
        container.resolve<UnitOfWork>(TOKENS.UnitOfWork)
      );
    },
    true
  );
}
