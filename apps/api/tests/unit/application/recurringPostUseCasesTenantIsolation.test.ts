/**
 * @file recurringPostUseCasesTenantIsolation.test.ts
 * @description Cross-tenant (CWE-639 / IDOR-RECURRING) regression tests for the
 *              recurring-post use cases. A caller authenticated as tenant B can
 *              neither get, update, deactivate, nor list tenant A's recurring
 *              schedules once `callerAccountId` is threaded from the route.
 *              RecurringPost is transitively tenant-scoped (FK -> Project.accountId)
 *              so the Prisma `$extends` guard cannot auto-inject — the owner gate
 *              must live at the use-case boundary (single schedule) and as a joined
 *              filter in the repository (lists).
 * @layer infrastructure
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { ok, err } from "@shared/types";
import { AccountId } from "@core/domain/value-objects/EntityId.js";
import { EntityNotFoundError } from "@core/domain/errors/index.js";
import type { RecurringPostData } from "@core/domain/repositories/RecurringPostRepository.js";
import type { ProjectRepositoryPort } from "@core/domain/repositories/ProjectRepository.js";
import { ProjectId } from "@core/domain/value-objects/EntityId.js";
import { GetRecurringPostQuery } from "@core/recurring/GetRecurringPostQuery.js";
import { ListRecurringPostsQuery } from "@core/recurring/ListRecurringPostsQuery.js";
import { UpdateRecurringPostUseCase } from "@core/recurring/UpdateRecurringPostUseCase.js";
import { DeactivateRecurringPostUseCase } from "@core/recurring/DeactivateRecurringPostUseCase.js";
import { CreateRecurringPostUseCase } from "@core/recurring/CreateRecurringPostUseCase.js";
import { USE_CASE_ERRORS } from "@core/application/UseCase.js";

const TENANT_A = AccountId.generate().value;
const TENANT_B = AccountId.generate().value;
const PROJECT_A = "a1000000-0000-4000-8000-000000000001";
const REC_ID = "r1000000-0000-4000-8000-000000000001";

/** Row owner map: recurringPostId -> owning accountId (via project.accountId). */
function makeData(overrides: Partial<RecurringPostData> = {}): RecurringPostData {
  return {
    id: REC_ID,
    projectId: PROJECT_A,
    templatePostId: "t1000000-0000-4000-8000-000000000001",
    name: "Weekly post",
    cronExpression: "0 9 * * MON",
    timezone: "UTC",
    startDate: new Date("2025-01-01T00:00:00.000Z"),
    occurrenceCount: 0,
    isActive: true,
    channels: ["ch-1"],
    contentVariation: "EXACT",
    createdAt: new Date("2025-01-01T00:00:00.000Z"),
    updatedAt: new Date("2025-01-01T00:00:00.000Z"),
    ...overrides,
  };
}

/**
 * Repo mock with the tenant-ownership hooks. `findOwnerAccountId(id)` resolves
 * the owner via the recurringPost -> project -> accountId chain; `findByProjectId`
 * accepts an optional `callerAccountId` joined filter.
 */
function makeRepo(owner: Record<string, string> = { [REC_ID]: TENANT_A }) {
  const rows = new Map<string, RecurringPostData>([[REC_ID, makeData()]]);
  return {
    rows,
    owner,
    save: vi.fn(async (d: RecurringPostData) => ok(d)),
    findById: vi.fn(async (id: string) => {
      const row = rows.get(id);
      return row ? ok(row) : err(new EntityNotFoundError("RecurringPost", id));
    }),
    findByProjectId: vi.fn(async (projectId: string, callerAccountId?: AccountId) => {
      const items = Array.from(rows.values())
        .filter((r) => r.projectId === projectId)
        .filter((r) => !callerAccountId || owner[r.id] === callerAccountId.value);
      return ok(items);
    }),
    findActiveByNextScheduled: vi.fn(async () => ok([])),
    delete: vi.fn(async () => ok(undefined)),
    findOwnerAccountId: vi.fn(async (id: string) => {
      const acc = owner[id];
      return acc ? AccountId.fromStringUnsafe(acc) : null;
    }),
  };
}

/** Project repo exposing only the ownership resolver used by the create gate. */
function makeProjectRepo(owner: string | null) {
  return {
    findOwnerAccountId: vi.fn(async () => (owner ? AccountId.fromStringUnsafe(owner) : null)),
  } as unknown as ProjectRepositoryPort;
}

const passthroughUow = { executeInTransaction: async (fn: () => Promise<void>) => fn() };

