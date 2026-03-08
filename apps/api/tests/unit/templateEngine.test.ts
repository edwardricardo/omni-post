/**
 * Unit Tests for Template Engine Re-export
 *
 * Tests that the template engine module correctly re-exports
 * ServerTemplateEngine functionality.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

describe("Template Engine Module - Re-exports", () => {
  it("should export ServerTemplateEngine class", async () => {
    const module = await import("../../src/lib/templates/templateEngine");
    assert.ok(module.ServerTemplateEngine);
    assert.strictEqual(typeof module.ServerTemplateEngine, "function");
  });

  it("should export templateEngine singleton", async () => {
    const module = await import("../../src/lib/templates/templateEngine");
    assert.ok(module.templateEngine);
    assert.strictEqual(typeof module.templateEngine, "object");
  });

  it("should export serverTemplateEngine", async () => {
    const module = await import("../../src/lib/templates/templateEngine");
    assert.ok(module.serverTemplateEngine);
  });

  it("should have templateEngine and serverTemplateEngine reference same instance", async () => {
    const module = await import("../../src/lib/templates/templateEngine");
    assert.strictEqual(module.templateEngine, module.serverTemplateEngine);
  });

  it("should have ServerTemplateEngine methods available on singleton", async () => {
    const module = await import("../../src/lib/templates/templateEngine");
    const engine = module.templateEngine;

    assert.ok(typeof engine.compile === "function");
    assert.ok(typeof engine.render === "function");
    assert.ok(typeof engine.validate === "function");
    assert.ok(typeof engine.sanitize === "function");
    assert.ok(typeof engine.validateTemplate === "function");
    assert.ok(typeof engine.getPlatformLimits === "function");
    assert.ok(typeof engine.getSupportedPlatforms === "function");
    assert.ok(typeof engine.compileForPlatform === "function");
  });

  it("should create new ServerTemplateEngine instances", async () => {
    const module = await import("../../src/lib/templates/templateEngine");
    const instance1 = new module.ServerTemplateEngine();
    const instance2 = new module.ServerTemplateEngine();

    assert.ok(instance1);
    assert.ok(instance2);
    assert.notStrictEqual(instance1, instance2);
  });

  it("should have platform compilation methods", async () => {
    const module = await import("../../src/lib/templates/templateEngine");
    const engine = module.templateEngine;

    assert.ok(typeof engine.compileForPlatform === "function");
    assert.ok(typeof engine.compileTemplate === "function");
    assert.ok(typeof engine.compileWithABTest === "function");
    assert.ok(typeof engine.compileTemplateWithComponents === "function");
  });

  it("should have platform query methods", async () => {
    const module = await import("../../src/lib/templates/templateEngine");
    const engine = module.templateEngine;

    assert.ok(typeof engine.getPlatformLimits === "function");
    assert.ok(typeof engine.getSupportedPlatforms === "function");
  });

  it("should have sanitization method", async () => {
    const module = await import("../../src/lib/templates/templateEngine");
    const engine = module.templateEngine;

    assert.ok(typeof engine.sanitize === "function");

    const sanitized = engine.sanitize("<p>Safe content</p>");
    assert.ok(typeof sanitized === "string");
  });

  it("should have validation methods", async () => {
    const module = await import("../../src/lib/templates/templateEngine");
    const engine = module.templateEngine;

    assert.ok(typeof engine.validate === "function");
    assert.ok(typeof engine.validateTemplate === "function");
  });

  it("should have base template engine methods", async () => {
    const module = await import("../../src/lib/templates/templateEngine");
    const engine = module.templateEngine;

    // Inherited from BaseTemplateEngine
    assert.ok(typeof engine.compile === "function");
    assert.ok(typeof engine.render === "function");
    assert.ok(typeof engine.registerHelper === "function");
    assert.ok(typeof engine.getRegisteredHelpers === "function");
  });

  it("should return registered helpers list", async () => {
    const module = await import("../../src/lib/templates/templateEngine");
    const engine = module.templateEngine;

    const helpers = engine.getRegisteredHelpers();
    assert.ok(Array.isArray(helpers));
    assert.ok(helpers.length > 0);

    // Check for common helpers
    assert.ok(helpers.includes("formatDate"));
    assert.ok(helpers.includes("uppercase"));
    assert.ok(helpers.includes("lowercase"));
  });

  it("should compile simple template", async () => {
    const module = await import("../../src/lib/templates/templateEngine");
    const engine = module.templateEngine;

    const template = engine.compile("Hello {{name}}!");
    assert.ok(typeof template === "function");

    const result = template({ name: "World" });
    assert.strictEqual(result, "Hello World!");
  });

  it("should render template with context", async () => {
    const module = await import("../../src/lib/templates/templateEngine");
    const engine = module.templateEngine;

    const result = engine.render("Hello {{name}}!", { name: "Test" });
    assert.ok(result.success);
    assert.strictEqual(result.content, "Hello Test!");
  });

  it("should validate template syntax", async () => {
    const module = await import("../../src/lib/templates/templateEngine");
    const engine = module.templateEngine;

    const validResult = engine.validate("Hello {{name}}!");
    assert.strictEqual(validResult.valid, true);

    const invalidResult = engine.validate("Hello {{unclosed");
    assert.strictEqual(invalidResult.valid, false);
  });

  it("should get supported platforms list", async () => {
    const module = await import("../../src/lib/templates/templateEngine");
    const engine = module.templateEngine;

    const platforms = engine.getSupportedPlatforms();
    assert.ok(Array.isArray(platforms));
    assert.ok(platforms.length > 0);
    assert.ok(platforms.includes("TWITTER"));
  });

  it("should get platform limits", async () => {
    const module = await import("../../src/lib/templates/templateEngine");
    const engine = module.templateEngine;

    const limits = engine.getPlatformLimits("TWITTER");
    assert.ok(limits);
    assert.strictEqual(limits.maxLength, 280);
  });

  it("should sanitize HTML content", async () => {
    const module = await import("../../src/lib/templates/templateEngine");
    const engine = module.templateEngine;

    const dirty = '<script>alert("xss")</script><p>Safe</p>';
    const clean = engine.sanitize(dirty);

    assert.ok(!clean.includes("<script>"));
    assert.ok(clean.includes("Safe"));
  });

  it("should be importable with different import styles", async () => {
    // Named import
    const { ServerTemplateEngine, templateEngine } = await import(
      "../../src/lib/templates/templateEngine"
    );
    assert.ok(ServerTemplateEngine);
    assert.ok(templateEngine);

    // Namespace import
    const module = await import("../../src/lib/templates/templateEngine");
    assert.ok(module.ServerTemplateEngine);
    assert.ok(module.templateEngine);
  });

  it("should maintain singleton pattern across imports", async () => {
    const module1 = await import("../../src/lib/templates/templateEngine");
    const module2 = await import("../../src/lib/templates/templateEngine");

    assert.strictEqual(module1.templateEngine, module2.templateEngine);
  });
});

describe("Template Engine Module - Integration with BaseTemplateEngine", () => {
  it("should have all Handlebars helpers registered", async () => {
    const module = await import("../../src/lib/templates/templateEngine");
    const engine = module.templateEngine;

    const helpers = engine.getRegisteredHelpers();

    // String helpers
    assert.ok(helpers.includes("uppercase"));
    assert.ok(helpers.includes("lowercase"));
    assert.ok(helpers.includes("capitalize"));
    assert.ok(helpers.includes("truncate"));

    // Array helpers
    assert.ok(helpers.includes("join"));
    assert.ok(helpers.includes("length"));

    // Conditional helpers
    assert.ok(helpers.includes("eq"));
    assert.ok(helpers.includes("ne"));
    assert.ok(helpers.includes("gt"));
    assert.ok(helpers.includes("lt"));

    // Math helpers
    assert.ok(helpers.includes("add"));
    assert.ok(helpers.includes("subtract"));
    assert.ok(helpers.includes("multiply"));
    assert.ok(helpers.includes("divide"));

    // Platform helpers
    assert.ok(helpers.includes("hashtag"));
    assert.ok(helpers.includes("mention"));
    assert.ok(helpers.includes("link"));
  });

  it("should use Handlebars helpers in templates", async () => {
    const module = await import("../../src/lib/templates/templateEngine");
    const engine = module.templateEngine;

    const result = engine.render("{{uppercase text}}", { text: "hello" });
    assert.strictEqual(result.content, "HELLO");
  });

  it("should use platform-specific helpers", async () => {
    const module = await import("../../src/lib/templates/templateEngine");
    const engine = module.templateEngine;

    const result = engine.render("{{hashtag tag}}", { tag: "test" });
    assert.strictEqual(result.content, "#test");
  });

  it("should handle complex helper combinations", async () => {
    const module = await import("../../src/lib/templates/templateEngine");
    const engine = module.templateEngine;

    const template = "{{uppercase (hashtag tag)}}";
    const result = engine.render(template, { tag: "test" });
    assert.strictEqual(result.content, "#TEST");
  });
});
