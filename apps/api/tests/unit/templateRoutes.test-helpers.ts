import { vi } from "vitest";
import Fastify, { FastifyInstance } from "fastify";
import { templateRoutes } from "../../src/templates/templateRoutes.js";
import { templateService } from "../../src/templates/templateService.js";
import { templateAnalytics } from "../../src/templates/templateAnalytics.js";
import { setupContainer } from "../../src/infrastructure/container/setup.js";
import { TOKENS } from "../../src/infrastructure/container/types.js";

// Mock PrismaClient for unit tests (no real DB connection needed)
const mockPrisma = {} as any;

export const mockTemplateService = {
  getTemplates: vi.fn(async () => ({
    ok: true,
    value: [
      {
        id: "template-1",
        name: "Test Template",
        description: "Test description",
        category: "social",
        content: "Hello {{name}}",
        variables: [{ name: "name", type: "string", required: true }],
        platforms: ["x", "instagram"],
        tags: ["test"],
        version: 1,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ],
  })),
  getTemplate: vi.fn(async () => ({
    ok: true,
    value: {
      id: "template-1",
      name: "Test Template",
      category: "social",
      content: "Hello {{name}}",
      variables: [],
      platforms: ["x"],
      tags: [],
      version: 1,
    },
  })),
  createTemplate: vi.fn(async (_projectId: string, data: any) => ({
    ok: true,
    value: {
      id: "new-template-id",
      ...data,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
  })),
  updateTemplate: vi.fn(async (_projectId: string, _templateId: string, data: any) => ({
    ok: true,
    value: {
      id: "template-1",
      ...data,
      updatedAt: new Date(),
    },
  })),
  deleteTemplate: vi.fn(async () => ({ ok: true, value: true })),
  duplicateTemplate: vi.fn(async (_projectId: string, _templateId: string, name: string) => ({
    ok: true,
    value: {
      id: "duplicated-template-id",
      name,
      category: "social",
      content: "Duplicated content",
      variables: [],
      platforms: ["x"],
      tags: [],
    },
  })),
  compileTemplate: vi.fn(async () => ({
    ok: true,
    value: {
      compiled: "Hello John",
      platforms: ["x"],
    },
  })),
  validateTemplate: vi.fn(async () => ({
    ok: true,
    value: { valid: true, errors: [] },
  })),
  getTemplateVersions: vi.fn(async () => ({
    ok: true,
    value: [
      {
        id: "version-1",
        templateId: "template-1",
        version: 1,
        content: "Version 1 content",
        variables: ["name"],
        platforms: ["x"],
        tags: [],
        changeLog: "Initial version",
        author: { id: "user-1", name: "Test User" },
        createdAt: new Date(),
        isActive: true,
        branchName: "main",
      },
    ],
  })),
  createTemplateVersion: vi.fn(async () => ({
    ok: true,
    value: {
      id: "new-version-id",
      version: 2,
      content: "New version content",
      isActive: true,
    },
  })),
  restoreTemplateVersion: vi.fn(async () => ({
    ok: true,
    value: {
      id: "template-1",
      content: "Restored content",
      version: 3,
    },
  })),
  getABTests: vi.fn(async () => ({
    ok: true,
    value: [
      {
        id: "test-1",
        name: "Test A/B",
        templateId: "template-1",
        status: "RUNNING",
        config: { variants: [] },
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ],
  })),
  createABTest: vi.fn(async (_projectId: string, data: any) => ({
    ok: true,
    value: {
      id: "new-test-id",
      ...data,
      status: "DRAFT",
      createdAt: new Date(),
      updatedAt: new Date(),
    },
  })),
  startABTest: vi.fn(async () => ({
    ok: true,
    value: {
      id: "test-1",
      status: "RUNNING",
      startDate: new Date(),
    },
  })),
  stopABTest: vi.fn(async () => ({
    ok: true,
    value: {
      id: "test-1",
      status: "STOPPED",
      endDate: new Date(),
    },
  })),
  getPlatformLimits: vi.fn(async (platform: string) => ({
    ok: true,
    value: {
      platform,
      maxChars: platform === "x" ? 280 : 2200,
      maxMediaPerPost: platform === "x" ? 4 : 10,
    },
  })),
  getSupportedPlatforms: vi.fn(async () => ({
    ok: true,
    value: ["x", "instagram", "facebook", "linkedin"],
  })),
};

Object.assign(templateService, mockTemplateService);

export async function createTestApp(): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });

  const container = setupContainer({ prisma: mockPrisma });
  container.registerInstance(TOKENS.TemplateService, templateService);
  container.registerInstance(TOKENS.TemplateAnalytics, templateAnalytics);

  app.decorate("container", container);

  await app.register(templateRoutes);

  return app;
}

export const projectId = "550e8400-e29b-41d4-a716-446655440000";
export const templateId = "660e8400-e29b-41d4-a716-446655440001";
export const versionId = "770e8400-e29b-41d4-a716-446655440002";
export const testId = "880e8400-e29b-41d4-a716-446655440003";
