/**
 * @file PostAggregateMapper.ts
 * @description Maps between Prisma Post models (with relations) and the PostAggregate
 *              domain entity. Used by PrismaPostRepository for persistence hydration.
 * @layer infrastructure
 */

import type { Post, PostContent, PostMedia, ContentVersion, MediaKind } from "@infra/prisma";
import {
  PostAggregate,
  type PostAggregateState,
  PostId,
  ProjectId,
  MediaId,
  ContentId,
  Content,
  type ContentLocale,
  PublishStatus,
  type PublishStatusValue,
  ScheduledTime,
  MediaAttachment,
  type MediaType,
} from "../../../domain/index.js";

/**
 * Prisma Post with relations
 */
export interface PrismaPostWithRelations extends Post {
  contents: PostContent[];
  media: PostMedia[];
  contentVersions: ContentVersion[];
}

/**
 * Maps Prisma MediaKind to domain MediaType
 */
function mapMediaKind(kind: MediaKind): MediaType {
  switch (kind) {
    case "image":
      return "image";
    case "video":
      return "video";
    case "gif":
      return "gif";
    default:
      return "image";
  }
}

/**
 * Maps domain MediaType to Prisma MediaKind
 */
function mapMediaTypeToPrisma(type: MediaType): MediaKind {
  switch (type) {
    case "image":
      return "image";
    case "video":
      return "video";
    case "gif":
      return "gif";
    default:
      return "image";
  }
}

/**
 * PostAggregateMapper
 *
 * Handles bidirectional mapping between Prisma Post models
 * and domain PostAggregate instances.
 */
export class PostAggregateMapper {
  /**
   * Map Prisma Post with relations to domain PostAggregate
   */
  static toDomain(prismaPost: PrismaPostWithRelations): PostAggregate {
    // Get the primary content (most recent revision for default locale)
    const primaryContent = prismaPost.contents.sort((a, b) => b.revision - a.revision)[0];

    // Reconstitute Content from DB data — bypass empty-body validation since
    // the database is a trusted source. Posts without content records are valid
    // in the DB schema (e.g., bare posts created before content is added).
    const content = Content.reconstitute({
      body: primaryContent?.body ?? "",
      ...(primaryContent?.title && { title: primaryContent.title }),
      ...(primaryContent?.summary && { summary: primaryContent.summary }),
      tags: primaryContent?.tags ?? [],
      locale: (primaryContent?.locale ?? "en") as ContentLocale,
    });

    // Parse status
    const statusResult = PublishStatus.fromString(prismaPost.status);
    if (!statusResult.ok) {
      throw new Error(`Invalid status: ${prismaPost.status}`);
    }

    // Create ScheduledTime if present
    let scheduledAt: ScheduledTime | undefined;
    if (prismaPost.scheduledAt) {
      // For reconstitution, we bypass validation since the time may have passed
      scheduledAt = ScheduledTime.reconstitute(prismaPost.scheduledAt);
    }

    // Map media attachments
    const media: MediaAttachment[] = [];
    for (const prismaMedia of prismaPost.media) {
      const mediaResult = MediaAttachment.create({
        id: MediaId.fromStringUnsafe(prismaMedia.id),
        type: mapMediaKind(prismaMedia.type),
        url: prismaMedia.url,
        ...(prismaMedia.width !== null && { width: prismaMedia.width }),
        ...(prismaMedia.height !== null && { height: prismaMedia.height }),
        ...(prismaMedia.durationMs !== null && { durationMs: prismaMedia.durationMs }),
        ...(prismaMedia.alt !== null && { altText: prismaMedia.alt }),
        ...(prismaMedia.hash !== null && { hash: prismaMedia.hash }),
      });

      if (mediaResult.ok) {
        media.push(mediaResult.value);
      }
    }

    // Map content versions
    const contentVersions: ContentId[] = prismaPost.contentVersions.map((cv) =>
      ContentId.fromStringUnsafe(cv.id)
    );

    // Create aggregate state
    const state: PostAggregateState = {
      id: PostId.fromStringUnsafe(prismaPost.id),
      projectId: ProjectId.fromStringUnsafe(prismaPost.projectId),
      content,
      status: statusResult.value,
      ...(scheduledAt && { scheduledAt }),
      ...(prismaPost.publishedAt && { publishedAt: prismaPost.publishedAt }),
      media,
      contentVersions,
      createdAt: prismaPost.createdAt,
      updatedAt: prismaPost.updatedAt,
      version: 0, // Prisma doesn't track aggregate version, start at 0
    };

    return PostAggregate.reconstitute(state);
  }

