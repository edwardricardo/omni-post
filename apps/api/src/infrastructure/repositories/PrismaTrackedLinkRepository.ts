/**
 * @file PrismaTrackedLinkRepository.ts
 * @description Prisma adapter implementing TrackedLinkRepository for link tracking.
 *              Receives PrismaClient via constructor injection.
 * @layer infrastructure
 */

import type { PrismaClient } from "@infra/prisma";
import { type Result, ok, err } from "@shared/types";
import {
  type TrackedLinkRepository,
  type TrackedLinkFilterOptions,
  type ClickStats,
  TrackedLink,
  type TrackedLinkProps,
  LinkClick,
  TrackedLinkId,
  ProjectId,
  EntityNotFoundError,
} from "@core/domain/index.js";
import { ShortCode } from "@core/domain/value-objects/ShortCode.js";
import { requireTenantContext } from "../../security/tenantContext.js";

/**
 * PrismaTrackedLinkRepository - Implements TrackedLinkRepository using Prisma
 *
 * This is an ADAPTER in the hexagonal architecture - it implements
 * the repository PORT defined in the domain layer.
 */
export class PrismaTrackedLinkRepository implements TrackedLinkRepository {
  constructor(private readonly prisma: PrismaClient) {}

  /**
   * Save a tracked link (create or update)
   */
  async save(link: TrackedLink): Promise<Result<void, Error>> {
    try {
      const exists = await this.prisma.trackedLink.findUnique({
        where: { id: link.id.value },
      });

      if (exists) {
        // Update existing link
        await this.prisma.trackedLink.update({
          where: { id: link.id.value },
          data: {
            clicks: link.clicks,
            isActive: link.isActive,
            utmSource: link.utmSource ?? null,
            utmMedium: link.utmMedium ?? null,
            utmCampaign: link.utmCampaign ?? null,
            utmContent: link.utmContent ?? null,
            utmTerm: link.utmTerm ?? null,
            campaignId: link.campaignId ?? null,
            updatedAt: new Date(),
          },
        });
      } else {
        // Create new link
        await this.prisma.trackedLink.create({
          data: {
            id: link.id.value,
            projectId: link.projectId.value,
            originalUrl: link.originalUrl,
            shortCode: link.shortCode.value,
            vanitySlug: link.vanitySlug ?? null,
            clicks: link.clicks,
            isActive: link.isActive,
            utmSource: link.utmSource ?? null,
            utmMedium: link.utmMedium ?? null,
            utmCampaign: link.utmCampaign ?? null,
            utmContent: link.utmContent ?? null,
            utmTerm: link.utmTerm ?? null,
            campaignId: link.campaignId ?? null,
            createdAt: link.createdAt,
            updatedAt: new Date(),
          },
        });
      }

      return ok(undefined);
    } catch (error) {
      return err(error instanceof Error ? error : new Error(String(error)));
    }
  }

  /**
   * Find a tracked link by ID, scoped to the caller's account.
   *
   * TrackedLink carries no `accountId` column, so ownership is enforced by a
   * transitive join through its `project`. The account is taken from the bound
   * tenant context — never from caller input — so a link owned by another
   * account misses the filter and is indistinguishable from a nonexistent id
   * (both return EntityNotFoundError → 404).
   */
  async findById(id: TrackedLinkId): Promise<Result<TrackedLink, EntityNotFoundError>> {
    const link = await this.prisma.trackedLink.findFirst({
      where: {
        id: id.value,
        project: { accountId: requireTenantContext().accountId },
      },
    });

    if (!link) {
      return err(new EntityNotFoundError("TrackedLink", id.value));
    }

    return ok(this.toDomain(link));
  }

  /**
   * Find a tracked link by short code (or vanity slug)
   */
  async findByShortCode(code: string): Promise<Result<TrackedLink, EntityNotFoundError>> {
    // Try to find by shortCode first, then by vanitySlug
    const link = await this.prisma.trackedLink.findFirst({
      where: {
        OR: [{ shortCode: code }, { vanitySlug: code }],
      },
    });

    if (!link) {
      return err(new EntityNotFoundError("TrackedLink", code));
    }

    return ok(this.toDomain(link));
  }

  /**
   * Find all tracked links for a project
   */
  async findByProjectId(
    projectId: ProjectId,
    options?: TrackedLinkFilterOptions
  ): Promise<TrackedLink[]> {
    const where: { projectId: string; isActive?: boolean } = {
      projectId: projectId.value,
    };

    if (options?.activeOnly) {
      where.isActive = true;
    }

    const links = await this.prisma.trackedLink.findMany({
      where,
      orderBy: { createdAt: "desc" },
      ...(options?.limit && { take: options.limit }),
      ...(options?.offset && { skip: options.offset }),
    });

    return links.map((link) => this.toDomain(link));
  }

