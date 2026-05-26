/**
 * @file PrismaConversionRepository.test.ts
 * @description Unit tests for the Prisma adapter of the ConversionRepository
 *              port. Stubs the Prisma client to assert the create data shape
 *              (Decimal-wrapped value, enum fields), the P2002 idempotency
 *              swallow, the rethrow of non-P2002 errors, and the findByAccount
 *              where/order shape with Decimal→number coercion at the boundary.
 * @layer infrastructure
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

class FakeDecimal {
  constructor(private readonly v: number) {}
  valueOf(): number {
    return this.v;
  }
  toString(): string {
    return String(this.v);
  }
}

class FakeKnownRequestError extends Error {
  code: string;
  constructor(code: string) {
    super(`prisma error ${code}`);
    this.code = code;
  }
}

vi.mock("@infra/prisma", () => ({
  Prisma: {
    Decimal: FakeDecimal,
    PrismaClientKnownRequestError: FakeKnownRequestError,
  },
}));

const { PrismaConversionRepository } =
  await import("../../../../src/infrastructure/repositories/PrismaConversionRepository.js");

interface MockPrisma {
  conversion: {
    create: ReturnType<typeof vi.fn>;
    findMany: ReturnType<typeof vi.fn>;
  };
}

function makePrisma(): MockPrisma {
  return {
    conversion: {
      create: vi.fn(),
      findMany: vi.fn(),
    },
  };
}

const recordInput = {
  accountId: "acc-1",
  source: "X" as const,
  contentId: "post-1",
  conversionType: "SALE" as const,
  value: 149.99,
  attribution: "LAST_CLICK" as const,
  occurredAt: new Date("2026-05-10T12:00:00Z"),
};

describe("PrismaConversionRepository", () => {
  let prisma: MockPrisma;
  let repo: InstanceType<typeof PrismaConversionRepository>;

  beforeEach(() => {
    prisma = makePrisma();
    repo = new PrismaConversionRepository(prisma as never);
  });

  it("record creates a row with the Decimal-wrapped value and enum fields", async () => {
    prisma.conversion.create.mockResolvedValue({});
    await repo.record(recordInput);
    const arg = prisma.conversion.create.mock.calls[0]?.[0];
    expect(arg.data.accountId).toBe("acc-1");
    expect(arg.data.source).toBe("X");
    expect(arg.data.contentId).toBe("post-1");
    expect(arg.data.conversionType).toBe("SALE");
    expect(arg.data.attribution).toBe("LAST_CLICK");
    expect(arg.data.occurredAt).toEqual(new Date("2026-05-10T12:00:00Z"));
    expect(arg.data.value).toBeInstanceOf(FakeDecimal);
    expect(Number(arg.data.value)).toBe(149.99);
  });

  it("record swallows the P2002 unique-violation (idempotent re-report)", async () => {
    prisma.conversion.create.mockRejectedValue(new FakeKnownRequestError("P2002"));
    await expect(repo.record(recordInput)).resolves.toBeUndefined();
  });

  it("record rethrows a non-P2002 known request error", async () => {
    prisma.conversion.create.mockRejectedValue(new FakeKnownRequestError("P2003"));
    await expect(repo.record(recordInput)).rejects.toBeInstanceOf(FakeKnownRequestError);
  });

  it("record rethrows a generic error", async () => {
    prisma.conversion.create.mockRejectedValue(new Error("connection lost"));
    await expect(repo.record(recordInput)).rejects.toThrow("connection lost");
  });

  it("findByAccount filters by account + date window, orders by occurredAt asc", async () => {
    prisma.conversion.findMany.mockResolvedValue([]);
    const start = new Date("2026-05-01T00:00:00Z");
    const end = new Date("2026-05-31T00:00:00Z");
    await repo.findByAccount("acc-1", { start, end });
    const arg = prisma.conversion.findMany.mock.calls[0]?.[0];
    expect(arg.where.accountId).toBe("acc-1");
    expect(arg.where.occurredAt).toEqual({ gte: start, lte: end });
    expect(arg.where.source).toBeUndefined();
    expect(arg.orderBy).toEqual({ occurredAt: "asc" });
  });

  it("findByAccount adds a source filter when supplied", async () => {
    prisma.conversion.findMany.mockResolvedValue([]);
    await repo.findByAccount("acc-1", {
      start: new Date("2026-05-01T00:00:00Z"),
      end: new Date("2026-05-31T00:00:00Z"),
      source: "INSTAGRAM",
    });
    const arg = prisma.conversion.findMany.mock.calls[0]?.[0];
    expect(arg.where.source).toBe("INSTAGRAM");
  });

  it("findByAccount coerces the Decimal value to a number at the boundary", async () => {
    prisma.conversion.findMany.mockResolvedValue([
      {
        id: "conv-1",
        accountId: "acc-1",
        source: "X",
        contentId: "post-1",
        conversionType: "SALE",
        value: new FakeDecimal(149.99),
        attribution: "LAST_CLICK",
        occurredAt: new Date("2026-05-10T12:00:00Z"),
        createdAt: new Date("2026-05-10T12:00:01Z"),
      },
    ]);
    const rows = await repo.findByAccount("acc-1", {
      start: new Date("2026-05-01T00:00:00Z"),
      end: new Date("2026-05-31T00:00:00Z"),
    });
    expect(rows).toHaveLength(1);
    expect(typeof rows[0]?.value).toBe("number");
    expect(rows[0]?.value).toBe(149.99);
  });
});
