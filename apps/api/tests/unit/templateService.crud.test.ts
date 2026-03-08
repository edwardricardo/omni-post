/**
 * Unit Tests for TemplateService - CRUD Operations
 *
 * Covers: Get Templates, Get Template, Create Template, Update Template, Delete Template
 */

import "./templateRoutes.env-setup.js";
import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "@infra/prisma";
import { TemplateService } from "../../src/templates/templateService";
import { mockPrismaMethod, restoreMock } from "./templateService.test-helpers.js";

describe("TemplateService - Get Templates", { concurrency: 1 }, () => {
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

    findMany.mock.mockImplementationOnce(() =>
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

    assert.strictEqual(result.ok, true);
    assert.ok(result.value);
    assert.strictEqual(result.value.length, 1);
    assert.strictEqual(result.value[0]!.name, "Test Template");
  });

  it("should filter templates by category", async () => {
    const findMany = mockPrismaMethod(prisma.template, "findMany");
    mocks.push(findMany);

    findMany.mock.mockImplementationOnce((args: any) => {
      assert.strictEqual(args.where.category, "professional");
      return Promise.resolve([]);
    });

    const result = await service.getTemplates("project-123", { category: "professional" });

    assert.strictEqual(result.ok, true);
  });

  it("should filter templates by platform", async () => {
    const findMany = mockPrismaMethod(prisma.template, "findMany");
    mocks.push(findMany);

    findMany.mock.mockImplementationOnce((args: any) => {
      assert.deepStrictEqual(args.where.platforms, { has: "LINKEDIN" });
      return Promise.resolve([]);
    });

    await service.getTemplates("project-123", { platform: "LINKEDIN" });
  });

  it("should filter templates by tags", async () => {
    const findMany = mockPrismaMethod(prisma.template, "findMany");
    mocks.push(findMany);

    findMany.mock.mockImplementationOnce((args: any) => {
      assert.deepStrictEqual(args.where.tags, { hasSome: ["tag1", "tag2"] });
      return Promise.resolve([]);
    });

    await service.getTemplates("project-123", { tags: ["tag1", "tag2"] });
  });

  it("should search templates by name and content", async () => {
    const findMany = mockPrismaMethod(prisma.template, "findMany");
    mocks.push(findMany);

    findMany.mock.mockImplementationOnce((args: any) => {
      assert.ok(args.where.OR);
      assert.strictEqual(args.where.OR.length, 3);
      return Promise.resolve([]);
    });

    await service.getTemplates("project-123", { search: "keyword" });
  });

  it("should apply pagination limits", async () => {
    const findMany = mockPrismaMethod(prisma.template, "findMany");
    mocks.push(findMany);

    findMany.mock.mockImplementationOnce((args: any) => {
      assert.strictEqual(args.take, 10);
      assert.strictEqual(args.skip, 20);
      return Promise.resolve([]);
    });

    await service.getTemplates("project-123", {}, { limit: 10, offset: 20 });
  });

  it("should exclude deleted templates", async () => {
    const findMany = mockPrismaMethod(prisma.template, "findMany");
    mocks.push(findMany);

    findMany.mock.mockImplementationOnce((args: any) => {
      assert.strictEqual(args.where.deletedAt, null);
      return Promise.resolve([]);
    });

    await service.getTemplates("project-123");
  });
});

describe("TemplateService - Get Template", { concurrency: 1 }, () => {
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

    findFirst.mock.mockImplementationOnce(() =>
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

    assert.strictEqual(result.ok, true);
    assert.ok(result.value);
    assert.strictEqual(result.value.id, "template-456");
  });

  it("should return null for non-existent template", async () => {
    const findFirst = mockPrismaMethod(prisma.template, "findFirst");
    mocks.push(findFirst);

    findFirst.mock.mockImplementationOnce(() => Promise.resolve(null));

    const result = await service.getTemplate("project-123", "nonexistent");

    assert.strictEqual(result.ok, true);
    assert.strictEqual(result.value, null);
  });

  it("should include versions in query", async () => {
    const findFirst = mockPrismaMethod(prisma.template, "findFirst");
    mocks.push(findFirst);

    findFirst.mock.mockImplementationOnce((args: any) => {
      assert.ok(args.include.versions);
      return Promise.resolve(null);
    });

    await service.getTemplate("project-123", "template-456");
  });

  it("should filter by project ID", async () => {
    const findFirst = mockPrismaMethod(prisma.template, "findFirst");
    mocks.push(findFirst);

    findFirst.mock.mockImplementationOnce((args: any) => {
      assert.strictEqual(args.where.projectId, "project-123");
      return Promise.resolve(null);
    });

    await service.getTemplate("project-123", "template-456");
  });
});

