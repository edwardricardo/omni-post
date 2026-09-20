/**
 * @file postUseCases.test.ts
 * @description Unit tests for all 7 post use cases: Create, Update, Schedule, Delete, Get, List.
 * @layer application
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { ok, err, type Result } from "@shared/types";
import {
  PostAggregate,
  ProjectId,
  PostId,
  ChannelId,
  AccountId,
  PUBLISH_STATUS,
} from "@core/domain/index.js";
import { EntityNotFoundError } from "@core/domain/errors/index.js";
import type { UnitOfWork } from "@core/domain/repositories/Repository.js";
import { CreatePostUseCase } from "@core/posts/CreatePostUseCase.js";
import { UpdatePostUseCase } from "@core/posts/UpdatePostUseCase.js";
import { SchedulePostUseCase } from "@core/posts/SchedulePostUseCase.js";
import { DeletePostUseCase, type DeletePostCaller } from "@core/posts/DeletePostUseCase.js";
import { GetPostUseCase } from "@core/posts/GetPostUseCase.js";
import { ListPostsUseCase } from "@core/posts/ListPostsUseCase.js";
import { USE_CASE_ERRORS } from "@core/application/UseCase.js";

// Mock business metrics — they call Prometheus which may not be initialized
vi.mock("../../../src/metrics/businessMetrics.js", () => ({
  incrementPostCreated: vi.fn(),
  incrementPostDeleted: vi.fn(),
  incrementPostPublished: vi.fn(),
}));

// --- Mock factories ---

/**
 * @param afterCommit - When given, the narrow save REGISTERS its debt discharge here
 *   instead of performing it, mirroring production: inside someone else's transaction
 *   `savePublicationRecord` defers the mark to the commit, and outside one it marks
 *   immediately because the runner resolving IS the commit. A double that marked inside
 *   the transaction either way would be testing itself.
 */
function createMockPostRepository(afterCommit?: Array<() => void>) {
  const store = new Map<string, PostAggregate>();
  /**
   * What each save saw, in call order. `outbox` is what the real adapters hand to the
   * outbox writer — `aggregate.domainEvents` at the moment of the write — so counting
   * event ids across the two entries is how a test sees whether an event would reach
   * the outbox twice. It would: `PrismaOutboxWriter` inserts with `createMany` keyed on
   * the event id and no `skipDuplicates`, so a second insert of the same id is a P2002
   * that aborts the whole transaction, not a duplicate row.
   */
  const writes: Array<{ save: "full" | "narrow" | "dispatch"; outbox: string[]; records: number }> =
    [];
  const recordWrite = (save: "full" | "narrow", post: PostAggregate): void => {
    writes.push({
      save,
      outbox: post.domainEvents.map((event) => event.eventId),
      records: post.publications.size,
    });
  };
  return {
    store,
    writes,
    findById: vi.fn(async (id: PostId) => {
      const post = store.get(id.value);
      if (!post) return err(new EntityNotFoundError("Post", id.value));
      return ok(post);
    }),
    save: vi.fn(async (post: PostAggregate) => {
      // The production full save REFUSES an aggregate that still owes a publication
      // write; the double implements the SAME refusal so this suite is tested against
      // the production contract instead of a laxer one.
      if (post.hasUnsavedPublications()) {
        return err(
          new Error(
            `post ${post.id.value} carries unsaved publication records: use savePublication`
          )
        );
      }
      recordWrite("full", post);
      store.set(post.id.value, post);
      return ok(undefined);
    }),
    savePublication: vi.fn(async (post: PostAggregate) => {
      recordWrite("narrow", post);
      const discharge = (): void => post.markPublicationsPersisted();
      if (afterCommit === undefined) {
        discharge();
      } else {
        afterCommit.push(discharge);
      }
      store.set(post.id.value, post);
      return ok(undefined);
    }),
    delete: vi.fn(async (id: PostId) => {
      if (!store.has(id.value)) return err(new EntityNotFoundError("Post", id.value));
      store.delete(id.value);
      return ok(undefined);
    }),
    countByProjectId: vi.fn(),
    countByStatus: vi.fn(),
    getProjectStats: vi.fn(),
    bulkUpdateStatus: vi.fn(),
    hardDelete: vi.fn(),
    findOwnerAccountId: vi.fn(async (_id: PostId): Promise<AccountId | null> => null),
    // Resolves by default so the create path's project-ownership gate lets the
    // aggregate through; the arms that exercise a FOREIGN project override it
    // with null, which is the only answer that means "not yours or not there".
    findProjectOwnerAccountId: vi.fn(async (_projectId: ProjectId): Promise<AccountId | null> =>
      AccountId.fromStringUnsafe("acc-owner-fixture")
    ),
  };
}

