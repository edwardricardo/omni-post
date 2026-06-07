/**
 * @file UpsertGlossaryTermUseCase.test.ts
 * @description Unit tests for UpsertGlossaryTermUseCase — happy path with
 *   embedding, non-fatal embedding failure, and repository upsert failure.
 * @layer infrastructure
 */
import { describe, it, vi, beforeEach } from "vitest";
import assert from "node:assert/strict";
import { ok, err } from "@shared/types";
import { USE_CASE_ERRORS } from "@core/application/UseCase.js";
import { UpsertGlossaryTermUseCase } from "../../src/UpsertGlossaryTermUseCase.js";
import type {
  GlossaryRepository,
  GlossaryEntry,
} from "@core/domain/repositories/GlossaryRepository.js";
import type { EmbeddingService } from "@core/embeddings/EmbeddingService.js";

const NOW = new Date("2024-01-01T00:00:00Z");

function makeGlossaryEntry(overrides: Partial<GlossaryEntry> = {}): GlossaryEntry {
  return {
    id: "entry-uuid-001",
    accountId: "acc-001",
    locale: "en",
    term: "Engagement Rate",
    definition: "Percentage of users who interact",
    usage: null,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

function makeMockRepo(
  opts: { upsert?: unknown; updateEmbedding?: unknown } = {}
): GlossaryRepository {
  const entry = makeGlossaryEntry();
  return {
    upsert: vi.fn(async () => opts.upsert ?? ok(entry)),
    updateEmbedding: vi.fn(async () => opts.updateEmbedding ?? ok(undefined)),
    findByLocale: vi.fn(async () => ok([])),
    delete: vi.fn(async () => ok(undefined)),
  } as unknown as GlossaryRepository;
}

function makeMockEmbeddings(fails = false): EmbeddingService {
  return {
    embedSingle: vi.fn(async () =>
      fails ? err(new Error("embedding failed")) : ok([0.1, 0.2, 0.3])
    ),
  } as unknown as EmbeddingService;
}

const BASE_INPUT = {
  accountId: "acc-001",
  locale: "en",
  term: "Engagement Rate",
  definition: "Percentage of users who interact with a post",
};

describe("UpsertGlossaryTermUseCase", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns the entry with embeddingPersisted true when embedding succeeds", async () => {
    const uc = new UpsertGlossaryTermUseCase(
      makeMockRepo(),
      makeMockEmbeddings(),
      "text-embedding-3-small",
      3
    );
    const r = await uc.execute(BASE_INPUT);
    assert.ok(r.ok, `expected ok but got err: ${r.ok ? "" : r.error.message}`);
    assert.ok(r.value.embeddingPersisted);
    assert.strictEqual(r.value.entry.term, "Engagement Rate");
  });

  it("returns embeddingPersisted false (non-fatal) when the embedding service fails", async () => {
    const uc = new UpsertGlossaryTermUseCase(
      makeMockRepo(),
      makeMockEmbeddings(true),
      "text-embedding-3-small",
      3
    );
    const r = await uc.execute(BASE_INPUT);
    assert.ok(r.ok, `expected ok — embedding failure is non-fatal`);
    assert.ok(!r.value.embeddingPersisted);
  });

  it("returns INTERNAL_ERROR when the repository upsert fails", async () => {
    const uc = new UpsertGlossaryTermUseCase(
      makeMockRepo({ upsert: err(new Error("DB error")) }),
      makeMockEmbeddings(),
      "text-embedding-3-small",
      3
    );
    const r = await uc.execute(BASE_INPUT);
    assert.ok(!r.ok);
    assert.strictEqual(r.error.code, USE_CASE_ERRORS.INTERNAL_ERROR);
  });

  it("returns the saved entry with usage when usage field is provided", async () => {
    const entryWithUsage = makeGlossaryEntry({ usage: "Use in analytics context" });
    const uc = new UpsertGlossaryTermUseCase(
      makeMockRepo({ upsert: ok(entryWithUsage) }),
      makeMockEmbeddings(),
      "text-embedding-3-small",
      3
    );
    const r = await uc.execute({ ...BASE_INPUT, usage: "Use in analytics context" });
    assert.ok(r.ok);
    assert.strictEqual(r.value.entry.usage, "Use in analytics context");
  });
});
