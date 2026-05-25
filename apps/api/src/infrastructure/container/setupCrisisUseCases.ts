/**
 * @file setupCrisisUseCases.ts
 * @description Registers outbox relay/cleaner, crisis mode, and scheduled report
 *              use cases in the DI container. Extracted from setupUseCases.ts.
 * @layer infrastructure
 */
import type { Container } from "./Container.js";
import { TOKENS } from "./types.js";
import type { EventDispatcher } from "../../domain/index.js";
import type { UnitOfWork } from "../../domain/repositories/Repository.js";
import type { BackgroundTaskScheduler } from "@observability/background-scheduler";
import { OutboxRelay } from "../outbox/OutboxRelay.js";
import { OutboxCleaner } from "../outbox/OutboxCleaner.js";
import { OutboxClaimService } from "../outbox/OutboxClaimService.js";
import { OutboxBackoff } from "../outbox/OutboxBackoff.js";
import { OutboxInbox } from "../outbox/OutboxInbox.js";
import { hostname } from "os";
import type { CrisisProjectRepository } from "@core/application/crisis/types.js";
import {
  EnterCrisisModeUseCase,
  ExitCrisisModeUseCase,
  GetCrisisStatusUseCase,
} from "@core/application/crisis/index.js";
import type { ScheduledReportRepository } from "../../domain/repositories/ScheduledReportRepository.js";
import type { EmailPort } from "../../domain/repositories/EmailPort.js";
import type { AnalyticsReadRepositoryPort } from "../../domain/repositories/AnalyticsReadRepository.js";
import {
  CreateScheduledReportUseCase,
  UpdateScheduledReportUseCase,
  DeleteScheduledReportUseCase,
  ListScheduledReportsQuery as ListScheduledReportsQueryUC,
  GenerateReportUseCase,
} from "@core/application/reports/index.js";

/**
 * Register outbox relay/cleaner, crisis mode, and scheduled report use cases
 */
export function setupCrisisUseCases(container: Container): void {
  // Worker identity must be unique per process so concurrent OutboxRelay
  // instances (multi-pod or test harness) can distinguish their claims
  // when running the lease-based concurrent-claim flow.
  const workerId = `${hostname()}-${process.pid}`;

  container.register<OutboxClaimService>(
    TOKENS.OutboxClaimService,
    () =>
      new OutboxClaimService({
        prisma: container.resolve(TOKENS.PrismaClient),
        workerId,
      }),
    true
  );
  container.register<OutboxBackoff>(TOKENS.OutboxBackoff, () => new OutboxBackoff(), true);
  container.register<OutboxInbox>(
    TOKENS.OutboxInbox,
    () => new OutboxInbox(container.resolve(TOKENS.PrismaClient)),
    true
  );

  // Register Outbox Relay + Cleaner
  container.register<OutboxRelay>(
    TOKENS.OutboxRelay,
    () =>
      new OutboxRelay({
        prisma: container.resolve(TOKENS.PrismaClient),
        eventDispatcher: container.resolve<EventDispatcher>(TOKENS.EventDispatcher),
        scheduler: container.resolve<BackgroundTaskScheduler>(TOKENS.BackgroundTaskScheduler),
        claimService: container.resolve<OutboxClaimService>(TOKENS.OutboxClaimService),
        backoff: container.resolve<OutboxBackoff>(TOKENS.OutboxBackoff),
        inbox: container.resolve<OutboxInbox>(TOKENS.OutboxInbox),
        consumerId: workerId,
      }),
    true
  );
  container.register<OutboxCleaner>(
    TOKENS.OutboxCleaner,
    () =>
      new OutboxCleaner(
        container.resolve(TOKENS.PrismaClient),
        container.resolve<BackgroundTaskScheduler>(TOKENS.BackgroundTaskScheduler)
      ),
    true
  );

  // Register Crisis Mode Use Cases
  container.register<EnterCrisisModeUseCase>(
    TOKENS.EnterCrisisModeUseCase,
    () =>
      new EnterCrisisModeUseCase(
        container.resolve<CrisisProjectRepository>(TOKENS.CrisisProjectRepository),
        container.resolve<EventDispatcher>(TOKENS.EventDispatcher),
        container.resolve<UnitOfWork>(TOKENS.UnitOfWork)
      ),
    true
  );
  container.register<ExitCrisisModeUseCase>(
    TOKENS.ExitCrisisModeUseCase,
    () =>
      new ExitCrisisModeUseCase(
        container.resolve<CrisisProjectRepository>(TOKENS.CrisisProjectRepository),
        container.resolve<EventDispatcher>(TOKENS.EventDispatcher),
        container.resolve<UnitOfWork>(TOKENS.UnitOfWork)
      ),
    true
  );
  container.register<GetCrisisStatusUseCase>(
    TOKENS.GetCrisisStatusUseCase,
    () =>
      new GetCrisisStatusUseCase(
        container.resolve<CrisisProjectRepository>(TOKENS.CrisisProjectRepository)
      ),
    true
  );

  // Register Scheduled Report Use Cases
  const reportRepo = () =>
    container.resolve<ScheduledReportRepository>(TOKENS.ScheduledReportRepository);
  const uow = () => container.resolve<UnitOfWork>(TOKENS.UnitOfWork);
  container.register(
    TOKENS.CreateScheduledReportUseCase,
    () => new CreateScheduledReportUseCase(reportRepo(), uow()),
    true
  );
  container.register(
    TOKENS.UpdateScheduledReportUseCase,
    () => new UpdateScheduledReportUseCase(reportRepo(), uow()),
    true
  );
  container.register(
    TOKENS.DeleteScheduledReportUseCase,
    () => new DeleteScheduledReportUseCase(reportRepo(), uow()),
    true
  );
  container.register(
    TOKENS.ListScheduledReportsQuery,
    () => new ListScheduledReportsQueryUC(reportRepo()),
    true
  );
  container.register(
    TOKENS.GenerateReportUseCase,
    () =>
      new GenerateReportUseCase(
        reportRepo(),
        container.resolve<AnalyticsReadRepositoryPort>(TOKENS.AnalyticsReadRepository),
        container.resolve<EmailPort>(TOKENS.EmailPort)
      ),
    true
  );
}