  /**
   * Map domain PostAggregate to Prisma create input
   */
  static toPrismaCreate(aggregate: PostAggregate): {
    post: {
      id: string;
      projectId: string;
      status: string;
      scheduledAt: Date | null;
      publishedAt: Date | null;
    };
    content: {
      postId: string;
      locale: string;
      title: string | null;
      summary: string | null;
      body: string;
      tags: string[];
      revision: number;
    };
    media: Array<{
      id: string;
      postId: string;
      type: MediaKind;
      url: string;
      width: number | null;
      height: number | null;
      durationMs: number | null;
      alt: string | null;
      hash: string | null;
    }>;
  } {
    const content = aggregate.content;
    const mediaList = aggregate.media;

    return {
      post: {
        id: aggregate.id.value,
        projectId: aggregate.projectId.value,
        status: aggregate.status.value,
        scheduledAt: aggregate.scheduledAt?.dateTime ?? null,
        publishedAt: aggregate.publishedAt ?? null,
      },
      content: {
        postId: aggregate.id.value,
        locale: content.locale,
        title: content.title ?? null,
        summary: content.summary ?? null,
        body: content.body,
        tags: [...content.tags],
        revision: 1,
      },
      media: mediaList.map((m) => ({
        id: m.id.value,
        postId: aggregate.id.value,
        type: mapMediaTypeToPrisma(m.type),
        url: m.url,
        width: m.width ?? null,
        height: m.height ?? null,
        durationMs: m.durationMs ?? null,
        alt: m.altText ?? null,
        hash: m.hash ?? null,
      })),
    };
  }

  /**
   * Map domain PostAggregate to Prisma update input
   */
  static toPrismaUpdate(aggregate: PostAggregate): {
    post: {
      status: string;
      scheduledAt: Date | null;
      publishedAt: Date | null;
    };
    content: {
      locale: string;
      title: string | null;
      summary: string | null;
      body: string;
      tags: string[];
    };
  } {
    const content = aggregate.content;

    return {
      post: {
        status: aggregate.status.value,
        scheduledAt: aggregate.scheduledAt?.dateTime ?? null,
        publishedAt: aggregate.publishedAt ?? null,
      },
      content: {
        locale: content.locale,
        title: content.title ?? null,
        summary: content.summary ?? null,
        body: content.body,
        tags: [...content.tags],
      },
    };
  }

  /**
   * Map PostAggregate to PostReadModel for queries
   */
  static toReadModel(aggregate: PostAggregate): {
    id: string;
    projectId: string;
    title: string | undefined;
    body: string;
    status: PublishStatusValue;
    locale: string;
    tags: string[];
    mediaCount: number;
    scheduledAt: Date | undefined;
    publishedAt: Date | undefined;
    createdAt: Date;
    updatedAt: Date;
  } {
    return {
      id: aggregate.id.value,
      projectId: aggregate.projectId.value,
      title: aggregate.content.title,
      body: aggregate.content.body,
      status: aggregate.status.value,
      locale: aggregate.content.locale,
      tags: [...aggregate.content.tags],
      mediaCount: aggregate.media.length,
      scheduledAt: aggregate.scheduledAt?.dateTime,
      publishedAt: aggregate.publishedAt,
      createdAt: aggregate.createdAt,
      updatedAt: aggregate.updatedAt,
    };
  }
}
