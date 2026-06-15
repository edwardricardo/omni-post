/**
 * @file templateService.ts
 * @description Core template service providing CRUD operations, duplication, and compilation
 *              with delegated version management and A/B testing via sub-services.
 * @layer infrastructure
 */
import { type Prisma, type PrismaClient } from "@infra/prisma";
import { BaseService } from "../services/BaseService.js";
import { ServerTemplateEngine } from "../lib/templates/ServerTemplateEngine.js";
import { AppError } from "../lib/errors/AppError.js";
import { Result } from "@shared/types";
import type {
  Template,
  TemplateVersion,
  ABTest,
  ABTestConfig,
  TemplateFilters,
  PaginationOptions,
} from "./templateTypes.js";
import { mapToTemplate, TemplateVersionService } from "./TemplateVersionService.js";
import { TemplateABTestService } from "./TemplateABTestService.js";

export class TemplateService extends BaseService {
  private readonly versionService: TemplateVersionService;
  private readonly abTestService: TemplateABTestService;
  private readonly templateEngine: ServerTemplateEngine;

  constructor(private readonly prisma: PrismaClient) {
    super("TemplateService");
    this.versionService = new TemplateVersionService(this.prisma);
    this.abTestService = new TemplateABTestService(this.prisma);
    this.templateEngine = new ServerTemplateEngine(this.prisma);
  }

  // ---------------------------------------------------------------------------
  // CRUD
  // ---------------------------------------------------------------------------

  async getTemplates(
    projectId: string,
    filters: TemplateFilters = {},
    pagination: PaginationOptions = { limit: 50, offset: 0 }
  ): Promise<Result<Template[], string>> {
    return this.executeWithErrorHandling(
      {
        operation: "getTemplates",
        metadata: { projectId, filters, pagination },
      },
      async () => {
        const where: Prisma.TemplateWhereInput = {
          projectId,
          deletedAt: null,
        };

        if (filters.category) {
          where.category = filters.category;
        }

        if (filters.platform) {
          where.platforms = {
            has: filters.platform,
          };
        }

        if (filters.tags && filters.tags.length > 0) {
          where.tags = {
            hasSome: filters.tags,
          };
        }

        if (filters.search) {
          where.OR = [
            { name: { contains: filters.search, mode: "insensitive" } },
            { description: { contains: filters.search, mode: "insensitive" } },
            { content: { contains: filters.search, mode: "insensitive" } },
          ];
        }

        const templates = await this.prisma.template.findMany({
          where,
          orderBy: { updatedAt: "desc" },
          take: pagination.limit,
          skip: pagination.offset,
          include: {
            project: {
              select: { id: true, name: true },
            },
            versions: {
              where: { isActive: true },
              take: 1,
            },
          },
        });

        return templates.map(mapToTemplate);
      }
    );
  }

  async getTemplate(
    projectId: string,
    templateId: string
  ): Promise<Result<Template | null, string>> {
    return this.executeWithErrorHandling(
      {
        operation: "getTemplate",
        metadata: { projectId, templateId },
      },
      async () => {
        const template = await this.prisma.template.findFirst({
          where: {
            id: templateId,
            projectId,
            deletedAt: null,
          },
          include: {
            versions: {
              orderBy: { version: "desc" },
            },
          },
        });

        return template ? mapToTemplate(template) : null;
      }
    );
  }

  async createTemplate(
    projectId: string,
    templateData: Omit<Template, "id">
  ): Promise<Result<Template, string>> {
    return this.executeWithErrorHandling(
      {
        operation: "createTemplate",
        metadata: { projectId, templateName: templateData.name },
      },
      async () => {
        const project = await this.prisma.project.findUnique({
          where: { id: projectId },
        });

        if (!project) {
          throw AppError.notFound("Project");
        }

        const template = await this.prisma.template.create({
          data: {
            projectId,
            accountId: project.accountId,
            name: templateData.name,
            ...(templateData.description !== undefined && {
              description: templateData.description,
            }),
            category: templateData.category,
            content: templateData.content,
            variables: (templateData.variables || []) as unknown as Prisma.InputJsonValue,
            platforms: templateData.platforms,
            variants: (templateData.variants || []) as unknown as Prisma.InputJsonValue,
            tags: templateData.tags || [],
            version: templateData.version || 1,
            createdAt: templateData.createdAt || new Date(),
            updatedAt: templateData.updatedAt || new Date(),
          },
          include: {
            versions: true,
          },
        });

        // Create initial version
        const versionResult = await this.versionService.createTemplateVersion(
          projectId,
          template.id,
          {
            templateId: template.id,
            version: 1,
            content: template.content,
            variables: (templateData.variables || []).map((v) => v.name),
            platforms: template.platforms,
            tags: template.tags,
            changeLog: "Initial version",
            author: {
              id: "system",
              name: "System",
            },
            isActive: true,
            branchName: "main",
            commitMessage: "Initial template creation",
          }
        );

        if (!versionResult.ok) {
          throw AppError.internal(`Failed to create initial version: ${versionResult.error}`);
        }

        return mapToTemplate(template);
      }
    );
  }

