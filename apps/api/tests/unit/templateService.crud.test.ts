/**
 * Unit Tests for TemplateService - CRUD Operations
 *
 * Covers: Get Templates, Get Template, Create Template, Update Template, Delete Template
 *
 * @file templateService.crud.test.ts
 * @description Tests for TemplateService - Get Templates
 * @layer infrastructure
 */

import "./templateRoutes.env-setup.js";
import { describe, it, beforeEach, afterEach, expect, vi } from "vitest";

vi.mock("@infra/prisma", async (importOriginal) => {
  const { vi: _vi } = await import("vitest");
  const { buildModelMock, createStore } = await import("./helpers/mockPrisma.js");

  const tStore = createStore();
  const tvStore = createStore();
  const pStore = createStore();
  const abStore = createStore();

  const p: Record<string, unknown> = {
    template: buildModelMock(tStore),
    templateVersion: buildModelMock(tvStore),
    project: buildModelMock(pStore),
    aBTest: buildModelMock(abStore),
    $connect: _vi.fn(async () => undefined),
    $disconnect: _vi.fn(async () => undefined),
  };
  p.$transaction = _vi.fn(async (fnOrArray: unknown) => {
    if (typeof fnOrArray === "function") {
      return (fnOrArray as (tx: unknown) => Promise<unknown>)(p);
    }
    return Promise.all(fnOrArray as Promise<unknown>[]);
  });

  const original = await importOriginal<Record<string, unknown>>();
  return { ...original, prisma: p };
});

vi.mock("../../src/lib/logger.js", () => {
  const noop = () => {};
  const noopLogger = {
    info: noop,
    warn: noop,
    error: noop,
    debug: noop,
    trace: noop,
    fatal: noop,
    child: () => noopLogger,
  };
  return { logger: noopLogger, authLogger: noopLogger, createLogger: () => noopLogger };
});

import { prisma } from "@infra/prisma";
import { TemplateService } from "../../src/templates/templateService";
import { mockPrismaMethod, restoreMock } from "./templateService.test-helpers.js";

describe("TemplateService - Get Templates", () => {
  let service: TemplateService;
  const mocks: any[] = [];

  beforeEach(() => {
    service = new TemplateService();
    for (const m of mocks) {
      restoreMock(m);
    }
    mocks.length = 0;
  });

  afterEach(() => {
    for (const m of mocks) {
      restoreMock(m);
    }
    mocks.length = 0;
  });

  it("should retrieve templates for a project", async () => {
    const findMany = mockPrismaMethod(prisma.template, "findMany");
    mocks.push(findMany);

    findMany.mockImplementationOnce(() =>
      Promise.resolve([
        {
          id: "template-1",
          name: "Test Template",
          category: "social",
          content: "Test content",
          variables: [],
          platforms: ["TWITTER"],
          variants: [],
          tags: ["test"],
          version: 1,
          createdAt: new Date(),
          updatedAt: new Date(),
          project: { id: "project-123", name: "Test" },
          versions: [],
        },
      ])
    );

    const result = await service.getTemplates("project-123");

    expect(result.ok).toBe(true);
    expect(result.value).toBeTruthy();
    expect(result.value.length).toBe(1);
    expect(result.value[0]!.name).toBe("Test Template");
  });

  it("should filter templates by category", async () => {
    const findMany = mockPrismaMethod(prisma.template, "findMany");
    mocks.push(findMany);

    findMany.mockImplementationOnce((args: any) => {
      expect(args.where.category).toBe("professional");
      return Promise.resolve([]);
    });

    const result = await service.getTemplates("project-123", { category: "professional" });

    expect(result.ok).toBe(true);
  });

  it("should filter templates by platform", async () => {
    const findMany = mockPrismaMethod(prisma.template, "findMany");
    mocks.push(findMany);

    findMany.mockImplementationOnce((args: any) => {
      expect(args.where.platforms).toStrictEqual({ has: "LINKEDIN" });
      return Promise.resolve([]);
    });

    await service.getTemplates("project-123", { platform: "LINKEDIN" });
  });

  it("should filter templates by tags", async () => {
    const findMany = mockPrismaMethod(prisma.template, "findMany");
    mocks.push(findMany);

    findMany.mockImplementationOnce((args: any) => {
      expect(args.where.tags).toStrictEqual({ hasSome: ["tag1", "tag2"] });
      return Promise.resolve([]);
    });

    await service.getTemplates("project-123", { tags: ["tag1", "tag2"] });
  });

  it("should search templates by name and content", async () => {
    const findMany = mockPrismaMethod(prisma.template, "findMany");
    mocks.push(findMany);

    findMany.mockImplementationOnce((args: any) => {
      expect(args.where.OR).toBeTruthy();
      expect(args.where.OR.length).toBe(3);
      return Promise.resolve([]);
    });

    await service.getTemplates("project-123", { search: "keyword" });
  });

  it("should apply pagination limits", async () => {
    const findMany = mockPrismaMethod(prisma.template, "findMany");
    mocks.push(findMany);

    findMany.mockImplementationOnce((args: any) => {
      expect(args.take).toBe(10);
      expect(args.skip).toBe(20);
      return Promise.resolve([]);
    });

    await service.getTemplates("project-123", {}, { limit: 10, offset: 20 });
  });

  it("should exclude deleted templates", async () => {
    const findMany = mockPrismaMethod(prisma.template, "findMany");
    mocks.push(findMany);

    findMany.mockImplementationOnce((args: any) => {
      expect(args.where.deletedAt).toBe(null);
      return Promise.resolve([]);
    });

    await service.getTemplates("project-123");
  });
});

