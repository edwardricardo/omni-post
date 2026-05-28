/**
 * @file generateUTMLinks.test.ts
 * @description Tests for `GenerateUTMLinksUseCase` after the UoW refactor.
 *   Verifies the UC validates the link id, persists state changes through
 *   the repository, and runs the mutation in a transaction when a UoW is
 *   provided.
 * @layer infrastructure
 */

import { describe, it, vi, expect } from "vitest";
import { ok, err } from "@shared/types";
import { GenerateUTMLinksUseCase } from "@core/utm/GenerateUTMLinksUseCase.js";

function makeMockLink(): {
  setUTMParameters: ReturnType<typeof vi.fn>;
  getUTMUrl: ReturnType<typeof vi.fn>;
} {
  return {
    setUTMParameters: vi.fn(),
    getUTMUrl: vi.fn(() => "https://example.com/?utm_source=email"),
  };
}

function makeMockRepo(link: ReturnType<typeof makeMockLink>): {
  findById: ReturnType<typeof vi.fn>;
  save: ReturnType<typeof vi.fn>;
} {
  return {
    findById: vi.fn(async () => ok(link)),
    save: vi.fn(async () => ok(undefined)),
  };
}

describe("GenerateUTMLinksUseCase", () => {
  const validInput = {
    trackedLinkId: "550e8400-e29b-41d4-a716-446655440010",
    source: "newsletter",
    medium: "email",
    campaign: "spring",
  };

  it("returns validation error for invalid trackedLinkId", async () => {
    const link = makeMockLink();
    const repo = makeMockRepo(link);
    const uc = new GenerateUTMLinksUseCase(repo as never);

    const result = await uc.execute({ ...validInput, trackedLinkId: "not-a-uuid" });
    expect(result.ok).toBe(false);
  });

  it("loads, mutates, and persists the link without a UoW", async () => {
    const link = makeMockLink();
    const repo = makeMockRepo(link);
    const uc = new GenerateUTMLinksUseCase(repo as never);

    const result = await uc.execute(validInput);
    expect(result.ok).toBe(true);
    expect(repo.findById).toHaveBeenCalledTimes(1);
    expect(link.setUTMParameters).toHaveBeenCalledTimes(1);
    expect(repo.save).toHaveBeenCalledTimes(1);
    if (result.ok) {
      expect(result.value.utmUrl).toBe("https://example.com/?utm_source=email");
    }
  });

  it("runs the mutation inside the UoW transaction when provided", async () => {
    const link = makeMockLink();
    const repo = makeMockRepo(link);
    const uow = {
      executeInTransaction: vi.fn(async (cb: () => Promise<void>) => {
        await cb();
      }),
    };
    const uc = new GenerateUTMLinksUseCase(repo as never, uow as never);

    const result = await uc.execute(validInput);
    expect(uow.executeInTransaction).toHaveBeenCalledTimes(1);
    expect(repo.findById).toHaveBeenCalledTimes(1);
    expect(repo.save).toHaveBeenCalledTimes(1);
    expect(result.ok).toBe(true);
  });

  it("returns NOT_FOUND when the tracked link does not exist", async () => {
    const link = makeMockLink();
    const repo = makeMockRepo(link);
    repo.findById = vi.fn(async () => err({ name: "EntityNotFoundError", message: "not found" }));
    const uc = new GenerateUTMLinksUseCase(repo as never);

    const result = await uc.execute(validInput);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.message).toContain("not found");
    }
    expect(link.setUTMParameters).not.toHaveBeenCalled();
    expect(repo.save).not.toHaveBeenCalled();
  });

  it("propagates repository.save errors as INTERNAL_ERROR Result", async () => {
    const link = makeMockLink();
    const repo = makeMockRepo(link);
    repo.save = vi.fn(async () => err({ name: "DbError", message: "save failed" }));
    const uc = new GenerateUTMLinksUseCase(repo as never);

    const result = await uc.execute(validInput);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.message).toContain("Failed to save");
    }
  });
});