/**
 * @param order - When given, `dispatchAll` appends itself so a test can see WHERE the
 *   dispatch sits relative to the saves. The production dispatcher runs in-process
 *   handlers and then a BullMQ publish, so its position relative to the transaction
 *   boundary is a correctness property, not an implementation detail.
 */
function createMockEventDispatcher(
  order?: Array<{ save: "full" | "narrow" | "dispatch"; outbox: string[]; records: number }>
) {
  return {
    dispatch: vi.fn(async () => {}),
    dispatchAll: vi.fn(async (events: Array<{ eventId: string }>) => {
      order?.push({
        save: "dispatch",
        outbox: events.map((event) => event.eventId),
        records: 0,
      });
    }),
    register: vi.fn(),
  };
}

/**
 * A unit of work that records WHICH seam a use case opened. The distinction is the
 * whole point: `executeInTransaction` resolves whatever its callback resolves, so a
 * use case that stores an `err` in a variable and lets the callback complete tells the
 * transaction it succeeded and the partial write COMMITS (ADR-0023).
 * `executeResultInTransaction` reads the `Result` and rolls back on `err`.
 */
function createRecordingUnitOfWork(): {
  state: {
    plainCalls: number;
    resultCalls: number;
    rolledBack: unknown[];
    afterCommit: Array<() => void>;
  };
  port: UnitOfWork;
} {
  const state = {
    plainCalls: 0,
    resultCalls: 0,
    rolledBack: [] as unknown[],
    // Work registered from inside the transaction that must run ONLY on commit — the
    // production seam's `onCommitted`. Drained on `ok`, never on `err`.
    afterCommit: [] as Array<() => void>,
  };
  const drain = (): void => {
    for (const hook of state.afterCommit) {
      hook();
    }
    state.afterCommit.length = 0;
  };
  return {
    state,
    port: {
      async executeInTransaction<T>(fn: () => Promise<T>): Promise<T> {
        state.plainCalls++;
        const value = await fn();
        drain();
        return value;
      },
      async executeResultInTransaction<T, E>(
        fn: () => Promise<Result<T, E>>
      ): Promise<Result<T, E>> {
        state.resultCalls++;
        const result = await fn();
        if (!result.ok) {
          state.rolledBack.push(result.error);
          return result;
        }
        drain();
        return result;
      },
    },
  };
}

function createMockBusinessMetrics() {
  return {
    incrementPostCreated: vi.fn(),
    incrementPostPublished: vi.fn(),
    incrementPostDeleted: vi.fn(),
  };
}

function createMockChannelRepository() {
  const channels = new Map<string, { id: string; name: string }>();
  return {
    channels,
    findById: vi.fn(async (id: ChannelId) => {
      const ch = channels.get(id.value);
      if (!ch) return err(new EntityNotFoundError("Channel", id.value));
      return ok(ch);
    }),
    save: vi.fn(),
    delete: vi.fn(),
    findByAccountId: vi.fn(),
  };
}

function createMockQueryRepository() {
  const store = new Map<string, any>();
  return {
    store,
    getById: vi.fn(async (id: PostId) => {
      const post = store.get(id.value);
      if (!post) return err(new EntityNotFoundError("Post", id.value));
      return ok(post);
    }),
    listByProject: vi.fn(
      async (
        _projId: ProjectId,
        _accountId?: any,
        pagination?: any,
        _sort?: any,
        _filter?: any
      ) => {
        const items = Array.from(store.values());
        const page = pagination?.page ?? 1;
        const limit = Math.min(pagination?.limit ?? 20, 100);
        const total = items.length;
        const totalPages = Math.ceil(total / limit);
        const start = (page - 1) * limit;
        return {
          items: items.slice(start, start + limit),
          total,
          page,
          limit,
          totalPages,
          hasNext: page < totalPages,
          hasPrevious: page > 1,
        };
      }
    ),
    search: vi.fn(),
    getUpcoming: vi.fn(),
    getRecentlyPublished: vi.fn(),
    getByIdWithThread: vi.fn(),
    listGlobal: vi.fn(),
  };
}