describe("TemplateService - Create Template", { concurrency: 1 }, () => {
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

    projectFindUnique.mock.mockImplementationOnce(() =>
      Promise.resolve({ id: "project-123", accountId: "account-456" })
    );

    templateCreate.mock.mockImplementationOnce(() =>
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

    versionUpdateMany.mock.mockImplementationOnce(() => Promise.resolve({ count: 0 }));

    versionCreate.mock.mockImplementationOnce(() =>
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

    assert.strictEqual(result.ok, true);
    assert.ok(result.value);
    assert.strictEqual(result.value.name, "New Template");
  });

  it("should fail for non-existent project", async () => {
    const projectFindUnique = mockPrismaMethod(prisma.project, "findUnique");
    mocks.push(projectFindUnique);

    projectFindUnique.mock.mockImplementationOnce(() => Promise.resolve(null));

    const templateData = {
      name: "Template",
      category: "social",
      content: "Content",
      variables: [] as any[],
      platforms: ["TWITTER"],
    };

    const result = await service.createTemplate("nonexistent-project", templateData);

    assert.strictEqual(result.ok, false);
  });

  it("should create initial version", async () => {
    const projectFindUnique = mockPrismaMethod(prisma.project, "findUnique");
    const templateCreate = mockPrismaMethod(prisma.template, "create");
    const versionUpdateMany = mockPrismaMethod(prisma.templateVersion, "updateMany");
    const versionCreate = mockPrismaMethod(prisma.templateVersion, "create");
    mocks.push(projectFindUnique, templateCreate, versionUpdateMany, versionCreate);

    projectFindUnique.mock.mockImplementationOnce(() =>
      Promise.resolve({ id: "project-123", accountId: "account-456" })
    );

    templateCreate.mock.mockImplementationOnce(() =>
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

    versionUpdateMany.mock.mockImplementationOnce(() => Promise.resolve({ count: 0 }));

    let versionCreated = false;
    versionCreate.mock.mockImplementationOnce(() => {
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

    assert.strictEqual(versionCreated, true);
  });
});

describe("TemplateService - Update Template", { concurrency: 1 }, () => {
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

    findFirst.mock.mockImplementationOnce(() =>
      Promise.resolve({
        id: "template-1",
        version: 1,
      })
    );

    update.mock.mockImplementationOnce(() =>
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

    assert.strictEqual(result.ok, true);
    assert.ok(result.value);
    assert.strictEqual(result.value.name, "Updated Template");
  });

  it("should increment version number", async () => {
    const findFirst = mockPrismaMethod(prisma.template, "findFirst");
    const update = mockPrismaMethod(prisma.template, "update");
    mocks.push(findFirst, update);

    findFirst.mock.mockImplementationOnce(() => Promise.resolve({ id: "template-1", version: 3 }));

    update.mock.mockImplementationOnce((args: any) => {
      assert.strictEqual(args.data.version, 4);
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

    findFirst.mock.mockImplementationOnce(() => Promise.resolve(null));

    const result = await service.updateTemplate("project-123", "nonexistent", {
      name: "Updated",
    });

    assert.strictEqual(result.ok, true);
    assert.strictEqual(result.value, null);
  });
});

describe("TemplateService - Delete Template", { concurrency: 1 }, () => {
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

    findFirst.mock.mockImplementationOnce(() => Promise.resolve({ id: "template-1" }));

    update.mock.mockImplementationOnce((args: any) => {
      assert.ok(args.data.deletedAt);
      return Promise.resolve({ id: "template-1" });
    });

    const result = await service.deleteTemplate("project-123", "template-1");

    assert.strictEqual(result.ok, true);
    assert.strictEqual(result.value, true);
  });

  it("should return false for non-existent template", async () => {
    const findFirst = mockPrismaMethod(prisma.template, "findFirst");
    mocks.push(findFirst);

    findFirst.mock.mockImplementationOnce(() => Promise.resolve(null));

    const result = await service.deleteTemplate("project-123", "nonexistent");

    assert.strictEqual(result.ok, true);
    assert.strictEqual(result.value, false);
  });
});
