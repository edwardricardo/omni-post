/**
 * @file getPostCommentsQueryTenantIsolation.test.ts
 * @description Cross-tenant (CWE-639 / IDOR-COMMENTS read-foreign-post)
 *              regression tests for GetPostCommentsQuery. A caller authenticated
 *              as tenant B must never receive the comments of a post owned by
 *              tenant A. Comments are transitively tenant-scoped (comment ->
 *              post -> project -> accountId), so the query threads
 *              `callerAccountId` into the repository, which applies a
 *              `post: { project: { accountId } }` joined filter — a foreign post
 *              returns an empty page and a total count of 0.
 * @layer infrastructure
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { AccountId, PostId } from "@core/domain/index.js";
import type {
  PostCommentRepository,
  PostCommentFindOptions,
} from "@core/domain/repositories/PostCommentRepository.js";
import { PostCommentAggregate } from "@core/domain/aggregates/PostCommentAggregate.js";
import { CommentId } from "@core/domain/value-objects/CommentId.js";
import { GetPostCommentsQuery } from "@core/comments/GetPostCommentsQuery.js";

const TENANT_A = AccountId.generate().value;
const TENANT_B = AccountId.generate().value;
const POST_A = PostId.generate().value;

function makeComment(): PostCommentAggregate {
  return PostCommentAggregate.reconstitute({
    id: CommentId.fromStringUnsafe("c1111111-1111-4111-8111-111111111111"),
    postId: POST_A,
    authorId: "a1111111-1111-4111-8111-111111111111",
    body: "tenant A's private comment",
    mentions: [],
    isEdited: false,
    createdAt: new Date("2025-01-01T00:00:00.000Z"),
    updatedAt: new Date("2025-01-01T00:00:00.000Z"),
    version: 0,
  });
}

/**
 * Repo mock whose `findByPost`/`countByPost` honour the joined-filter gate:
 * when `callerAccountId` is present and does not match the post's owner, the
 * post's comments are invisible (empty page, zero count).
 */
function makeRepo(postOwner: string): PostCommentRepository {
  const all = [makeComment()];
  const visibleTo = (callerAccountId?: AccountId): boolean =>
    !callerAccountId || callerAccountId.value === postOwner;
  return {
    findById: vi.fn(),
    findByPost: vi.fn(
      async (_postId: string, _options: PostCommentFindOptions, callerAccountId?: AccountId) => ({
        items: visibleTo(callerAccountId) ? all : [],
      })
    ),
    findReplies: vi.fn(async () => []),
    save: vi.fn(),
    softDelete: vi.fn(),
    countByPost: vi.fn(async (_postId: string, callerAccountId?: AccountId) =>
      visibleTo(callerAccountId) ? all.length : 0
    ),
  } as unknown as PostCommentRepository;
}

describe("GetPostCommentsQuery — tenant isolation (IDOR-COMMENTS read, CWE-639)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns an empty page and zero count when tenant B reads tenant A's post comments", async () => {
    const repo = makeRepo(TENANT_A);
    const query = new GetPostCommentsQuery(repo);

    const result = await query.execute({ postId: POST_A, callerAccountId: TENANT_B });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.items).toHaveLength(0);
    expect(result.value.totalCount).toBe(0);
  });

  it("returns the comments when the owning tenant A reads its own post comments", async () => {
    const repo = makeRepo(TENANT_A);
    const query = new GetPostCommentsQuery(repo);

    const result = await query.execute({ postId: POST_A, callerAccountId: TENANT_A });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.items).toHaveLength(1);
    expect(result.value.totalCount).toBe(1);
  });

  it("threads callerAccountId into both findByPost and countByPost", async () => {
    const repo = makeRepo(TENANT_A);
    const query = new GetPostCommentsQuery(repo);

    await query.execute({ postId: POST_A, callerAccountId: TENANT_A });

    const findCall = (repo.findByPost as ReturnType<typeof vi.fn>).mock.calls[0];
    const countCall = (repo.countByPost as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(findCall?.[2]).toBeInstanceOf(AccountId);
    expect((findCall?.[2] as AccountId).value).toBe(TENANT_A);
    expect((countCall?.[1] as AccountId).value).toBe(TENANT_A);
  });
});
