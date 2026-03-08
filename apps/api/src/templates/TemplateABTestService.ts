/**
 * Template A/B Test Service
 *
 * Manages A/B testing for content templates including creating, starting,
 * stopping, and querying A/B tests. Tests are associated with templates
 * and support lifecycle management through status transitions.
 *
 * @module templates/TemplateABTestService
 */
import { prisma } from "@infra/prisma";
import { Prisma } from "@infra/prisma";
import { BaseService } from "../services/BaseService";
import { Result } from "@shared/types";
import type { ABTest, ABTestConfig } from "./templateTypes.js";
import { AppError } from "../lib/errors/AppError.js";

/**
 * Maps a database A/B test record to the ABTest interface.
 */
function mapToABTest(dbTest: any): ABTest {
  return {
    id: dbTest.id,
    name: dbTest.name,
    description: dbTest.description,
    templateId: dbTest.templateId,
    config: dbTest.config,
    status: dbTest.status,
    startDate: dbTest.startDate,
    endDate: dbTest.endDate,
    createdAt: dbTest.createdAt,
    updatedAt: dbTest.updatedAt,
  };
}

export class TemplateABTestService extends BaseService {
  constructor() {
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

        const tests = await prisma.aBTest.findMany({
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
        const template = await prisma.template.findFirst({
          where: {
            id: testData.templateId,
            projectId,
            deletedAt: null,
          },
        });

        if (!template) {
          throw AppError.notFound("Template");
        }

        const test = await prisma.aBTest.create({
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
        const test = await prisma.aBTest.findFirst({
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

        const updatedTest = await prisma.aBTest.update({
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
        const test = await prisma.aBTest.findFirst({
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

        const updatedTest = await prisma.aBTest.update({
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
