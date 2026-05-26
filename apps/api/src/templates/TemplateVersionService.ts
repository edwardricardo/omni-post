/**
 * @file TemplateVersionService.ts
 * @description Template version history management: creating versions, retrieving history,
 *              restoring previous versions, and branch support with commit messages.
 * @layer infrastructure
 */
import type { PrismaClient } from "@infra/prisma";
import { BaseService } from "../services/BaseService";
import { Result } from "@shared/types";
import type { Template, TemplateVersion } from "./templateTypes.js";
import { AppError } from "../lib/errors/AppError.js";

/**
 * Maps a database template version record to the TemplateVersion interface.
 */
function mapToTemplateVersion(dbVersion: {
  id: string;
  templateId: string;
  version: number;
  content: string;
  variables: unknown;
  platforms: unknown;
  tags: unknown;
  changeLog: string;
  author: unknown;
  createdAt: Date;
  isActive: boolean;
  parentVersionId: string | null;
  branchName: string | null;
  commitMessage: string | null;
}): TemplateVersion {
  return {
    id: dbVersion.id,
    templateId: dbVersion.templateId,
    version: dbVersion.version,
    content: dbVersion.content,
    variables: (dbVersion.variables as TemplateVersion["variables"]) || [],
    platforms: (dbVersion.platforms as string[]) || [],
    tags: (dbVersion.tags as string[]) || [],
    changeLog: dbVersion.changeLog,
    author: dbVersion.author as TemplateVersion["author"],
    createdAt: dbVersion.createdAt,
    isActive: dbVersion.isActive,
    ...(dbVersion.parentVersionId != null ? { parentVersionId: dbVersion.parentVersionId } : {}),
    ...(dbVersion.branchName != null ? { branchName: dbVersion.branchName } : {}),
    ...(dbVersion.commitMessage != null ? { commitMessage: dbVersion.commitMessage } : {}),
  };
}

/**
 * Maps a database template record to the Template interface.
 */
export function mapToTemplate(dbTemplate: Record<string, unknown>): Template {
  const t = dbTemplate as {
    id: string;
    name: string;
    description: string;
    category: string;
    content: string;
    variables: unknown;
    platforms: unknown;
    variants: unknown;
    tags: unknown;
    version: number;
    createdAt: Date;
    updatedAt: Date;
  };
  return {
    id: t.id,
    name: t.name,
    description: t.description,
    category: t.category,
    content: t.content,
    variables: (t.variables as Template["variables"]) || [],
    platforms: (t.platforms as string[]) || [],
    variants: (t.variants as Template["variants"]) || [],
    tags: (t.tags as string[]) || [],
    version: t.version,
    createdAt: t.createdAt,
    updatedAt: t.updatedAt,
  };
}

export class TemplateVersionService extends BaseService {
  constructor(private readonly prisma: PrismaClient) {
    super("TemplateVersionService");
  }

  async getTemplateVersions(
    projectId: string,
    templateId: string
  ): Promise<Result<TemplateVersion[], string>> {
    return this.executeWithErrorHandling(
      {
        operation: "getTemplateVersions",
        metadata: { projectId, templateId },
      },
      async () => {
        const versions = await this.prisma.templateVersion.findMany({
          where: {
            template: {
              id: templateId,
              projectId,
              deletedAt: null,
            },
          },
          orderBy: { version: "desc" },
        });

        return versions.map(mapToTemplateVersion);
      }
    );
  }

  async createTemplateVersion(
    projectId: string,
    templateId: string,
    versionData: Omit<TemplateVersion, "id" | "createdAt">
  ): Promise<Result<TemplateVersion, string>> {
    return this.executeWithErrorHandling(
      {
        operation: "createTemplateVersion",
        metadata: { projectId, templateId, version: versionData.version },
      },
      async () => {
        // Deactivate current active version
        if (versionData.isActive) {
          await this.prisma.templateVersion.updateMany({
            where: {
              templateId,
              isActive: true,
            },
            data: { isActive: false },
          });
        }

        const version = await this.prisma.templateVersion.create({
          data: {
            templateId,
            version: versionData.version,
            content: versionData.content,
            variables: versionData.variables,
            platforms: versionData.platforms,
            tags: versionData.tags,
            changeLog: versionData.changeLog,
            author: versionData.author,
            isActive: versionData.isActive,
            ...(versionData.parentVersionId !== undefined && {
              parentVersionId: versionData.parentVersionId,
            }),
            branchName: versionData.branchName || "main",
            ...(versionData.commitMessage !== undefined && {
              commitMessage: versionData.commitMessage,
            }),
            createdAt: new Date(),
          },
        });

        return mapToTemplateVersion(version);
      }
    );
  }

  async restoreTemplateVersion(
    projectId: string,
    templateId: string,
    versionId: string
  ): Promise<Result<Template | null, string>> {
    return this.executeWithErrorHandling(
      {
        operation: "restoreTemplateVersion",
        metadata: { projectId, templateId, versionId },
      },
      async () => {
        const version = await this.prisma.templateVersion.findFirst({
          where: {
            id: versionId,
            template: {
              id: templateId,
              projectId,
              deletedAt: null,
            },
          },
        });

        if (!version) {
          return null;
        }

        // Update template with version content
        const template = await this.prisma.template.update({
          where: { id: templateId },
          data: {
            content: version.content,
            platforms: version.platforms,
            tags: version.tags,
            version: (version.version || 0) + 1,
            updatedAt: new Date(),
          },
          include: {
            versions: true,
          },
        });

        // Create new version from restored content
        const newVersionResult = await this.createTemplateVersion(projectId, templateId, {
          templateId,
          version: template.version,
          content: version.content,
          variables: version.variables,
          platforms: version.platforms,
          tags: version.tags,
          changeLog: `Restored from version ${version.version}`,
          author: {
            id: "system",
            name: "System",
          },
          isActive: true,
          branchName: version.branchName || "main",
          commitMessage: `Restore version ${version.version}`,
        });

        if (!newVersionResult.ok) {
          throw AppError.internal(`Failed to create restored version: ${newVersionResult.error}`);
        }

        return mapToTemplate(template);
      }
    );
  }
}
