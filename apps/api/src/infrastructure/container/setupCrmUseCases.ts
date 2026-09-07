/**
 * @file setupCrmUseCases.ts
 * @description DI registrations for CRM integration feature.
 *              Registers repository adapters and use cases as singletons.
 * @layer infrastructure
 */

import type { Container } from "./Container.js";
import { TOKENS } from "./types.js";
import type { PrismaClient } from "@infra/prisma";
import { PrismaCrmConnectionRepository } from "../repositories/PrismaCrmConnectionRepository.js";
import { PrismaCrmContactRepository } from "../repositories/PrismaCrmContactRepository.js";
import { PrismaCrmActivityRepository } from "../repositories/PrismaCrmActivityRepository.js";
import { PrismaCrmSyncLogRepository } from "../repositories/PrismaCrmSyncLogRepository.js";
import type { UnitOfWork } from "@core/domain/repositories/Repository.js";
import { ConnectCrmUseCase } from "@core/crm/ConnectCrmUseCase.js";
import { DisconnectCrmUseCase } from "@core/crm/DisconnectCrmUseCase.js";
import { GetCrmConnectionsQuery } from "@core/crm/GetCrmConnectionsQuery.js";
import { SyncCrmContactsUseCase } from "@core/crm/SyncCrmContactsUseCase.js";
import { LogCrmActivityUseCase } from "@core/crm/LogCrmActivityUseCase.js";
import { GetCrmSyncLogsQuery } from "@core/crm/GetCrmSyncLogsQuery.js";

/**
 * @function setupCrmUseCases
 * @description Registers CRM repositories, queries, and use cases as singletons in the container.
 * @param container - DI container
 */
export function setupCrmUseCases(container: Container): void {
  // The container's client, never the `@infra/prisma` singleton — `setup.ts` applies the tenant
  // guard and the request-scoped GUC binding there. All four CRM models are guard-enrolled and
  // RLS-covered; the sync consumers bind their scope from the job payload, the existing
  // convention for in-process consumers.
  const prisma = container.resolve<PrismaClient>(TOKENS.PrismaClient);
  const connRepo = new PrismaCrmConnectionRepository(prisma);
  const contactRepo = new PrismaCrmContactRepository(prisma);
  const activityRepo = new PrismaCrmActivityRepository(prisma);
  const syncLogRepo = new PrismaCrmSyncLogRepository(prisma);
  const uow = () => container.resolve<UnitOfWork>(TOKENS.UnitOfWork);

  container.registerInstance(TOKENS.CrmConnectionRepository, connRepo);
  container.registerInstance(TOKENS.CrmContactRepository, contactRepo);
  container.registerInstance(TOKENS.CrmActivityRepository, activityRepo);
  container.registerInstance(TOKENS.CrmSyncLogRepository, syncLogRepo);

  container.register(TOKENS.ConnectCrmUseCase, () => new ConnectCrmUseCase(connRepo, uow()), true);
  container.register(
    TOKENS.DisconnectCrmUseCase,
    () => new DisconnectCrmUseCase(connRepo, uow()),
    true
  );
  container.registerInstance(TOKENS.GetCrmConnectionsQuery, new GetCrmConnectionsQuery(connRepo));
  container.register(
    TOKENS.SyncCrmContactsUseCase,
    () => new SyncCrmContactsUseCase(connRepo, contactRepo, syncLogRepo, uow()),
    true
  );
  container.register(
    TOKENS.LogCrmActivityUseCase,
    () => new LogCrmActivityUseCase(activityRepo, uow()),
    true
  );
  container.registerInstance(
    TOKENS.GetCrmSyncLogsQuery,
    new GetCrmSyncLogsQuery(connRepo, syncLogRepo)
  );
}
