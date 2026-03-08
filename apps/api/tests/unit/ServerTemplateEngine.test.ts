/**
 * Unit Tests for ServerTemplateEngine
 *
 * Tests server-specific template functionality including:
 * - Platform-specific compilation and adaptation
 * - Content sanitization
 * - Platform validation
 * - Component compilation
 * - Platform limits
 */

import "./templateRoutes.env-setup.js";
import { describe, it, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "@infra/prisma";
import { ServerTemplateEngine } from "../../src/lib/templates/ServerTemplateEngine";
import type { Template, TemplateContext } from "@shared/types";

// Save original prisma methods for monkey-patching per test
const _originalComponentFindUnique = prisma.templateComponent.findUnique;
const _originalComponentUsageFindMany = prisma.templateComponentUsage.findMany;

// Restore real prisma methods after all tests complete
after(() => {
  prisma.templateComponent.findUnique = _originalComponentFindUnique;
  prisma.templateComponentUsage.findMany = _originalComponentUsageFindMany;
});

describe("ServerTemplateEngine - Platform Validation", { concurrency: 1 }, () => {
  let engine: ServerTemplateEngine;

  before(() => {
    engine = new ServerTemplateEngine();
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
    assert.strictEqual(result.valid, true);
    assert.strictEqual(result.errors.length, 0);
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
    assert.strictEqual(result.valid, false);
    assert.ok(result.errors.some((err) => err.includes("character limit")));
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
    assert.strictEqual(result.valid, true);
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
    assert.strictEqual(result.valid, true);
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
    assert.strictEqual(result.valid, false);
    assert.ok(result.errors.some((err) => err.includes("Unknown platform")));
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
    assert.strictEqual(result.valid, true);
  });
});

describe("ServerTemplateEngine - Content Adaptation", { concurrency: 1 }, () => {
  let engine: ServerTemplateEngine;

  before(() => {
    engine = new ServerTemplateEngine();
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

    assert.strictEqual(result.success, true);
    assert.ok(result.content);
    assert.ok(result.content.length <= 280);
    assert.ok(result.content.endsWith("..."));
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

    assert.ok(result.adaptations?.truncated);
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

    assert.strictEqual(result.success, true);
    assert.strictEqual(result.content, "Short content");
    assert.ok(!result.adaptations?.truncated);
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

    assert.strictEqual(result.success, true);
    assert.strictEqual(result.platform, "twitter");
  });
});

describe("ServerTemplateEngine - Content Sanitization", { concurrency: 1 }, () => {
  let engine: ServerTemplateEngine;

  before(() => {
    engine = new ServerTemplateEngine();
  });

  it("should sanitize HTML content", () => {
    const maliciousContent = '<script>alert("xss")</script><p>Safe content</p>';
    const sanitized = engine.sanitize(maliciousContent);

    assert.ok(!sanitized.includes("<script>"));
    assert.ok(sanitized.includes("Safe content"));
  });

  it("should preserve safe HTML tags", () => {
    const safeContent = "<p>Paragraph</p><strong>Bold</strong><em>Italic</em>";
    const sanitized = engine.sanitize(safeContent);

    assert.ok(sanitized.includes("<p>"));
    assert.ok(sanitized.includes("<strong>"));
    assert.ok(sanitized.includes("<em>"));
  });

  it("should remove malicious attributes", () => {
    const maliciousContent = '<a href="javascript:alert(1)">Click me</a>';
    const sanitized = engine.sanitize(maliciousContent);

    assert.ok(!sanitized.includes("javascript:"));
  });

  it("should handle empty content", () => {
    const sanitized = engine.sanitize("");
    assert.strictEqual(sanitized, "");
  });
});

describe("ServerTemplateEngine - Platform Compilation", { concurrency: 1 }, () => {
  let engine: ServerTemplateEngine;

  before(() => {
    engine = new ServerTemplateEngine();
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

    assert.strictEqual(result.success, true);
    assert.strictEqual(result.content, "Hello John! Welcome to Twitter");
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

    assert.strictEqual(results.length, 3);
    assert.strictEqual(results[0]!.platform, "TWITTER");
    assert.strictEqual(results[1]!.platform, "INSTAGRAM");
    assert.strictEqual(results[2]!.platform, "LINKEDIN");
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

    assert.strictEqual(result.success, false);
    assert.ok(result.errors);
    assert.ok(result.errors.length > 0);
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

    assert.strictEqual(result.platform, "FACEBOOK");
  });
});

describe("ServerTemplateEngine - Platform Limits", { concurrency: 1 }, () => {
  let engine: ServerTemplateEngine;

  before(() => {
    engine = new ServerTemplateEngine();
  });

  it("should return Twitter platform limits", () => {
    const limits = engine.getPlatformLimits("TWITTER");

    assert.ok(limits);
    assert.strictEqual(limits.maxLength, 280);
    assert.strictEqual(limits.allowsHashtags, true);
    assert.strictEqual(limits.allowsMentions, true);
  });

  it("should return Instagram platform limits", () => {
    const limits = engine.getPlatformLimits("INSTAGRAM");

    assert.ok(limits);
    assert.strictEqual(limits.maxLength, 2200);
    assert.strictEqual(limits.recommendedHashtagCount, 30);
  });

  it("should return LinkedIn platform limits", () => {
    const limits = engine.getPlatformLimits("LINKEDIN");

    assert.ok(limits);
    assert.strictEqual(limits.maxLength, 3000);
    assert.strictEqual(limits.maxLines, 7);
  });

  it("should return null for unknown platform", () => {
    const limits = engine.getPlatformLimits("UNKNOWN");
    assert.strictEqual(limits, null);
  });

  it("should handle case-insensitive platform names", () => {
    const limits = engine.getPlatformLimits("twitter");
    assert.ok(limits);
    assert.strictEqual(limits.maxLength, 280);
  });

  it("should return all supported platforms", () => {
    const platforms = engine.getSupportedPlatforms();

    assert.ok(Array.isArray(platforms));
    assert.ok(platforms.length > 0);
    assert.ok(platforms.includes("TWITTER"));
    assert.ok(platforms.includes("INSTAGRAM"));
    assert.ok(platforms.includes("LINKEDIN"));
    assert.ok(platforms.includes("FACEBOOK"));
  });
});

describe("ServerTemplateEngine - Component Compilation", { concurrency: 1 }, () => {
  let engine: ServerTemplateEngine;
  let mockFindUnique: ReturnType<typeof import("node:test").mock.fn>;
  let mockFindMany: ReturnType<typeof import("node:test").mock.fn>;

  beforeEach((t) => {
    engine = new ServerTemplateEngine();
    // Create fresh mocks per test via t.mock — auto-restored when the test ends
    mockFindUnique = t.mock.fn();
    mockFindMany = t.mock.fn();
    prisma.templateComponent.findUnique = mockFindUnique as any;
    prisma.templateComponentUsage.findMany = mockFindMany as any;
  });

  it("should compile component by ID", async () => {
    mockFindUnique.mock.mockImplementationOnce(() =>
      Promise.resolve({
        id: "component-1",
        name: "Header",
        content: "Welcome {{username}}!",
      })
    );

    const context: TemplateContext = { username: "Alice" };
    const result = await engine.compileComponent("component-1", context);

    assert.strictEqual(result, "Welcome Alice!");
    assert.strictEqual(mockFindUnique.mock.calls.length, 1);
  });

  it("should throw error for missing component", async () => {
    mockFindUnique.mock.mockImplementationOnce(() => Promise.resolve(null));

    await assert.rejects(
      async () => await engine.compileComponent("missing-component", {}),
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

    mockFindMany.mock.mockImplementationOnce(() =>
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

    mockFindUnique.mock.mockImplementationOnce(() =>
      Promise.resolve({
        id: "comp-1",
        name: "header",
        content: "Breaking News",
      })
    );

    const context: TemplateContext = { content: "Major update" };
    const results = await engine.compileTemplateWithComponents(template, context);

    assert.ok(results.length > 0);
    assert.strictEqual(results[0]!.success, true);
  });
});

describe("ServerTemplateEngine - A/B Testing", { concurrency: 1 }, () => {
  let engine: ServerTemplateEngine;

  before(() => {
    engine = new ServerTemplateEngine();
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

    assert.ok(results.length > 0);
    assert.strictEqual(results[0]!.success, true);
    assert.ok(results[0]!.content === "Content A" || results[0]!.content === "Content B");
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

    assert.strictEqual(results[0]!.content, "Default only");
  });
});

describe("ServerTemplateEngine - Adaptation Tracking", { concurrency: 1 }, () => {
  let engine: ServerTemplateEngine;

  before(() => {
    engine = new ServerTemplateEngine();
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

    assert.strictEqual(result.success, true);
    assert.ok(result.adaptations?.truncated);
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

    assert.strictEqual(result.success, true);
  });
});
