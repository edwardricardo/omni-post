/**
 * @file setupCrmUseCases.ts
 * @description DI registrations for CRM integration feature.
 *              Registers repository adapters and use cases as singletons.
 * @layer infrastructure
 */

import type { Container } from "./Container.js";
import { TOKENS } from "./types.js";
import { prisma } from "@infra/prisma";
import { PrismaCrmConnectionRepository } from "../repositories/PrismaCrmConnectionRepository.js";
import { PrismaCrmContactRepository } from "../repositories/PrismaCrmContactRepository.js";
import { PrismaCrmActivityRepository } from "../repositories/PrismaCrmActivityRepository.js";
import { PrismaCrmSyncLogRepository } from "../repositories/PrismaCrmSyncLogRepository.js";
import type { UnitOfWork } from "../../domain/repositories/Repository.js";
import { ConnectCrmUseCase } from "@core/application/crm/ConnectCrmUseCase.js";
import { DisconnectCrmUseCase } from "@core/application/crm/DisconnectCrmUseCase.js";
import { GetCrmConnectionsQuery } from "@core/application/crm/GetCrmConnectionsQuery.js";
import { SyncCrmContactsUseCase } from "@core/application/crm/SyncCrmContactsUseCase.js";
import { LogCrmActivityUseCase } from "@core/application/crm/LogCrmActivityUseCase.js";
import { GetCrmSyncLogsQuery } from "@core/application/crm/GetCrmSyncLogsQuery.js";

export function setupCrmUseCases(container: Container): void {
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
