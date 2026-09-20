/**
 * @file PostAggregateMapper.ts
 * @description Maps between Prisma Post models (with relations) and the PostAggregate
 *              domain entity. Used by PrismaPostRepository for persistence hydration.
 * @layer infrastructure
 */

import type {
  Post,
  PostContent,
  PostMedia,
  ContentVersion,
  MediaKind,
  PostChannelPublication,
  Provider,
} from "@infra/prisma";
import { type Result, ok, err } from "@shared/types";
import {
  PostAggregate,
  type PostAggregateState,
  PostId,
  ProjectId,
  ChannelId,
  MediaId,
  ContentId,
  Content,
  type ContentLocale,
  PublishStatus,
  type PublishStatusValue,
  ScheduledTime,
  MediaAttachment,
  type MediaType,
  ChannelPublication,
  ContentFingerprint,
  ExclusionReason,
  FragmentReference,
  providedReference,
  noneReturnedReference,
  type ChannelFailureCode,
  type ChannelPublicationState,
  type ChannelRetractionBlock,
  type ChannelRetractionClearance,
  type ProviderType,
  type PublicationOutcomeKind,
} from "@core/domain/index.js";

/**
 * One publication row, optionally carrying the channel it belongs to. The provider is
 * read from that joined row and never from the record: which provider a channel is on
 * is the channel's fact, and storing a copy would be a second place for it to drift.
 */
export interface PrismaPostChannelPublicationWithChannel extends PostChannelPublication {
  channel?: { provider: Provider } | null;
}

/**
 * Prisma Post with relations
 */
export interface PrismaPostWithRelations extends Post {
  contents: PostContent[];
  media: PostMedia[];
  contentVersions: ContentVersion[];
  channelPublications?: PrismaPostChannelPublicationWithChannel[];
}

/** The database enum is uppercase; the domain's outcome kinds are not. */
const OUTCOME_KIND: Record<string, PublicationOutcomeKind> = {
  UNRESOLVED: "unresolved",
  PUBLISHED: "published",
  EXCLUDED: "excluded",
};

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
 * A stored row that cannot be read back into the state it claims to describe.
 *
 * It is NOT a validation failure: the writer of this row is the entity itself, so a row
 * that will not parse is a row the application could not have written — a corrupted
 * row, or a schema the code no longer agrees with. Both are defects, and both are worse
 * when answered by dropping the part that would not parse: a fragment silently missing
 * from a live set is content nobody knows is still on the provider.
 */
export class PostRowCorruptedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PostRowCorruptedError";
  }
}

/**
 * Maps one stored publication row back into its record entity.
 *
 * Reconstitution re-runs no rule: the row IS the state, and a row that could not have
 * been produced by the entity is a database defect. It is SURFACED rather than repaired
 * — every value the row carries is either read back whole or the row is refused, so no
 * caller is handed a record that is quietly missing part of what was stored. Two fields
 * are derived rather than stored: the head reference, which folds `externalId` and
 * `externalIdMissing` into one explicit value, and `excludedAt`, which is the attempt
 * that excluded the channel (`lastAttemptAt`) and falls back to the row's own last write.
 */