describe("Recurring-post use cases — tenant isolation (IDOR-RECURRING, CWE-639)", () => {
  let repo: ReturnType<typeof makeRepo>;

  beforeEach(() => {
    vi.clearAllMocks();
    repo = makeRepo();
  });

  describe("GetRecurringPostQuery", () => {
    it("returns null when tenant B gets tenant A's recurring post", async () => {
      const query = new GetRecurringPostQuery(repo as never);
      const result = await query.execute({ id: REC_ID, callerAccountId: TENANT_B });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value).toBeNull();
    });

    it("returns the schedule when the owning tenant A gets its own recurring post", async () => {
      const query = new GetRecurringPostQuery(repo as never);
      const result = await query.execute({ id: REC_ID, callerAccountId: TENANT_A });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value?.id).toBe(REC_ID);
    });
  });

  describe("ListRecurringPostsQuery", () => {
    it("returns zero items when tenant B lists tenant A's project", async () => {
      const query = new ListRecurringPostsQuery(repo as never);
      const result = await query.execute({ projectId: PROJECT_A, callerAccountId: TENANT_B });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value).toHaveLength(0);
    });

    it("returns the owning tenant A's schedules when tenant A lists its project", async () => {
      const query = new ListRecurringPostsQuery(repo as never);
      const result = await query.execute({ projectId: PROJECT_A, callerAccountId: TENANT_A });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value).toHaveLength(1);
    });
  });

  describe("UpdateRecurringPostUseCase", () => {
    it("returns not-found and performs no save when tenant B updates tenant A's schedule", async () => {
      const useCase = new UpdateRecurringPostUseCase(repo as never);
      const result = await useCase.execute({
        id: REC_ID,
        name: "hijacked",
        callerAccountId: TENANT_B,
      });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe(USE_CASE_ERRORS.NOT_FOUND);
      expect(repo.save).not.toHaveBeenCalled();
    });

    it("updates successfully when the owning tenant A updates its own schedule", async () => {
      const useCase = new UpdateRecurringPostUseCase(repo as never);
      const result = await useCase.execute({
        id: REC_ID,
        name: "renamed",
        callerAccountId: TENANT_A,
      });
      expect(result.ok).toBe(true);
      expect(repo.save).toHaveBeenCalledOnce();
    });
  });

  describe("DeactivateRecurringPostUseCase", () => {
    it("returns not-found and performs no save when tenant B deactivates tenant A's schedule", async () => {
      const useCase = new DeactivateRecurringPostUseCase(repo as never);
      const result = await useCase.execute({ id: REC_ID, callerAccountId: TENANT_B });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe(USE_CASE_ERRORS.NOT_FOUND);
      expect(repo.save).not.toHaveBeenCalled();
    });

    it("deactivates successfully when the owning tenant A deactivates its own schedule", async () => {
      const useCase = new DeactivateRecurringPostUseCase(repo as never);
      const result = await useCase.execute({ id: REC_ID, callerAccountId: TENANT_A });
      expect(result.ok).toBe(true);
      expect(repo.save).toHaveBeenCalledOnce();
    });
  });

  describe("CreateRecurringPostUseCase (create-in-foreign-project)", () => {
    const VALID_COMMAND = {
      projectId: PROJECT_A,
      templatePostId: ProjectId.generate().value,
      name: "Weekly",
      cronExpression: "0 9 * * MON",
      startDate: "2025-01-01T00:00:00.000Z",
      channels: [ProjectId.generate().value],
    };

    it("returns not-found and performs no save when tenant B creates a schedule in tenant A's project", async () => {
      const projectRepo = makeProjectRepo(TENANT_A);
      const useCase = new CreateRecurringPostUseCase(
        repo as never,
        projectRepo,
        passthroughUow as never
      );

      const result = await useCase.execute({ ...VALID_COMMAND, callerAccountId: TENANT_B });

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe(USE_CASE_ERRORS.NOT_FOUND);
      expect(repo.save).not.toHaveBeenCalled();
    });

    it("returns not-found when the target project does not exist", async () => {
      const projectRepo = makeProjectRepo(null);
      const useCase = new CreateRecurringPostUseCase(
        repo as never,
        projectRepo,
        passthroughUow as never
      );

      const result = await useCase.execute({ ...VALID_COMMAND, callerAccountId: TENANT_B });

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe(USE_CASE_ERRORS.NOT_FOUND);
      expect(repo.save).not.toHaveBeenCalled();
    });

    it("creates the schedule when the owning tenant A creates in its own project", async () => {
      const projectRepo = makeProjectRepo(TENANT_A);
      const useCase = new CreateRecurringPostUseCase(
        repo as never,
        projectRepo,
        passthroughUow as never
      );

      const result = await useCase.execute({ ...VALID_COMMAND, callerAccountId: TENANT_A });

      expect(result.ok).toBe(true);
      expect(repo.save).toHaveBeenCalledOnce();
    });
  });
});
