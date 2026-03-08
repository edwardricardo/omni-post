/**
 * Container Setup - Repository Registrations
 *
 * Registers all repository adapters in the DI container.
 * Extracted from setup.ts to keep files under 800 lines.
 *
 * @module infrastructure/container/setupRepositories
 */
import type { Container } from "./Container.js";
import { TOKENS } from "./types.js";
import { PrismaAdminUserRepository } from "../repositories/PrismaAdminUserRepository.js";
import type { AdminUserRepositoryPort } from "../../domain/repositories/AdminUserRepository.js";
import { PrismaPostRepository } from "../repositories/PrismaPostRepository.js";
import { PrismaPostQueryRepository } from "../repositories/PrismaPostQueryRepository.js";
import { PrismaAccountRepository } from "../repositories/PrismaAccountRepository.js";
import { PrismaAccountQueryRepository } from "../repositories/PrismaAccountQueryRepository.js";
import { PrismaProjectRepository } from "../repositories/PrismaProjectRepository.js";
import { PrismaAnalyticsQueryRepository } from "../repositories/PrismaAnalyticsQueryRepository.js";
import { PrismaProjectQueryRepository } from "../repositories/PrismaProjectQueryRepository.js";
import { PrismaAnalyticsReadRepository } from "../repositories/PrismaAnalyticsReadRepository.js";
import type { ProjectQueryRepositoryPort } from "../../domain/repositories/ProjectQueryRepository.js";
import type { AnalyticsReadRepositoryPort } from "../../domain/repositories/AnalyticsReadRepository.js";
import { PrismaChannelRepository } from "../repositories/PrismaChannelRepository.js";
import type { PostRepository, PostQueryRepository } from "../../domain/index.js";
import type { AccountRepositoryPort } from "../../domain/repositories/AccountRepository.js";
import type { AccountQueryRepositoryPort } from "../../domain/repositories/AccountQueryRepository.js";
import type { ProjectRepositoryPort } from "../../domain/repositories/ProjectRepository.js";
import type { AnalyticsQueryRepository } from "../../domain/repositories/AnalyticsQueryRepository.js";
import type { ChannelRepository } from "../../domain/repositories/ChannelRepository.js";
import { PrismaApiKeyRepository } from "../repositories/PrismaApiKeyRepository.js";
import type { ApiKeyRepository } from "../../domain/repositories/ApiKeyRepository.js";
import { PrismaOutboxWriter } from "../outbox/PrismaOutboxWriter.js";
import type { OutboxWriter } from "../../domain/repositories/OutboxWriter.js";
import { PrismaUnitOfWork } from "../unitofwork/PrismaUnitOfWork.js";
import type { UnitOfWork } from "../../domain/index.js";
import type { TrackedLinkRepository } from "../../domain/repositories/TrackedLinkRepository.js";
import { PrismaTrackedLinkRepository } from "../repositories/PrismaTrackedLinkRepository.js";
import type { CrisisProjectRepository } from "../../application/crisis/types.js";
import { PrismaCrisisProjectRepository } from "../repositories/PrismaCrisisProjectRepository.js";

/**
 * Register all repository adapters in the container
 */
export function setupRepositories(container: Container): void {
  // Register Outbox Writer (P2-1)
  container.register<OutboxWriter>(TOKENS.OutboxWriter, () => new PrismaOutboxWriter(), true);

  // Register PostRepository (receives OutboxWriter for atomic event persistence)
  container.register<PostRepository>(
    TOKENS.PostRepository,
    () =>
      new PrismaPostRepository(
        container.resolve(TOKENS.PrismaClient),
        container.resolve<OutboxWriter>(TOKENS.OutboxWriter)
      ),
    true
  );

  // Register Post Query Repository (P2-3 -- CQRS read side)
  container.register<PostQueryRepository>(
    TOKENS.PostQueryRepository,
    () => new PrismaPostQueryRepository(container.resolve(TOKENS.PrismaClient)),
    true
  );

  // Register Repositories (FASE H4b)
  container.register<AccountRepositoryPort>(
    TOKENS.AccountRepository,
    () => new PrismaAccountRepository(container.resolve(TOKENS.PrismaClient)),
    true
  );

  // Register Account Query Repository (R1-B -- billing read-model, CQRS read side)
  container.register<AccountQueryRepositoryPort>(
    TOKENS.AccountQueryRepository,
    () => new PrismaAccountQueryRepository(container.resolve(TOKENS.PrismaClient)),
    true
  );

  container.register<ProjectRepositoryPort>(
    TOKENS.ProjectRepository,
    () => new PrismaProjectRepository(container.resolve(TOKENS.PrismaClient)),
    true
  );

  container.register<AnalyticsQueryRepository>(
    TOKENS.AnalyticsQueryRepository,
    () => new PrismaAnalyticsQueryRepository(container.resolve(TOKENS.PrismaClient)),
    true
  );

  container.register<ChannelRepository>(
    TOKENS.ChannelRepository,
    () => new PrismaChannelRepository(container.resolve(TOKENS.PrismaClient)),
    true
  );

  // Register Read-model Repositories (R1-C -- analytics consumers)
  container.register<ProjectQueryRepositoryPort>(
    TOKENS.ProjectQueryRepository,
    () => new PrismaProjectQueryRepository(container.resolve(TOKENS.PrismaClient)),
    true
  );

  container.register<AnalyticsReadRepositoryPort>(
    TOKENS.AnalyticsReadRepository,
    () => new PrismaAnalyticsReadRepository(container.resolve(TOKENS.PrismaClient)),
    true
  );

  // Register API Key Repository (FASE H10-B)
  container.register<ApiKeyRepository>(
    TOKENS.ApiKeyRepository,
    () => new PrismaApiKeyRepository(container.resolve(TOKENS.PrismaClient)),
    true
  );

  // Register AdminUser Repository (R1-A -- hexagonal port replacing legacy UserRepository)
  container.register<AdminUserRepositoryPort>(
    TOKENS.AdminUserRepository,
    () => new PrismaAdminUserRepository(container.resolve(TOKENS.PrismaClient)),
    true
  );

  // Register Unit of Work (P2-4)
  container.register<UnitOfWork>(
    TOKENS.UnitOfWork,
    () => new PrismaUnitOfWork(container.resolve(TOKENS.PrismaClient)),
    true
  );

  // Register TrackedLink Repository (P1-DI-7)
  container.register<TrackedLinkRepository>(
    TOKENS.TrackedLinkRepository,
    () => new PrismaTrackedLinkRepository(container.resolve(TOKENS.PrismaClient)),
    true
  );

  // Register Crisis Project Repository (P1-DI-8)
  container.register<CrisisProjectRepository>(
    TOKENS.CrisisProjectRepository,
    () => new PrismaCrisisProjectRepository(container.resolve(TOKENS.PrismaClient)),
    true
  );
}
