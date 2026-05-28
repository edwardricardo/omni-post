/**
 * @file setupWebhookAdminUseCases.ts
 * @description DI registrations for the webhook admin feature: rotation repo +
 *              RotateWebhookSecretKeyUseCase. Singletons.
 * @layer infrastructure
 */

import type { Container } from "./Container.js";
import { TOKENS } from "./types.js";
import { prisma } from "@infra/prisma";
import { PrismaWebhookSubscriptionRotationRepository } from "../repositories/PrismaWebhookSubscriptionRotationRepository.js";
import { RotateWebhookSecretKeyUseCase } from "@core/webhooks/RotateWebhookSecretKeyUseCase.js";
import type { UnitOfWork } from "@core/domain/repositories/Repository.js";

export function setupWebhookAdminUseCases(container: Container): void {
  const repo = new PrismaWebhookSubscriptionRotationRepository(prisma);
  container.registerInstance(TOKENS.WebhookSubscriptionRotationRepository, repo);
  container.register<RotateWebhookSecretKeyUseCase>(
    TOKENS.RotateWebhookSecretKeyUseCase,
    () => new RotateWebhookSecretKeyUseCase(repo, container.resolve<UnitOfWork>(TOKENS.UnitOfWork)),
    true
  );
}