const TEST_PROJECT_ID = ProjectId.generate().value;
// Server-derived caller account threaded into the read use cases (CWE-639 scope).
const TEST_ACCOUNT_ID = AccountId.generate().value;

function validCreateInput(overrides?: Record<string, unknown>) {
  return {
    projectId: TEST_PROJECT_ID,
    body: "Test post body content",
    ...overrides,
  };
}

describe("CreatePostUseCase", () => {
  let useCase: CreatePostUseCase;
  let repo: ReturnType<typeof createMockPostRepository>;
  let dispatcher: ReturnType<typeof createMockEventDispatcher>;

  beforeEach(() => {
    repo = createMockPostRepository();
    dispatcher = createMockEventDispatcher();
    useCase = new CreatePostUseCase(repo as any, dispatcher as any, createMockBusinessMetrics());
  });

  describe("success", () => {
    it("creates a post with DRAFT status", async () => {
      const result = await useCase.execute(validCreateInput());
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.status).toBe(PUBLISH_STATUS.DRAFT);
      expect(result.value.body).toBe("Test post body content");
      expect(result.value.id).toBeTruthy();
    });

    it("persists the post in the repository", async () => {
      const result = await useCase.execute(validCreateInput());
      expect(result.ok).toBe(true);
      expect(repo.save).toHaveBeenCalledOnce();
    });

    it("dispatches domain events", async () => {
      await useCase.execute(validCreateInput());
      expect(dispatcher.dispatchAll).toHaveBeenCalledOnce();
    });

    it("returns projectId in output", async () => {
      const result = await useCase.execute(validCreateInput());
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.projectId).toBe(TEST_PROJECT_ID);
    });

    it("creates with title when provided", async () => {
      const result = await useCase.execute(validCreateInput({ title: "My Title" }));
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.title).toBe("My Title");
    });

    it("creates with tags when provided", async () => {
      const result = await useCase.execute(validCreateInput({ tags: ["a", "b"] }));
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.tags).toEqual(["a", "b"]);
    });

    it("creates as SCHEDULED when scheduledAt provided", async () => {
      const future = new Date(Date.now() + 7_200_000);
      const result = await useCase.execute(validCreateInput({ scheduledAt: future }));
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.status).toBe(PUBLISH_STATUS.SCHEDULED);
      expect(result.value.scheduledAt).toBeDefined();
    });

    it("returns createdAt timestamp", async () => {
      const result = await useCase.execute(validCreateInput());
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.createdAt).toBeInstanceOf(Date);
    });
  });

  describe("validation", () => {
    it("rejects invalid projectId", async () => {
      const result = await useCase.execute(validCreateInput({ projectId: "not-uuid" }));
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe(USE_CASE_ERRORS.VALIDATION_FAILED);
    });

    it("rejects empty body", async () => {
      const result = await useCase.execute(validCreateInput({ body: "" }));
      expect(result.ok).toBe(false);
    });
  });

  describe("error handling", () => {
    it("returns error when save fails", async () => {
      repo.save.mockResolvedValueOnce(err(new Error("DB error")));
      const result = await useCase.execute(validCreateInput());
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe(USE_CASE_ERRORS.INTERNAL_ERROR);
    });
  });
});

