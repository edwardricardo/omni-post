/**
 * @file PrismaMentionQueryRepository.ts
 * @description Prisma adapter implementing the MentionQueryRepository port.
 *   Read-side of the brand-listening CQRS path: a cursor-paginated mention feed
 *   and a windowed Share-of-Voice aggregation. SoV is computed from a single
 *   normalized corpus with consistent where-clauses across providers (never
 *   per-platform divergence), via count/groupBy (no row loading, no raw SQL).
 * @layer infrastructure
 */

import type { PrismaClient, Prisma } from "@infra/prisma";
import { type $Enums } from "@infra/prisma";

import {
  type MentionQueryRepository,
  type MentionDTO,
  type MentionFilter,
  type ShareOfVoiceDTO,
  type ProviderShareDTO,
  type CursorPagination,
  type CursorPaginatedResult,
} from "@core/domain/repositories/MentionQueryRepository.js";

/** Where fragment selecting brand-attributed mentions (own-brand or BRAND term). */
const brandOr = [
  { source: "WEBHOOK" as $Enums.MentionSource },
  { trackedTerm: { kind: "BRAND" as $Enums.TrackedTermKind } },
];

export class PrismaMentionQueryRepository implements MentionQueryRepository {
  constructor(private readonly prisma: PrismaClient) {}

  /**
   * @method getShareOfVoice
   * @description Computes SoV for a project over [since, until) from the corpus:
   *   counts + per-provider + per-sentiment breakdowns, all from one consistent
   *   set of where-clauses. `sov = brandCount / marketCount` (0 when market is 0).
   */
  async getShareOfVoice(params: {
    accountId: string;
    projectId: string;
    since: Date;
    until: Date;
  }): Promise<ShareOfVoiceDTO> {
    const base = {
      accountId: params.accountId,
      projectId: params.projectId,
      providerCreatedAt: { gte: params.since, lt: params.until },
    } satisfies Prisma.MentionWhereInput;

    const brandWhere: Prisma.MentionWhereInput = { ...base, OR: brandOr };
    const marketWhere: Prisma.MentionWhereInput = {
      ...base,
      trackedTerm: { kind: "MARKET" as $Enums.TrackedTermKind },
    };

    const [
      totalCount,
      brandCount,
      marketCount,
      totalByProvider,
      brandByProvider,
      marketByProvider,
      bySentimentRows,
    ] = await Promise.all([
      this.prisma.mention.count({ where: base }),
      this.prisma.mention.count({ where: brandWhere }),
      this.prisma.mention.count({ where: marketWhere }),
      this.prisma.mention.groupBy({ by: ["provider"], where: base, _count: { _all: true } }),
      this.prisma.mention.groupBy({ by: ["provider"], where: brandWhere, _count: { _all: true } }),
      this.prisma.mention.groupBy({ by: ["provider"], where: marketWhere, _count: { _all: true } }),
      this.prisma.mention.groupBy({
        by: ["sentimentLabel"],
        where: base,
        _count: { _all: true },
      }),
    ]);

    const byProvider = this.mergeProviderShares(totalByProvider, brandByProvider, marketByProvider);

    const bySentiment = { positive: 0, neutral: 0, negative: 0, unscored: 0 };
    for (const row of bySentimentRows) {
      const n = row._count._all;
      switch (row.sentimentLabel) {
        case "POSITIVE":
          bySentiment.positive += n;
          break;
        case "NEUTRAL":
          bySentiment.neutral += n;
          break;
        case "NEGATIVE":
          bySentiment.negative += n;
          break;
        default:
          bySentiment.unscored += n;
      }
    }

    return {
      projectId: params.projectId,
      since: params.since,
      until: params.until,
      brandCount,
      marketCount,
      totalCount,
      sov: marketCount > 0 ? brandCount / marketCount : 0,
      byProvider,
      bySentiment,
    };
  }