  async updateTemplate(
    projectId: string,
    templateId: string,
    updateData: Partial<Template>
  ): Promise<Result<Template | null, string>> {
    return this.executeWithErrorHandling(
      {
        operation: "updateTemplate",
        metadata: { projectId, templateId },
      },
      async () => {
        const existingTemplate = await this.prisma.template.findFirst({
          where: {
            id: templateId,
            projectId,
            deletedAt: null,
          },
        });

        if (!existingTemplate) {
          return null;
        }

        const template = await this.prisma.template.update({
          where: { id: templateId },
          data: {
            ...(updateData.name !== undefined && { name: updateData.name }),
            ...(updateData.description !== undefined && { description: updateData.description }),
            ...(updateData.category !== undefined && { category: updateData.category }),
            ...(updateData.content !== undefined && { content: updateData.content }),
            ...(updateData.variables !== undefined && {
              variables: (updateData.variables || []) as unknown as Prisma.InputJsonValue,
            }),
            ...(updateData.platforms !== undefined && { platforms: updateData.platforms }),
            ...(updateData.variants !== undefined && {
              variants: (updateData.variants || []) as unknown as Prisma.InputJsonValue,
            }),
            ...(updateData.tags && { tags: updateData.tags }),
            version: (existingTemplate.version || 0) + 1,
            updatedAt: updateData.updatedAt || new Date(),
          },
          include: {
            versions: true,
          },
        });

        return mapToTemplate(template);
      }
    );
  }

  async deleteTemplate(projectId: string, templateId: string): Promise<Result<boolean, string>> {
    return this.executeWithErrorHandling(
      {
        operation: "deleteTemplate",
        metadata: { projectId, templateId },
      },
      async () => {
        const template = await this.prisma.template.findFirst({
          where: {
            id: templateId,
            projectId,
            deletedAt: null,
          },
        });

        if (!template) {
          return false;
        }

        await this.prisma.template.update({
          where: { id: templateId },
          data: {
            deletedAt: new Date(),
          },
        });

        return true;
      }
    );
  }

  async duplicateTemplate(
    projectId: string,
    templateId: string,
    newName?: string
  ): Promise<Result<Template | null, string>> {
    return this.executeWithErrorHandling(
      {
        operation: "duplicateTemplate",
        metadata: { projectId, templateId, newName },
      },
      async () => {
        const originalTemplateResult = await this.getTemplate(projectId, templateId);

        if (!originalTemplateResult.ok) {
          throw AppError.internal(`Failed to get template: ${originalTemplateResult.error}`);
        }

        if (!originalTemplateResult.value) {
          return null;
        }

        const originalTemplate = originalTemplateResult.value;

        const duplicatedResult = await this.createTemplate(projectId, {
          ...originalTemplate,
          name: newName || `${originalTemplate.name} (Copy)`,
          createdAt: new Date(),
          updatedAt: new Date(),
        });

        if (!duplicatedResult.ok) {
          throw AppError.internal(`Failed to create duplicate: ${duplicatedResult.error}`);
        }

        return duplicatedResult.value;
      }
    );
  }

  // ---------------------------------------------------------------------------
  // Compilation & Validation
  // ---------------------------------------------------------------------------

  async compileTemplate(
    projectId: string,
    templateId: string,
    context: Record<string, unknown>,
    platforms?: string[],
    abTestConfig?: ABTestConfig
  ): Promise<Result<any, string>> {
    return this.executeWithErrorHandling(
      {
        operation: "compileTemplate",
        metadata: { projectId, templateId, platforms },
      },
      async () => {
        const templateResult = await this.getTemplate(projectId, templateId);

        if (!templateResult.ok) {
          throw AppError.internal(`Failed to get template: ${templateResult.error}`);
        }

        if (!templateResult.value) {
          return null;
        }

        const template = templateResult.value;

        const compilationTemplate = {
          ...template,
          platforms: platforms || template.platforms,
        };

        const project = await this.prisma.project.findUnique({
          where: { id: projectId },
          select: { id: true, name: true },
        });

        if (!project) {
          throw AppError.notFound("Project");
        }

        const enhancedContext = {
          ...context,
          project: {
            id: project.id,
            name: project.name,
            ...((context.project as object) || {}),
          },
          template: {
            id: template.id,
            name: template.name,
            category: template.category,
            version: template.version,
          },
        };

        if (abTestConfig?.enabled) {
          return await this.templateEngine.compileWithABTest(
            compilationTemplate,
            enhancedContext,
            abTestConfig
          );
        } else {
          return await this.templateEngine.compileTemplate(compilationTemplate, enhancedContext);
        }
      }
    );
  }

