/**
 * @file brandKitUseCases.test.ts
 * @description Tests for BrandKit use cases — UpsertBrandKitUseCase, GetBrandKitQuery, DeleteBrandKitUseCase.
 * @layer infrastructure
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import assert from "node:assert/strict";
import { UpsertBrandKitUseCase } from "@core/application/brand-kit/UpsertBrandKitUseCase.js";
import { GetBrandKitQuery } from "@core/application/brand-kit/GetBrandKitQuery.js";
import { DeleteBrandKitUseCase } from "@core/application/brand-kit/DeleteBrandKitUseCase.js";
import type { BrandKitData } from "@core/domain/repositories/BrandKitRepository.js";

function makeRepo() {
  return {
    upsert: vi.fn(
      async (
        data: Omit<BrandKitData, "id" | "createdAt" | "updatedAt">
      ): Promise<BrandKitData> => ({
        id: "bk-1",
        ...data,
        createdAt: new Date("2024-01-01"),
        updatedAt: new Date("2024-01-01"),
      })
    ),
    findByAccountId: vi.fn(async (_accountId: string): Promise<BrandKitData | null> => null),
    deleteByAccountId: vi.fn(async () => undefined),
  };
}

function makeInput(overrides: Record<string, unknown> = {}) {
  return {
    accountId: "acc-1",
    primaryColor: "#FF0000",
    ...overrides,
  };
}

// ============================================================================
// UpsertBrandKitUseCase
// ============================================================================

describe("UpsertBrandKitUseCase", () => {
  let repo: ReturnType<typeof makeRepo>;
  let uc: UpsertBrandKitUseCase;

  beforeEach(() => {
    vi.clearAllMocks();
    repo = makeRepo();
    uc = new UpsertBrandKitUseCase(repo);
  });

  it("upserts brand kit with valid input", async () => {
    const r = await uc.execute(makeInput());
    assert.ok(r.ok);
    assert.equal(r.value.primaryColor, "#FF0000");
    expect(repo.upsert).toHaveBeenCalledOnce();
  });

  it("upserts with all color fields", async () => {
    const r = await uc.execute(
      makeInput({
        primaryColor: "#FF0000",
        secondaryColor: "#00FF00",
        accentColor: "#0000FF",
      })
    );
    assert.ok(r.ok);
    assert.equal(r.value.secondaryColor, "#00FF00");
    assert.equal(r.value.accentColor, "#0000FF");
  });

  it("upserts with logo and font fields", async () => {
    const r = await uc.execute(
      makeInput({
        logoUrl: "https://example.com/logo.png",
        logoStorageKey: "logos/acc-1.png",
        fontPrimary: "Inter",
        fontSecondary: "Georgia",
      })
    );
    assert.ok(r.ok);
    assert.equal(r.value.logoUrl, "https://example.com/logo.png");
    assert.equal(r.value.fontPrimary, "Inter");
  });

  it("defaults optional fields to null", async () => {
    await uc.execute({ accountId: "acc-1" });
    const call = repo.upsert.mock.calls[0]?.[0];
    assert.equal(call?.primaryColor, null);
    assert.equal(call?.secondaryColor, null);
    assert.equal(call?.accentColor, null);
    assert.equal(call?.logoUrl, null);
    assert.equal(call?.fontPrimary, null);
  });

  it("rejects empty accountId", async () => {
    const r = await uc.execute(makeInput({ accountId: "" }));
    assert.ok(!r.ok);
    assert.match(r.error.message, /accountId is required/);
  });

  it("rejects invalid primaryColor", async () => {
    const r = await uc.execute(makeInput({ primaryColor: "red" }));
    assert.ok(!r.ok);
    assert.match(r.error.message, /primaryColor.*#RRGGBB/);
  });

  it("rejects invalid secondaryColor", async () => {
    const r = await uc.execute(makeInput({ secondaryColor: "#GGG000" }));
    assert.ok(!r.ok);
    assert.match(r.error.message, /secondaryColor.*#RRGGBB/);
  });

  it("rejects invalid accentColor", async () => {
    const r = await uc.execute(makeInput({ accentColor: "#FFF" }));
    assert.ok(!r.ok);
    assert.match(r.error.message, /accentColor.*#RRGGBB/);
  });

  it("accepts null color values", async () => {
    const r = await uc.execute(
      makeInput({ primaryColor: null, secondaryColor: null, accentColor: null })
    );
    assert.ok(r.ok);
    assert.equal(r.value.primaryColor, null);
  });

  it("accepts undefined color values (defaults to null)", async () => {
    const r = await uc.execute({ accountId: "acc-1" });
    assert.ok(r.ok);
  });

  it("wraps repository errors as internal errors", async () => {
    repo.upsert.mockRejectedValueOnce(new Error("DB connection failed"));
    const r = await uc.execute(makeInput());
    assert.ok(!r.ok);
    assert.equal(r.error.code, "INTERNAL_ERROR");
    assert.match(r.error.message, /Failed to upsert brand kit/);
  });

  it("uses UnitOfWork when provided", async () => {
    const executeFn = vi.fn(async (cb: () => Promise<void>) => {
      await cb();
    });
    const uow = { executeInTransaction: executeFn };
    const ucWithUow = new UpsertBrandKitUseCase(repo, uow);
    const r = await ucWithUow.execute(makeInput());
    assert.ok(r.ok);
    expect(executeFn).toHaveBeenCalledOnce();
    expect(repo.upsert).toHaveBeenCalledOnce();
  });
});

// ============================================================================
// GetBrandKitQuery
// ============================================================================

describe("GetBrandKitQuery", () => {
  let repo: ReturnType<typeof makeRepo>;
  let query: GetBrandKitQuery;

  beforeEach(() => {
    vi.clearAllMocks();
    repo = makeRepo();
    query = new GetBrandKitQuery(repo);
  });

  it("returns brand kit when found", async () => {
    const kitData: BrandKitData = {
      id: "bk-1",
      accountId: "acc-1",
      primaryColor: "#FF0000",
      secondaryColor: null,
      accentColor: null,
      logoUrl: null,
      logoStorageKey: null,
      fontPrimary: "Inter",
      fontSecondary: null,
      createdAt: new Date("2024-01-01"),
      updatedAt: new Date("2024-01-01"),
    };
    repo.findByAccountId.mockResolvedValueOnce(kitData);

    const r = await query.execute({ accountId: "acc-1" });
    assert.ok(r.ok);
    assert.equal(r.value?.id, "bk-1");
    assert.equal(r.value?.primaryColor, "#FF0000");
    assert.equal(r.value?.fontPrimary, "Inter");
  });

  it("returns null when not found", async () => {
    repo.findByAccountId.mockResolvedValueOnce(null);

    const r = await query.execute({ accountId: "acc-1" });
    assert.ok(r.ok);
    assert.equal(r.value, null);
  });

  it("rejects empty accountId", async () => {
    const r = await query.execute({ accountId: "" });
    assert.ok(!r.ok);
    assert.match(r.error.message, /accountId is required/);
  });
});

// ============================================================================
// DeleteBrandKitUseCase
// ============================================================================

describe("DeleteBrandKitUseCase", () => {
  let repo: ReturnType<typeof makeRepo>;
  let uc: DeleteBrandKitUseCase;

  beforeEach(() => {
    vi.clearAllMocks();
    repo = makeRepo();
    uc = new DeleteBrandKitUseCase(repo);
  });

  it("deletes brand kit by accountId", async () => {
    const r = await uc.execute({ accountId: "acc-1" });
    assert.ok(r.ok);
    expect(repo.deleteByAccountId).toHaveBeenCalledWith("acc-1");
  });

  it("rejects empty accountId", async () => {
    const r = await uc.execute({ accountId: "" });
    assert.ok(!r.ok);
    assert.match(r.error.message, /accountId is required/);
  });

  it("wraps repository errors as internal errors", async () => {
    repo.deleteByAccountId.mockRejectedValueOnce(new Error("DB error"));
    const r = await uc.execute({ accountId: "acc-1" });
    assert.ok(!r.ok);
    assert.equal(r.error.code, "INTERNAL_ERROR");
  });

  it("uses UnitOfWork when provided", async () => {
    const executeFn = vi.fn(async (cb: () => Promise<void>) => {
      await cb();
    });
    const uow = { executeInTransaction: executeFn };
    const ucWithUow = new DeleteBrandKitUseCase(repo, uow);
    const r = await ucWithUow.execute({ accountId: "acc-1" });
    assert.ok(r.ok);
    expect(executeFn).toHaveBeenCalledOnce();
    expect(repo.deleteByAccountId).toHaveBeenCalledOnce();
  });
});