describe("TemplateService - Get Template", () => {
  let service: TemplateService;
  const mocks: any[] = [];

  beforeEach(() => {
    service = new TemplateService();
    for (const m of mocks) {
      restoreMock(m);
    }
    mocks.length = 0;
  });

  afterEach(() => {
    for (const m of mocks) {
      restoreMock(m);
    }
    mocks.length = 0;
  });

  it("should retrieve single template by ID", async () => {
    const findFirst = mockPrismaMethod(prisma.template, "findFirst");
    mocks.push(findFirst);

    findFirst.mockImplementationOnce(() =>
      Promise.resolve({
        id: "template-456",
        name: "Single Template",
        category: "social",
        content: "Content here",
        variables: [],
        platforms: ["TWITTER"],
        variants: [],
        tags: [],
        version: 1,
        createdAt: new Date(),
        updatedAt: new Date(),
        versions: [],
      })
    );

    const result = await service.getTemplate("project-123", "template-456");

    expect(result.ok).toBe(true);
    expect(result.value).toBeTruthy();
    expect(result.value.id).toBe("template-456");
  });

  it("should return null for non-existent template", async () => {
    const findFirst = mockPrismaMethod(prisma.template, "findFirst");
    mocks.push(findFirst);

    findFirst.mockImplementationOnce(() => Promise.resolve(null));

    const result = await service.getTemplate("project-123", "nonexistent");

    expect(result.ok).toBe(true);
    expect(result.value).toBe(null);
  });

  it("should include versions in query", async () => {
    const findFirst = mockPrismaMethod(prisma.template, "findFirst");
    mocks.push(findFirst);

    findFirst.mockImplementationOnce((args: any) => {
      expect(args.include.versions).toBeTruthy();
      return Promise.resolve(null);
    });

    await service.getTemplate("project-123", "template-456");
  });

  it("should filter by project ID", async () => {
    const findFirst = mockPrismaMethod(prisma.template, "findFirst");
    mocks.push(findFirst);

    findFirst.mockImplementationOnce((args: any) => {
      expect(args.where.projectId).toBe("project-123");
      return Promise.resolve(null);
    });

    await service.getTemplate("project-123", "template-456");
  });
});

