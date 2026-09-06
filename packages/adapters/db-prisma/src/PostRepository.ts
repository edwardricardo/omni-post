/**
 * @file PostRepository.ts
 * @description Prisma-backed repository for Post entities — create, list, get-by-id, and
 *              update operations with circuit-breaker protection for transactional writes.
 * @layer infrastructure
 */
import { ok, err, type Result, type CanonicalPost, type Media } from "@shared/types";
import type { CreatePostInput, ListPostsQuery, PostsPage } from "@ports/core";
import type { PrismaClient, MediaKind } from "@infra/prisma";
import { createLogger } from "@observability/logger";

const logger = createLogger("adapter:db-prisma:post");

export function createPostRepository(
  transactionBreaker: {
    fire: (fn: () => Promise<unknown>) => Promise<unknown>;
  },
  prisma: PrismaClient
) {
  return {
    async getPostById(
      id: string
    ): Promise<Result<CanonicalPost, "NOT_FOUND" | "SOFT_DELETED" | "DATABASE_ERROR">> {
      try {
        // DELIBERATE soft-delete-sweep exception: this read must SEE soft-deleted
        // rows. The publish worker needs "SOFT_DELETED" (terminal no-op — retrying
        // would republish on a later restore) to be distinguishable from
        // "NOT_FOUND" (absent row), and a `deletedAt: null` where-filter would
        // collapse both into null. Liveness of the WHOLE chain
        // (post → project → account) is classified below instead.
        const post = await prisma.post.findUnique({
          where: { id },
          include: {
            contents: {
              orderBy: [{ revision: "desc" }, { updatedAt: "desc" }],
              take: 1,
            },
            media: true,
            project: { select: { deletedAt: true, account: { select: { deletedAt: true } } } },
          },
        });

        if (!post) {
          return err("NOT_FOUND");
        }

        // The chain is live only when every link is. Dropping the `project`
        // include above removes these properties from the row TYPE, so the
        // classification cannot silently outlive its inputs.
        const chainIsLive =
          post.deletedAt === null &&
          post.project.deletedAt === null &&
          post.project.account.deletedAt === null;
        if (!chainIsLive) {
          return err("SOFT_DELETED");
        }

        if (post.contents.length === 0) {
          return err("NOT_FOUND");
        }

        const content = post.contents[0]!; // Safe because we checked length above
        const canonical: CanonicalPost = {
          id: post.id,
          projectId: post.projectId,
          locale: content.locale as "es" | "en",
          ...(content.title ? { title: content.title } : {}),
          ...(content.summary ? { summary: content.summary } : {}),
          body: content.body,
          tags: content.tags,
          media: post.media.map((m) => ({
            id: m.id,
            type: m.type as "image" | "video" | "gif",
            url: m.url,
            ...(m.width ? { w: m.width } : {}),
            ...(m.height ? { h: m.height } : {}),
            ...(m.durationMs ? { durationMs: m.durationMs } : {}),
            ...(m.alt ? { alt: m.alt } : {}),
          })),
          ...(post.scheduledAt ? { scheduledAt: post.scheduledAt } : {}),
        };

        return ok(canonical);
      } catch (error) {
        logger.error({ err: error }, "getPostById error");
        return err("DATABASE_ERROR");
      }
    },

    async createPost(input: CreatePostInput): Promise<Result<CanonicalPost, "DATABASE_ERROR">> {
      try {
        // Create Post with PostContent and PostMedia in a transaction with circuit breaker
        const result = await transactionBreaker.fire(() => {
          return prisma.$transaction(async (tx) => {
            // Create the main Post record
            const post = await tx.post.create({
              data: {
                projectId: input.projectId,
                status: "DRAFT",
                ...(input.scheduledAt ? { scheduledAt: input.scheduledAt } : {}),
              },
            });

            // Create PostContent record
            const content = await tx.postContent.create({
              data: {
                postId: post.id,
                locale: input.locale,
                ...(input.title ? { title: input.title } : {}),
                ...(input.summary ? { summary: input.summary } : {}),
                body: input.body,
                tags: input.tags ?? [],
                revision: 1,
              },
            });

            // Create PostMedia records if provided
            const mediaRecords = [];
            if (input.media && input.media.length > 0) {
              for (const media of input.media) {
                const mediaRecord = await tx.postMedia.create({
                  data: {
                    postId: post.id,
                    url: media.url,
                    type: media.type.toUpperCase() as MediaKind,
                    ...(media.w ? { width: media.w } : {}),
                    ...(media.h ? { height: media.h } : {}),
                    ...(media.durationMs ? { durationMs: media.durationMs } : {}),
                    ...(media.alt ? { alt: media.alt } : {}),
                  },
                });
                mediaRecords.push(mediaRecord);
              }
            }

            return { post, content, media: mediaRecords };
          });
        });

        // Transform to CanonicalPost format
        const txResult = result as {
          post: { id: string; projectId: string; scheduledAt: Date | null };
          content: {
            locale: string;
            title: string | null;
            summary: string | null;
            body: string;
            tags: string[];
          };
          media: Array<{
            id: string;
            type: string;
            url: string;
            width: number | null;
            height: number | null;
            durationMs: number | null;
            alt: string | null;
          }>;
        };
        const canonical: CanonicalPost = {
          id: txResult.post.id,
          projectId: txResult.post.projectId,
          locale: txResult.content.locale as "es" | "en",
          ...(txResult.content.title ? { title: txResult.content.title } : {}),
          ...(txResult.content.summary ? { summary: txResult.content.summary } : {}),
          body: txResult.content.body,
          tags: txResult.content.tags,
          media: txResult.media.map((m) => ({
            id: m.id,
            type: m.type.toLowerCase() as "image" | "video" | "gif",
            url: m.url,
            ...(m.width != null ? { w: m.width } : {}),
            ...(m.height != null ? { h: m.height } : {}),
            ...(m.durationMs != null ? { durationMs: m.durationMs } : {}),
            ...(m.alt != null ? { alt: m.alt } : {}),
          })),
          ...(txResult.post.scheduledAt ? { scheduledAt: txResult.post.scheduledAt } : {}),
        };

        return ok(canonical);
      } catch (error) {
        logger.error({ err: error }, "createPost error");
        return err("DATABASE_ERROR");
      }
    },

    async listPosts(query: ListPostsQuery): Promise<Result<PostsPage, "DATABASE_ERROR">> {
      try {
        const where: Record<string, unknown> = {};

        if (query.projectId) where.projectId = query.projectId;
        if (query.status) where.status = query.status;

        const limit = Math.min(query.limit ?? 50, 100);
        const offset = query.offset ?? 0;

        // Get total count
        const total = await prisma.post.count({ where });

        // Get posts with latest content
        const posts = await prisma.post.findMany({
          where,
          include: {
            contents: {
              orderBy: [{ revision: "desc" }, { updatedAt: "desc" }],
              take: 1,
            },
            media: true,
          },
          orderBy: { createdAt: "desc" },
          take: limit,
          skip: offset,
        });

        const canonicalPosts: CanonicalPost[] = posts.map((post) => {
          const content = post.contents[0]!; // Safe: query includes contents
          return {
            id: post.id,
            projectId: post.projectId,
            locale: content.locale as "es" | "en",
            ...(content.title ? { title: content.title } : {}),
            ...(content.summary ? { summary: content.summary } : {}),
            body: content.body,
            tags: content.tags,
            media: post.media.map((m) => ({
              id: m.id,
              type: m.type.toLowerCase() as "image" | "video" | "gif",
              url: m.url,
              ...(m.width ? { w: m.width } : {}),
              ...(m.height ? { h: m.height } : {}),
              ...(m.durationMs ? { durationMs: m.durationMs } : {}),
              ...(m.alt ? { alt: m.alt } : {}),
            })),
            ...(post.scheduledAt ? { scheduledAt: post.scheduledAt } : {}),
          };
        });

        const result: PostsPage = {
          posts: canonicalPosts,
          total,
          limit,
          offset,
        };

        return ok(result);
      } catch (error) {
        logger.error({ err: error }, "listPosts error");
        return err("DATABASE_ERROR");
      }
    },

    async addMediaToPost(
      postId: string,
      media: Media
    ): Promise<Result<void, "NOT_FOUND" | "DATABASE_ERROR">> {
      try {
        // Check if post exists
        const post = await prisma.post.findUnique({ where: { id: postId } });
        if (!post) {
          return err("NOT_FOUND");
        }

        // Add media to post
        await prisma.postMedia.create({
          data: {
            postId,
            url: media.url,
            type: media.type.toUpperCase() as MediaKind,
            ...(media.w ? { width: media.w } : {}),
            ...(media.h ? { height: media.h } : {}),
            ...(media.durationMs ? { durationMs: media.durationMs } : {}),
            ...(media.alt ? { alt: media.alt } : {}),
          },
        });

        return ok(undefined);
      } catch (error) {
        logger.error({ err: error }, "addMediaToPost error");
        return err("DATABASE_ERROR");
      }
    },
  };
}
