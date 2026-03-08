/**
 * Template Version Service
 *
 * Manages template version history including creating new versions,
 * retrieving version history, and restoring templates to previous versions.
 * Supports branching with named branches and commit messages.
 *
 * @module templates/TemplateVersionService
 */
import { prisma } from "@infra/prisma";
import { BaseService } from "../services/BaseService";
import { Result } from "@shared/types";
import type { Template, TemplateVersion } from "./templateTypes.js";
import { AppError } from "../lib/errors/AppError.js";

/**
 * Maps a database template version record to the TemplateVersion interface.
 */
function mapToTemplateVersion(dbVersion: any): TemplateVersion {
  return {
    id: dbVersion.id,
    templateId: dbVersion.templateId,
    version: dbVersion.version,
    content: dbVersion.content,
    variables: dbVersion.variables || [],
    platforms: dbVersion.platforms || [],
    tags: dbVersion.tags || [],
    changeLog: dbVersion.changeLog,
    author: dbVersion.author,
    createdAt: dbVersion.createdAt,
    isActive: dbVersion.isActive,
    parentVersionId: dbVersion.parentVersionId,
    branchName: dbVersion.branchName,
    commitMessage: dbVersion.commitMessage,
  };
}

/**
 * Maps a database template record to the Template interface.
 */
export function mapToTemplate(dbTemplate: any): Template {
  return {
    id: dbTemplate.id,
    name: dbTemplate.name,
    description: dbTemplate.description,
    category: dbTemplate.category,
    content: dbTemplate.content,
    variables: dbTemplate.variables || [],
    platforms: dbTemplate.platforms || [],
    variants: dbTemplate.variants || [],
    tags: dbTemplate.tags || [],
    version: dbTemplate.version,
    createdAt: dbTemplate.createdAt,
    updatedAt: dbTemplate.updatedAt,
  };
}

export class TemplateVersionService extends BaseService {
  constructor() {
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
        const versions = await prisma.templateVersion.findMany({
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
          await prisma.templateVersion.updateMany({
            where: {
              templateId,
              isActive: true,
            },
            data: { isActive: false },
          });
        }

        const version = await prisma.templateVersion.create({
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
        const version = await prisma.templateVersion.findFirst({
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
        const template = await prisma.template.update({
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