function toChannelPublication(
  row: PrismaPostChannelPublicationWithChannel
): Result<ChannelPublication, PostRowCorruptedError> {
  const fragments: FragmentReference[] = [];
  if (Array.isArray(row.liveFragments)) {
    for (const entry of row.liveFragments) {
      const parsed = FragmentReference.fromJSON(entry);
      if (!parsed.ok) {
        return err(
          new PostRowCorruptedError(
            `publication ${row.id}: a stored live fragment could not be read back — ${parsed.error.message}`
          )
        );
      }
      fragments.push(parsed.value);
    }
  }

  const outcomeKind = OUTCOME_KIND[row.outcome];
  if (outcomeKind === undefined) {
    return err(
      new PostRowCorruptedError(`publication ${row.id}: unknown outcome "${row.outcome}"`)
    );
  }

  let head: ChannelPublicationState["head"];
  if (row.externalId !== null) {
    const provided = providedReference(row.externalId);
    if (!provided.ok) {
      // Falling back to the none-returned reference here would flip `externalIdMissing`
      // from false to true: "the provider gave us this id" becomes "the provider gave us
      // nothing". That is a different fact about the publication, stated as if it were
      // the stored one.
      return err(
        new PostRowCorruptedError(
          `publication ${row.id}: stored external id could not be read as a reference — ${provided.error.message}`
        )
      );
    }
    head = provided.value;
  } else if (row.externalIdMissing) {
    head = noneReturnedReference();
  }

  let reason: ExclusionReason | undefined;
  if (row.reasonCode !== null) {
    const built = ExclusionReason.create({
      code: row.reasonCode as ChannelFailureCode,
      ...(row.reasonDetail !== null && { detail: row.reasonDetail }),
    });
    if (!built.ok) {
      return err(
        new PostRowCorruptedError(
          `publication ${row.id}: stored reason "${row.reasonCode}" could not be read back — ${built.error.message}`
        )
      );
    }
    reason = built.value;
  }

  let contentHash: ContentFingerprint | undefined;
  if (row.contentHash !== null) {
    const parsed = ContentFingerprint.fromString(row.contentHash);
    if (!parsed.ok) {
      return err(
        new PostRowCorruptedError(
          `publication ${row.id}: stored content fingerprint could not be read back — ${parsed.error.message}`
        )
      );
    }
    contentHash = parsed.value;
  }

  const rebuilt = ChannelPublication.reconstitute({
    id: row.id,
    channelId: ChannelId.fromStringUnsafe(row.channelId),
    ...(row.channel?.provider !== undefined && {
      provider: row.channel.provider as ProviderType,
    }),
    outcomeKind,
    ...(head !== undefined && { head }),
    liveFragments: fragments,
    pendingRetraction: row.pendingRetraction,
    ...(row.retractionBlockedCause !== null && {
      retractionBlockedCause: row.retractionBlockedCause as ChannelRetractionBlock,
    }),
    ...(row.actionWindowStartedAt !== null && { actionWindowStartedAt: row.actionWindowStartedAt }),
    ...(row.actionWindowExpiredAt !== null && { actionWindowExpiredAt: row.actionWindowExpiredAt }),
    ...(row.retractionAlertHash !== null && { retractionAlertHash: row.retractionAlertHash }),
    ...(row.retractionClearedCause !== null && {
      retractionClearedCause: row.retractionClearedCause as ChannelRetractionClearance,
    }),
    ...(row.retractionClearedAt !== null && { retractionClearedAt: row.retractionClearedAt }),
    ...(contentHash !== undefined && { contentHash }),
    ...(row.publishedAt !== null && { publishedAt: row.publishedAt }),
    ...(reason !== undefined && { reason }),
    ...(row.lastFailureCode !== null && {
      lastFailure: {
        code: row.lastFailureCode as ChannelFailureCode,
        ...(row.lastFailureDetail !== null && { detail: row.lastFailureDetail }),
        at: row.lastAttemptAt ?? row.updatedAt,
      },
    }),
    ...(outcomeKind === "excluded" && {
      excludedAt: row.lastAttemptAt ?? row.updatedAt,
    }),
    attempts: row.attempts,
    episode: row.episode,
    episodeAttempts: row.episodeAttempts,
  });

  if (!rebuilt.ok) {
    return err(new PostRowCorruptedError(`publication ${row.id}: ${rebuilt.error.message}`));
  }
  return ok(rebuilt.value);
}

/**
 * PostAggregateMapper
 *
 * Handles bidirectional mapping between Prisma Post models
 * and domain PostAggregate instances.
 */
export class PostAggregateMapper {
  /**
   * @method toDomain
   * @description Map Prisma Post with relations to domain PostAggregate.
   *
   *   The ONE place in this file that raises, and the honest reason is narrower than
   *   "the list reads have no error channel". The publication refusals can only be
   *   reached through `findById`, because that is the only read that includes
   *   `channelPublications` at all; the five list reads never load a publication row and
   *   so can never meet them. And `findById` DOES have an error channel — it returns
   *   `Promise<Result<…>>` — it simply does not use it here: the raise passes straight
   *   through it today, uncaught.
   *
   *   So the raise survives for exactly one reason: closing it means widening the
   *   `PostRepository.findById` port error union past `EntityNotFoundError` and narrowing
   *   every caller on it, which is the rework that owns `findById`, not this mapper.
   *   {@link PostAggregateMapper.reconstitute} is the same mapping as a `Result`, ready
   *   for that caller.
   *
   *   Blast radius while it stands, and it is NOT uniform across the refusals — saying
   *   "per-post" of all of them would be false:
   *
   *   - The PUBLICATION refusals are per-post. `channelPublications` is included by
   *     `findById` alone (`PrismaPostRepository.ts:73`), so no list read can meet them.
   *   - The MEDIA refusal is wider. `media: true` is included by `findById` AND by
   *     `findByProjectId`, `findByStatus`, `findReadyForPublishing` and
   *     `findWithFilters`, each of which maps this function over a page with no
   *     try/catch and returns a `PaginatedResult` that has no error channel. One
   *     corrupted media row therefore rejects the WHOLE PAGE from those four.
   *
   *   That is bounded by a fact about those four loaders rather than by this file: they
   *   have no production consumer. The API's list reads go through
   *   `PrismaPostQueryRepository`; the only callers of these four are their own two
   *   suites, so a corrupted media row can reject a page only inside those suites. The
   *   bound is the absence of consumers and nothing else: a future production caller of
   *   any of the four would widen this refusal's reach with nothing in the tree to
   *   notice, which is one more reason to retire them. Once they are gone, the per-post
   *   claim is true of both refusals.
   *
   *   The drop this replaced was not data loss on the list path, and the distinction is
   *   worth keeping straight: the deletion mechanism is `doUpdate` removing media the
   *   aggregate no longer carries, which fires on `save()`. A list read never saves, so
   *   there the old behaviour under-REPORTED. The loss needs a read followed by a save,
   *   which is the `findById` path.
   * @param prismaPost - The row with its relations
   * @returns The aggregate
   */
  static toDomain(prismaPost: PrismaPostWithRelations): PostAggregate {
    const built = PostAggregateMapper.reconstitute(prismaPost);
    if (!built.ok) {
      throw built.error;
    }
    return built.value;
  }

