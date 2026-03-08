/**
 * Infrastructure Layer - Prisma TrackedLink Repository
 *
 * Part of Sprint 19: Link Tracking Feature
 * Implements TrackedLinkRepository interface using Prisma ORM.
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
} from "../../domain/index.js";
import { ShortCode } from "../../domain/value-objects/ShortCode.js";

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
   * Find a tracked link by ID
   */
  async findById(id: TrackedLinkId): Promise<Result<TrackedLink, EntityNotFoundError>> {
    const link = await this.prisma.trackedLink.findUnique({
      where: { id: id.value },
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
   * Delete a tracked link
   */
  async delete(id: TrackedLinkId): Promise<Result<void, EntityNotFoundError>> {
    const exists = await this.prisma.trackedLink.findUnique({
      where: { id: id.value },
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
   * Get click statistics for a link
   */
  async getClickStats(linkId: TrackedLinkId): Promise<ClickStats> {
    // Get total clicks and click records
    const [link, clicks] = await Promise.all([
      this.prisma.trackedLink.findUnique({
        where: { id: linkId.value },
        select: { clicks: true },
      }),
      this.prisma.linkClick.findMany({
        where: { trackedLinkId: linkId.value },
        select: { country: true, timestamp: true },
      }),
    ]);

    // Count clicks by country
    const clicksByCountry: Record<string, number> = {};
    for (const click of clicks) {
      const country = click.country ?? "Unknown";
      clicksByCountry[country] = (clicksByCountry[country] ?? 0) + 1;
    }

    return {
      totalClicks: link?.clicks ?? 0,
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
      createdAt: link.createdAt,
      updatedAt: link.updatedAt,
    };

    return TrackedLink.fromPersistence(props);
  }
}
