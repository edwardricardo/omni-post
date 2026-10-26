/**
 * @file postRepositoryStoredValues.test.ts
 * @description Pins how the post repository and the post aggregate mapper read and write the
 *              values Postgres constrains: a stored content locale outside CONTENT_LOCALES fails
 *              the read with the InvalidValueError that names the PostContent row and the value
 *              (logged, then DATABASE_ERROR, where the repository answers a Result), and a media
 *              kind is written as the lowercase `MediaKind` value the column holds. Tier 0: a
 *              mocked PrismaClient shaped as Postgres answers each query, no database.
 * @layer infrastructure
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import assert from "node:assert/strict";
import type { PrismaClient } from "@infra/prisma";
import { InvalidValueError } from "@core/domain/index.js";
import { createPostRepository } from "../src/PostRepository.js";
import {
  PostAggregateMapper,
  type PrismaPostWithRelations,
} from "../src/post/PostAggregateMapper.js";

// The repository creates its logger at module scope, so the spy is installed through
// the factory it imports rather than injected.
const { loggerError } = vi.hoisted(() => ({ loggerError: vi.fn() }));
vi.mock("@observability/logger", () => ({
  createLogger: () => ({ error: loggerError, warn: vi.fn(), info: vi.fn(), debug: vi.fn() }),
}));

const NOW = new Date("2026-09-01T12:00:00Z");
const CONTENT_ID = "pc-1";
const FR_MESSAGE = `PostContent ${CONTENT_ID} holds locale "fr", which is not a content locale (en, es)`;

const PASS_THROUGH = { fire: (operation: () => Promise<unknown>) => operation() };

/**
 * @description A PostContent row as Postgres returns it.
 * @param locale - The locale the row holds.
 * @returns The row.
 */
function contentRow(locale: string) {
  return {
    id: CONTENT_ID,
    postId: "post-1",
    accountId: "acc-1",
    locale,
    title: null,
    summary: null,
    body: "post body",
    tags: [],
    revision: 1,
    createdAt: NOW,
    updatedAt: NOW,
  };
}

/**
 * @description A live Post row with one content row in the given locale.
 * @param locale - The locale of its content row.
 * @returns The row, with its contents and media included.
 */
function postRow(locale: string) {
  return {
    id: "post-1",
    projectId: "proj-1",
    accountId: "acc-1",
    status: "DRAFT",
    scheduledAt: null,
    publishedAt: null,
    archivedAt: null,
    deletedAt: null,
    createdAt: NOW,
    updatedAt: NOW,
    contents: [contentRow(locale)],
    media: [],
  };
}

/**
 * @description A client whose post reads answer `row`, with a live parent chain.
 * @param row - The post row every post read returns.
 * @returns The client.
 */
function clientReading(row: ReturnType<typeof postRow>) {
  const parentTx = {
    project: { findUnique: vi.fn(async () => ({ deletedAt: null, account: { deletedAt: null } })) },
    $executeRaw: vi.fn(async () => 1),
  };
  return {
    post: {
      findUnique: vi.fn(async () => row),
      findMany: vi.fn(async () => [row]),
      count: vi.fn(async () => 1),
    },
    $transaction: vi.fn(async (fn: (tx: typeof parentTx) => Promise<unknown>) => fn(parentTx)),
  } as unknown as PrismaClient;
}

describe("PostRepository — a stored content locale", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("getPostById reads a post in es with its locale", async () => {
    const repository = createPostRepository(PASS_THROUGH, clientReading(postRow("es")));

    const result = await repository.getPostById("post-1");

    assert.ok(result.ok);
    expect(result.value.locale).toBe("es");
    expect(loggerError).not.toHaveBeenCalled();
  });

  it("getPostById answers DATABASE_ERROR for a post in fr, logging the error that names the row", async () => {
    const repository = createPostRepository(PASS_THROUGH, clientReading(postRow("fr")));

    const result = await repository.getPostById("post-1");

    expect(result).toEqual({ ok: false, error: "DATABASE_ERROR" });
    expect(loggerError).toHaveBeenCalledTimes(1);
    const [context, message] = loggerError.mock.calls[0] as [{ err: unknown }, string];
    expect(message).toBe("getPostById error");
    expect(context.err).toBeInstanceOf(InvalidValueError);
    expect(context.err).toMatchObject({ field: "locale", value: "fr", message: FR_MESSAGE });
  });

  it("listPosts answers DATABASE_ERROR when a listed post is in fr, logging the error that names the row", async () => {
    const repository = createPostRepository(PASS_THROUGH, clientReading(postRow("fr")));

    const result = await repository.listPosts({ limit: 10, offset: 0 });

    expect(result).toEqual({ ok: false, error: "DATABASE_ERROR" });
    expect(loggerError).toHaveBeenCalledTimes(1);
    const [context, message] = loggerError.mock.calls[0] as [{ err: unknown }, string];
    expect(message).toBe("listPosts error");
    expect(context.err).toMatchObject({ field: "locale", value: "fr", message: FR_MESSAGE });
  });
});

