/**
 * @file PrismaMentionRepository.test.ts
 * @description Tests the Prisma mention write adapter: dedup lookup + reconstitution,
 *   insert, and idempotent handling of the (provider, externalId) unique violation.
 * @layer infrastructure
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import assert from "node:assert/strict";
import { PrismaMentionRepository } from "@adapters/db-prisma";
import { MentionAggregate } from "@core/domain/aggregates/MentionAggregate.js";
import { AccountId, ProjectId } from "@core/domain/value-objects/EntityId.js";
import type { ProviderType } from "@core/domain/value-objects/Provider.js";

const ACCOUNT_ID = "11111111-1111-4111-8111-111111111111";
const PROJECT_ID = "22222222-2222-4222-8222-222222222222";

/**
 * The double models the shape the adapter actually uses: both of its statements run inside an
 * interactive transaction that binds `app.account_id` first, because `Mention` is RLS-covered and
 * this package is shared with the workers, where no request-scoped tenant context exists. The
 * transaction client exposes the SAME spies, so every assertion below still observes the real
 * call; `$executeRaw` is what the GUC binding issues, and `bindScopes` records what it bound so a
 * test can assert the scope rather than only the query.
 */
function makePrisma() {
  const mention = {
    findFirst: vi.fn(async () => null),
    create: vi.fn(async () => ({})),
  };
  const bindScopes: unknown[] = [];
  const $executeRaw = vi.fn(async (_strings: TemplateStringsArray, ...values: unknown[]) => {
    bindScopes.push(values[0]);
    return 1;
  });
  return {
    mention,
    bindScopes,
    $executeRaw,
    $transaction: vi.fn(async (fn: (tx: unknown) => unknown) => fn({ mention, $executeRaw })),
  };
}

function makeMention() {
  const r = MentionAggregate.create({
    accountId: AccountId.fromStringUnsafe(ACCOUNT_ID),
    projectId: ProjectId.fromStringUnsafe(PROJECT_ID),
    provider: "X" as ProviderType,
    externalId: "ext-1",
    source: "SEARCH",
    authorName: "Jane",
    authorProviderId: "provider-user-1",
    body: "hello",
    providerCreatedAt: new Date("2026-05-01T00:00:00Z"),
  });
  if (!r.ok) throw r.error;
  return r.value;
}

function makeRow() {
  return {
    id: "44444444-4444-4444-8444-444444444444",
    accountId: ACCOUNT_ID,
    projectId: PROJECT_ID,
    channelId: null,
    provider: "X",
    externalId: "ext-1",
    trackedTermId: null,
    source: "SEARCH",
    authorName: "Jane",
    authorHandle: null,
    authorAvatarUrl: null,
    authorProviderId: "provider-user-1",
    url: null,
    body: "hello",
    lang: null,
    mediaUrls: [],
    sentimentScore: null,
    sentimentLabel: null,
    providerCreatedAt: new Date("2026-05-01T00:00:00Z"),
    createdAt: new Date("2026-05-01T00:00:00Z"),
    updatedAt: new Date("2026-05-01T00:00:00Z"),
  };
}

describe("PrismaMentionRepository", () => {
  let prisma: ReturnType<typeof makePrisma>;
  let repo: PrismaMentionRepository;

  beforeEach(() => {
    vi.clearAllMocks();
    prisma = makePrisma();
    repo = new PrismaMentionRepository(prisma as never);
  });

  it("returns null from findByProviderExternalId when no row exists", async () => {
    const result = await repo.findByProviderExternalId("X" as ProviderType, "ext-1");
    assert.strictEqual(result, null);
    expect(prisma.mention.findFirst).toHaveBeenCalledWith({
      where: { provider: "X", externalId: "ext-1" },
    });
  });

  it("reconstitutes a Mention aggregate when a row exists", async () => {
    prisma.mention.findFirst.mockResolvedValueOnce(makeRow() as never);
    const result = await repo.findByProviderExternalId("X" as ProviderType, "ext-1");
    assert.ok(result !== null);
    expect(result.externalId).toBe("ext-1");
    expect(result.body).toBe("hello");
    expect(result.channelId).toBeNull();
  });

  it("binds the system scope for the dedup probe, which spans tenants by construction", async () => {
    await repo.findByProviderExternalId("X" as ProviderType, "ext-1");
    expect(prisma.bindScopes).toEqual(["__system__"]);
  });

  it("inserts on save and returns ok", async () => {
    const result = await repo.save(makeMention());
    assert.ok(result.ok);
    expect(prisma.mention.create).toHaveBeenCalledTimes(1);
  });

  it("binds the mention's own account on save, never the system scope", async () => {
    await repo.save(makeMention());
    expect(prisma.bindScopes).toEqual([ACCOUNT_ID]);
  });

  it("treats a P2002 unique violation as idempotent success", async () => {
    prisma.mention.create.mockRejectedValueOnce({ code: "P2002" });
    const result = await repo.save(makeMention());
    assert.ok(result.ok);
  });

  it("returns err on a non-P2002 failure", async () => {
    prisma.mention.create.mockRejectedValueOnce(new Error("connection lost"));
    const result = await repo.save(makeMention());
    assert.ok(!result.ok);
  });
});