describe("UpdatePostUseCase", () => {
  let useCase: UpdatePostUseCase;
  let repo: ReturnType<typeof createMockPostRepository>;
  let dispatcher: ReturnType<typeof createMockEventDispatcher>;
  let existingPost: PostAggregate;

  beforeEach(() => {
    repo = createMockPostRepository();
    dispatcher = createMockEventDispatcher();
    useCase = new UpdatePostUseCase(repo as any, dispatcher as any);

    const createResult = PostAggregate.create({
      projectId: ProjectId.fromStringUnsafe(TEST_PROJECT_ID),
      body: "Original body",
    });
    expect(createResult.ok).toBe(true);
    if (!createResult.ok) return;
    existingPost = createResult.value;
    repo.store.set(existingPost.id.value, existingPost);
  });

  describe("success", () => {
    it("updates body and returns updated DTO", async () => {
      const result = await useCase.execute({
        postId: existingPost.id.value,
        body: "Updated body",
      });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.body).toBe("Updated body");
    });

    it("updates title", async () => {
      const result = await useCase.execute({
        postId: existingPost.id.value,
        title: "New Title",
      });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.title).toBe("New Title");
    });

    it("updates tags", async () => {
      const result = await useCase.execute({
        postId: existingPost.id.value,
        tags: ["x", "y"],
      });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.tags).toEqual(["x", "y"]);
    });

    it("persists and dispatches events", async () => {
      await useCase.execute({ postId: existingPost.id.value, body: "New" });
      expect(repo.save).toHaveBeenCalled();
      expect(dispatcher.dispatchAll).toHaveBeenCalled();
    });
  });

  describe("validation", () => {
    it("rejects invalid postId", async () => {
      const result = await useCase.execute({ postId: "not-uuid", body: "x" });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe(USE_CASE_ERRORS.VALIDATION_FAILED);
    });
  });

  describe("business rules", () => {
    it("rejects update on non-editable post (SCHEDULED)", async () => {
      existingPost.schedule(new Date(Date.now() + 3_600_000));
      const result = await useCase.execute({
        postId: existingPost.id.value,
        body: "Cannot update",
      });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe(USE_CASE_ERRORS.FORBIDDEN);
    });
  });

  describe("error handling", () => {
    it("returns NOT_FOUND for non-existent post", async () => {
      const fakeId = PostId.generate().value;
      const result = await useCase.execute({ postId: fakeId, body: "x" });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe(USE_CASE_ERRORS.NOT_FOUND);
    });
  });
});

