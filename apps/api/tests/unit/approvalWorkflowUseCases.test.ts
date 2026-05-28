/**
 * @file approvalWorkflowUseCases.test.ts
 * @description Unit tests for multi-level approval workflow use cases:
 *   CreateApprovalWorkflowUseCase, UpdateApprovalWorkflowUseCase,
 *   DeleteApprovalWorkflowUseCase, and ListApprovalWorkflowsQuery.
 * @layer application
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { ok, err } from "@shared/types";
import { CreateApprovalWorkflowUseCase } from "@core/approvals/CreateApprovalWorkflowUseCase.js";
import { UpdateApprovalWorkflowUseCase } from "@core/approvals/UpdateApprovalWorkflowUseCase.js";
import { DeleteApprovalWorkflowUseCase } from "@core/approvals/DeleteApprovalWorkflowUseCase.js";
import { ListApprovalWorkflowsQuery } from "@core/approvals/ListApprovalWorkflowsQuery.js";
import { ApprovalWorkflow } from "@core/domain/entities/ApprovalWorkflow.js";
import { EntityNotFoundError } from "@core/domain/errors/index.js";
import type { ApprovalWorkflowRepository } from "@core/domain/repositories/ApprovalWorkflowRepository.js";

// ---------------------------------------------------------------------------
// Mock factories
// ---------------------------------------------------------------------------

function createMockWorkflowRepo(): ApprovalWorkflowRepository {
  return {
    findById: vi.fn(),
    findByAccountId: vi.fn(),
    findDefaultByAccountId: vi.fn(),
    save: vi.fn(),
    delete: vi.fn(),
    hasActiveRequests: vi.fn(),
  };
}

function createMockUoW() {
  return {
    executeInTransaction: vi.fn(async (fn: () => Promise<unknown>) => fn()),
  };
}

function makeWorkflow(
  overrides?: Partial<Parameters<typeof ApprovalWorkflow.create>[0]>
): ApprovalWorkflow {
  const result = ApprovalWorkflow.create({
    id: "wf-001",
    accountId: "account-001",
    name: "Default Workflow",
    levels: [{ id: "l1", order: 1, requireAll: false }],
    ...overrides,
  });
  if (!result.ok) {
    throw new Error(`Failed to create test workflow: ${result.error.message}`);
  }
  return result.value;
}

// ---------------------------------------------------------------------------
// CreateApprovalWorkflowUseCase
// ---------------------------------------------------------------------------

describe("CreateApprovalWorkflowUseCase", () => {
  let repo: ApprovalWorkflowRepository;
  let uow: ReturnType<typeof createMockUoW>;
  let useCase: CreateApprovalWorkflowUseCase;

  beforeEach(() => {
    vi.clearAllMocks();
    repo = createMockWorkflowRepo();
    uow = createMockUoW();
    useCase = new CreateApprovalWorkflowUseCase(repo, uow);
  });

  it("creates a workflow successfully", async () => {
    vi.mocked(repo.findByAccountId).mockResolvedValue([]);
    vi.mocked(repo.save).mockResolvedValue(ok(undefined));

    const result = await useCase.execute({
      accountId: "account-001",
      name: "New Workflow",
      levels: [{ order: 1 }, { order: 2 }],
    });

    expect(result.ok).toBeTruthy();
    expect(result.value.workflowId).toBeDefined();
    expect(repo.save).toHaveBeenCalledOnce();
  });

  it("creates a workflow with description and isDefault", async () => {
    vi.mocked(repo.findByAccountId).mockResolvedValue([]);
    vi.mocked(repo.findDefaultByAccountId).mockResolvedValue(null);
    vi.mocked(repo.save).mockResolvedValue(ok(undefined));

    const result = await useCase.execute({
      accountId: "account-001",
      name: "Default Workflow",
      description: "The default approval process",
      levels: [{ order: 1, role: "editor" }],
      isDefault: true,
    });

    expect(result.ok).toBeTruthy();
  });

  it("rejects duplicate workflow name within account", async () => {
    const existing = makeWorkflow({ name: "duplicate name" });
    vi.mocked(repo.findByAccountId).mockResolvedValue([existing]);

    const result = await useCase.execute({
      accountId: "account-001",
      name: "Duplicate Name",
      levels: [{ order: 1 }],
    });

    expect(result.ok).toBeFalsy();
    expect(result.error.code).toBe("CONFLICT");
    expect(result.error.message).toContain("already exists");
  });

  it("unsets previous default when creating new default", async () => {
    const oldDefault = makeWorkflow({
      id: "wf-old",
      name: "Old Default",
      isDefault: true,
    });
    vi.mocked(repo.findByAccountId).mockResolvedValue([oldDefault]);
    vi.mocked(repo.findDefaultByAccountId).mockResolvedValue(oldDefault);
    vi.mocked(repo.save).mockResolvedValue(ok(undefined));

    const result = await useCase.execute({
      accountId: "account-001",
      name: "New Default",
      levels: [{ order: 1 }],
      isDefault: true,
    });

    expect(result.ok).toBeTruthy();
    // save should be called twice: once for old default (unset), once for new workflow
    expect(repo.save).toHaveBeenCalledTimes(2);
  });

  it("rejects invalid levels (empty name via domain validation)", async () => {
    vi.mocked(repo.findByAccountId).mockResolvedValue([]);

    const result = await useCase.execute({
      accountId: "account-001",
      name: "",
      levels: [{ order: 1 }],
    });

    expect(result.ok).toBeFalsy();
    expect(result.error.code).toBe("VALIDATION_FAILED");
  });
});

// ---------------------------------------------------------------------------
// UpdateApprovalWorkflowUseCase
// ---------------------------------------------------------------------------

describe("UpdateApprovalWorkflowUseCase", () => {
  let repo: ApprovalWorkflowRepository;
  let uow: ReturnType<typeof createMockUoW>;
  let useCase: UpdateApprovalWorkflowUseCase;

  beforeEach(() => {
    vi.clearAllMocks();
    repo = createMockWorkflowRepo();
    uow = createMockUoW();
    useCase = new UpdateApprovalWorkflowUseCase(repo, uow);
  });

  it("updates workflow name successfully", async () => {
    const existing = makeWorkflow();
    vi.mocked(repo.findById).mockResolvedValue(ok(existing));
    vi.mocked(repo.save).mockResolvedValue(ok(undefined));

    const result = await useCase.execute({
      workflowId: "wf-001",
      accountId: "account-001",
      name: "Updated Name",
    });

    expect(result.ok).toBeTruthy();
    expect(repo.save).toHaveBeenCalledOnce();
  });

  it("rejects update for non-existent workflow", async () => {
    vi.mocked(repo.findById).mockResolvedValue(
      err(new EntityNotFoundError("ApprovalWorkflow", "wf-999"))
    );

    const result = await useCase.execute({
      workflowId: "wf-999",
      accountId: "account-001",
      name: "Updated",
    });

    expect(result.ok).toBeFalsy();
    expect(result.error.code).toBe("NOT_FOUND");
  });

  it("rejects update when accountId does not match", async () => {
    const existing = makeWorkflow();
    vi.mocked(repo.findById).mockResolvedValue(ok(existing));

    const result = await useCase.execute({
      workflowId: "wf-001",
      accountId: "wrong-account",
      name: "Updated",
    });

    expect(result.ok).toBeFalsy();
    expect(result.error.code).toBe("FORBIDDEN");
  });

  it("replaces levels when provided", async () => {
    const existing = makeWorkflow();
    vi.mocked(repo.findById).mockResolvedValue(ok(existing));
    vi.mocked(repo.save).mockResolvedValue(ok(undefined));

    const result = await useCase.execute({
      workflowId: "wf-001",
      accountId: "account-001",
      levels: [
        { order: 1, role: "editor" },
        { order: 2, role: "manager" },
        { order: 3, role: "director" },
      ],
    });

    expect(result.ok).toBeTruthy();
    expect(repo.save).toHaveBeenCalledOnce();
  });
});

// ---------------------------------------------------------------------------
// DeleteApprovalWorkflowUseCase
// ---------------------------------------------------------------------------

describe("DeleteApprovalWorkflowUseCase", () => {
  let repo: ApprovalWorkflowRepository;
  let uow: ReturnType<typeof createMockUoW>;
  let useCase: DeleteApprovalWorkflowUseCase;

  beforeEach(() => {
    vi.clearAllMocks();
    repo = createMockWorkflowRepo();
    uow = createMockUoW();
    useCase = new DeleteApprovalWorkflowUseCase(repo, uow);
  });

  it("deletes workflow successfully when no active requests", async () => {
    const existing = makeWorkflow();
    vi.mocked(repo.findById).mockResolvedValue(ok(existing));
    vi.mocked(repo.hasActiveRequests).mockResolvedValue(false);
    vi.mocked(repo.delete).mockResolvedValue(ok(undefined));

    const result = await useCase.execute({
      workflowId: "wf-001",
      accountId: "account-001",
    });

    expect(result.ok).toBeTruthy();
    expect(repo.delete).toHaveBeenCalledWith("wf-001");
  });

  it("rejects deletion when workflow has active requests", async () => {
    const existing = makeWorkflow();
    vi.mocked(repo.findById).mockResolvedValue(ok(existing));
    vi.mocked(repo.hasActiveRequests).mockResolvedValue(true);

    const result = await useCase.execute({
      workflowId: "wf-001",
      accountId: "account-001",
    });

    expect(result.ok).toBeFalsy();
    expect(result.error.code).toBe("CONFLICT");
    expect(result.error.message).toContain("active");
  });

  it("rejects deletion for non-existent workflow", async () => {
    vi.mocked(repo.findById).mockResolvedValue(
      err(new EntityNotFoundError("ApprovalWorkflow", "wf-999"))
    );

    const result = await useCase.execute({
      workflowId: "wf-999",
      accountId: "account-001",
    });

    expect(result.ok).toBeFalsy();
    expect(result.error.code).toBe("NOT_FOUND");
  });

  it("rejects deletion when accountId does not match", async () => {
    const existing = makeWorkflow();
    vi.mocked(repo.findById).mockResolvedValue(ok(existing));

    const result = await useCase.execute({
      workflowId: "wf-001",
      accountId: "wrong-account",
    });

    expect(result.ok).toBeFalsy();
    expect(result.error.code).toBe("FORBIDDEN");
  });
});

// ---------------------------------------------------------------------------
// ListApprovalWorkflowsQuery
// ---------------------------------------------------------------------------

describe("ListApprovalWorkflowsQuery", () => {
  let repo: ApprovalWorkflowRepository;
  let query: ListApprovalWorkflowsQuery;

  beforeEach(() => {
    vi.clearAllMocks();
    repo = createMockWorkflowRepo();
    query = new ListApprovalWorkflowsQuery(repo);
  });

  it("returns empty array when no workflows exist", async () => {
    vi.mocked(repo.findByAccountId).mockResolvedValue([]);

    const result = await query.execute({ accountId: "account-001" });

    expect(result.ok).toBeTruthy();
    expect(result.value.length).toBe(0);
  });

  it("returns workflows with levels as DTOs", async () => {
    const wf1 = makeWorkflow({ name: "Workflow A" });
    const wf2 = makeWorkflow({
      id: "wf-002",
      name: "Workflow B",
      levels: [
        { id: "l1", order: 1, role: "editor", requireAll: false },
        { id: "l2", order: 2, role: "manager", requireAll: true },
      ],
    });
    vi.mocked(repo.findByAccountId).mockResolvedValue([wf1, wf2]);

    const result = await query.execute({ accountId: "account-001" });

    expect(result.ok).toBeTruthy();
    expect(result.value.length).toBe(2);
    expect(result.value[0]?.name).toBe("Workflow A");
    expect(result.value[1]?.name).toBe("Workflow B");
    expect(result.value[1]?.levels.length).toBe(2);
  });

  it("handles repository errors gracefully", async () => {
    vi.mocked(repo.findByAccountId).mockRejectedValue(new Error("DB error"));

    const result = await query.execute({ accountId: "account-001" });

    expect(result.ok).toBeFalsy();
    expect(result.error.code).toBe("INTERNAL_ERROR");
  });
});
