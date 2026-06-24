/**
 * @file createCommentUseCaseTenantIsolation.test.ts
 * @description Cross-tenant (CWE-639 / IDOR-COMMENTS create-on-foreign-post)
 *              regression tests for CreateCommentUseCase. A caller authenticated
 *              as tenant B must not be able to comment on a post owned by tenant
 *              A. Comment -> Post -> Project -> accountId is transitively
 *              tenant-scoped, so the owner gate resolves the post's owner via
 *              `PostRepository.findOwnerAccountId` and rejects a foreign caller
 *              with NOT_FOUND (anti-enumeration) before any save.
 * @layer infrastructure
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { AccountId, PostId } from "@core/domain/index.js";
import type { PostRepository } from "@core/domain/index.js";
import type { PostCommentRepository } from "@core/domain/repositories/PostCommentRepository.js";
import type { UnitOfWork } from "@core/domain/repositories/Repository.js";
import { CreateCommentUseCase } from "@core/comments/CreateCommentUseCase.js";
import { USE_CASE_ERRORS } from "@core/application/UseCase.js";

const TENANT_A = AccountId.generate().value;
const TENANT_B = AccountId.generate().value;
const POST_A = PostId.generate().value;
const AUTHOR = "11111111-1111-4111-8111-111111111111";

const passthroughUow: UnitOfWork = { executeInTransaction: async (fn) => fn() };

function makeCommentRepo() {
  return {
    save: vi.fn(async () => undefined),
    findById: vi.fn(),
    findByPost: vi.fn(),
    findReplies: vi.fn(),
    softDelete: vi.fn(),
    countByPost: vi.fn(),
  } as unknown as PostCommentRepository;
}

/** Post repo whose only relevant behaviour is the ownership resolver. */
function makePostRepo(owner: string | null) {
  return {
    findOwnerAccountId: vi.fn(async () => (owner ? AccountId.fromStringUnsafe(owner) : null)),
  } as unknown as PostRepository;
}

describe("CreateCommentUseCase — tenant isolation (IDOR-COMMENTS create, CWE-639)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns not-found and performs no save when tenant B comments on tenant A's post", async () => {
    const commentRepo = makeCommentRepo();
    const postRepo = makePostRepo(TENANT_A);
    const useCase = new CreateCommentUseCase(commentRepo, postRepo, passthroughUow);

    const result = await useCase.execute({
      postId: POST_A,
      authorId: AUTHOR,
      body: "cross-tenant comment",
      callerAccountId: TENANT_B,
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe(USE_CASE_ERRORS.NOT_FOUND);
    expect(commentRepo.save).not.toHaveBeenCalled();
  });

  it("returns not-found when the target post does not exist", async () => {
    const commentRepo = makeCommentRepo();
    const postRepo = makePostRepo(null);
    const useCase = new CreateCommentUseCase(commentRepo, postRepo, passthroughUow);

    const result = await useCase.execute({
      postId: POST_A,
      authorId: AUTHOR,
      body: "into the void",
      callerAccountId: TENANT_B,
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe(USE_CASE_ERRORS.NOT_FOUND);
    expect(commentRepo.save).not.toHaveBeenCalled();
  });

  it("creates the comment when the owning tenant A comments on its own post", async () => {
    const commentRepo = makeCommentRepo();
    const postRepo = makePostRepo(TENANT_A);
    const useCase = new CreateCommentUseCase(commentRepo, postRepo, passthroughUow);

    const result = await useCase.execute({
      postId: POST_A,
      authorId: AUTHOR,
      body: "my own comment",
      callerAccountId: TENANT_A,
    });

    expect(result.ok).toBe(true);
    expect(commentRepo.save).toHaveBeenCalledOnce();
  });
});