  async compileTemplateWithComponents(
    projectId: string,
    templateId: string,
    context: Record<string, unknown>
  ): Promise<Result<any, string>> {
    return this.executeWithErrorHandling(
      {
        operation: "compileTemplateWithComponents",
        metadata: { projectId, templateId },
      },
      async () => {
        const templateResult = await this.getTemplate(projectId, templateId);

        if (!templateResult.ok) {
          throw AppError.internal(`Failed to get template: ${templateResult.error}`);
        }

        if (!templateResult.value) {
          return null;
        }

        const template = templateResult.value;

        const project = await this.prisma.project.findUnique({
          where: { id: projectId },
          select: { id: true, name: true },
        });

        if (!project) {
          throw AppError.notFound("Project");
        }

        const enhancedContext = {
          ...context,
          project: {
            id: project.id,
            name: project.name,
            ...((context.project as object) || {}),
          },
        };

        return await this.templateEngine.compileTemplateWithComponents(template, enhancedContext);
      }
    );
  }

  async validateTemplate(
    projectId: string,
    templateId: string
  ): Promise<Result<{ valid: boolean; errors: string[] }, string>> {
    return this.executeWithErrorHandling(
      {
        operation: "validateTemplate",
        metadata: { projectId, templateId },
      },
      async () => {
        const templateResult = await this.getTemplate(projectId, templateId);

        if (!templateResult.ok) {
          throw AppError.internal(`Failed to get template: ${templateResult.error}`);
        }

        if (!templateResult.value) {
          return { valid: false, errors: ["Template not found"] };
        }

        const template = templateResult.value;

        return this.templateEngine.validateTemplate(template);
      }
    );
  }

  async getPlatformLimits(platform: string): Promise<Result<any, string>> {
    return this.executeWithErrorHandling(
      {
        operation: "getPlatformLimits",
        metadata: { platform },
      },
      async () => {
        return this.templateEngine.getPlatformLimits(platform);
      }
    );
  }

  async getSupportedPlatforms(): Promise<Result<string[], string>> {
    return this.executeWithErrorHandling(
      {
        operation: "getSupportedPlatforms",
      },
      async () => {
        return this.templateEngine.getSupportedPlatforms();
      }
    );
  }

  // ---------------------------------------------------------------------------
  // Version management — delegated to TemplateVersionService
  // ---------------------------------------------------------------------------

  async getTemplateVersions(
    projectId: string,
    templateId: string
  ): Promise<Result<TemplateVersion[], string>> {
    return this.versionService.getTemplateVersions(projectId, templateId);
  }

  async createTemplateVersion(
    projectId: string,
    templateId: string,
    versionData: Omit<TemplateVersion, "id" | "createdAt">
  ): Promise<Result<TemplateVersion, string>> {
    return this.versionService.createTemplateVersion(projectId, templateId, versionData);
  }

  async restoreTemplateVersion(
    projectId: string,
    templateId: string,
    versionId: string
  ): Promise<Result<Template | null, string>> {
    return this.versionService.restoreTemplateVersion(projectId, templateId, versionId);
  }

  // ---------------------------------------------------------------------------
  // A/B Testing — delegated to TemplateABTestService
  // ---------------------------------------------------------------------------

  async getABTests(
    projectId: string,
    status?: ABTest["status"]
  ): Promise<Result<ABTest[], string>> {
    return this.abTestService.getABTests(projectId, status);
  }

  async createABTest(
    projectId: string,
    testData: {
      name: string;
      description?: string;
      templateId: string;
      config: ABTestConfig;
    }
  ): Promise<Result<ABTest, string>> {
    return this.abTestService.createABTest(projectId, testData);
  }

  async startABTest(projectId: string, testId: string): Promise<Result<ABTest | null, string>> {
    return this.abTestService.startABTest(projectId, testId);
  }

  async stopABTest(projectId: string, testId: string): Promise<Result<ABTest | null, string>> {
    return this.abTestService.stopABTest(projectId, testId);
  }
}
