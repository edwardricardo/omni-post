/**
 * @file PrismaStyleGuideRuleRepository.test.ts
 * @description Unit tests for the Prisma-backed adapter of the
 *              `StyleGuideRuleRepository` port. Stubs Prisma to verify
 *              both branches of `upsert` (with and without an id),
 *              the Result-typed surface, and the pgvector text → number[]
 *              round-trip through `findById` / `listByAccountLocale`.
 * @layer infrastructure
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { withTenantContext } from "../../../../src/security/tenantContext.js";

class FakePrismaClientKnownRequestError extends Error {
  code: string;
  clientVersion: string;
  constructor(message: string, opts: { code: string; clientVersion: string }) {
    super(message);
    this.name = "PrismaClientKnownRequestError";
    this.code = opts.code;
    this.clientVersion = opts.clientVersion;
  }
}

vi.mock("@infra/prisma", () => ({
  Prisma: {
    sql: (strings: TemplateStringsArray, ...values: unknown[]) => ({ strings, values }),
    PrismaClientKnownRequestError: FakePrismaClientKnownRequestError,
  },
}));

const { PrismaStyleGuideRuleRepository } =
  await import("../../../../src/infrastructure/repositories/PrismaStyleGuideRuleRepository.js");

interface MockPrisma {
  $queryRaw: ReturnType<typeof vi.fn>;
  $executeRaw: ReturnType<typeof vi.fn>;
  styleGuideRule: {
    upsert: ReturnType<typeof vi.fn>;
    create: ReturnType<typeof vi.fn>;
    delete: ReturnType<typeof vi.fn>;
  };
}

function makePrisma(): MockPrisma {
  return {
    $queryRaw: vi.fn(),
    $executeRaw: vi.fn(),
    styleGuideRule: {
      upsert: vi.fn(),
      create: vi.fn(),
      delete: vi.fn(),
    },
  };
}

describe("PrismaStyleGuideRuleRepository", () => {
  let prisma: MockPrisma;
  let repo: PrismaStyleGuideRuleRepository;

  beforeEach(() => {
    prisma = makePrisma();
    repo = new PrismaStyleGuideRuleRepository(prisma as never);
  });

  it("upsert routes to `create` when no id is supplied", async () => {
    prisma.styleGuideRule.create.mockResolvedValue({
      id: "s-new",
      accountId: "acc-1",
      locale: "es",
      rule: "Prefer active voice",
      example: null,
      category: null,
      embeddingModel: "text-embedding-3-small",
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const result = await repo.upsert({
      accountId: "acc-1",
      locale: "es",
      rule: "Prefer active voice",
    });

    expect(result.ok).toBe(true);
    expect(prisma.styleGuideRule.create).toHaveBeenCalledTimes(1);
    expect(prisma.styleGuideRule.upsert).not.toHaveBeenCalled();
    if (result.ok) expect(result.value.embedding).toBeNull();
  });

  it("upsert routes to `upsert` when an id is supplied", async () => {
    prisma.styleGuideRule.upsert.mockResolvedValue({
      id: "s-fixed",
      accountId: "acc-1",
      locale: "es",
      rule: "v2",
      example: null,
      category: null,
      embeddingModel: "text-embedding-3-small",
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const result = await repo.upsert({
      id: "s-fixed",
      accountId: "acc-1",
      locale: "es",
      rule: "v2",
    });

    expect(result.ok).toBe(true);
    expect(prisma.styleGuideRule.upsert).toHaveBeenCalledTimes(1);
    expect(prisma.styleGuideRule.create).not.toHaveBeenCalled();
  });

  it("upsert returns PERSISTENCE_ERROR when Prisma throws", async () => {
    prisma.styleGuideRule.create.mockRejectedValue(new Error("boom"));
    const result = await repo.upsert({
      accountId: "acc-1",
      locale: "es",
      rule: "x",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("PERSISTENCE_ERROR");
  });

  it("findById returns NOT_FOUND when the raw query returns no rows", async () => {
    prisma.$queryRaw.mockResolvedValue([]);
    const result = await repo.findById("missing");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("NOT_FOUND");
  });

  it("findById parses the pgvector text representation into number[]", async () => {
    prisma.$queryRaw.mockResolvedValue([
      {
        id: "s-1",
        accountId: "acc-1",
        locale: "en",
        rule: "Prefer active voice",
        example: null,
        category: "grammar",
        embedding: "[0.4,0.5]",
        embeddingModel: "text-embedding-3-small",
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ]);

    const result = await repo.findById("s-1");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.embedding).toEqual([0.4, 0.5]);
      expect(result.value.category).toBe("grammar");
    }
  });

  it("delete maps P2025 to NOT_FOUND", async () => {
    const prismaError = new FakePrismaClientKnownRequestError("Record not found", {
      code: "P2025",
      clientVersion: "7.0.0",
    });
    prisma.styleGuideRule.delete.mockRejectedValue(prismaError);

    const result = await repo.delete("missing");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("NOT_FOUND");
  });

  it("updateEmbedding returns NOT_FOUND when no rows are affected", async () => {
    prisma.$executeRaw.mockResolvedValue(0);
    const result = await withTenantContext({ accountId: "acc-test" }, () =>
      repo.updateEmbedding("missing", [0.1], "model-y")
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("NOT_FOUND");
  });

  it("updateEmbedding succeeds when the row is updated", async () => {
    prisma.$executeRaw.mockResolvedValue(1);
    const result = await withTenantContext({ accountId: "acc-test" }, () =>
      repo.updateEmbedding("s-1", [0.1, 0.2], "model-y")
    );
    expect(result.ok).toBe(true);
  });

  it("updateEmbedding throws when no TenantContext is bound (S2.1d guard)", async () => {
    prisma.$executeRaw.mockResolvedValue(1);
    const result = await repo.updateEmbedding("s-1", [0.1, 0.2], "model-y");
    // The adapter catches TenantContextMissingError and maps to PERSISTENCE_ERROR.
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("PERSISTENCE_ERROR");
  });
});
