/**
 * @file createPostUseCaseTenantIsolation.test.ts
 * @description Cross-tenant (CWE-639 / IDOR-POSTS create-in-foreign-project)
 *              regression tests for CreatePostUseCase. A caller authenticated as
 *              tenant B must not be able to create a post inside tenant A's
 *              project. Post is transitively tenant-scoped (FK -> Project), so
 *              the Prisma `$extends` guard cannot auto-inject on the write path —
 *              the owner gate must resolve `project.accountId` and reject a
 *              foreign caller with NOT_FOUND (anti-enumeration) before any save.
 * @layer infrastructure
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { ok } from "@shared/types";
import { AccountId, ProjectId } from "@core/domain/index.js";
import type { PostRepository } from "@core/domain/index.js";
import type { EventDispatcher } from "@core/domain/events/DomainEvent.js";
import type { BusinessMetricsPort } from "@core/domain/repositories/BusinessMetricsPort.js";
import type { ProjectRepositoryPort } from "@core/domain/repositories/ProjectRepository.js";
import type { UnitOfWork } from "@core/domain/repositories/Repository.js";
import { CreatePostUseCase } from "@core/posts/CreatePostUseCase.js";
import { USE_CASE_ERRORS } from "@core/application/UseCase.js";

const TENANT_A = AccountId.generate().value;
const TENANT_B = AccountId.generate().value;
const PROJECT_A = ProjectId.generate().value;

const passthroughUow: UnitOfWork = { executeInTransaction: async (fn) => fn() };

function makeMockPostRepo() {
  return {
    save: vi.fn(async () => ok(undefined)),
    findById: vi.fn(),
    findByProjectId: vi.fn(),
    findByStatus: vi.fn(),
    findReadyForPublishing: vi.fn(),
    findWithFilters: vi.fn(),
    countByProjectId: vi.fn(),
    countByStatus: vi.fn(),
    getProjectStats: vi.fn(),
    bulkUpdateStatus: vi.fn(),
    bulkArchive: vi.fn(),
    bulkHardDelete: vi.fn(),
    delete: vi.fn(),
    hardDelete: vi.fn(),
    filterIdsByAccount: vi.fn(),
    findOwnerAccountId: vi.fn(),
  } as unknown as PostRepository;
}

function makeMockDispatcher(): EventDispatcher {
  return { dispatch: vi.fn(async () => {}), dispatchAll: vi.fn(async () => {}), register: vi.fn() };
}

function makeMockMetrics(): BusinessMetricsPort {
  return {
    incrementPostCreated: vi.fn(),
    incrementPostPublished: vi.fn(),
    incrementPostDeleted: vi.fn(),
  } as unknown as BusinessMetricsPort;
}

/** Project repo whose only relevant behaviour is the ownership resolver. */
function makeMockProjectRepo(owner: string | null) {
  return {
    findOwnerAccountId: vi.fn(async () => (owner ? AccountId.fromStringUnsafe(owner) : null)),
  } as unknown as ProjectRepositoryPort;
}

describe("CreatePostUseCase — tenant isolation (IDOR-POSTS create, CWE-639)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns not-found and performs no save when tenant B creates into tenant A's project", async () => {
    const postRepo = makeMockPostRepo();
    const projectRepo = makeMockProjectRepo(TENANT_A);
    const useCase = new CreatePostUseCase(
      postRepo,
      makeMockDispatcher(),
      makeMockMetrics(),
      projectRepo,
      passthroughUow
    );

    const result = await useCase.execute({
      projectId: PROJECT_A,
      body: "cross-tenant injection",
      callerAccountId: TENANT_B,
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe(USE_CASE_ERRORS.NOT_FOUND);
    expect(postRepo.save).not.toHaveBeenCalled();
  });

  it("returns not-found when the project does not exist", async () => {
    const postRepo = makeMockPostRepo();
    const projectRepo = makeMockProjectRepo(null);
    const useCase = new CreatePostUseCase(
      postRepo,
      makeMockDispatcher(),
      makeMockMetrics(),
      projectRepo,
      passthroughUow
    );

    const result = await useCase.execute({
      projectId: PROJECT_A,
      body: "into a void",
      callerAccountId: TENANT_B,
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe(USE_CASE_ERRORS.NOT_FOUND);
    expect(postRepo.save).not.toHaveBeenCalled();
  });

  it("creates the post when the owning tenant A creates into its own project", async () => {
    const postRepo = makeMockPostRepo();
    const projectRepo = makeMockProjectRepo(TENANT_A);
    const useCase = new CreatePostUseCase(
      postRepo,
      makeMockDispatcher(),
      makeMockMetrics(),
      projectRepo,
      passthroughUow
    );

    const result = await useCase.execute({
      projectId: PROJECT_A,
      body: "my own post",
      callerAccountId: TENANT_A,
    });

    expect(result.ok).toBe(true);
    expect(postRepo.save).toHaveBeenCalledOnce();
  });

  it("creates the post when no callerAccountId is provided (system/admin path)", async () => {
    const postRepo = makeMockPostRepo();
    const projectRepo = makeMockProjectRepo(TENANT_A);
    const useCase = new CreatePostUseCase(
      postRepo,
      makeMockDispatcher(),
      makeMockMetrics(),
      projectRepo,
      passthroughUow
    );

    const result = await useCase.execute({ projectId: PROJECT_A, body: "system post" });

    expect(result.ok).toBe(true);
    expect(projectRepo.findOwnerAccountId).not.toHaveBeenCalled();
    expect(postRepo.save).toHaveBeenCalledOnce();
  });
});
