/**
 * Unit Tests for TemplateService - Versioning, Duplication, Compilation, A/B Testing
 *
 * Covers: Duplicate Template, Compile Template, Version Management, A/B Testing
 *
 * @file templateService.versions.test.ts
 * @description Tests for TemplateService - Duplicate Template
 * @layer infrastructure
 */

import "./templateRoutes.env-setup.js";
import { describe, it, beforeEach, afterEach, expect, vi } from "vitest";

vi.mock("@infra/prisma", async (importOriginal) => {
  const { vi: _vi } = await import("vitest");
  const { buildModelMock, createStore } = await import("./helpers/mockPrisma.js");

  const p: Record<string, unknown> = {
    template: buildModelMock(createStore()),
    templateVersion: buildModelMock(createStore()),
    project: buildModelMock(createStore()),
    aBTest: buildModelMock(createStore()),
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
import { TemplateService } from "../../src/templates/templateService.js";
import { mockPrismaMethod, restoreMock } from "./templateService.test-helpers.js";

describe("TemplateService - Duplicate Template", () => {
  let service: TemplateService;
  const mocks: any[] = [];

  beforeEach(() => {
    service = new TemplateService(prisma);
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

  it("should duplicate existing template", async () => {
    const findFirst = mockPrismaMethod(prisma.template, "findFirst");
    const projectFindUnique = mockPrismaMethod(prisma.project, "findUnique");
    const templateCreate = mockPrismaMethod(prisma.template, "create");
    const versionUpdateMany = mockPrismaMethod(prisma.templateVersion, "updateMany");
    const versionCreate = mockPrismaMethod(prisma.templateVersion, "create");
    mocks.push(findFirst, projectFindUnique, templateCreate, versionUpdateMany, versionCreate);

    // First call: getTemplate (via findFirst) for the original
    findFirst.mockImplementationOnce(() =>
      Promise.resolve({
        id: "original-template",
        name: "Original",
        category: "social",
        content: "Original content",
        variables: [],
        platforms: ["TWITTER"],
        variants: [],
        tags: ["original"],
        version: 1,
        createdAt: new Date(),
        updatedAt: new Date(),
        versions: [],
      })
    );

    projectFindUnique.mockImplementationOnce(() =>
      Promise.resolve({ id: "project-123", accountId: "account-456" })
    );

    templateCreate.mockImplementationOnce((args: any) => {
      expect(args.data.name.includes("Copy")).toBeTruthy();
      return Promise.resolve({
        id: "duplicated-template",
        name: "Original (Copy)",
        category: "social",
        content: "Original content",
        variables: [],
        platforms: ["TWITTER"],
        variants: [],
        tags: ["original"],
        version: 1,
        createdAt: new Date(),
        updatedAt: new Date(),
        versions: [],
      });
    });

    versionUpdateMany.mockImplementationOnce(() => Promise.resolve({ count: 0 }));

    versionCreate.mockImplementationOnce(() =>
      Promise.resolve({
        id: "version-1",
        templateId: "duplicated-template",
        version: 1,
        content: "Original content",
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

    const result = await service.duplicateTemplate("project-123", "original-template");

    expect(result.ok).toBe(true);
    expect(result.value).toBeTruthy();
    expect(result.value.name.includes("Copy")).toBeTruthy();
  });

  it("should use custom name for duplicate", async () => {
    const findFirst = mockPrismaMethod(prisma.template, "findFirst");
    const projectFindUnique = mockPrismaMethod(prisma.project, "findUnique");
    const templateCreate = mockPrismaMethod(prisma.template, "create");
    const versionUpdateMany = mockPrismaMethod(prisma.templateVersion, "updateMany");
    const versionCreate = mockPrismaMethod(prisma.templateVersion, "create");
    mocks.push(findFirst, projectFindUnique, templateCreate, versionUpdateMany, versionCreate);

    findFirst.mockImplementationOnce(() =>
      Promise.resolve({
        id: "original",
        name: "Original",
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

    projectFindUnique.mockImplementationOnce(() =>
      Promise.resolve({ id: "project-123", accountId: "account-456" })
    );

    templateCreate.mockImplementationOnce((args: any) => {
      expect(args.data.name).toBe("Custom Name");
      return Promise.resolve({
        id: "duplicate",
        name: "Custom Name",
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
      });
    });

    versionUpdateMany.mockImplementationOnce(() => Promise.resolve({ count: 0 }));

    versionCreate.mockImplementationOnce(() =>
      Promise.resolve({
        id: "version-1",
        templateId: "duplicate",
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
      })
    );

    await service.duplicateTemplate("project-123", "original", "Custom Name");
  });
});

describe("TemplateService - Compile Template", () => {
  let service: TemplateService;
  const mocks: any[] = [];

  beforeEach(() => {
    service = new TemplateService(prisma);
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

  it("should return null for non-existent template", async () => {
    const findFirst = mockPrismaMethod(prisma.template, "findFirst");
    mocks.push(findFirst);

    findFirst.mockImplementationOnce(() => Promise.resolve(null));

    const result = await service.compileTemplate("project-123", "nonexistent", {});

    expect(result.ok).toBe(true);
    expect(result.value).toBe(null);
  });
});

describe("TemplateService - Version Management", () => {
  let service: TemplateService;
  const mocks: any[] = [];

  beforeEach(() => {
    service = new TemplateService(prisma);
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

  it("should get template versions", async () => {
    const findMany = mockPrismaMethod(prisma.templateVersion, "findMany");
    mocks.push(findMany);

    findMany.mockImplementationOnce(() =>
      Promise.resolve([
        {
          id: "version-1",
          templateId: "template-1",
          version: 1,
          content: "Version 1 content",
          variables: [],
          platforms: ["TWITTER"],
          tags: [],
          changeLog: "Initial version",
          author: { id: "user-1", name: "User" },
          isActive: true,
          branchName: "main",
          createdAt: new Date(),
        },
      ])
    );

    const result = await service.getTemplateVersions("project-123", "template-1");

    expect(result.ok).toBe(true);
    expect(result.value).toBeTruthy();
    expect(result.value.length).toBe(1);
  });

  it("should create new template version", async () => {
    const updateMany = mockPrismaMethod(prisma.templateVersion, "updateMany");
    const create = mockPrismaMethod(prisma.templateVersion, "create");
    mocks.push(updateMany, create);

    updateMany.mockImplementationOnce(() => Promise.resolve({ count: 1 }));

    create.mockImplementationOnce(() =>
      Promise.resolve({
        id: "version-2",
        templateId: "template-1",
        version: 2,
        content: "Version 2 content",
        variables: [],
        platforms: ["TWITTER"],
        tags: [],
        changeLog: "Updated content",
        author: { id: "user-1", name: "User" },
        isActive: true,
        branchName: "main",
        createdAt: new Date(),
      })
    );

    const result = await service.createTemplateVersion("project-123", "template-1", {
      templateId: "template-1",
      version: 2,
      content: "Version 2 content",
      variables: [],
      platforms: ["TWITTER"],
      tags: [],
      changeLog: "Updated content",
      author: { id: "user-1", name: "User" },
      isActive: true,
    });

    expect(result.ok).toBe(true);
    expect(result.value).toBeTruthy();
  });

  it("should deactivate previous version when creating new active version", async () => {
    const updateMany = mockPrismaMethod(prisma.templateVersion, "updateMany");
    const create = mockPrismaMethod(prisma.templateVersion, "create");
    mocks.push(updateMany, create);

    let deactivateCalled = false;
    updateMany.mockImplementationOnce(() => {
      deactivateCalled = true;
      return Promise.resolve({ count: 1 });
    });

    create.mockImplementationOnce(() =>
      Promise.resolve({
        id: "version-new",
        templateId: "template-1",
        version: 3,
        content: "Content",
        variables: [],
        platforms: ["TWITTER"],
        tags: [],
        changeLog: "Change",
        author: { id: "user-1", name: "User" },
        isActive: true,
        branchName: "main",
        createdAt: new Date(),
      })
    );

    await service.createTemplateVersion("project-123", "template-1", {
      templateId: "template-1",
      version: 3,
      content: "Content",
      variables: [],
      platforms: ["TWITTER"],
      tags: [],
      changeLog: "Change",
      author: { id: "user-1", name: "User" },
      isActive: true,
    });

    expect(deactivateCalled).toBe(true);
  });
});

describe("TemplateService - A/B Testing", () => {
  let service: TemplateService;
  const mocks: any[] = [];

  beforeEach(() => {
    service = new TemplateService(prisma);
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

  it("should create A/B test", async () => {
    const templateFindFirst = mockPrismaMethod(prisma.template, "findFirst");
    const aBTestCreate = mockPrismaMethod(prisma.aBTest, "create");
    mocks.push(templateFindFirst, aBTestCreate);

    templateFindFirst.mockImplementationOnce(() => Promise.resolve({ id: "template-1" }));

    aBTestCreate.mockImplementationOnce(() =>
      Promise.resolve({
        id: "test-1",
        name: "Test A/B",
        templateId: "template-1",
        config: {
          enabled: true,
          variants: [],
        },
        status: "DRAFT",
        createdAt: new Date(),
        updatedAt: new Date(),
        template: { id: "template-1" },
      })
    );

    const result = await service.createABTest("project-123", {
      name: "Test A/B",
      templateId: "template-1",
      config: { enabled: true, variants: [] },
    });

    expect(result.ok).toBe(true);
    expect(result.value).toBeTruthy();
  });

  it("should start A/B test", async () => {
    const findFirst = mockPrismaMethod(prisma.aBTest, "findFirst");
    const update = mockPrismaMethod(prisma.aBTest, "update");
    mocks.push(findFirst, update);

    findFirst.mockImplementationOnce(() =>
      Promise.resolve({
        id: "test-1",
        status: "DRAFT",
        template: { id: "template-1" },
      })
    );

    update.mockImplementationOnce((args: any) => {
      expect(args.data.status).toBe("RUNNING");
      return Promise.resolve({
        id: "test-1",
        name: "Test",
        templateId: "template-1",
        config: { enabled: true, variants: [] },
        status: "RUNNING",
        startDate: new Date(),
        createdAt: new Date(),
        updatedAt: new Date(),
        template: { id: "template-1" },
      });
    });

    const result = await service.startABTest("project-123", "test-1");

    expect(result.ok).toBe(true);
    expect(result.value).toBeTruthy();
  });

  it("should stop A/B test", async () => {
    const findFirst = mockPrismaMethod(prisma.aBTest, "findFirst");
    const update = mockPrismaMethod(prisma.aBTest, "update");
    mocks.push(findFirst, update);

    findFirst.mockImplementationOnce(() =>
      Promise.resolve({
        id: "test-1",
        status: "RUNNING",
        template: { id: "template-1" },
      })
    );

    update.mockImplementationOnce((args: any) => {
      expect(args.data.status).toBe("STOPPED");
      return Promise.resolve({
        id: "test-1",
        name: "Test",
        templateId: "template-1",
        config: { enabled: true, variants: [] },
        status: "STOPPED",
        endDate: new Date(),
        createdAt: new Date(),
        updatedAt: new Date(),
        template: { id: "template-1" },
      });
    });

    const result = await service.stopABTest("project-123", "test-1");

    expect(result.ok).toBe(true);
    expect(result.value).toBeTruthy();
  });
});
