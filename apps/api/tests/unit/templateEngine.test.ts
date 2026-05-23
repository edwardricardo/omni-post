/**
 * Unit Tests for Template Engine Re-export
 *
 * Tests that the template engine module correctly re-exports
 * ServerTemplateEngine functionality.
 *
 * @file templateEngine.test.ts
 * @description Tests for Template Engine Module - Re-exports
 * @layer infrastructure
 */

import { describe, it, expect } from "vitest";
import type { PrismaClient } from "@infra/prisma";

const stubPrisma = {} as unknown as PrismaClient;

describe("Template Engine Module - Re-exports", () => {
  it("should export ServerTemplateEngine class", async () => {
    const module = await import("../../src/lib/templates/templateEngine");
    expect(module.ServerTemplateEngine).toBeTruthy();
    expect(typeof module.ServerTemplateEngine).toBe("function");
  }, 10_000);

  it("should export templateEngine singleton", async () => {
    const module = await import("../../src/lib/templates/templateEngine");
    expect(module.templateEngine).toBeTruthy();
    expect(typeof module.templateEngine).toBe("object");
  });

  it("should export serverTemplateEngine", async () => {
    const module = await import("../../src/lib/templates/templateEngine");
    expect(module.serverTemplateEngine).toBeTruthy();
  });

  it("should have templateEngine and serverTemplateEngine reference same instance", async () => {
    const module = await import("../../src/lib/templates/templateEngine");
    expect(module.templateEngine).toBe(module.serverTemplateEngine);
  });

  it("should have ServerTemplateEngine methods available on singleton", async () => {
    const module = await import("../../src/lib/templates/templateEngine");
    const engine = module.templateEngine;

    expect(typeof engine.compile === "function").toBeTruthy();
    expect(typeof engine.render === "function").toBeTruthy();
    expect(typeof engine.validate === "function").toBeTruthy();
    expect(typeof engine.sanitize === "function").toBeTruthy();
    expect(typeof engine.validateTemplate === "function").toBeTruthy();
    expect(typeof engine.getPlatformLimits === "function").toBeTruthy();
    expect(typeof engine.getSupportedPlatforms === "function").toBeTruthy();
    expect(typeof engine.compileForPlatform === "function").toBeTruthy();
  });

  it("should create new ServerTemplateEngine instances", async () => {
    const module = await import("../../src/lib/templates/templateEngine");
    const instance1 = new module.ServerTemplateEngine(stubPrisma);
    const instance2 = new module.ServerTemplateEngine(stubPrisma);

    expect(instance1).toBeTruthy();
    expect(instance2).toBeTruthy();
    expect(instance1).not.toBe(instance2);
  });

  it("should have platform compilation methods", async () => {
    const module = await import("../../src/lib/templates/templateEngine");
    const engine = module.templateEngine;

    expect(typeof engine.compileForPlatform === "function").toBeTruthy();
    expect(typeof engine.compileTemplate === "function").toBeTruthy();
    expect(typeof engine.compileWithABTest === "function").toBeTruthy();
    expect(typeof engine.compileTemplateWithComponents === "function").toBeTruthy();
  });

  it("should have platform query methods", async () => {
    const module = await import("../../src/lib/templates/templateEngine");
    const engine = module.templateEngine;

    expect(typeof engine.getPlatformLimits === "function").toBeTruthy();
    expect(typeof engine.getSupportedPlatforms === "function").toBeTruthy();
  });

  it("should have sanitization method", async () => {
    const module = await import("../../src/lib/templates/templateEngine");
    const engine = module.templateEngine;

    expect(typeof engine.sanitize === "function").toBeTruthy();

    const sanitized = engine.sanitize("<p>Safe content</p>");
    expect(typeof sanitized === "string").toBeTruthy();
  });

  it("should have validation methods", async () => {
    const module = await import("../../src/lib/templates/templateEngine");
    const engine = module.templateEngine;

    expect(typeof engine.validate === "function").toBeTruthy();
    expect(typeof engine.validateTemplate === "function").toBeTruthy();
  });

  it("should have base template engine methods", async () => {
    const module = await import("../../src/lib/templates/templateEngine");
    const engine = module.templateEngine;

    // Inherited from BaseTemplateEngine
    expect(typeof engine.compile === "function").toBeTruthy();
    expect(typeof engine.render === "function").toBeTruthy();
    expect(typeof engine.registerHelper === "function").toBeTruthy();
    expect(typeof engine.getRegisteredHelpers === "function").toBeTruthy();
  });

  it("should return registered helpers list", async () => {
    const module = await import("../../src/lib/templates/templateEngine");
    const engine = module.templateEngine;

    const helpers = engine.getRegisteredHelpers();
    expect(Array.isArray(helpers)).toBeTruthy();
    expect(helpers.length > 0).toBeTruthy();

    // Check for common helpers
    expect(helpers.includes("formatDate")).toBeTruthy();
    expect(helpers.includes("uppercase")).toBeTruthy();
    expect(helpers.includes("lowercase")).toBeTruthy();
  });

  it("should compile simple template", async () => {
    const module = await import("../../src/lib/templates/templateEngine");
    const engine = module.templateEngine;

    const template = engine.compile("Hello {{name}}!");
    expect(typeof template === "function").toBeTruthy();

    const result = template({ name: "World" });
    expect(result).toBe("Hello World!");
  });

  it("should render template with context", async () => {
    const module = await import("../../src/lib/templates/templateEngine");
    const engine = module.templateEngine;

    const result = engine.render("Hello {{name}}!", { name: "Test" });
    expect(result.success).toBeTruthy();
    expect(result.content).toBe("Hello Test!");
  });

  it("should validate template syntax", async () => {
    const module = await import("../../src/lib/templates/templateEngine");
    const engine = module.templateEngine;

    const validResult = engine.validate("Hello {{name}}!");
    expect(validResult.valid).toBe(true);

    const invalidResult = engine.validate("Hello {{unclosed");
    expect(invalidResult.valid).toBe(false);
  });

  it("should get supported platforms list", async () => {
    const module = await import("../../src/lib/templates/templateEngine");
    const engine = module.templateEngine;

    const platforms = engine.getSupportedPlatforms();
    expect(Array.isArray(platforms)).toBeTruthy();
    expect(platforms.length > 0).toBeTruthy();
    expect(platforms.includes("TWITTER")).toBeTruthy();
  });

  it("should get platform limits", async () => {
    const module = await import("../../src/lib/templates/templateEngine");
    const engine = module.templateEngine;

    const limits = engine.getPlatformLimits("TWITTER");
    expect(limits).toBeTruthy();
    expect(limits.maxLength).toBe(280);
  });

  it("should sanitize HTML content", async () => {
    const module = await import("../../src/lib/templates/templateEngine");
    const engine = module.templateEngine;

    const dirty = '<script>alert("xss")</script><p>Safe</p>';
    const clean = engine.sanitize(dirty);

    expect(clean.includes("<script>")).toBeFalsy();
    expect(clean.includes("Safe")).toBeTruthy();
  });

  it("should be importable with different import styles", async () => {
    // Named import
    const { ServerTemplateEngine, templateEngine } =
      await import("../../src/lib/templates/templateEngine");
    expect(ServerTemplateEngine).toBeTruthy();
    expect(templateEngine).toBeTruthy();

    // Namespace import
    const module = await import("../../src/lib/templates/templateEngine");
    expect(module.ServerTemplateEngine).toBeTruthy();
    expect(module.templateEngine).toBeTruthy();
  });

  it("should maintain singleton pattern across imports", async () => {
    const module1 = await import("../../src/lib/templates/templateEngine");
    const module2 = await import("../../src/lib/templates/templateEngine");

    expect(module1.templateEngine).toBe(module2.templateEngine);
  });
});