describe("PostRepository — media rows", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("createPost writes each media kind as the lowercase MediaKind value and returns the post in its locale", async () => {
    const postMediaCreate = vi.fn(async ({ data }: { data: Record<string, unknown> }) => ({
      id: "m-1",
      width: null,
      height: null,
      durationMs: null,
      alt: null,
      ...data,
    }));
    const tx = {
      project: { findFirst: vi.fn(async () => ({ accountId: "acc-1" })) },
      post: {
        create: vi.fn(async () => ({
          id: "post-1",
          projectId: "proj-1",
          accountId: "acc-1",
          scheduledAt: null,
        })),
      },
      postContent: { create: vi.fn(async () => contentRow("es")) },
      postMedia: { create: postMediaCreate },
    };
    const client = {
      $transaction: vi.fn(async (fn: (client: typeof tx) => Promise<unknown>) => fn(tx)),
    } as unknown as PrismaClient;
    const repository = createPostRepository(PASS_THROUGH, client);

    const result = await repository.createPost({
      projectId: "proj-1",
      locale: "es",
      body: "post body",
      media: [{ id: "m-1", type: "image", url: "https://cdn.example.com/a.jpg", w: 1080 }],
    });

    expect(postMediaCreate).toHaveBeenCalledWith({
      data: {
        postId: "post-1",
        accountId: "acc-1",
        url: "https://cdn.example.com/a.jpg",
        type: "image",
        width: 1080,
      },
    });
    assert.ok(result.ok);
    expect(result.value.locale).toBe("es");
    expect(result.value.media).toEqual([
      { id: "m-1", type: "image", url: "https://cdn.example.com/a.jpg", w: 1080 },
    ]);
  });

  it("addMediaToPost writes the media kind as the lowercase MediaKind value", async () => {
    const postMediaCreate = vi.fn(async () => ({}));
    const client = {
      post: { findUnique: vi.fn(async () => ({ id: "post-1", accountId: "acc-1" })) },
      postMedia: { create: postMediaCreate },
    } as unknown as PrismaClient;
    const repository = createPostRepository(PASS_THROUGH, client);

    const result = await repository.addMediaToPost("post-1", {
      id: "m-2",
      type: "video",
      url: "https://cdn.example.com/b.mp4",
      durationMs: 4000,
    });

    expect(result).toEqual({ ok: true, value: undefined });
    expect(postMediaCreate).toHaveBeenCalledWith({
      data: {
        postId: "post-1",
        accountId: "acc-1",
        url: "https://cdn.example.com/b.mp4",
        type: "video",
        durationMs: 4000,
      },
    });
  });
});

describe("PostAggregateMapper.toDomain — the stored content locale", () => {
  /**
   * @description A Post row with relations, holding the given content rows.
   * @param contents - Its PostContent rows.
   * @returns The row the mapper reads.
   */
  function aggregateRow(contents: ReturnType<typeof contentRow>[]): PrismaPostWithRelations {
    return {
      ...postRow("es"),
      version: 0,
      contents,
      media: [],
      contentVersions: [],
    } as unknown as PrismaPostWithRelations;
  }

  it("maps the latest content revision's locale onto the aggregate", () => {
    const aggregate = PostAggregateMapper.toDomain(aggregateRow([contentRow("es")]));

    expect(aggregate.content.locale).toBe("es");
  });

  it("maps a post with no content row to en", () => {
    const aggregate = PostAggregateMapper.toDomain(aggregateRow([]));

    expect(aggregate.content.locale).toBe("en");
  });

  it("throws the InvalidValueError that names the content row when its locale is fr", () => {
    expect(() => PostAggregateMapper.toDomain(aggregateRow([contentRow("fr")]))).toThrowError(
      FR_MESSAGE
    );
    expect(() => PostAggregateMapper.toDomain(aggregateRow([contentRow("fr")]))).toThrowError(
      InvalidValueError
    );
  });
});
