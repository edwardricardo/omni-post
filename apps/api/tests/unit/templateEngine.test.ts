/**
 * @file templateEngine.test.ts
 * @description Tests the template-engine barrel re-export and the engine's
 *              BaseTemplateEngine-inherited behaviour (Handlebars compile/render,
 *              helpers, validation, sanitization, platform limits). After the
 *              prisma→DI migration the barrel re-exports the ServerTemplateEngine
 *              *class* (the module singleton was removed), so tests construct an
 *              instance. The DB-touching server methods are covered separately in
 *              ServerTemplateEngine.test.ts.
 * @layer infrastructure
 */

import { describe, it, expect, beforeEach } from "vitest";
import type { PrismaClient } from "@infra/prisma";
import { ServerTemplateEngine } from "../../src/lib/templates/templateEngine.js";

// Pure (BaseTemplateEngine) methods exercised here never hit the DB, so a stub
// prisma is sufficient.
const stubPrisma = {} as unknown as PrismaClient;

describe("templateEngine barrel re-export", () => {
  it("re-exports the ServerTemplateEngine class and constructs independent instances", () => {
    expect(typeof ServerTemplateEngine).toBe("function");
    const a = new ServerTemplateEngine(stubPrisma);
    const b = new ServerTemplateEngine(stubPrisma);
    expect(a).not.toBe(b);
  });
});

describe("ServerTemplateEngine — Handlebars behaviour", () => {
  let engine: ServerTemplateEngine;
  beforeEach(() => {
    engine = new ServerTemplateEngine(stubPrisma);
  });

  it("compiles a template into a render function", () => {
    const template = engine.compile("Hello {{name}}!");
    expect(template({ name: "World" })).toBe("Hello World!");
  });

  it("renders a template with context", () => {
    const result = engine.render("Hello {{name}}!", { name: "Test" });
    expect(result.success).toBeTruthy();
    expect(result.content).toBe("Hello Test!");
  });

  it("validates template syntax", () => {
    expect(engine.validate("Hello {{name}}!").valid).toBe(true);
    expect(engine.validate("Hello {{unclosed").valid).toBe(false);
  });

  it("sanitizes HTML content, stripping scripts", () => {
    const clean = engine.sanitize('<script>alert("xss")</script><p>Safe</p>');
    expect(clean.includes("<script>")).toBeFalsy();
    expect(clean.includes("Safe")).toBeTruthy();
  });

  it("lists registered Handlebars helpers", () => {
    const helpers = engine.getRegisteredHelpers();
    expect(Array.isArray(helpers)).toBeTruthy();
    expect(helpers).toEqual(expect.arrayContaining(["formatDate", "uppercase", "lowercase"]));
  });

  it("applies string, platform and combined helpers", () => {
    expect(engine.render("{{uppercase text}}", { text: "hello" }).content).toBe("HELLO");
    expect(engine.render("{{hashtag tag}}", { tag: "test" }).content).toBe("#test");
    expect(engine.render("{{uppercase (hashtag tag)}}", { tag: "test" }).content).toBe("#TEST");
  });
});

describe("ServerTemplateEngine — platform metadata", () => {
  let engine: ServerTemplateEngine;
  beforeEach(() => {
    engine = new ServerTemplateEngine(stubPrisma);
  });

  it("lists supported platforms including TWITTER", () => {
    const platforms = engine.getSupportedPlatforms();
    expect(Array.isArray(platforms)).toBeTruthy();
    expect(platforms.includes("TWITTER")).toBeTruthy();
  });

  it("returns platform limits (TWITTER maxLength 280)", () => {
    expect(engine.getPlatformLimits("TWITTER").maxLength).toBe(280);
  });
});