describe("SchedulePostUseCase", () => {
  let useCase: SchedulePostUseCase;
  let repo: ReturnType<typeof createMockPostRepository>;
  let dispatcher: ReturnType<typeof createMockEventDispatcher>;
  let channelRepo: ReturnType<typeof createMockChannelRepository>;
  let draftPost: PostAggregate;
  let channelId: string;

  beforeEach(() => {
    repo = createMockPostRepository();
    // Shares the repo's order log, so a case can assert WHERE the dispatch sits
    // relative to the two saves.
    dispatcher = createMockEventDispatcher(repo.writes);
    channelRepo = createMockChannelRepository();
    useCase = new SchedulePostUseCase(
      repo as any,
      dispatcher as any,
      channelRepo as any,
      createMockBusinessMetrics()
    );

    const createResult = PostAggregate.create({
      projectId: ProjectId.fromStringUnsafe(TEST_PROJECT_ID),
      body: "Post to schedule",
    });
    expect(createResult.ok).toBe(true);
    if (!createResult.ok) return;
    draftPost = createResult.value;
    repo.store.set(draftPost.id.value, draftPost);

    channelId = ChannelId.generate().value;
    channelRepo.channels.set(channelId, { id: channelId, name: "Test Channel" });
  });

  describe("success", () => {
    it("schedules a draft post", async () => {
      const future = new Date(Date.now() + 7_200_000).toISOString();
      const result = await useCase.execute({
        postId: draftPost.id.value,
        channelIds: [channelId],
        scheduledFor: future,
      });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.status).toBe(PUBLISH_STATUS.SCHEDULED);
      expect(result.value.channelIds).toEqual([channelId]);
    });

    it("persists and dispatches events", async () => {
      const future = new Date(Date.now() + 7_200_000).toISOString();
      await useCase.execute({
        postId: draftPost.id.value,
        channelIds: [channelId],
        scheduledFor: future,
      });
      expect(repo.save).toHaveBeenCalled();
      expect(dispatcher.dispatchAll).toHaveBeenCalled();
    });
  });

  describe("validation", () => {
    it("rejects invalid postId", async () => {
      const result = await useCase.execute({
        postId: "not-uuid",
        channelIds: [channelId],
        scheduledFor: new Date(Date.now() + 3_600_000).toISOString(),
      });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe(USE_CASE_ERRORS.VALIDATION_FAILED);
    });

    it("rejects empty channelIds", async () => {
      const result = await useCase.execute({
        postId: draftPost.id.value,
        channelIds: [],
        scheduledFor: new Date(Date.now() + 3_600_000).toISOString(),
      });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe(USE_CASE_ERRORS.VALIDATION_FAILED);
    });

    it("rejects invalid date string", async () => {
      const result = await useCase.execute({
        postId: draftPost.id.value,
        channelIds: [channelId],
        scheduledFor: "not-a-date",
      });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe(USE_CASE_ERRORS.VALIDATION_FAILED);
    });

    it("rejects non-existent channel", async () => {
      const fakeChannelId = ChannelId.generate().value;
      const result = await useCase.execute({
        postId: draftPost.id.value,
        channelIds: [fakeChannelId],
        scheduledFor: new Date(Date.now() + 3_600_000).toISOString(),
      });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe(USE_CASE_ERRORS.NOT_FOUND);
    });
  });

  describe("error handling", () => {
    it("returns NOT_FOUND for non-existent post", async () => {
      const fakePostId = PostId.generate().value;
      const result = await useCase.execute({
        postId: fakePostId,
        channelIds: [channelId],
        scheduledFor: new Date(Date.now() + 3_600_000).toISOString(),
      });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe(USE_CASE_ERRORS.NOT_FOUND);
    });
  });

  describe("the declared target set (REC-1 [static])", () => {
    it("PERSISTS the validated identities through the narrow save, not only in the DTO", async () => {
      const second = ChannelId.generate().value;
      channelRepo.channels.set(second, { id: second, name: "Second Channel" });
      const future = new Date(Date.now() + 7_200_000).toISOString();

      const result = await useCase.execute({
        postId: draftPost.id.value,
        channelIds: [channelId, second],
        scheduledFor: future,
      });

      expect(result.ok).toBe(true);
      expect(repo.savePublication).toHaveBeenCalledOnce();
      const saved = repo.savePublication.mock.calls[0]![0] as PostAggregate;
      expect(saved.publications.size).toBe(2);
      expect(saved.publications.all.map((record) => record.channelId.value).sort()).toEqual(
        [channelId, second].sort()
      );
      expect(saved.publications.all.every((record) => record.outcome.kind === "unresolved")).toBe(
        true
      );
      expect(saved.hasUnsavedPublications()).toBe(false);
    });

    it("writes the full save FIRST and the narrow save SECOND, each carrying its own events", async () => {
      // The order is forced from both ends and neither end is negotiable. The full save
      // must run BEFORE the declaration, because it refuses an aggregate that owes a
      // publication write. The narrow save must run AFTER it, because it is the only
      // writer of the record — and it must not re-carry the events the full save already
      // put in the outbox, which is a P2002 on the event id, not a duplicate row.
      const future = new Date(Date.now() + 7_200_000).toISOString();

      const result = await useCase.execute({
        postId: draftPost.id.value,
        channelIds: [channelId],
        scheduledFor: future,
      });

      expect(result.ok).toBe(true);
      const saves = repo.writes.filter((write) => write.save !== "dispatch");
      expect(saves.map((write) => write.save)).toEqual(["full", "narrow"]);
      expect(saves).toHaveLength(2);
      const [fullSave, narrowSave] = saves;
      expect(fullSave?.records).toBe(0);
      expect(narrowSave?.records).toBe(1);

      // SAVES only: the dispatch carries the same event ids the full save wrote, and it
      // is not an outbox write — counting it here would read the outbox contract's own
      // success as a duplicate.
      const everyOutboxWrite = saves.flatMap((write) => write.outbox);
      expect(everyOutboxWrite.length).toBeGreaterThan(0);
      expect(new Set(everyOutboxWrite).size).toBe(
        everyOutboxWrite.length,
        "no event id reaches the outbox twice"
      );
      expect(narrowSave?.outbox).toEqual([]);
    });
  });

  describe("the transaction seam", () => {
    let uow: ReturnType<typeof createRecordingUnitOfWork>;

    beforeEach(() => {
      uow = createRecordingUnitOfWork();
      // Rebuilt so the narrow save registers its discharge with THIS unit of work, the
      // way production's `savePublicationRecord` registers with the ambient transaction.
      repo = createMockPostRepository(uow.state.afterCommit);
      repo.store.set(draftPost.id.value, draftPost);
      dispatcher = createMockEventDispatcher(repo.writes);
      useCase = new SchedulePostUseCase(
        // canon-exception: test-fixture
        repo as any,
        // canon-exception: test-fixture
        dispatcher as any,
        // canon-exception: test-fixture
        channelRepo as any,
        createMockBusinessMetrics(),
        // No cast: the double implements the WHOLE `UnitOfWork` port, and typing it as
        // the port is what makes a future member of that port break this file.
        uow.port
      );
    });

    it("dispatches the events only AFTER the transaction has closed", async () => {
      // The dispatcher is not a database call. `ComposedEventDispatcher.dispatchAll`
      // runs the in-process handlers and then publishes a BullMQ batch, which is the
      // "external API call" ARCHITECTURE_CANON §UoW Rules forbids inside a transaction.
      // Inside it, the events reach consumers before the transaction that produced them
      // has committed — and anything fallible after the dispatch can still roll it back.
      const future = new Date(Date.now() + 7_200_000).toISOString();

      const result = await useCase.execute({
        postId: draftPost.id.value,
        channelIds: [channelId],
        scheduledFor: future,
      });

      expect(result.ok).toBe(true);
      expect(repo.writes.map((write) => write.save)).toEqual(["full", "narrow", "dispatch"]);
      expect(dispatcher.dispatchAll).toHaveBeenCalledOnce();
      expect(uow.state.resultCalls).toBe(1);
    });

    it("dispatches exactly the events the full save put in the outbox", async () => {
      // Read from the value the dispatch site reads `ok` from, rather than from an outer
      // mutable the callback assigned. The seam runs its callback exactly ONCE
      // (`PrismaUnitOfWork.executeInTransaction` calls `prisma.$transaction` once, at
      // `:104`, with no retry loop), so there is no second attempt to capture an empty
      // array — but the events still belong to the result, not to a variable beside it.
      const future = new Date(Date.now() + 7_200_000).toISOString();

      const result = await useCase.execute({
        postId: draftPost.id.value,
        channelIds: [channelId],
        scheduledFor: future,
      });

      expect(result.ok).toBe(true);
      const writes = repo.writes;
      const fullSave = writes.find((write) => write.save === "full");
      const dispatch = writes.find((write) => write.save === "dispatch");
      expect(fullSave?.outbox.length).toBeGreaterThan(0);
      expect(dispatch?.outbox).toEqual(fullSave?.outbox);
    });

    it("dispatches NOTHING when the transaction rolls back", async () => {
      // The phantom completion this closes: consumers told a post was scheduled, by a
      // transaction that then rolled the schedule back.
      repo.savePublication.mockResolvedValueOnce(err(new Error("records write failed")));
      const future = new Date(Date.now() + 7_200_000).toISOString();

      const result = await useCase.execute({
        postId: draftPost.id.value,
        channelIds: [channelId],
        scheduledFor: future,
      });

      expect(result.ok).toBe(false);
      expect(uow.state.rolledBack).toHaveLength(1);
      expect(dispatcher.dispatchAll).not.toHaveBeenCalled();
    });

    it("commits the schedule through the Result-aware seam", async () => {
      const future = new Date(Date.now() + 7_200_000).toISOString();

      const result = await useCase.execute({
        postId: draftPost.id.value,
        channelIds: [channelId],
        scheduledFor: future,
      });

      expect(result.ok).toBe(true);
      expect(uow.state.resultCalls).toBe(1);
      expect(uow.state.plainCalls).toBe(0);
    });

    it("aborts the transaction when the save fails, instead of resolving over the failure", async () => {
      // The save is multi-statement (post row, content, media, outbox), so a failure
      // raised after the first statement leaves a partial write. Handing the `err` back
      // as a resolved callback tells the unit of work the work succeeded and COMMITS
      // that partial write; the Result-aware seam rolls it back (ADR-0023).
      repo.save.mockResolvedValueOnce(err(new Error("connection reset")));
      const future = new Date(Date.now() + 7_200_000).toISOString();

      const result = await useCase.execute({
        postId: draftPost.id.value,
        channelIds: [channelId],
        scheduledFor: future,
      });

      expect(uow.state.rolledBack).toHaveLength(1);
      expect(uow.state.plainCalls).toBe(0);
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe(USE_CASE_ERRORS.INTERNAL_ERROR);
    });
  });
});