describe("TemplateService - Create Template", () => {
  let service: TemplateService;
  const mocks: any[] = [];

  beforeEach(() => {
    service = new TemplateService();
    for (const m of mocks) {
      restoreMock(m);
    }
    mocks.length = 0;
  });

  afterEach(() => {
    for (const m of mocks) {
      restoreMock(m);
    }
    mocks.length = 0;
  });

  it("should create new template", async () => {
    const projectFindUnique = mockPrismaMethod(prisma.project, "findUnique");
    const templateCreate = mockPrismaMethod(prisma.template, "create");
    const templateFindFirst = mockPrismaMethod(prisma.template, "findFirst");
    const versionUpdateMany = mockPrismaMethod(prisma.templateVersion, "updateMany");
    const versionCreate = mockPrismaMethod(prisma.templateVersion, "create");
    mocks.push(
      projectFindUnique,
      templateCreate,
      templateFindFirst,
      versionUpdateMany,
      versionCreate
    );

    projectFindUnique.mockImplementationOnce(() =>
      Promise.resolve({ id: "project-123", accountId: "account-456" })
    );

    templateCreate.mockImplementationOnce(() =>
      Promise.resolve({
        id: "new-template",
        name: "New Template",
        category: "social",
        content: "Template content",
        variables: [],
        platforms: ["TWITTER"],
        variants: [],
        tags: [],
        version: 1,
        createdAt: new Date(),
        updatedAt: new Date(),
        versions: [],
      })
    );

    versionUpdateMany.mockImplementationOnce(() => Promise.resolve({ count: 0 }));

    versionCreate.mockImplementationOnce(() =>
      Promise.resolve({
        id: "version-1",
        templateId: "new-template",
        version: 1,
        content: "Template content",
        variables: [],
        platforms: ["TWITTER"],
        tags: [],
        changeLog: "Initial version",
        author: { id: "system", name: "System" },
        isActive: true,
        branchName: "main",
        createdAt: new Date(),
      })
    );

    const templateData = {
      name: "New Template",
      category: "social",
      content: "Template content",
      variables: [] as any[],
      platforms: ["TWITTER"],
    };

    const result = await service.createTemplate("project-123", templateData);

    expect(result.ok).toBe(true);
    expect(result.value).toBeTruthy();
    expect(result.value.name).toBe("New Template");
  });

  it("should fail for non-existent project", async () => {
    const projectFindUnique = mockPrismaMethod(prisma.project, "findUnique");
    mocks.push(projectFindUnique);

    projectFindUnique.mockImplementationOnce(() => Promise.resolve(null));

    const templateData = {
      name: "Template",
      category: "social",
      content: "Content",
      variables: [] as any[],
      platforms: ["TWITTER"],
    };

    const result = await service.createTemplate("nonexistent-project", templateData);

    expect(result.ok).toBe(false);
  });

  it("should create initial version", async () => {
    const projectFindUnique = mockPrismaMethod(prisma.project, "findUnique");
    const templateCreate = mockPrismaMethod(prisma.template, "create");
    const versionUpdateMany = mockPrismaMethod(prisma.templateVersion, "updateMany");
    const versionCreate = mockPrismaMethod(prisma.templateVersion, "create");
    mocks.push(projectFindUnique, templateCreate, versionUpdateMany, versionCreate);

    projectFindUnique.mockImplementationOnce(() =>
      Promise.resolve({ id: "project-123", accountId: "account-456" })
    );

    templateCreate.mockImplementationOnce(() =>
      Promise.resolve({
        id: "template-1",
        name: "Test",
        category: "social",
        content: "Content",
        variables: [],
        platforms: ["TWITTER"],
        variants: [],
        tags: [],
        version: 1,
        createdAt: new Date(),
        updatedAt: new Date(),
        versions: [],
      })
    );

    versionUpdateMany.mockImplementationOnce(() => Promise.resolve({ count: 0 }));

    let versionCreated = false;
    versionCreate.mockImplementationOnce(() => {
      versionCreated = true;
      return Promise.resolve({
        id: "version-1",
        templateId: "template-1",
        version: 1,
        content: "Content",
        variables: [],
        platforms: ["TWITTER"],
        tags: [],
        changeLog: "Initial version",
        author: { id: "system", name: "System" },
        isActive: true,
        branchName: "main",
        createdAt: new Date(),
      });
    });

    await service.createTemplate("project-123", {
      name: "Test",
      category: "social",
      content: "Content",
      variables: [],
      platforms: ["TWITTER"],
    });

    expect(versionCreated).toBe(true);
  });
});