  /**
   * @method listMentions
   * @description Cursor-paginated mention feed (newest first) with optional
   *   provider / tracked-term-kind / sentiment / date-range filters.
   */
  async listMentions(
    filter: MentionFilter,
    pagination: CursorPagination
  ): Promise<CursorPaginatedResult<MentionDTO>> {
    const where = this.buildWhereClause(filter);
    const cursorCondition = this.parseCursorCondition(pagination.cursor);

    const rows = await this.prisma.mention.findMany({
      where: { ...where, ...cursorCondition },
      include: { trackedTerm: { select: { kind: true } } },
      orderBy: [{ providerCreatedAt: "desc" }, { id: "desc" }],
      take: pagination.limit + 1,
    });

    const hasMore = rows.length > pagination.limit;
    const items = hasMore ? rows.slice(0, pagination.limit) : rows;
    const dtos = items.map((row) => this.toDTO(row));

    let nextCursor: string | null = null;
    const lastItem = items[items.length - 1];
    if (hasMore && lastItem) {
      nextCursor = `${lastItem.providerCreatedAt.toISOString()}_${lastItem.id}`;
    }

    return { items: dtos, nextCursor, hasMore };
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  private mergeProviderShares(
    total: Array<{ provider: string; _count: { _all: number } }>,
    brand: Array<{ provider: string; _count: { _all: number } }>,
    market: Array<{ provider: string; _count: { _all: number } }>
  ): ProviderShareDTO[] {
    const brandMap = new Map(brand.map((r) => [r.provider, r._count._all]));
    const marketMap = new Map(market.map((r) => [r.provider, r._count._all]));

    return total.map((r) => {
      const totalCount = r._count._all;
      const brandCount = brandMap.get(r.provider) ?? 0;
      const marketCount = marketMap.get(r.provider) ?? 0;
      return {
        provider: r.provider,
        brandCount,
        marketCount,
        totalCount,
        sov: marketCount > 0 ? brandCount / marketCount : 0,
      };
    });
  }

  private buildWhereClause(filter: MentionFilter): Prisma.MentionWhereInput {
    return {
      accountId: filter.accountId,
      ...(filter.projectId !== undefined && { projectId: filter.projectId }),
      ...(filter.provider !== undefined && { provider: filter.provider as $Enums.Provider }),
      ...(filter.kind !== undefined && {
        trackedTerm: { kind: filter.kind as $Enums.TrackedTermKind },
      }),
      ...(filter.sentiment !== undefined && {
        sentimentLabel: filter.sentiment as $Enums.MentionSentiment,
      }),
      ...((filter.since !== undefined || filter.until !== undefined) && {
        providerCreatedAt: {
          ...(filter.since !== undefined && { gte: filter.since }),
          ...(filter.until !== undefined && { lt: filter.until }),
        },
      }),
    };
  }

  private parseCursorCondition(cursor: string | undefined): Prisma.MentionWhereInput {
    if (cursor === undefined) {
      return {};
    }
    const separatorIndex = cursor.indexOf("_");
    if (separatorIndex === -1) {
      return {};
    }
    const cursorDate = new Date(cursor.substring(0, separatorIndex));
    const cursorId = cursor.substring(separatorIndex + 1);
    if (isNaN(cursorDate.getTime())) {
      return {};
    }
    return {
      OR: [
        { providerCreatedAt: { lt: cursorDate } },
        { providerCreatedAt: cursorDate, id: { lt: cursorId } },
      ],
    };
  }

  private toDTO(row: PrismaMentionRow): MentionDTO {
    return {
      id: row.id,
      accountId: row.accountId,
      projectId: row.projectId,
      provider: row.provider,
      externalId: row.externalId,
      source: row.source,
      trackedTermId: row.trackedTermId,
      trackedTermKind: row.trackedTerm?.kind ?? null,
      channelId: row.channelId,
      authorName: row.authorName,
      authorHandle: row.authorHandle,
      authorAvatarUrl: row.authorAvatarUrl,
      authorProviderId: row.authorProviderId,
      url: row.url,
      body: row.body,
      lang: row.lang,
      mediaUrls: [...row.mediaUrls],
      sentimentScore: row.sentimentScore !== null ? Number(row.sentimentScore) : null,
      sentimentLabel: row.sentimentLabel,
      providerCreatedAt: row.providerCreatedAt,
      ingestedAt: row.ingestedAt,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }
}

// ---------------------------------------------------------------------------
// Internal row type (mirrors the Mention model + the included trackedTerm.kind)
// ---------------------------------------------------------------------------

interface PrismaMentionRow {
  id: string;
  accountId: string;
  projectId: string;
  provider: string;
  externalId: string;
  source: string;
  trackedTermId: string | null;
  channelId: string | null;
  authorName: string;
  authorHandle: string | null;
  authorAvatarUrl: string | null;
  authorProviderId: string;
  url: string | null;
  body: string;
  lang: string | null;
  mediaUrls: string[];
  sentimentScore: Prisma.Decimal | null;
  sentimentLabel: string | null;
  providerCreatedAt: Date;
  ingestedAt: Date;
  createdAt: Date;
  updatedAt: Date;
  trackedTerm: { kind: string } | null;
}