describe("DeletePostUseCase", () => {
  let useCase: DeletePostUseCase;
  let repo: ReturnType<typeof createMockPostRepository>;
  let draftPost: PostAggregate;

  // These behavior tests exercise the caller-agnostic delete mechanics (status
  // rules, validation, not-found). They use an explicit system caller so the
  // ownership gate is skipped — the gate itself is covered separately below.
  const SYSTEM_CALLER: DeletePostCaller = { type: "system", source: "unit-test" };

  beforeEach(() => {
    repo = createMockPostRepository();
    useCase = new DeletePostUseCase(repo as any, createMockBusinessMetrics());

    const createResult = PostAggregate.create({
      projectId: ProjectId.fromStringUnsafe(TEST_PROJECT_ID),
      body: "Post to delete",
    });
    expect(createResult.ok).toBe(true);
    if (!createResult.ok) return;
    draftPost = createResult.value;
    repo.store.set(draftPost.id.value, draftPost);
  });

  describe("success", () => {
    it("deletes a draft post", async () => {
      const result = await useCase.execute({ postId: draftPost.id.value, caller: SYSTEM_CALLER });
      expect(result.ok).toBe(true);
      expect(repo.delete).toHaveBeenCalled();
    });

    it("deletes a failed post", async () => {
      draftPost.startPublishing(["X"]);
      draftPost.markAsFailed("error", ["X"]);
      const result = await useCase.execute({ postId: draftPost.id.value, caller: SYSTEM_CALLER });
      expect(result.ok).toBe(true);
    });

    it("deletes a cancelled post", async () => {
      draftPost.cancel("no longer needed");
      const result = await useCase.execute({ postId: draftPost.id.value, caller: SYSTEM_CALLER });
      expect(result.ok).toBe(true);
    });
  });

  describe("business rules", () => {
    it("rejects deleting a SCHEDULED post", async () => {
      draftPost.schedule(new Date(Date.now() + 3_600_000));
      const result = await useCase.execute({ postId: draftPost.id.value, caller: SYSTEM_CALLER });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe(USE_CASE_ERRORS.FORBIDDEN);
    });

    it("rejects deleting a PUBLISHED post", async () => {
      draftPost.startPublishing(["X"]);
      draftPost.markAsPublished({ X: { success: true } });
      const result = await useCase.execute({ postId: draftPost.id.value, caller: SYSTEM_CALLER });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe(USE_CASE_ERRORS.FORBIDDEN);
    });
  });

  describe("validation", () => {
    it("rejects invalid postId", async () => {
      const result = await useCase.execute({ postId: "not-uuid", caller: SYSTEM_CALLER });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe(USE_CASE_ERRORS.VALIDATION_FAILED);
    });
  });

  describe("error handling", () => {
    it("returns NOT_FOUND for non-existent post", async () => {
      const result = await useCase.execute({
        postId: PostId.generate().value,
        caller: SYSTEM_CALLER,
      });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe(USE_CASE_ERRORS.NOT_FOUND);
    });
  });

  describe("ownership gate (CWE-639)", () => {
    const ownerAccount = AccountId.generate();

    it("returns NOT_FOUND and never deletes when the customer does not own the post", async () => {
      repo.findOwnerAccountId.mockResolvedValueOnce(ownerAccount);

      const result = await useCase.execute({
        postId: draftPost.id.value,
        caller: { type: "customer", accountId: AccountId.generate().value },
      });

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe(USE_CASE_ERRORS.NOT_FOUND);
      expect(repo.delete).not.toHaveBeenCalled();
      // Gate runs before load — findById is never reached on a foreign id.
      expect(repo.findById).not.toHaveBeenCalled();
    });

    it("returns NOT_FOUND when the post has no owner (findOwnerAccountId null)", async () => {
      repo.findOwnerAccountId.mockResolvedValueOnce(null);

      const result = await useCase.execute({
        postId: draftPost.id.value,
        caller: { type: "customer", accountId: ownerAccount.value },
      });

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe(USE_CASE_ERRORS.NOT_FOUND);
      expect(repo.delete).not.toHaveBeenCalled();
    });

    it("deletes when the customer owns the post", async () => {
      repo.findOwnerAccountId.mockResolvedValueOnce(ownerAccount);

      const result = await useCase.execute({
        postId: draftPost.id.value,
        caller: { type: "customer", accountId: ownerAccount.value },
      });

      expect(result.ok).toBe(true);
      expect(repo.delete).toHaveBeenCalled();
    });

    it("skips the gate for a system caller (findOwnerAccountId never consulted)", async () => {
      const result = await useCase.execute({
        postId: draftPost.id.value,
        caller: { type: "system", source: "PostPublishingSaga:Compensation" },
      });

      expect(result.ok).toBe(true);
      expect(repo.findOwnerAccountId).not.toHaveBeenCalled();
      expect(repo.delete).toHaveBeenCalled();
    });

    it("fails closed (throws) for an unknown caller variant", async () => {
      await expect(
        useCase.execute({
          postId: draftPost.id.value,
          caller: { type: "intruder" } as unknown as DeletePostCaller,
        })
      ).rejects.toThrow(/Unhandled delete caller type/);
      expect(repo.delete).not.toHaveBeenCalled();
    });
  });
});

