/**
 * @file setupCustomReportUseCases.ts
 * @description DI registrations for Custom Report Builder feature.
 *              Registers repository adapter and all use cases/queries as singletons.
 * @layer infrastructure
 */

import type { Container } from "./Container.js";
import { TOKENS } from "./types.js";
import { prisma } from "@infra/prisma";
import { PrismaCustomReportRepository } from "../repositories/PrismaCustomReportRepository.js";
import type { UnitOfWork } from "@core/domain/repositories/Repository.js";
import { CreateCustomReportUseCase } from "@core/custom-reports/CreateCustomReportUseCase.js";
import { UpdateCustomReportUseCase } from "@core/custom-reports/UpdateCustomReportUseCase.js";
import { DeleteCustomReportUseCase } from "@core/custom-reports/DeleteCustomReportUseCase.js";
import { ListCustomReportsQuery } from "@core/custom-reports/ListCustomReportsQuery.js";
import { GetCustomReportQuery } from "@core/custom-reports/GetCustomReportQuery.js";
import { RunCustomReportQuery } from "@core/custom-reports/RunCustomReportQuery.js";
import { ScheduleCustomReportUseCase } from "@core/custom-reports/ScheduleCustomReportUseCase.js";
import { PrismaAnalyticsAggregationQuery } from "../repositories/PrismaAnalyticsAggregationQuery.js";

/**
 * Register all Custom Report use cases in the container
 */
export function setupCustomReportUseCases(container: Container): void {
  const repo = new PrismaCustomReportRepository(prisma);
  const uow = () => container.resolve<UnitOfWork>(TOKENS.UnitOfWork);
  const analyticsAggQuery = new PrismaAnalyticsAggregationQuery(prisma);

  container.registerInstance(TOKENS.CustomReportRepository, repo);
  container.registerInstance(TOKENS.AnalyticsAggregationQuery, analyticsAggQuery);

  container.registerInstance(TOKENS.ListCustomReportsQuery, new ListCustomReportsQuery(repo));

  container.registerInstance(TOKENS.GetCustomReportQuery, new GetCustomReportQuery(repo));

  container.registerInstance(
    TOKENS.RunCustomReportQuery,
    new RunCustomReportQuery(repo, analyticsAggQuery)
  );

  container.register(
    TOKENS.CreateCustomReportUseCase,
    () => new CreateCustomReportUseCase(repo, uow()),
    true
  );

  container.register(
    TOKENS.UpdateCustomReportUseCase,
    () => new UpdateCustomReportUseCase(repo, uow()),
    true
  );

  container.register(
    TOKENS.DeleteCustomReportUseCase,
    () => new DeleteCustomReportUseCase(repo, uow()),
    true
  );

  container.register(
    TOKENS.ScheduleCustomReportUseCase,
    () => new ScheduleCustomReportUseCase(repo, uow()),
    true
  );
}
