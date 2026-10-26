/**
 * @file PrismaCrisisProjectRepository.test.ts
 * @description Pins how PrismaCrisisProjectRepository.findById reads a project's stored locale:
 *              a content locale reaches the domain Project, and a value outside CONTENT_LOCALES
 *              fails the read with the InvalidValueError that names the project row and the
 *              value. Tier 0: a mocked PrismaClient, no database.
 * @layer infrastructure
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import assert from "node:assert/strict";
import type { PrismaClient } from "@infra/prisma";
import { InvalidValueError, ProjectId } from "@core/domain/index.js";
import { PrismaCrisisProjectRepository } from "../../../../src/infrastructure/repositories/PrismaCrisisProjectRepository.js";

const PROJECT_ID = "b0000000-0000-4000-8000-000000000001";
const ACCOUNT_ID = "a0000000-0000-4000-8000-000000000001";

/**
 * @description A Project row as findById's query returns it.
 * @param locale - The locale the row holds.
 * @returns The row.
 */
function projectRow(locale: string) {
  return {
    id: PROJECT_ID,
    accountId: ACCOUNT_ID,
    name: "Launch",
    locale,
    isInCrisisMode: false,
    crisisStartedAt: null,
    crisisReason: null,
    crisisModeHistory: [],
    createdAt: new Date("2026-01-01T00:00:00Z"),
    updatedAt: new Date("2026-01-01T00:00:00Z"),
    deletedAt: null,
    account: { id: ACCOUNT_ID },
  };
}

/**
 * @description A repository over a client whose project read answers the given row.
 * @param row - The row the read returns.
 * @returns The repository.
 */
function repositoryReading(row: ReturnType<typeof projectRow>) {
  const prisma = { project: { findFirst: vi.fn(async () => row) } };
  return new PrismaCrisisProjectRepository(prisma as unknown as PrismaClient);
}

describe("PrismaCrisisProjectRepository.findById — the stored locale", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("reconstitutes the project with its stored locale when it is es or en", async () => {
    for (const locale of ["es", "en"]) {
      const repository = repositoryReading(projectRow(locale));

      const result = await repository.findById(ProjectId.fromStringUnsafe(PROJECT_ID));

      assert.ok(result.ok);
      expect(result.value.locale).toBe(locale);
    }
  });

  it("fails the read with InvalidValueError naming the project when its stored locale is pt", async () => {
    const repository = repositoryReading(projectRow("pt"));

    const read = repository.findById(ProjectId.fromStringUnsafe(PROJECT_ID));

    await expect(read).rejects.toBeInstanceOf(InvalidValueError);
    await expect(read).rejects.toMatchObject({
      field: "locale",
      value: "pt",
      message: `Project ${PROJECT_ID} holds locale "pt", which is not a content locale (en, es)`,
    });
  });
});
