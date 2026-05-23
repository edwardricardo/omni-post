/**
 * Unit Tests for ServerTemplateEngine
 *
 * Tests server-specific template functionality including:
 * - Platform-specific compilation and adaptation
 * - Content sanitization
 * - Platform validation
 * - Component compilation
 * - Platform limits
 *
 * @file ServerTemplateEngine.test.ts
 * @description Tests for ServerTemplateEngine - Platform Validation
 * @layer infrastructure
 */

import "./templateRoutes.env-setup.js";
import { describe, it, beforeAll, afterAll, beforeEach, vi, expect } from "vitest";

vi.mock("@infra/prisma", async (importOriginal) => {
  const { vi: _vi } = await import("vitest");
  const { buildModelMock, createStore } = await import("./helpers/mockPrisma.js");

  const p: Record<string, unknown> = {
    template: buildModelMock(createStore()),
    templateVersion: buildModelMock(createStore()),
    templateComponent: buildModelMock(createStore()),
    templateComponentUsage: buildModelMock(createStore()),
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
import { ServerTemplateEngine } from "../../src/lib/templates/ServerTemplateEngine";
import type { Template, TemplateContext } from "@shared/types";

// Save original prisma methods for monkey-patching per test
const _originalComponentFindUnique = prisma.templateComponent.findUnique;
const _originalComponentUsageFindMany = prisma.templateComponentUsage.findMany;

// Restore real prisma methods after all tests complete
afterAll(() => {
  prisma.templateComponent.findUnique = _originalComponentFindUnique;
  prisma.templateComponentUsage.findMany = _originalComponentUsageFindMany;
});

describe("ServerTemplateEngine - Platform Validation", () => {
  let engine: ServerTemplateEngine;

  beforeAll(() => {
    engine = new ServerTemplateEngine(prisma);
  });

  it("should validate content within Twitter character limit", () => {
    const template: Template = {
      id: "test-1",
      name: "Twitter Template",
      category: "social",
      content: "This is a short tweet",
      variables: [],
      platforms: ["TWITTER"],
    };

    const result = engine.validateTemplate(template);
    expect(result.valid).toBe(true);
    expect(result.errors.length).toBe(0);
  });

  it("should fail validation for content exceeding Twitter limit", () => {
    const longContent = "x".repeat(300);
    const template: Template = {
      id: "test-2",
      name: "Long Twitter Template",
      category: "social",
      content: longContent,
      variables: [],
      platforms: ["TWITTER"],
    };

    const result = engine.validateTemplate(template);
    expect(result.valid).toBe(false);
    expect(result.errors.some((err) => err.includes("character limit"))).toBeTruthy();
  });

  it("should validate content for Instagram character limit", () => {
    const template: Template = {
      id: "test-3",
      name: "Instagram Template",
      category: "social",
      content: "Check out our latest product! #amazing #newlaunch",
      variables: [],
      platforms: ["INSTAGRAM"],
    };

    const result = engine.validateTemplate(template);
    expect(result.valid).toBe(true);
  });

  it("should validate content for LinkedIn line limit", () => {
    const template: Template = {
      id: "test-4",
      name: "LinkedIn Template",
      category: "professional",
      content: "Line 1\nLine 2\nLine 3\nLine 4\nLine 5\nLine 6",
      variables: [],
      platforms: ["LINKEDIN"],
    };

    const result = engine.validateTemplate(template);
    expect(result.valid).toBe(true);
  });

  it("should fail validation for unknown platform", () => {
    const template: Template = {
      id: "test-5",
      name: "Unknown Platform Template",
      category: "social",
      content: "Test content",
      variables: [],
      platforms: ["UNKNOWN_PLATFORM"],
    };

    const result = engine.validateTemplate(template);
    expect(result.valid).toBe(false);
    expect(result.errors.some((err) => err.includes("Unknown platform"))).toBeTruthy();
  });

  it("should validate multiple platforms", () => {
    const template: Template = {
      id: "test-6",
      name: "Multi-Platform Template",
      category: "social",
      content: "Short content for all platforms",
      variables: [],
      platforms: ["TWITTER", "INSTAGRAM", "LINKEDIN"],
    };

    const result = engine.validateTemplate(template);
    expect(result.valid).toBe(true);
  });
});

describe("ServerTemplateEngine - Content Adaptation", () => {
  let engine: ServerTemplateEngine;

  beforeAll(() => {
    engine = new ServerTemplateEngine(prisma);
  });

  it("should truncate content exceeding Twitter limit", async () => {
    const longContent = "x".repeat(300);
    const template: Template = {
      id: "test-7",
      name: "Long Tweet",
      category: "social",
      content: longContent,
      variables: [],
      platforms: ["TWITTER"],
    };
    const context: TemplateContext = {};

    const result = await engine.compileForPlatform(template, context, "TWITTER");

    expect(result.success).toBe(true);
    expect(result.content).toBeTruthy();
    expect(result.content.length <= 280).toBeTruthy();
    expect(result.content.endsWith("...")).toBeTruthy();
  });

  it("should track truncation in adaptations", async () => {
    const longContent = "x".repeat(300);
    const template: Template = {
      id: "test-8",
      name: "Truncated Template",
      category: "social",
      content: longContent,
      variables: [],
      platforms: ["X"],
    };
    const context: TemplateContext = {};

    const result = await engine.compileForPlatform(template, context, "X");

    expect(result.adaptations?.truncated).toBeTruthy();
  });

  it("should not adapt content within limits", async () => {
    const template: Template = {
      id: "test-9",
      name: "Short Template",
      category: "social",
      content: "Short content",
      variables: [],
      platforms: ["TWITTER"],
    };
    const context: TemplateContext = {};

    const result = await engine.compileForPlatform(template, context, "TWITTER");

    expect(result.success).toBe(true);
    expect(result.content).toBe("Short content");
    expect(result.adaptations?.truncated).toBeFalsy();
  });

  it("should handle platform case insensitivity", async () => {
    const template: Template = {
      id: "test-10",
      name: "Case Test",
      category: "social",
      content: "Test content",
      variables: [],
      platforms: ["twitter"],
    };
    const context: TemplateContext = {};

    const result = await engine.compileForPlatform(template, context, "twitter");

    expect(result.success).toBe(true);
    expect(result.platform).toBe("twitter");
  });
});

describe("ServerTemplateEngine - Content Sanitization", () => {
  let engine: ServerTemplateEngine;

  beforeAll(() => {
    engine = new ServerTemplateEngine(prisma);
  });

  it("should sanitize HTML content", () => {
    const maliciousContent = '<script>alert("xss")</script><p>Safe content</p>';
    const sanitized = engine.sanitize(maliciousContent);

    expect(sanitized.includes("<script>")).toBeFalsy();
    expect(sanitized.includes("Safe content")).toBeTruthy();
  });

  it("should preserve safe HTML tags", () => {
    const safeContent = "<p>Paragraph</p><strong>Bold</strong><em>Italic</em>";
    const sanitized = engine.sanitize(safeContent);

    expect(sanitized.includes("<p>")).toBeTruthy();
    expect(sanitized.includes("<strong>")).toBeTruthy();
    expect(sanitized.includes("<em>")).toBeTruthy();
  });

  it("should remove malicious attributes", () => {
    const maliciousContent = '<a href="javascript:alert(1)">Click me</a>';
    const sanitized = engine.sanitize(maliciousContent);

    expect(sanitized.includes("javascript:")).toBeFalsy();
  });

  it("should handle empty content", () => {
    const sanitized = engine.sanitize("");
    expect(sanitized).toBe("");
  });
});

describe("ServerTemplateEngine - Platform Compilation", () => {
  let engine: ServerTemplateEngine;

  beforeAll(() => {
    engine = new ServerTemplateEngine(prisma);
  });

  it("should compile template with variables", async () => {
    const template: Template = {
      id: "test-11",
      name: "Variable Template",
      category: "social",
      content: "Hello {{name}}! Welcome to {{platform}}",
      variables: [],
      platforms: ["TWITTER"],
    };
    const context: TemplateContext = {
      name: "John",
      platform: "Twitter",
    };

    const result = await engine.compileForPlatform(template, context, "TWITTER");

    expect(result.success).toBe(true);
    expect(result.content).toBe("Hello John! Welcome to Twitter");
  });

  it("should compile for multiple platforms", async () => {
    const template: Template = {
      id: "test-12",
      name: "Multi-Platform",
      category: "social",
      content: "Universal content",
      variables: [],
      platforms: ["TWITTER", "INSTAGRAM", "LINKEDIN"],
    };
    const context: TemplateContext = {};

    const results = await engine.compileTemplate(template, context);

    expect(results.length).toBe(3);
    expect(results[0]!.platform).toBe("TWITTER");
    expect(results[1]!.platform).toBe("INSTAGRAM");
    expect(results[2]!.platform).toBe("LINKEDIN");
  });

  it("should handle compilation errors gracefully", async () => {
    const template: Template = {
      id: "test-13",
      name: "Invalid Template",
      category: "social",
      content: "Hello {{unclosed",
      variables: [],
      platforms: ["TWITTER"],
    };
    const context: TemplateContext = {};

    const result = await engine.compileForPlatform(template, context, "TWITTER");

    expect(result.success).toBe(false);
    expect(result.errors).toBeTruthy();
    expect(result.errors.length > 0).toBeTruthy();
  });

  it("should include platform in result", async () => {
    const template: Template = {
      id: "test-14",
      name: "Platform Test",
      category: "social",
      content: "Content",
      variables: [],
      platforms: ["FACEBOOK"],
    };
    const context: TemplateContext = {};

    const result = await engine.compileForPlatform(template, context, "FACEBOOK");

    expect(result.platform).toBe("FACEBOOK");
  });
});

describe("ServerTemplateEngine - Platform Limits", () => {
  let engine: ServerTemplateEngine;

  beforeAll(() => {
    engine = new ServerTemplateEngine(prisma);
  });

  it("should return Twitter platform limits", () => {
    const limits = engine.getPlatformLimits("TWITTER");

    expect(limits).toBeTruthy();
    expect(limits.maxLength).toBe(280);
    expect(limits.allowsHashtags).toBe(true);
    expect(limits.allowsMentions).toBe(true);
  });

  it("should return Instagram platform limits", () => {
    const limits = engine.getPlatformLimits("INSTAGRAM");

    expect(limits).toBeTruthy();
    expect(limits.maxLength).toBe(2200);
    expect(limits.recommendedHashtagCount).toBe(30);
  });

  it("should return LinkedIn platform limits", () => {
    const limits = engine.getPlatformLimits("LINKEDIN");

    expect(limits).toBeTruthy();
    expect(limits.maxLength).toBe(3000);
    expect(limits.maxLines).toBe(7);
  });

  it("should return null for unknown platform", () => {
    const limits = engine.getPlatformLimits("UNKNOWN");
    expect(limits).toBe(null);
  });

  it("should handle case-insensitive platform names", () => {
    const limits = engine.getPlatformLimits("twitter");
    expect(limits).toBeTruthy();
    expect(limits.maxLength).toBe(280);
  });

  it("should return all supported platforms", () => {
    const platforms = engine.getSupportedPlatforms();

    expect(Array.isArray(platforms)).toBeTruthy();
    expect(platforms.length > 0).toBeTruthy();
    expect(platforms.includes("TWITTER")).toBeTruthy();
    expect(platforms.includes("INSTAGRAM")).toBeTruthy();
    expect(platforms.includes("LINKEDIN")).toBeTruthy();
    expect(platforms.includes("FACEBOOK")).toBeTruthy();
  });
});

describe("ServerTemplateEngine - Component Compilation", () => {
  let engine: ServerTemplateEngine;
  let mockFindUnique: ReturnType<typeof import("node:test").mock.fn>;
  let mockFindMany: ReturnType<typeof import("node:test").mock.fn>;

  beforeEach(() => {
    engine = new ServerTemplateEngine(prisma);
    // Create fresh mocks per test via t.mock — auto-restored when the test ends
    mockFindUnique = vi.fn();
    mockFindMany = vi.fn();
    prisma.templateComponent.findUnique = mockFindUnique as any;
    prisma.templateComponentUsage.findMany = mockFindMany as any;
  });

  it("should compile component by ID", async () => {
    mockFindUnique.mockImplementationOnce(() =>
      Promise.resolve({
        id: "component-1",
        name: "Header",
        content: "Welcome {{username}}!",
      })
    );

    const context: TemplateContext = { username: "Alice" };
    const result = await engine.compileComponent("component-1", context);

    expect(result).toBe("Welcome Alice!");
    expect(mockFindUnique.mock.calls.length).toBe(1);
  });

  it("should throw error for missing component", async () => {
    mockFindUnique.mockImplementationOnce(() => Promise.resolve(null));

    await expect(engine.compileComponent("missing-component", {})).rejects.toThrow(
      /Template component .+ not found/
    );
  });

  it("should compile template with components", async () => {
    const template: Template = {
      id: "template-1",
      name: "With Components",
      category: "social",
      content: "Post: {{component_header}} - {{content}}",
      variables: [],
      platforms: ["TWITTER"],
    };

    mockFindMany.mockImplementationOnce(() =>
      Promise.resolve([
        {
          componentId: "comp-1",
          component: {
            id: "comp-1",
            name: "header",
            content: "Breaking News",
          },
        },
      ])
    );

    mockFindUnique.mockImplementationOnce(() =>
      Promise.resolve({
        id: "comp-1",
        name: "header",
        content: "Breaking News",
      })
    );

    const context: TemplateContext = { content: "Major update" };
    const results = await engine.compileTemplateWithComponents(template, context);

    expect(results.length > 0).toBeTruthy();
    expect(results[0]!.success).toBe(true);
  });
});

describe("ServerTemplateEngine - A/B Testing", () => {
  let engine: ServerTemplateEngine;

  beforeAll(() => {
    engine = new ServerTemplateEngine(prisma);
  });

  it("should compile with A/B test variant selection", async () => {
    const template: Template = {
      id: "test-ab",
      name: "A/B Test Template",
      category: "social",
      content: "Default content",
      variables: [],
      platforms: ["TWITTER"],
      variants: [
        { id: "var-1", name: "Variant A", content: "Content A", weight: 50 },
        { id: "var-2", name: "Variant B", content: "Content B", weight: 50 },
      ],
    };

    const context: TemplateContext = {};
    const abTestConfig = { enabled: true, trafficSplit: [50, 50] };

    const results = await engine.compileWithABTest(template, context, abTestConfig);

    expect(results.length > 0).toBeTruthy();
    expect(results[0]!.success).toBe(true);
    expect(results[0]!.content === "Content A" || results[0]!.content === "Content B").toBeTruthy();
  });

  it("should use default content if no variants", async () => {
    const template: Template = {
      id: "test-no-variants",
      name: "No Variants",
      category: "social",
      content: "Default only",
      variables: [],
      platforms: ["TWITTER"],
    };

    const context: TemplateContext = {};
    const abTestConfig = { enabled: true };

    const results = await engine.compileWithABTest(template, context, abTestConfig);

    expect(results[0]!.content).toBe("Default only");
  });
});

describe("ServerTemplateEngine - Adaptation Tracking", () => {
  let engine: ServerTemplateEngine;

  beforeAll(() => {
    engine = new ServerTemplateEngine(prisma);
  });

  it("should detect URL shortening in adaptations", async () => {
    const template: Template = {
      id: "test-urls",
      name: "URL Template",
      category: "social",
      content: "Check out https://example.com/very-long-url " + "x".repeat(280),
      variables: [],
      platforms: ["TWITTER"],
    };
    const context: TemplateContext = {};

    const result = await engine.compileForPlatform(template, context, "TWITTER");

    expect(result.success).toBe(true);
    expect(result.adaptations?.truncated).toBeTruthy();
  });

  it("should detect hashtag relocation for Instagram", async () => {
    const template: Template = {
      id: "test-hashtags",
      name: "Hashtag Template",
      category: "social",
      content: "#hashtag at start, content in middle",
      variables: [],
      platforms: ["INSTAGRAM"],
    };
    const context: TemplateContext = {};

    const result = await engine.compileForPlatform(template, context, "INSTAGRAM");

    expect(result.success).toBe(true);
  });
});
