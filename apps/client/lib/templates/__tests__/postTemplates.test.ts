/**
 * @file postTemplates.test.ts
 * @description Mutation-killing tests for postTemplates — covers template data,
 * getTemplatesByCategory, fillTemplateVariables, and templateCategories.
 * @layer infrastructure
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  postTemplates,
  getTemplatesByCategory,
  fillTemplateVariables,
  templateCategories,
  type PostTemplate,
} from "../postTemplates.js";

// ============================================================================
// postTemplates array
// ============================================================================

describe("postTemplates", () => {
  it("is a non-empty array", () => {
    expect(Array.isArray(postTemplates)).toBe(true);
    expect(postTemplates.length).toBeGreaterThan(0);
  });

  it("each template has required fields", () => {
    for (const t of postTemplates) {
      expect(t.id).toBeTruthy();
      expect(t.name).toBeTruthy();
      expect(t.description).toBeTruthy();
      expect(t.category).toBeTruthy();
      expect(t.content).toBeTruthy();
      expect(Array.isArray(t.tags)).toBe(true);
      expect(Array.isArray(t.platforms)).toBe(true);
      expect(t.platforms.length).toBeGreaterThan(0);
    }
  });

  it("has unique template IDs", () => {
    const ids = postTemplates.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("contains product-launch template", () => {
    const tpl = postTemplates.find((t) => t.id === "product-launch");
    expect(tpl).toBeDefined();
    expect(tpl?.category).toBe("announcement");
    expect(tpl?.variables).toContain("PRODUCT_NAME");
    expect(tpl?.platforms).toContain("x");
    expect(tpl?.platforms).toContain("linkedin");
    expect(tpl?.platforms).toContain("instagram");
  });

  it("contains company-news template", () => {
    const tpl = postTemplates.find((t) => t.id === "company-news");
    expect(tpl).toBeDefined();
    expect(tpl?.category).toBe("announcement");
    expect(tpl?.variables).toContain("NEWS_CONTENT");
  });

  it("contains limited-offer template", () => {
    const tpl = postTemplates.find((t) => t.id === "limited-offer");
    expect(tpl).toBeDefined();
    expect(tpl?.category).toBe("promotion");
    expect(tpl?.variables).toContain("PROMO_CODE");
    expect(tpl?.variables).toContain("DISCOUNT_AMOUNT");
  });

  it("contains new-service template", () => {
    const tpl = postTemplates.find((t) => t.id === "new-service");
    expect(tpl).toBeDefined();
    expect(tpl?.category).toBe("promotion");
    expect(tpl?.variables).toContain("SERVICE_NAME");
  });

  it("contains behind-scenes template", () => {
    const tpl = postTemplates.find((t) => t.id === "behind-scenes");
    expect(tpl).toBeDefined();
    expect(tpl?.category).toBe("engagement");
    expect(tpl?.variables).toContain("COMPANY_NAME");
  });

  it("contains user-spotlight template", () => {
    const tpl = postTemplates.find((t) => t.id === "user-spotlight");
    expect(tpl).toBeDefined();
    expect(tpl?.category).toBe("engagement");
    expect(tpl?.variables).toContain("USER_NAME");
  });

  it("contains poll-question template", () => {
    const tpl = postTemplates.find((t) => t.id === "poll-question");
    expect(tpl).toBeDefined();
    expect(tpl?.category).toBe("question");
    expect(tpl?.variables).toContain("OPTION_A");
    expect(tpl?.variables).toContain("OPTION_B");
  });

  it("contains feedback-request template", () => {
    const tpl = postTemplates.find((t) => t.id === "feedback-request");
    expect(tpl).toBeDefined();
    expect(tpl?.category).toBe("question");
  });

  it("contains tip-tuesday template", () => {
    const tpl = postTemplates.find((t) => t.id === "tip-tuesday");
    expect(tpl).toBeDefined();
    expect(tpl?.category).toBe("educational");
    expect(tpl?.variables).toContain("TIP_TITLE");
  });

  it("contains myth-busting template", () => {
    const tpl = postTemplates.find((t) => t.id === "myth-busting");
    expect(tpl).toBeDefined();
    expect(tpl?.category).toBe("educational");
    expect(tpl?.variables).toContain("MYTH_STATEMENT");
  });

  it("contains personal-story template", () => {
    const tpl = postTemplates.find((t) => t.id === "personal-story");
    expect(tpl).toBeDefined();
    expect(tpl?.category).toBe("personal");
  });

  it("contains event-announcement template", () => {
    const tpl = postTemplates.find((t) => t.id === "event-announcement");
    expect(tpl).toBeDefined();
    expect(tpl?.category).toBe("event");
    expect(tpl?.variables).toContain("EVENT_NAME");
    expect(tpl?.variables).toContain("EVENT_DATE");
    expect(tpl?.variables).toContain("REGISTRATION_LINK");
  });

  it("each template with variables has them listed", () => {
    for (const t of postTemplates) {
      if (t.variables) {
        expect(t.variables.length).toBeGreaterThan(0);
        // Each listed variable should appear in the content
        for (const v of t.variables) {
          expect(t.content).toContain(`{{${v}}}`);
        }
      }
    }
  });

  it("each template has a preview string", () => {
    for (const t of postTemplates) {
      if (t.preview !== undefined) {
        expect(t.preview.length).toBeGreaterThan(0);
      }
    }
  });
});

// ============================================================================
// getTemplatesByCategory
// ============================================================================

describe("getTemplatesByCategory", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns announcement templates", () => {
    const results = getTemplatesByCategory("announcement");
    expect(results.length).toBeGreaterThan(0);
    for (const t of results) {
      expect(t.category).toBe("announcement");
    }
  });

  it("returns promotion templates", () => {
    const results = getTemplatesByCategory("promotion");
    expect(results.length).toBeGreaterThan(0);
    for (const t of results) {
      expect(t.category).toBe("promotion");
    }
  });

  it("returns engagement templates", () => {
    const results = getTemplatesByCategory("engagement");
    expect(results.length).toBeGreaterThan(0);
  });

  it("returns question templates", () => {
    const results = getTemplatesByCategory("question");
    expect(results.length).toBeGreaterThan(0);
  });

  it("returns educational templates", () => {
    const results = getTemplatesByCategory("educational");
    expect(results.length).toBeGreaterThan(0);
  });

  it("returns personal templates", () => {
    const results = getTemplatesByCategory("personal");
    expect(results.length).toBeGreaterThan(0);
  });

  it("returns event templates", () => {
    const results = getTemplatesByCategory("event");
    expect(results.length).toBeGreaterThan(0);
  });
});

// ============================================================================
// fillTemplateVariables
// ============================================================================

describe("fillTemplateVariables", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const simpleTemplate: PostTemplate = {
    id: "test",
    name: "Test",
    description: "Test template",
    category: "announcement",
    content: "Hello {{NAME}}, welcome to {{COMPANY}}!",
    tags: [],
    variables: ["NAME", "COMPANY"],
    platforms: ["x"],
  };

  it("replaces single variable", () => {
    const result = fillTemplateVariables(
      { ...simpleTemplate, content: "Hello {{NAME}}!" },
      { NAME: "Alice" }
    );
    expect(result).toBe("Hello Alice!");
  });

  it("replaces multiple variables", () => {
    const result = fillTemplateVariables(simpleTemplate, {
      NAME: "Bob",
      COMPANY: "Acme",
    });
    expect(result).toBe("Hello Bob, welcome to Acme!");
  });

  it("replaces all occurrences of the same variable", () => {
    const tpl: PostTemplate = {
      ...simpleTemplate,
      content: "{{NAME}} says hi, and {{NAME}} says bye",
    };
    const result = fillTemplateVariables(tpl, { NAME: "Charlie" });
    expect(result).toBe("Charlie says hi, and Charlie says bye");
  });

  it("leaves unmatched variables as-is", () => {
    const result = fillTemplateVariables(simpleTemplate, { NAME: "Dave" });
    expect(result).toContain("{{COMPANY}}");
    expect(result).toContain("Dave");
  });

  it("handles empty variables object", () => {
    const result = fillTemplateVariables(simpleTemplate, {});
    expect(result).toBe(simpleTemplate.content);
  });

  it("works with real product-launch template", () => {
    const tpl = postTemplates.find((t) => t.id === "product-launch");
    expect(tpl).toBeDefined();
    if (tpl) {
      const result = fillTemplateVariables(tpl, {
        PRODUCT_NAME: "OmniPost",
        PRODUCT_DESCRIPTION: "A social media CMS",
        FEATURE_1: "Multi-platform",
        FEATURE_2: "Scheduling",
        FEATURE_3: "Analytics",
        CALL_TO_ACTION: "Try it now!",
      });
      expect(result).toContain("OmniPost");
      expect(result).toContain("A social media CMS");
      expect(result).toContain("Multi-platform");
      expect(result).toContain("Try it now!");
    }
  });
});

// ============================================================================
// templateCategories
// ============================================================================

describe("templateCategories", () => {
  it("has 7 categories", () => {
    expect(templateCategories.length).toBe(7);
  });

  it("includes announcement category", () => {
    const cat = templateCategories.find((c) => c.id === "announcement");
    expect(cat?.name).toBe("Announcements");
    expect(cat?.description).toContain("Product launches");
  });

  it("includes promotion category", () => {
    const cat = templateCategories.find((c) => c.id === "promotion");
    expect(cat?.name).toBe("Promotions");
  });

  it("includes engagement category", () => {
    const cat = templateCategories.find((c) => c.id === "engagement");
    expect(cat?.name).toBe("Engagement");
  });

  it("includes question category", () => {
    const cat = templateCategories.find((c) => c.id === "question");
    expect(cat?.name).toBe("Questions");
  });

  it("includes educational category", () => {
    const cat = templateCategories.find((c) => c.id === "educational");
    expect(cat?.name).toBe("Educational");
  });

  it("includes personal category", () => {
    const cat = templateCategories.find((c) => c.id === "personal");
    expect(cat?.name).toBe("Personal");
  });

  it("includes event category", () => {
    const cat = templateCategories.find((c) => c.id === "event");
    expect(cat?.name).toBe("Events");
  });

  it("each category has id, name, and description", () => {
    for (const cat of templateCategories) {
      expect(cat.id).toBeTruthy();
      expect(cat.name).toBeTruthy();
      expect(cat.description).toBeTruthy();
    }
  });
});
