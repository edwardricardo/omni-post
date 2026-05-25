/**
 * @file ThreadReadRepository.test.ts
 * @description Contract tests for the thread read port. Exercises an in-memory
 *              reference implementation against the semantics every adapter must
 *              honour: by-id and batch lookup, timeframe scoping by project /
 *              account, full-history scoping, and project thread counts.
 * @layer infrastructure
 */
import { describe, it, beforeEach } from "vitest";
import assert from "node:assert/strict";
import type { ThreadReadRepositoryPort } from "@core/domain/repositories/ThreadReadRepository.js";
import type {
  ThreadWithRelations,
  ThreadWithTweets,
} from "@core/domain/repositories/ReadModelDtos.js";

function makeThread(overrides: Partial<ThreadWithRelations> = {}): ThreadWithRelations {
  const createdAt = overrides.createdAt ?? new Date("2026-05-01T00:00:00Z");
  return {
    id: "thread-1",
    postId: "post-1",
    strategy: "AUTO",
    createdAt,
    updatedAt: createdAt,
    post: {
      id: "post-1",
      projectId: "proj-1",
      status: "PUBLISHED",
      scheduledAt: null,
      publishedAt: createdAt,
      deletedAt: null,
      createdAt,
      updatedAt: createdAt,
      project: {
        id: "proj-1",
        name: "Project One",
        locale: "en",
        accountId: "acc-1",
        isInCrisisMode: false,
        crisisStartedAt: null,
        crisisReason: null,
        crisisModeHistory: null,
        deletedAt: null,
        createdAt,
        updatedAt: createdAt,
      },
    },
    tweets: [],
    ...overrides,
  };
}

class InMemoryThreadReadRepository implements ThreadReadRepositoryPort {
  constructor(private readonly threads: ThreadWithRelations[]) {}

  async getById(threadId: string): Promise<ThreadWithRelations | null> {
    return this.threads.find((t) => t.id === threadId) ?? null;
  }

  async getByIds(threadIds: string[]): Promise<ThreadWithRelations[]> {
    return this.threads.filter((t) => threadIds.includes(t.id));
  }

  async getByProjectIdAndTimeframe(
    projectId: string,
    start: Date,
    end: Date
  ): Promise<ThreadWithRelations[]> {
    return this.threads
      .filter((t) => t.post.projectId === projectId && t.createdAt >= start && t.createdAt < end)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  }

  async getByAccountIdAndTimeframe(
    accountId: string,
    start: Date,
    end: Date
  ): Promise<ThreadWithRelations[]> {
    return this.threads
      .filter(
        (t) => t.post.project.accountId === accountId && t.createdAt >= start && t.createdAt < end
      )
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  }

  async getByProjectId(projectId: string): Promise<ThreadWithTweets[]> {
    return this.threads
      .filter((t) => t.post.projectId === projectId)
      .map(({ post: _post, ...rest }) => rest);
  }

  async getByAccountId(accountId: string): Promise<ThreadWithTweets[]> {
    return this.threads
      .filter((t) => t.post.project.accountId === accountId)
      .map(({ post: _post, ...rest }) => rest);
  }

  async countByProjectId(projectId: string): Promise<number> {
    return this.threads.filter((t) => t.post.projectId === projectId).length;
  }
}

describe("ThreadReadRepository contract", () => {
  let repo: InMemoryThreadReadRepository;

  beforeEach(() => {
    repo = new InMemoryThreadReadRepository([
      makeThread({ id: "t1", createdAt: new Date("2026-05-10T00:00:00Z") }),
      makeThread({
        id: "t2",
        postId: "post-2",
        createdAt: new Date("2026-05-20T00:00:00Z"),
        post: {
          ...makeThread().post,
          id: "post-2",
        },
      }),
    ]);
  });

  it("returns a thread with post and project when found by id", async () => {
    const thread = await repo.getById("t1");
    assert.ok(thread, "thread should be found");
    assert.strictEqual(thread?.id, "t1");
    assert.strictEqual(thread?.post.project.accountId, "acc-1");
  });

  it("returns null when the thread does not exist", async () => {
    assert.strictEqual(await repo.getById("missing"), null);
  });

  it("returns multiple threads by ids in a single batch", async () => {
    const threads = await repo.getByIds(["t1", "t2"]);
    assert.strictEqual(threads.length, 2);
  });

  it("scopes threads to a project within the timeframe ordered by createdAt desc", async () => {
    const threads = await repo.getByProjectIdAndTimeframe(
      "proj-1",
      new Date("2026-05-01T00:00:00Z"),
      new Date("2026-06-01T00:00:00Z")
    );
    assert.strictEqual(threads.length, 2);
    assert.strictEqual(threads[0]?.id, "t2", "newest thread first");
  });

  it("excludes threads outside the timeframe upper bound", async () => {
    const threads = await repo.getByProjectIdAndTimeframe(
      "proj-1",
      new Date("2026-05-01T00:00:00Z"),
      new Date("2026-05-15T00:00:00Z")
    );
    assert.strictEqual(threads.length, 1);
    assert.strictEqual(threads[0]?.id, "t1");
  });

  it("scopes threads to an account within the timeframe", async () => {
    const threads = await repo.getByAccountIdAndTimeframe(
      "acc-1",
      new Date("2026-05-01T00:00:00Z"),
      new Date("2026-06-01T00:00:00Z")
    );
    assert.strictEqual(threads.length, 2);
  });

  it("returns project threads with tweets and no post join", async () => {
    const threads = await repo.getByProjectId("proj-1");
    assert.strictEqual(threads.length, 2);
    assert.ok(Array.isArray(threads[0]?.tweets));
    assert.ok(!("post" in (threads[0] as object)));
  });

  it("returns account threads with tweets and no post join", async () => {
    const threads = await repo.getByAccountId("acc-1");
    assert.strictEqual(threads.length, 2);
  });

  it("counts threads belonging to a project", async () => {
    assert.strictEqual(await repo.countByProjectId("proj-1"), 2);
    assert.strictEqual(await repo.countByProjectId("proj-other"), 0);
  });
});
