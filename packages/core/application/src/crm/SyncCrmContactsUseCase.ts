/**
 * @file SyncCrmContactsUseCase.ts
 * @description Fetches contacts from CRM adapter (paginated), upserts them,
 *              and creates a sync log entry. Uses UoW for transactional persistence.
 * @layer application
 */

import { type Result, ok, err } from "@shared/types";
import { type UseCase, UseCaseError, USE_CASE_ERRORS } from "../UseCase.js";
import type { CrmConnectionRepository } from "@core/domain/repositories/CrmConnectionRepository.js";
import type { CrmContactRepository } from "@core/domain/repositories/CrmContactRepository.js";
import type {
  CrmSyncLogRepository,
  CrmSyncLogData,
} from "@core/domain/repositories/CrmSyncLogRepository.js";
import type { CrmAdapter } from "@ports/core";
import type { UnitOfWork } from "@core/domain/repositories/Repository.js";

export interface SyncCrmContactsInput {
  accountId: string;
  platform: string;
  adapter: CrmAdapter;
}

export class SyncCrmContactsUseCase implements UseCase<
  SyncCrmContactsInput,
  CrmSyncLogData,
  UseCaseError
> {
  constructor(
    private readonly connectionRepo: CrmConnectionRepository,
    private readonly contactRepo: CrmContactRepository,
    private readonly syncLogRepo: CrmSyncLogRepository,
    private readonly unitOfWork?: UnitOfWork
  ) {}

  /**
   * @method execute
   * @description Syncs contacts from CRM. Paginates through all pages and upserts.
   */
  async execute(input: SyncCrmContactsInput): Promise<Result<CrmSyncLogData, UseCaseError>> {
    if (!input.accountId) {
      return err(new UseCaseError("accountId is required", USE_CASE_ERRORS.VALIDATION_FAILED));
    }
    if (!input.platform) {
      return err(new UseCaseError("platform is required", USE_CASE_ERRORS.VALIDATION_FAILED));
    }

    const doWork = async (): Promise<Result<CrmSyncLogData, UseCaseError>> => {
      const connection = await this.connectionRepo.findByAccountAndPlatform(
        input.accountId,
        input.platform
      );
      if (!connection || !connection.isActive) {
        return err(new UseCaseError("Active CRM connection not found", USE_CASE_ERRORS.NOT_FOUND));
      }

      const syncLog = await this.syncLogRepo.create({
        connectionId: connection.id,
        status: "RUNNING",
      });

      let totalSynced = 0;
      let cursor: string | undefined;
      const errors: string[] = [];

      try {
        let hasMore = true;
        while (hasMore) {
          const page = await input.adapter.fetchContacts(connection.accessToken, cursor);

          if (page.contacts.length > 0) {
            const contacts = page.contacts.map((c) => ({
              accountId: input.accountId,
              platform: input.platform,
              externalId: c.externalId,
              email: c.email,
              ...(c.firstName !== undefined && { firstName: c.firstName }),
              ...(c.lastName !== undefined && { lastName: c.lastName }),
              ...(c.company !== undefined && { company: c.company }),
              ...(c.title !== undefined && { title: c.title }),
              ...(c.phone !== undefined && { phone: c.phone }),
            }));
            const count = await this.contactRepo.upsertMany(contacts);
            totalSynced += count;
          }

          hasMore = page.hasMore;
          cursor = page.nextCursor;
        }

        // Update connection lastSyncAt
        await this.connectionRepo.save({
          ...connection,
          lastSyncAt: new Date(),
        });

        const updatedLog = await this.syncLogRepo.update(syncLog.id, {
          completedAt: new Date(),
          contactsSynced: totalSynced,
          status: errors.length > 0 ? "PARTIAL" : "COMPLETED",
          ...(errors.length > 0 && { errors }),
        });
        return ok(updatedLog);
      } catch (syncError: unknown) {
        const errorMessage = syncError instanceof Error ? syncError.message : "Unknown sync error";
        errors.push(errorMessage);

        const failedLog = await this.syncLogRepo.update(syncLog.id, {
          completedAt: new Date(),
          contactsSynced: totalSynced,
          status: "FAILED",
          errors,
        });
        return ok(failedLog);
      }
    };

    try {
      if (this.unitOfWork) {
        let result: Result<CrmSyncLogData, UseCaseError> = err(
          new UseCaseError("Transaction not executed", USE_CASE_ERRORS.INTERNAL_ERROR)
        );
        await this.unitOfWork.executeInTransaction(async () => {
          result = await doWork();
        });
        return result;
      }
      return await doWork();
    } catch (error: unknown) {
      return err(
        new UseCaseError(
          "Failed to sync CRM contacts",
          USE_CASE_ERRORS.INTERNAL_ERROR,
          error instanceof Error ? error : undefined
        )
      );
    }
  }
}