  /**
   * @method reconstitute
   * @description The mapping itself: a stored value that cannot be read back refuses the
   *   row, naming what failed. That holds for the status, for every publication row and
   *   for every media row — nothing is dropped and nothing is repaired, because a value
   *   the application wrote and this cannot read back is a defect whichever half is wrong.
   *
   *   ONE value IS defaulted, and it is a default rather than a repair: a post with no
   *   content row reads as an EMPTY post (`body: ""`, `locale: "en"`). That is a real
   *   state, not a corrupted one — `Post.contents` is a to-many, so zero rows is a shape
   *   the schema admits, and `PrismaApproveVariantAdapter` creates the post and its
   *   content in two statements OUTSIDE a transaction, so a failure between them leaves
   *   exactly this post behind. Refusing it would make a bare post permanently
   *   unloadable, including for the delete that would clean it up.
   * @param prismaPost - The row with its relations
   * @returns Result with the aggregate, or the corrupted-row error
   */
  static reconstitute(
    prismaPost: PrismaPostWithRelations
  ): Result<PostAggregate, PostRowCorruptedError> {
    // Get the primary content (most recent revision for default locale)
    const primaryContent = prismaPost.contents.sort((a, b) => b.revision - a.revision)[0];

    // An absent content row is the empty post described above, not a failure to read one.
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
      return err(
        new PostRowCorruptedError(
          `post ${prismaPost.id}: invalid status "${prismaPost.status}" — ${statusResult.error.message}`
        )
      );
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

      if (!mediaResult.ok) {
        // Dropping it is the worse of the two answers ON THE READ-THEN-SAVE PATH, which
        // is where it actually costs something: `doUpdate` derives the media to DELETE
        // from what the aggregate carries, so a row dropped here is removed from the
        // database by the next save of this post. A list read never saves, so there the
        // drop under-reported rather than destroyed.
        //
        // RESIDUAL, and it is the widest surface this refusal opens: `MediaAttachment`
        // parses the url with `new URL(url)`, which rejects a RELATIVE one, while
        // `PostMedia.url` is an unconstrained String. Our writer cannot produce such a
        // row — every stored url came from a `MediaAttachment` that already parsed — and
        // no relative-url fixture or seed exists in the tree, so the refusal is inert
        // today. A future writer that stores a path instead of an absolute url would
        // meet it, which is the intended answer rather than a surprise.
        return err(
          new PostRowCorruptedError(
            `post ${prismaPost.id}: stored media ${prismaMedia.id} could not be read back — ${mediaResult.error.message}`
          )
        );
      }
      media.push(mediaResult.value);
    }

    // Map content versions
    const contentVersions: ContentId[] = prismaPost.contentVersions.map((cv) =>
      ContentId.fromStringUnsafe(cv.id)
    );

    // Map the per-channel publication records. An absent relation means the caller
    // did not ask for them; an empty array means the post has declared no targets. A
    // row that will not read back refuses the whole post: a post handed over with one
    // of its channels missing is the "lost channel" this record exists to prevent.
    const publications: ChannelPublication[] = [];
    for (const row of prismaPost.channelPublications ?? []) {
      const record = toChannelPublication(row);
      if (!record.ok) {
        return err(record.error);
      }
      publications.push(record.value);
    }

    // Create aggregate state
    const state: PostAggregateState = {
      id: PostId.fromStringUnsafe(prismaPost.id),
      projectId: ProjectId.fromStringUnsafe(prismaPost.projectId),
      ...(typeof (prismaPost as { accountId?: string }).accountId === "string" && {
        accountId: (prismaPost as { accountId?: string }).accountId as string,
      }),
      publications,
      content,
      status: statusResult.value,
      ...(scheduledAt && { scheduledAt }),
      ...(prismaPost.publishedAt && { publishedAt: prismaPost.publishedAt }),
      media,
      contentVersions,
      createdAt: prismaPost.createdAt,
      updatedAt: prismaPost.updatedAt,
      // OCC version (Azure saga §15-20). Persisted column on Post; the
      // repository uses it as a WHERE-clause guard on update. Reconstituting
      // with the stored value lets the aggregate enforce expectedVersion
      // checks at the use-case layer.
      version: prismaPost.version,
    };

    return ok(PostAggregate.reconstitute(state));
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