describe("Template Engine Module - Integration with BaseTemplateEngine", () => {
  it("should have all Handlebars helpers registered", async () => {
    const module = await import("../../src/lib/templates/templateEngine");
    const engine = module.templateEngine;

    const helpers = engine.getRegisteredHelpers();

    // String helpers
    expect(helpers.includes("uppercase")).toBeTruthy();
    expect(helpers.includes("lowercase")).toBeTruthy();
    expect(helpers.includes("capitalize")).toBeTruthy();
    expect(helpers.includes("truncate")).toBeTruthy();

    // Array helpers
    expect(helpers.includes("join")).toBeTruthy();
    expect(helpers.includes("length")).toBeTruthy();

    // Conditional helpers
    expect(helpers.includes("eq")).toBeTruthy();
    expect(helpers.includes("ne")).toBeTruthy();
    expect(helpers.includes("gt")).toBeTruthy();
    expect(helpers.includes("lt")).toBeTruthy();

    // Math helpers
    expect(helpers.includes("add")).toBeTruthy();
    expect(helpers.includes("subtract")).toBeTruthy();
    expect(helpers.includes("multiply")).toBeTruthy();
    expect(helpers.includes("divide")).toBeTruthy();

    // Platform helpers
    expect(helpers.includes("hashtag")).toBeTruthy();
    expect(helpers.includes("mention")).toBeTruthy();
    expect(helpers.includes("link")).toBeTruthy();
  });

  it("should use Handlebars helpers in templates", async () => {
    const module = await import("../../src/lib/templates/templateEngine");
    const engine = module.templateEngine;

    const result = engine.render("{{uppercase text}}", { text: "hello" });
    expect(result.content).toBe("HELLO");
  });

  it("should use platform-specific helpers", async () => {
    const module = await import("../../src/lib/templates/templateEngine");
    const engine = module.templateEngine;

    const result = engine.render("{{hashtag tag}}", { tag: "test" });
    expect(result.content).toBe("#test");
  });

  it("should handle complex helper combinations", async () => {
    const module = await import("../../src/lib/templates/templateEngine");
    const engine = module.templateEngine;

    const template = "{{uppercase (hashtag tag)}}";
    const result = engine.render(template, { tag: "test" });
    expect(result.content).toBe("#TEST");
  });
});
