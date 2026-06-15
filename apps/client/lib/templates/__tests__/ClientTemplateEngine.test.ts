/**
 * @file ClientTemplateEngine.test.ts
 * @description Mutation-killing tests for ClientTemplateEngine — covers enrichContext,
 * preview, extractVariables, generateDocumentation, validateTemplate, and API methods.
 * @layer infrastructure
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { ClientTemplateEngine } from "../ClientTemplateEngine.js";

// ============================================================================
// Mock fetch
// ============================================================================

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

function mockJsonResponse(data: unknown, ok = true, status = 200) {
  return {
    ok,
    status,
    statusText: ok ? "OK" : "Error",
    json: vi.fn().mockResolvedValue(data),
  };
}

// ============================================================================
// Helpers
// ============================================================================

function makeEngine(apiBaseUrl = "/api") {
  return new ClientTemplateEngine(apiBaseUrl);
}

function makeTemplate(content: string, id = "tpl-1") {
  return {
    id,
    name: "Test Template",
    content,
    category: "announcement" as const,
    tags: ["test"],
    variables: [],
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

// ============================================================================
// enrichContext
// ============================================================================

describe("ClientTemplateEngine.enrichContext", () => {
  let engine: ClientTemplateEngine;

  beforeEach(() => {
    vi.clearAllMocks();
    engine = makeEngine();
  });

  it("adds currentYear as a number", () => {
    const ctx = engine.enrichContext({});
    expect(typeof ctx.currentYear).toBe("number");
    expect(ctx.currentYear).toBe(new Date().getFullYear());
  });

  it("adds currentMonth as a string", () => {
    const ctx = engine.enrichContext({});
    expect(typeof ctx.currentMonth).toBe("string");
    expect((ctx.currentMonth as string).length).toBeGreaterThan(0);
  });

  it("adds currentDay as a string", () => {
    const ctx = engine.enrichContext({});
    expect(typeof ctx.currentDay).toBe("string");
  });

  it("defaults premium to false when not provided", () => {
    const ctx = engine.enrichContext({});
    expect(ctx.premium).toBe(false);
  });

  it("preserves user-provided premium value", () => {
    const ctx = engine.enrichContext({ premium: true });
    expect(ctx.premium).toBe(true);
  });

  it("defaults platforms to twitter, linkedin, facebook", () => {
    const ctx = engine.enrichContext({});
    expect(ctx.platforms).toEqual(["twitter", "linkedin", "facebook"]);
  });

  it("preserves user-provided platforms", () => {
    const ctx = engine.enrichContext({ platforms: ["x", "instagram"] });
    expect(ctx.platforms).toEqual(["x", "instagram"]);
  });

  it("sets date to current date when not provided", () => {
    const ctx = engine.enrichContext({});
    expect(ctx.date).toBeInstanceOf(Date);
  });

  it("preserves user-provided date", () => {
    const customDate = new Date("2025-06-15");
    const ctx = engine.enrichContext({ date: customDate });
    expect(ctx.date).toBe(customDate);
  });

  it("user-provided context overrides defaults", () => {
    const ctx = engine.enrichContext({ customField: "value" });
    expect(ctx.customField).toBe("value");
  });
});

// ============================================================================
// preview
// ============================================================================

describe("ClientTemplateEngine.preview", () => {
  let engine: ClientTemplateEngine;

  beforeEach(() => {
    vi.clearAllMocks();
    engine = makeEngine();
  });

  it("renders template with default sample data", () => {
    const template = makeTemplate("Hello {{username}}!");
    const result = engine.preview(template);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.content).toContain("johndoe");
    }
  });

  it("uses provided sample data overrides", () => {
    const template = makeTemplate("Product: {{productName}}");
    const result = engine.preview(template, { productName: "Custom Product" });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.content).toContain("Custom Product");
    }
  });

  it("includes default companyName in sample data", () => {
    const template = makeTemplate("Company: {{companyName}}");
    const result = engine.preview(template);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.content).toContain("Tech Innovations Inc.");
    }
  });

  it("includes default price in sample data", () => {
    const template = makeTemplate("Price: {{price}}");
    const result = engine.preview(template);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.content).toContain("$99");
    }
  });

  it("includes default discount in sample data", () => {
    const template = makeTemplate("Discount: {{discount}}");
    const result = engine.preview(template);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.content).toContain("20%");
    }
  });
});

// ============================================================================
// extractVariables
// ============================================================================

describe("ClientTemplateEngine.extractVariables", () => {
  let engine: ClientTemplateEngine;

  beforeEach(() => {
    vi.clearAllMocks();
    engine = makeEngine();
  });

  it("extracts variable names from template", () => {
    const vars = engine.extractVariables("Hello {{name}}, you are {{age}} years old");
    const names = vars.map((v) => v.name);
    expect(names).toContain("name");
    expect(names).toContain("age");
  });

  it("returns empty array for template without variables", () => {
    const vars = engine.extractVariables("No variables here");
    expect(vars).toEqual([]);
  });

  it("sets type to string by default", () => {
    const vars = engine.extractVariables("{{test}}");
    expect(vars[0]?.type).toBe("string");
  });

  it("sets required to true by default", () => {
    const vars = engine.extractVariables("{{test}}");
    expect(vars[0]?.required).toBe(true);
  });
});

// ============================================================================
// generateDocumentation
// ============================================================================

describe("ClientTemplateEngine.generateDocumentation", () => {
  let engine: ClientTemplateEngine;

  beforeEach(() => {
    vi.clearAllMocks();
    engine = makeEngine();
  });

  it("returns variables, helpers, and examples", () => {
    const template = makeTemplate("Hello {{name}}!");
    const doc = engine.generateDocumentation(template);
    expect(doc.variables).toBeDefined();
    expect(doc.helpers).toBeDefined();
    expect(doc.examples).toBeDefined();
  });

  it("generates example for each variable", () => {
    const template = makeTemplate("{{a}} and {{b}}");
    const doc = engine.generateDocumentation(template);
    expect(doc.examples.length).toBe(2);
  });

  it("example contains variable name", () => {
    const template = makeTemplate("{{myVar}}");
    const doc = engine.generateDocumentation(template);
    expect(doc.examples[0]?.variable).toBe("myVar");
  });

  it("string type example contains Example prefix", () => {
    const template = makeTemplate("{{testVar}}");
    const doc = engine.generateDocumentation(template);
    expect(doc.examples[0]?.example).toContain("Example");
  });
});

// ============================================================================
// validateTemplate
// ============================================================================

describe("ClientTemplateEngine.validateTemplate", () => {
  let engine: ClientTemplateEngine;

  beforeEach(() => {
    vi.clearAllMocks();
    engine = makeEngine();
  });

  it("validates a template object", () => {
    const template = makeTemplate("Valid {{content}}");
    const result = engine.validateTemplate(template);
    expect(result).toBeDefined();
  });

  it("validates a string directly", () => {
    const result = engine.validateTemplate("Direct {{string}} content");
    expect(result).toBeDefined();
  });
});

// ============================================================================
// loadTemplates (API method)
// ============================================================================

describe("ClientTemplateEngine.loadTemplates", () => {
  let engine: ClientTemplateEngine;

  beforeEach(() => {
    vi.clearAllMocks();
    engine = makeEngine("/api");
  });

  it("fetches templates from API", async () => {
    mockFetch.mockResolvedValue(mockJsonResponse({ templates: [{ id: "t1", content: "test" }] }));

    const result = await engine.loadTemplates();
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining("/api/templates"),
      expect.any(Object)
    );
    expect(result).toHaveLength(1);
  });

  it("adds category filter to query params", async () => {
    mockFetch.mockResolvedValue(mockJsonResponse({ templates: [] }));

    await engine.loadTemplates({ category: "promotion" });
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining("category=promotion"),
      expect.any(Object)
    );
  });

  it("adds tags filter to query params", async () => {
    mockFetch.mockResolvedValue(mockJsonResponse({ templates: [] }));

    await engine.loadTemplates({ tags: ["social", "marketing"] });
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining("tags=social"),
      expect.any(Object)
    );
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining("tags=marketing"),
      expect.any(Object)
    );
  });

  it("returns empty array when templates key missing", async () => {
    mockFetch.mockResolvedValue(mockJsonResponse({}));

    const result = await engine.loadTemplates();
    expect(result).toEqual([]);
  });

  it("throws ApiError on non-ok response", async () => {
    mockFetch.mockResolvedValue(mockJsonResponse({}, false, 500));

    await expect(engine.loadTemplates()).rejects.toMatchObject({ status: 500 });
  });
});

// ============================================================================
// loadTemplate (single)
// ============================================================================

describe("ClientTemplateEngine.loadTemplate", () => {
  let engine: ClientTemplateEngine;

  beforeEach(() => {
    vi.clearAllMocks();
    engine = makeEngine("/api");
  });

  it("fetches single template by ID", async () => {
    mockFetch.mockResolvedValue(mockJsonResponse({ template: { id: "t1", content: "test" } }));

    const result = await engine.loadTemplate("t1");
    expect(mockFetch).toHaveBeenCalledWith("/api/templates/t1", expect.any(Object));
    expect(result?.id).toBe("t1");
  });

  it("returns null on 404", async () => {
    mockFetch.mockResolvedValue(mockJsonResponse({}, false, 404));

    const result = await engine.loadTemplate("nonexistent");
    expect(result).toBeNull();
  });

  it("throws ApiError on non-404 error", async () => {
    mockFetch.mockResolvedValue(mockJsonResponse({}, false, 500));

    await expect(engine.loadTemplate("t1")).rejects.toMatchObject({ status: 500 });
  });

  it("returns null when template key missing", async () => {
    mockFetch.mockResolvedValue(mockJsonResponse({}));

    const result = await engine.loadTemplate("t1");
    expect(result).toBeNull();
  });
});

// ============================================================================
// saveTemplate
// ============================================================================

describe("ClientTemplateEngine.saveTemplate", () => {
  let engine: ClientTemplateEngine;

  beforeEach(() => {
    vi.clearAllMocks();
    engine = makeEngine("/api");
  });

  it("uses PUT for existing template with ID", async () => {
    mockFetch.mockResolvedValue(mockJsonResponse({ template: { id: "t1", content: "saved" } }));

    const template = makeTemplate("content", "t1");
    await engine.saveTemplate(template);

    expect(mockFetch).toHaveBeenCalledWith(
      "/api/templates/t1",
      expect.objectContaining({ method: "PUT" })
    );
  });

  it("uses POST for new template without ID", async () => {
    mockFetch.mockResolvedValue(mockJsonResponse({ template: { id: "new-id", content: "saved" } }));

    const template = { ...makeTemplate("content"), id: "" };
    await engine.saveTemplate(template);

    expect(mockFetch).toHaveBeenCalledWith(
      "/api/templates",
      expect.objectContaining({ method: "POST" })
    );
  });

  it("sends template as JSON body", async () => {
    mockFetch.mockResolvedValue(mockJsonResponse({ template: { id: "t1" } }));

    const template = makeTemplate("my content", "t1");
    await engine.saveTemplate(template);

    const call = mockFetch.mock.calls[0];
    const body = JSON.parse(call?.[1]?.body as string);
    expect(body.content).toBe("my content");
  });

  it("throws ApiError on non-ok response", async () => {
    mockFetch.mockResolvedValue(mockJsonResponse({}, false, 500));

    await expect(engine.saveTemplate(makeTemplate("test"))).rejects.toMatchObject({
      status: 500,
    });
  });
});

// ============================================================================
// deleteTemplate
// ============================================================================

describe("ClientTemplateEngine.deleteTemplate", () => {
  let engine: ClientTemplateEngine;

  beforeEach(() => {
    vi.clearAllMocks();
    engine = makeEngine("/api");
  });

  it("sends DELETE to correct URL", async () => {
    mockFetch.mockResolvedValue(mockJsonResponse({}));

    const result = await engine.deleteTemplate("t1");
    expect(mockFetch).toHaveBeenCalledWith(
      "/api/templates/t1",
      expect.objectContaining({ method: "DELETE" })
    );
    expect(result).toBe(true);
  });

  it("throws ApiError on non-ok response", async () => {
    mockFetch.mockResolvedValue(mockJsonResponse({}, false, 500));

    await expect(engine.deleteTemplate("t1")).rejects.toMatchObject({ status: 500 });
  });
});

// ============================================================================
// constructor
// ============================================================================

describe("ClientTemplateEngine constructor", () => {
  it("uses /api/backend as default base URL (canonical proxy)", () => {
    const engine = new ClientTemplateEngine();
    mockFetch.mockResolvedValue(mockJsonResponse({ templates: [] }));
    engine.loadTemplates();
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining("/api/backend/templates"),
      expect.any(Object)
    );
  });

  it("uses custom base URL when provided", () => {
    const engine = new ClientTemplateEngine("/custom-api");
    mockFetch.mockResolvedValue(mockJsonResponse({ templates: [] }));
    engine.loadTemplates();
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining("/custom-api/templates"),
      expect.any(Object)
    );
  });
});
