/**
 * @file setupWebhookAdminUseCases.ts
 * @description DI registrations for the webhook admin feature: rotation repo +
 *              RotateWebhookSecretKeyUseCase. Singletons.
 * @layer infrastructure
 */

import type { Container } from "./Container.js";
import { TOKENS } from "./types.js";
import type { PrismaClient } from "@infra/prisma";
import { PrismaWebhookSubscriptionRotationRepository } from "../repositories/PrismaWebhookSubscriptionRotationRepository.js";
import { RotateWebhookSecretKeyUseCase } from "@core/webhooks/RotateWebhookSecretKeyUseCase.js";
import type { UnitOfWork } from "@core/domain/repositories/Repository.js";

/**
 * @function setupWebhookAdminUseCases
 * @description Registers webhook admin repositories and use cases as singletons in the container.
 * @param container - DI container
 */
export function setupWebhookAdminUseCases(container: Container): void {
  // The container's client, never the `@infra/prisma` singleton — `setup.ts` applies the tenant
  // guard and the request-scoped GUC binding there.
  //
  // Scope declaration for this admin surface: `webhookSubscription` IS guard-enrolled and
  // RLS-covered, and the rotation endpoint is authenticated as an ADMIN, which binds no tenant.
  // The conversion is what makes that loud, so the route declares the boundary explicitly with
  // `withSystemContext` (see `admin/webhookAdminRoutes.ts`) instead of reading a subscription
  // that a policy would otherwise hide from it without a word.
  const prisma = container.resolve<PrismaClient>(TOKENS.PrismaClient);
  const repo = new PrismaWebhookSubscriptionRotationRepository(prisma);
  container.registerInstance(TOKENS.WebhookSubscriptionRotationRepository, repo);
  container.register<RotateWebhookSecretKeyUseCase>(
    TOKENS.RotateWebhookSecretKeyUseCase,
    () => new RotateWebhookSecretKeyUseCase(repo, container.resolve<UnitOfWork>(TOKENS.UnitOfWork)),
    true
  );
}
