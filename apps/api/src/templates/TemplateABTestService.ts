/**
 * @file TemplateABTestService.ts
 * @description A/B testing service for content templates: creation, lifecycle transitions,
 *              result queries, and test-to-template association management.
 * @layer infrastructure
 */
import type { Prisma, PrismaClient } from "@infra/prisma";
import { BaseService } from "../services/BaseService";
import { Result } from "@shared/types";
import type { ABTest, ABTestConfig } from "./templateTypes.js";
import { AppError } from "../lib/errors/AppError.js";

/**
 * Maps a database A/B test record to the ABTest interface.
 */
function mapToABTest(dbTest: Record<string, unknown>): ABTest {
  const t = dbTest as {
    id: string;
    name: string;
    description: string;
    templateId: string;
    config: ABTest["config"];
    status: ABTest["status"];
    startDate: Date;
    endDate: Date;
    createdAt: Date;
    updatedAt: Date;
  };
  return {
    id: t.id,
    name: t.name,
    description: t.description,
    templateId: t.templateId,
    config: t.config,
    status: t.status,
    startDate: t.startDate,
    endDate: t.endDate,
    createdAt: t.createdAt,
    updatedAt: t.updatedAt,
  };
}

export class TemplateABTestService extends BaseService {
  constructor(private readonly prisma: PrismaClient) {
    super("TemplateABTestService");
  }

  async getABTests(
    projectId: string,
    status?: ABTest["status"]
  ): Promise<Result<ABTest[], string>> {
    return this.executeWithErrorHandling(
      {
        operation: "getABTests",
        metadata: { projectId, status },
      },
      async () => {
        const where: Prisma.ABTestWhereInput = {
          template: {
            projectId,
            deletedAt: null,
          },
        };

        if (status) {
          where.status = status;
        }

        const tests = await this.prisma.aBTest.findMany({
          where,
          orderBy: { createdAt: "desc" },
          include: {
            template: true,
          },
        });

        return tests.map(mapToABTest);
      }
    );
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
    return this.executeWithErrorHandling(
      {
        operation: "createABTest",
        metadata: { projectId, testName: testData.name, templateId: testData.templateId },
      },
      async () => {
        // Validate template exists
        const template = await this.prisma.template.findFirst({
          where: {
            id: testData.templateId,
            projectId,
            deletedAt: null,
          },
        });

        if (!template) {
          throw AppError.notFound("Template");
        }

        const test = await this.prisma.aBTest.create({
          data: {
            name: testData.name,
            ...(testData.description !== undefined && { description: testData.description }),
            templateId: testData.templateId,
            config: testData.config as unknown as Prisma.InputJsonValue,
            status: "DRAFT",
            createdAt: new Date(),
            updatedAt: new Date(),
          },
          include: {
            template: true,
          },
        });

        return mapToABTest(test);
      }
    );
  }

  async startABTest(projectId: string, testId: string): Promise<Result<ABTest | null, string>> {
    return this.executeWithErrorHandling(
      {
        operation: "startABTest",
        metadata: { projectId, testId },
      },
      async () => {
        const test = await this.prisma.aBTest.findFirst({
          where: {
            id: testId,
            template: {
              projectId,
              deletedAt: null,
            },
          },
          include: {
            template: true,
          },
        });

        if (!test) {
          return null;
        }

        const updatedTest = await this.prisma.aBTest.update({
          where: { id: testId },
          data: {
            status: "RUNNING",
            startDate: new Date(),
            updatedAt: new Date(),
          },
          include: {
            template: true,
          },
        });

        return mapToABTest(updatedTest);
      }
    );
  }

  async stopABTest(projectId: string, testId: string): Promise<Result<ABTest | null, string>> {
    return this.executeWithErrorHandling(
      {
        operation: "stopABTest",
        metadata: { projectId, testId },
      },
      async () => {
        const test = await this.prisma.aBTest.findFirst({
          where: {
            id: testId,
            template: {
              projectId,
              deletedAt: null,
            },
          },
          include: {
            template: true,
          },
        });

        if (!test) {
          return null;
        }

        const updatedTest = await this.prisma.aBTest.update({
          where: { id: testId },
          data: {
            status: "STOPPED",
            endDate: new Date(),
            updatedAt: new Date(),
          },
          include: {
            template: true,
          },
        });

        return mapToABTest(updatedTest);
      }
    );
  }
}
