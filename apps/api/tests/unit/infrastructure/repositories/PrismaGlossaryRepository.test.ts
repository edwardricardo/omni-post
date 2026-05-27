/**
 * @file PrismaGlossaryRepository.test.ts
 * @description Unit tests for the Prisma-backed adapter of the
 *              `GlossaryRepository` port. The Prisma client is stubbed
 *              with vi-mocked `$queryRaw`, `$executeRaw`, and
 *              `glossary.upsert/delete` methods, allowing us to assert
 *              both the Result-typed surface and the row → entity
 *              mapping (including pgvector text parse → number[]).
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

const { PrismaGlossaryRepository } =
  await import("../../../../src/infrastructure/repositories/PrismaGlossaryRepository.js");

interface MockPrisma {
  $queryRaw: ReturnType<typeof vi.fn>;
  $executeRaw: ReturnType<typeof vi.fn>;
  glossary: {
    upsert: ReturnType<typeof vi.fn>;
    delete: ReturnType<typeof vi.fn>;
  };
}

function makePrisma(): MockPrisma {
  return {
    $queryRaw: vi.fn(),
    $executeRaw: vi.fn(),
    glossary: {
      upsert: vi.fn(),
      delete: vi.fn(),
    },
  };
}

describe("PrismaGlossaryRepository", () => {
  let prisma: MockPrisma;
  let repo: PrismaGlossaryRepository;

  beforeEach(() => {
    prisma = makePrisma();
    repo = new PrismaGlossaryRepository(prisma as never);
  });

  it("upsert returns the persisted entry with embedding=null on first write", async () => {
    prisma.glossary.upsert.mockResolvedValue({
      id: "g-1",
      accountId: "acc-1",
      locale: "es",
      term: "Marca",
      definition: "Identidad",
      usage: null,
      embeddingModel: "text-embedding-3-small",
      createdAt: new Date("2026-01-01T00:00:00Z"),
      updatedAt: new Date("2026-01-01T00:00:00Z"),
    });

    const result = await repo.upsert({
      accountId: "acc-1",
      locale: "es",
      term: "Marca",
      definition: "Identidad",
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.id).toBe("g-1");
      expect(result.value.embedding).toBeNull();
    }
  });

  it("upsert returns PERSISTENCE_ERROR when Prisma throws", async () => {
    prisma.glossary.upsert.mockRejectedValue(new Error("connection refused"));
    const result = await repo.upsert({
      accountId: "acc-1",
      locale: "es",
      term: "X",
      definition: "Y",
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
        id: "g-1",
        accountId: "acc-1",
        locale: "es",
        term: "Marca",
        definition: "Identidad",
        usage: null,
        embedding: "[0.1,0.2,0.3]",
        embeddingModel: "text-embedding-3-small",
        createdAt: new Date("2026-01-01T00:00:00Z"),
        updatedAt: new Date("2026-01-01T00:00:00Z"),
      },
    ]);

    const result = await repo.findById("g-1");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.embedding).toEqual([0.1, 0.2, 0.3]);
    }
  });

  it("delete maps P2025 (record not found) to NOT_FOUND", async () => {
    const prismaError = new FakePrismaClientKnownRequestError("Record not found", {
      code: "P2025",
      clientVersion: "7.0.0",
    });
    prisma.glossary.delete.mockRejectedValue(prismaError);

    const result = await repo.delete("missing");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("NOT_FOUND");
  });

  it("delete returns PERSISTENCE_ERROR on any other Prisma error", async () => {
    prisma.glossary.delete.mockRejectedValue(new Error("network blip"));
    const result = await repo.delete("g-1");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("PERSISTENCE_ERROR");
  });

  it("listByAccountLocale maps rows preserving null embeddings", async () => {
    prisma.$queryRaw.mockResolvedValue([
      {
        id: "g-1",
        accountId: "acc-1",
        locale: "es",
        term: "Marca",
        definition: "Identidad",
        usage: null,
        embedding: null,
        embeddingModel: "text-embedding-3-small",
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ]);
    const result = await repo.listByAccountLocale("acc-1", "es");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toHaveLength(1);
      expect(result.value[0]?.embedding).toBeNull();
    }
  });

  it("updateEmbedding returns NOT_FOUND when no rows are affected", async () => {
    prisma.$executeRaw.mockResolvedValue(0);
    const result = await withTenantContext({ accountId: "acc-test" }, () =>
      repo.updateEmbedding("missing", [0.1, 0.2], "model-x")
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("NOT_FOUND");
  });

  it("updateEmbedding succeeds when the row is updated", async () => {
    prisma.$executeRaw.mockResolvedValue(1);
    const result = await withTenantContext({ accountId: "acc-test" }, () =>
      repo.updateEmbedding("g-1", [0.1, 0.2], "model-x")
    );
    expect(result.ok).toBe(true);
  });

  it("updateEmbedding throws when no TenantContext is bound (S2.1d guard)", async () => {
    prisma.$executeRaw.mockResolvedValue(1);
    const result = await repo.updateEmbedding("g-1", [0.1, 0.2], "model-x");
    // The adapter catches TenantContextMissingError and maps to PERSISTENCE_ERROR.
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("PERSISTENCE_ERROR");
  });
});