  /**
   * Delete a tracked link, scoped to the caller's account.
   *
   * The existence pre-check uses the SAME transitive `project.accountId` join as
   * `findById`, so a foreign (or nonexistent) id returns NOT_FOUND BEFORE the
   * destructive `$transaction` runs — the `linkClick` cascade never fires for a
   * link the caller does not own.
   */
  async delete(id: TrackedLinkId): Promise<Result<void, EntityNotFoundError>> {
    const exists = await this.prisma.trackedLink.findFirst({
      where: {
        id: id.value,
        project: { accountId: requireTenantContext().accountId },
      },
    });

    if (!exists) {
      return err(new EntityNotFoundError("TrackedLink", id.value));
    }

    // Delete related clicks first (cascade should handle this, but explicit is safer)
    await this.prisma.$transaction([
      this.prisma.linkClick.deleteMany({
        where: { trackedLinkId: id.value },
      }),
      this.prisma.trackedLink.delete({
        where: { id: id.value },
      }),
    ]);

    return ok(undefined);
  }

  /**
   * Record a click event and increment the click counter
   */
  async recordClick(linkId: TrackedLinkId, click: LinkClick): Promise<Result<void, Error>> {
    try {
      await this.prisma.$transaction([
        // Create click record
        this.prisma.linkClick.create({
          data: {
            id: click.id.value,
            trackedLinkId: linkId.value,
            timestamp: click.timestamp,
            referrer: click.referrer ?? null,
            userAgent: click.userAgent ?? null,
            ipAddress: click.ipAddress ?? null,
            country: click.country ?? null,
            city: click.city ?? null,
          },
        }),
        // Increment click counter
        this.prisma.trackedLink.update({
          where: { id: linkId.value },
          data: {
            clicks: { increment: 1 },
            updatedAt: new Date(),
          },
        }),
      ]);

      return ok(undefined);
    } catch (error) {
      return err(error instanceof Error ? error : new Error(String(error)));
    }
  }

  /**
   * Get click statistics for a link, scoped to the caller's account.
   *
   * The link is resolved through the SAME transitive `project.accountId` join as
   * `findById`/`delete`, so a foreign (or nonexistent) id yields the empty
   * not-found stats result BEFORE any `linkClick` row is read. This makes the
   * method scoped by construction: a future direct caller (e.g. a bulk-stats use
   * case) cannot read another account's click data even without a preceding
   * owner-gated `findById`.
   */
  async getClickStats(linkId: TrackedLinkId): Promise<ClickStats> {
    const link = await this.prisma.trackedLink.findFirst({
      where: {
        id: linkId.value,
        project: { accountId: requireTenantContext().accountId },
      },
      select: { clicks: true },
    });

    // Foreign or nonexistent id: return the empty stats result without touching
    // linkClick — identical to the shape returned for a missing link previously.
    if (!link) {
      return { totalClicks: 0, clicksByCountry: {} };
    }

    const clicks = await this.prisma.linkClick.findMany({
      where: { trackedLinkId: linkId.value },
      select: { country: true, timestamp: true },
    });

    // Count clicks by country
    const clicksByCountry: Record<string, number> = {};
    for (const click of clicks) {
      const country = click.country ?? "Unknown";
      clicksByCountry[country] = (clicksByCountry[country] ?? 0) + 1;
    }

    return {
      totalClicks: link.clicks,
      clicksByCountry,
    };
  }

  /**
   * Check if a short code is available
   */
  async isShortCodeAvailable(code: string): Promise<boolean> {
    const existing = await this.prisma.trackedLink.findFirst({
      where: {
        OR: [{ shortCode: code }, { vanitySlug: code }],
      },
    });

    return existing === null;
  }

  /**
   * Map Prisma model to domain entity
   */
  private toDomain(link: {
    id: string;
    projectId: string;
    originalUrl: string;
    shortCode: string;
    vanitySlug: string | null;
    clicks: number;
    isActive: boolean;
    utmSource?: string | null;
    utmMedium?: string | null;
    utmCampaign?: string | null;
    utmContent?: string | null;
    utmTerm?: string | null;
    campaignId?: string | null;
    createdAt: Date;
    updatedAt: Date;
  }): TrackedLink {
    const shortCodeResult = ShortCode.fromString(link.shortCode);
    if (!shortCodeResult.ok) {
      throw new Error(`Invalid short code in database: ${link.shortCode}`);
    }

    const props: TrackedLinkProps = {
      id: TrackedLinkId.fromStringUnsafe(link.id),
      projectId: ProjectId.fromStringUnsafe(link.projectId),
      originalUrl: link.originalUrl,
      shortCode: shortCodeResult.value,
      ...(link.vanitySlug && { vanitySlug: link.vanitySlug }),
      clicks: link.clicks,
      isActive: link.isActive,
      ...(link.utmSource && { utmSource: link.utmSource }),
      ...(link.utmMedium && { utmMedium: link.utmMedium }),
      ...(link.utmCampaign && { utmCampaign: link.utmCampaign }),
      ...(link.utmContent && { utmContent: link.utmContent }),
      ...(link.utmTerm && { utmTerm: link.utmTerm }),
      ...(link.campaignId && { campaignId: link.campaignId }),
      createdAt: link.createdAt,
      updatedAt: link.updatedAt,
    };

    return TrackedLink.fromPersistence(props);
  }
}
