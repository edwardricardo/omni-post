/**
 * @file ThreadRepository.ts
 * @description Prisma-backed repository for Thread and Tweet entities — create, update,
 *              list, and status transition operations with strategy mapping.
 * @layer infrastructure
 */
import { ok, err, type Result, type Thread, type Tweet } from "@shared/types";
import type { CreateThreadInput, CreateTweetInput, UpdateTweetInput } from "@ports/core";
import { prisma, type ThreadStrategy as PrismaThreadStrategy } from "@infra/prisma";
import {
  mapThreadStrategyFromDB,
  mapThreadStrategyToDB,
  mapTweetStatusFromDB,
  mapTweetStatusToDB,
} from "./mappers.js";
import { createLogger } from "@observability/logger";

const logger = createLogger("adapter:db-prisma:thread");

export function createThreadRepository() {
  return {
    async createThread(
      input: CreateThreadInput
    ): Promise<Result<Thread, "POST_NOT_FOUND" | "THREAD_EXISTS" | "DATABASE_ERROR">> {
      try {
        // Check if post exists
        const post = await prisma.post.findUnique({ where: { id: input.postId } });
        if (!post) {
          return err("POST_NOT_FOUND");
        }

        // Check if thread already exists for this post
        const existingThread = await prisma.thread.findUnique({ where: { postId: input.postId } });
        if (existingThread) {
          return err("THREAD_EXISTS");
        }

        const thread = await prisma.thread.create({
          data: {
            postId: input.postId,
            strategy: mapThreadStrategyToDB(input.strategy) as PrismaThreadStrategy,
          },
          include: {
            tweets: {
              orderBy: { sequenceNumber: "asc" },
            },
          },
        });

        const result: Thread = {
          id: thread.id,
          postId: thread.postId,
          strategy: mapThreadStrategyFromDB(thread.strategy),
          tweets: thread.tweets.map((t) => ({
            id: t.id,
            threadId: t.threadId,
            sequenceNumber: t.sequenceNumber,
            content: t.content,
            ...(t.media ? { media: JSON.parse(JSON.stringify(t.media)) } : {}),
            ...(t.tweetId ? { tweetId: t.tweetId } : {}),
            ...(t.parentTweetId ? { parentTweetId: t.parentTweetId } : {}),
            status: mapTweetStatusFromDB(t.status),
            ...(t.publishedAt ? { publishedAt: t.publishedAt } : {}),
            createdAt: t.createdAt,
            updatedAt: t.updatedAt,
          })),
          createdAt: thread.createdAt,
          updatedAt: thread.updatedAt,
        };

        return ok(result);
      } catch (error) {
        logger.error({ err: error }, "createThread error");
        return err("DATABASE_ERROR");
      }
    },

    async getThreadByPostId(postId: string): Promise<Result<Thread | null, "DATABASE_ERROR">> {
      try {
        const thread = await prisma.thread.findUnique({
          where: { postId },
          include: {
            tweets: {
              orderBy: { sequenceNumber: "asc" },
            },
          },
        });

        if (!thread) {
          return ok(null);
        }

        const result: Thread = {
          id: thread.id,
          postId: thread.postId,
          strategy: mapThreadStrategyFromDB(thread.strategy),
          tweets: thread.tweets.map((t) => ({
            id: t.id,
            threadId: t.threadId,
            sequenceNumber: t.sequenceNumber,
            content: t.content,
            ...(t.media ? { media: JSON.parse(JSON.stringify(t.media)) } : {}),
            ...(t.tweetId ? { tweetId: t.tweetId } : {}),
            ...(t.parentTweetId ? { parentTweetId: t.parentTweetId } : {}),
            status: mapTweetStatusFromDB(t.status),
            ...(t.publishedAt ? { publishedAt: t.publishedAt } : {}),
            createdAt: t.createdAt,
            updatedAt: t.updatedAt,
          })),
          createdAt: thread.createdAt,
          updatedAt: thread.updatedAt,
        };

        return ok(result);
      } catch (error) {
        logger.error({ err: error }, "getThreadByPostId error");
        return err("DATABASE_ERROR");
      }
    },

    async getThreadById(threadId: string): Promise<Result<Thread, "NOT_FOUND" | "DATABASE_ERROR">> {
      try {
        const thread = await prisma.thread.findUnique({
          where: { id: threadId },
          include: {
            tweets: {
              orderBy: { sequenceNumber: "asc" },
            },
          },
        });

        if (!thread) {
          return err("NOT_FOUND");
        }

        const result: Thread = {
          id: thread.id,
          postId: thread.postId,
          strategy: mapThreadStrategyFromDB(thread.strategy),
          tweets: thread.tweets.map((t) => ({
            id: t.id,
            threadId: t.threadId,
            sequenceNumber: t.sequenceNumber,
            content: t.content,
            ...(t.media ? { media: JSON.parse(JSON.stringify(t.media)) } : {}),
            ...(t.tweetId ? { tweetId: t.tweetId } : {}),
            ...(t.parentTweetId ? { parentTweetId: t.parentTweetId } : {}),
            status: mapTweetStatusFromDB(t.status),
            ...(t.publishedAt ? { publishedAt: t.publishedAt } : {}),
            createdAt: t.createdAt,
            updatedAt: t.updatedAt,
          })),
          createdAt: thread.createdAt,
          updatedAt: thread.updatedAt,
        };

        return ok(result);
      } catch (error) {
        logger.error({ err: error }, "getThreadById error");
        return err("DATABASE_ERROR");
      }
    },

    async deleteThread(threadId: string): Promise<Result<void, "NOT_FOUND" | "DATABASE_ERROR">> {
      try {
        const thread = await prisma.thread.findUnique({ where: { id: threadId } });
        if (!thread) {
          return err("NOT_FOUND");
        }

        // Cascade delete is handled by the database schema
        await prisma.thread.delete({ where: { id: threadId } });
        return ok(undefined);
      } catch (error) {
        logger.error({ err: error }, "deleteThread error");
        return err("DATABASE_ERROR");
      }
    },

    // Tweet management methods
    async createTweet(
      input: CreateTweetInput
    ): Promise<Result<Tweet, "THREAD_NOT_FOUND" | "SEQUENCE_EXISTS" | "DATABASE_ERROR">> {
      try {
        // Check if thread exists
        const thread = await prisma.thread.findUnique({ where: { id: input.threadId } });
        if (!thread) {
          return err("THREAD_NOT_FOUND");
        }

        // Check if sequence number already exists
        const existingTweet = await prisma.tweet.findUnique({
          where: {
            threadId_sequenceNumber: {
              threadId: input.threadId,
              sequenceNumber: input.sequenceNumber,
            },
          },
        });
        if (existingTweet) {
          return err("SEQUENCE_EXISTS");
        }

        const tweet = await prisma.tweet.create({
          data: {
            threadId: input.threadId,
            sequenceNumber: input.sequenceNumber,
            content: input.content,
            media: input.media ? JSON.parse(JSON.stringify(input.media)) : null,
            status: mapTweetStatusToDB("PENDING"),
          },
        });

        const result: Tweet = {
          id: tweet.id,
          threadId: tweet.threadId,
          sequenceNumber: tweet.sequenceNumber,
          content: tweet.content,
          ...(tweet.media ? { media: JSON.parse(JSON.stringify(tweet.media)) } : {}),
          ...(tweet.tweetId ? { tweetId: tweet.tweetId } : {}),
          ...(tweet.parentTweetId ? { parentTweetId: tweet.parentTweetId } : {}),
          status: mapTweetStatusFromDB(tweet.status),
          ...(tweet.publishedAt ? { publishedAt: tweet.publishedAt } : {}),
          createdAt: tweet.createdAt,
          updatedAt: tweet.updatedAt,
        };

        return ok(result);
      } catch (error) {
        logger.error({ err: error }, "createTweet error");
        return err("DATABASE_ERROR");
      }
    },

    async updateTweet(
      tweetId: string,
      input: UpdateTweetInput
    ): Promise<Result<Tweet, "NOT_FOUND" | "DATABASE_ERROR">> {
      try {
        const tweet = await prisma.tweet.findUnique({ where: { id: tweetId } });
        if (!tweet) {
          return err("NOT_FOUND");
        }

        const updateData: Record<string, unknown> = {
          status: mapTweetStatusToDB(input.status),
        };
        if (input.tweetId !== undefined) updateData.tweetId = input.tweetId;
        if (input.parentTweetId !== undefined) updateData.parentTweetId = input.parentTweetId;
        if (input.publishedAt !== undefined) updateData.publishedAt = input.publishedAt;

        const updatedTweet = await prisma.tweet.update({
          where: { id: tweetId },
          data: updateData,
        });

        const result: Tweet = {
          id: updatedTweet.id,
          threadId: updatedTweet.threadId,
          sequenceNumber: updatedTweet.sequenceNumber,
          content: updatedTweet.content,
          ...(updatedTweet.media ? { media: JSON.parse(JSON.stringify(updatedTweet.media)) } : {}),
          ...(updatedTweet.tweetId ? { tweetId: updatedTweet.tweetId } : {}),
          ...(updatedTweet.parentTweetId ? { parentTweetId: updatedTweet.parentTweetId } : {}),
          status: mapTweetStatusFromDB(updatedTweet.status),
          ...(updatedTweet.publishedAt ? { publishedAt: updatedTweet.publishedAt } : {}),
          createdAt: updatedTweet.createdAt,
          updatedAt: updatedTweet.updatedAt,
        };

        return ok(result);
      } catch (error) {
        logger.error({ err: error }, "updateTweet error");
        return err("DATABASE_ERROR");
      }
    },

    async getTweetsByThread(threadId: string): Promise<Result<Tweet[], "DATABASE_ERROR">> {
      try {
        const tweets = await prisma.tweet.findMany({
          where: { threadId },
          orderBy: { sequenceNumber: "asc" },
        });

        const result: Tweet[] = tweets.map((t) => ({
          id: t.id,
          threadId: t.threadId,
          sequenceNumber: t.sequenceNumber,
          content: t.content,
          ...(t.media ? { media: JSON.parse(JSON.stringify(t.media)) } : {}),
          ...(t.tweetId ? { tweetId: t.tweetId } : {}),
          ...(t.parentTweetId ? { parentTweetId: t.parentTweetId } : {}),
          status: mapTweetStatusFromDB(t.status),
          ...(t.publishedAt ? { publishedAt: t.publishedAt } : {}),
          createdAt: t.createdAt,
          updatedAt: t.updatedAt,
        }));

        return ok(result);
      } catch (error) {
        logger.error({ err: error }, "getTweetsByThread error");
        return err("DATABASE_ERROR");
      }
    },

    async getTweetById(tweetId: string): Promise<Result<Tweet, "NOT_FOUND" | "DATABASE_ERROR">> {
      try {
        const tweet = await prisma.tweet.findUnique({ where: { id: tweetId } });
        if (!tweet) {
          return err("NOT_FOUND");
        }

        const result: Tweet = {
          id: tweet.id,
          threadId: tweet.threadId,
          sequenceNumber: tweet.sequenceNumber,
          content: tweet.content,
          ...(tweet.media ? { media: JSON.parse(JSON.stringify(tweet.media)) } : {}),
          ...(tweet.tweetId ? { tweetId: tweet.tweetId } : {}),
          ...(tweet.parentTweetId ? { parentTweetId: tweet.parentTweetId } : {}),
          status: mapTweetStatusFromDB(tweet.status),
          ...(tweet.publishedAt ? { publishedAt: tweet.publishedAt } : {}),
          createdAt: tweet.createdAt,
          updatedAt: tweet.updatedAt,
        };

        return ok(result);
      } catch (error) {
        logger.error({ err: error }, "getTweetById error");
        return err("DATABASE_ERROR");
      }
    },
  };
}