describe("TemplateService - Update Template", () => {
  let service: TemplateService;
  const mocks: any[] = [];

  beforeEach(() => {
    service = new TemplateService();
    for (const m of mocks) {
      restoreMock(m);
    }
    mocks.length = 0;
  });

  afterEach(() => {
    for (const m of mocks) {
      restoreMock(m);
    }
    mocks.length = 0;
  });

  it("should update existing template", async () => {
    const findFirst = mockPrismaMethod(prisma.template, "findFirst");
    const update = mockPrismaMethod(prisma.template, "update");
    mocks.push(findFirst, update);

    findFirst.mockImplementationOnce(() =>
      Promise.resolve({
        id: "template-1",
        version: 1,
      })
    );

    update.mockImplementationOnce(() =>
      Promise.resolve({
        id: "template-1",
        name: "Updated Template",
        category: "social",
        content: "Updated content",
        variables: [],
        platforms: ["TWITTER"],
        variants: [],
        tags: [],
        version: 2,
        createdAt: new Date(),
        updatedAt: new Date(),
        versions: [],
      })
    );

    const result = await service.updateTemplate("project-123", "template-1", {
      name: "Updated Template",
      content: "Updated content",
    });

    expect(result.ok).toBe(true);
    expect(result.value).toBeTruthy();
    expect(result.value.name).toBe("Updated Template");
  });

  it("should increment version number", async () => {
    const findFirst = mockPrismaMethod(prisma.template, "findFirst");
    const update = mockPrismaMethod(prisma.template, "update");
    mocks.push(findFirst, update);

    findFirst.mockImplementationOnce(() => Promise.resolve({ id: "template-1", version: 3 }));

    update.mockImplementationOnce((args: any) => {
      expect(args.data.version).toBe(4);
      return Promise.resolve({
        id: "template-1",
        name: "Template",
        category: "social",
        content: "Content",
        variables: [],
        platforms: ["TWITTER"],
        variants: [],
        tags: [],
        version: 4,
        createdAt: new Date(),
        updatedAt: new Date(),
        versions: [],
      });
    });

    await service.updateTemplate("project-123", "template-1", { content: "New content" });
  });

  it("should return null for non-existent template", async () => {
    const findFirst = mockPrismaMethod(prisma.template, "findFirst");
    mocks.push(findFirst);

    findFirst.mockImplementationOnce(() => Promise.resolve(null));

    const result = await service.updateTemplate("project-123", "nonexistent", {
      name: "Updated",
    });

    expect(result.ok).toBe(true);
    expect(result.value).toBe(null);
  });
});

describe("TemplateService - Delete Template", () => {
  let service: TemplateService;
  const mocks: any[] = [];

  beforeEach(() => {
    service = new TemplateService();
    for (const m of mocks) {
      restoreMock(m);
    }
    mocks.length = 0;
  });

  afterEach(() => {
    for (const m of mocks) {
      restoreMock(m);
    }
    mocks.length = 0;
  });

  it("should soft delete template", async () => {
    const findFirst = mockPrismaMethod(prisma.template, "findFirst");
    const update = mockPrismaMethod(prisma.template, "update");
    mocks.push(findFirst, update);

    findFirst.mockImplementationOnce(() => Promise.resolve({ id: "template-1" }));

    update.mockImplementationOnce((args: any) => {
      expect(args.data.deletedAt).toBeTruthy();
      return Promise.resolve({ id: "template-1" });
    });

    const result = await service.deleteTemplate("project-123", "template-1");

    expect(result.ok).toBe(true);
    expect(result.value).toBe(true);
  });

  it("should return false for non-existent template", async () => {
    const findFirst = mockPrismaMethod(prisma.template, "findFirst");
    mocks.push(findFirst);

    findFirst.mockImplementationOnce(() => Promise.resolve(null));

    const result = await service.deleteTemplate("project-123", "nonexistent");

    expect(result.ok).toBe(true);
    expect(result.value).toBe(false);
  });
});