describe("GetPostUseCase", () => {
  let useCase: GetPostUseCase;
  let queryRepo: ReturnType<typeof createMockQueryRepository>;

  beforeEach(() => {
    queryRepo = createMockQueryRepository();
    useCase = new GetPostUseCase(queryRepo as any);
  });

  describe("success", () => {
    it("returns the post read model", async () => {
      const postId = PostId.generate().value;
      queryRepo.store.set(postId, {
        id: postId,
        projectId: TEST_PROJECT_ID,
        body: "Hello",
        status: "DRAFT",
        locale: "en",
        tags: [],
        mediaCount: 0,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const result = await useCase.execute({ postId, callerAccountId: TEST_ACCOUNT_ID });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.id).toBe(postId);
      expect(result.value.body).toBe("Hello");
    });
  });

  describe("validation", () => {
    it("rejects invalid postId", async () => {
      const result = await useCase.execute({ postId: "bad-id", callerAccountId: TEST_ACCOUNT_ID });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe(USE_CASE_ERRORS.VALIDATION_FAILED);
    });
  });

  describe("error handling", () => {
    it("returns NOT_FOUND for unknown post", async () => {
      const result = await useCase.execute({
        postId: PostId.generate().value,
        callerAccountId: TEST_ACCOUNT_ID,
      });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe(USE_CASE_ERRORS.NOT_FOUND);
    });
  });
});

describe("ListPostsUseCase", () => {
  let useCase: ListPostsUseCase;
  let queryRepo: ReturnType<typeof createMockQueryRepository>;

  beforeEach(() => {
    queryRepo = createMockQueryRepository();
    useCase = new ListPostsUseCase(queryRepo as any);
  });

  describe("success", () => {
    it("returns paginated results", async () => {
      // Seed 3 posts
      for (let i = 0; i < 3; i++) {
        const id = PostId.generate().value;
        queryRepo.store.set(id, {
          id,
          projectId: TEST_PROJECT_ID,
          body: `Post ${i}`,
          status: "DRAFT",
          locale: "en",
          tags: [],
          mediaCount: 0,
          createdAt: new Date(),
          updatedAt: new Date(),
        });
      }

      const result = await useCase.execute({
        projectId: TEST_PROJECT_ID,
        callerAccountId: TEST_ACCOUNT_ID,
      });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.items).toHaveLength(3);
      expect(result.value.total).toBe(3);
    });

    it("respects page and limit parameters", async () => {
      for (let i = 0; i < 25; i++) {
        const id = PostId.generate().value;
        queryRepo.store.set(id, {
          id,
          projectId: TEST_PROJECT_ID,
          body: `Post ${i}`,
          status: "DRAFT",
          locale: "en",
          tags: [],
          mediaCount: 0,
          createdAt: new Date(),
          updatedAt: new Date(),
        });
      }

      const result = await useCase.execute({
        projectId: TEST_PROJECT_ID,
        callerAccountId: TEST_ACCOUNT_ID,
        page: 1,
        limit: 10,
      });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.items).toHaveLength(10);
      expect(result.value.hasNext).toBe(true);
      expect(result.value.totalPages).toBe(3);
    });

    it("caps limit at 100", async () => {
      const result = await useCase.execute({
        projectId: TEST_PROJECT_ID,
        callerAccountId: TEST_ACCOUNT_ID,
        limit: 500,
      });
      expect(result.ok).toBe(true);
      // The use case caps at 100, mock respects it. The caller account is the
      // second argument (CWE-639 scope), so pagination is the third.
      expect(queryRepo.listByProject).toHaveBeenCalledWith(
        expect.anything(),
        expect.anything(),
        expect.objectContaining({ limit: 100 }),
        undefined,
        undefined
      );
    });

    it("defaults page to 1 and limit to 20", async () => {
      await useCase.execute({ projectId: TEST_PROJECT_ID, callerAccountId: TEST_ACCOUNT_ID });
      expect(queryRepo.listByProject).toHaveBeenCalledWith(
        expect.anything(),
        expect.anything(),
        expect.objectContaining({ page: 1, limit: 20 }),
        undefined,
        undefined
      );
    });
  });

  describe("validation", () => {
    it("rejects invalid projectId", async () => {
      const result = await useCase.execute({
        projectId: "bad-id",
        callerAccountId: TEST_ACCOUNT_ID,
      });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe(USE_CASE_ERRORS.VALIDATION_FAILED);
    });
  });
});
