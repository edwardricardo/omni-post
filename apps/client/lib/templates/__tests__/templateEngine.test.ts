import { describe, it, expect, beforeEach } from "vitest";
import { ClientTemplateEngine } from "../ClientTemplateEngine";
import type { Template, TemplateContext } from "@shared/types";

describe("ClientTemplateEngine", () => {
  let engine: ClientTemplateEngine;

  beforeEach(() => {
    engine = new ClientTemplateEngine();
  });

  describe("Variable Extraction", () => {
    it("should extract simple variables", () => {
      const content = "Hello {{username}}, welcome to {{platform}}!";
      const variables = engine.extractVariables(content);

      expect(variables).toHaveLength(2);
      expect(variables.map((v) => v.name)).toEqual(["username", "platform"]);
      expect(variables[0].type).toBe("string");
    });

    it("should extract complex variables with dot notation as root", () => {
      const content = "User: {{user.name}}, Email: {{user.email}}";
      const variables = engine.extractVariables(content);

      expect(variables).toHaveLength(1);
      expect(variables[0].name).toBe("user");
    });

    it("should ignore block helper syntax", () => {
      // Block helpers like #if, #each are excluded by the regex
      const content = "{{#if premium}}Content: {{username}}{{/if}}";
      const variables = engine.extractVariables(content);

      // The regex excludes {{#if and {{/if but extracts {{username}}
      expect(variables.map((v) => v.name)).toContain("username");
      // Block helper names with # prefix are excluded
      expect(variables.map((v) => v.name)).not.toContain("if");
    });
  });

  describe("Template Validation", () => {
    it("should validate correct template syntax", () => {
      const content = "{{#if premium}}{{username}}{{/if}}";
      const result = engine.validateTemplate(content);

      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it("should detect unmatched brackets", () => {
      const content = "Hello {{username";
      const result = engine.validateTemplate(content);

      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
    });

    it("should detect mismatched brackets", () => {
      // The validator checks for matching {{ and }} pairs
      const content = "{{#if premium}}Premium content{{/if";
      const result = engine.validateTemplate(content);

      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
    });

    it("should accept Template object as input", () => {
      const template: Template = {
        id: "test",
        name: "Test",
        category: "test",
        content: "Hello {{username}}",
        variables: [],
        platforms: ["twitter"],
      };

      const result = engine.validateTemplate(template);
      expect(result.valid).toBe(true);
    });
  });

  describe("Template Rendering", () => {
    let template: Template;

    beforeEach(() => {
      template = {
        id: "test-template",
        name: "Test Template",
        description: "A test template",
        category: "test",
        content: "Hello {{username}}! {{#if premium}}You are a premium user.{{/if}}",
        variables: [
          { name: "username", type: "string", required: true },
          { name: "premium", type: "boolean", required: false },
        ],
        platforms: ["twitter"],
      };
    });

    it("should render template with basic variables", () => {
      const context: TemplateContext = {
        username: "John Doe",
        premium: true,
      };

      const result = engine.render(template.content, context);

      expect(result.success).toBe(true);
      expect(result.content).toBe("Hello John Doe! You are a premium user.");
    });

    it("should handle missing optional variables", () => {
      const context: TemplateContext = {
        username: "John Doe",
      };

      const result = engine.render(template.content, context);

      expect(result.success).toBe(true);
      expect(result.content).toBe("Hello John Doe! ");
    });

    it("should report missing variables in warnings", () => {
      const context: TemplateContext = {
        premium: true,
      };

      const result = engine.render(template.content, context);

      expect(result.success).toBe(true);
      expect(result.warnings).toBeDefined();
      expect(result.warnings!.some((w) => w.includes("username"))).toBe(true);
    });

    it("should handle compilation errors gracefully", () => {
      const result = engine.render("{{#if}}Invalid syntax{{/if}}", {});

      expect(result.success).toBe(false);
      expect(result.errors).toBeDefined();
    });
  });

  describe("Helper Functions", () => {
    it("should format dates correctly", () => {
      const content = 'Today is {{formatDate date "MMM dd, yyyy"}}';
      const context: TemplateContext = { date: new Date("2023-12-25T00:00:00.000Z") };

      const result = engine.render(content, context);

      expect(result.success).toBe(true);
      // Allow for timezone differences
      expect(result.content).toMatch(/Today is Dec (24|25), 2023/);
    });

    it("should transform text case", () => {
      const content = "{{uppercase name}} vs {{lowercase name}} vs {{capitalize name}}";
      const context: TemplateContext = { name: "john doe" };

      const result = engine.render(content, context);

      expect(result.success).toBe(true);
      expect(result.content).toBe("JOHN DOE vs john doe vs John doe");
    });

    it("should join arrays correctly", () => {
      const content = '{{join hashtags ", "}}';
      const context: TemplateContext = { hashtags: ["tech", "innovation", "startup"] };

      const result = engine.render(content, context);

      expect(result.success).toBe(true);
      expect(result.content).toBe("tech, innovation, startup");
    });

    it("should handle array length", () => {
      const content = "You have {{length hashtags}} tags";
      const context: TemplateContext = { hashtags: ["tag1", "tag2", "tag3"] };

      const result = engine.render(content, context);

      expect(result.success).toBe(true);
      expect(result.content).toBe("You have 3 tags");
    });

    it("should add hashtag prefix", () => {
      const content = '{{hashtag "productivity"}} {{hashtag "#innovation"}}';

      const result = engine.render(content, {});

      expect(result.success).toBe(true);
      expect(result.content).toBe("#productivity #innovation");
    });

    it("should perform math operations", () => {
      const content = "{{add 5 3}} {{subtract 10 4}} {{multiply 6 7}} {{divide 20 4}}";

      const result = engine.render(content, {});

      expect(result.success).toBe(true);
      expect(result.content).toBe("8 6 42 5");
    });

    it("should handle conditional comparisons", () => {
      const content = '{{#if (eq provider "twitter")}}Twitter{{else}}Other{{/if}}';
      const context: TemplateContext = { provider: "twitter" };

      const result = engine.render(content, context);

      expect(result.success).toBe(true);
      expect(result.content).toBe("Twitter");
    });

    it("should handle loops with context", () => {
      const content = "{{#each items}}{{@index}}: {{this}} {{/each}}";
      const context: TemplateContext = { items: ["first", "second", "third"] };

      const result = engine.render(content, context);

      expect(result.success).toBe(true);
      expect(result.content).toBe("0: first 1: second 2: third ");
    });
  });

  describe("A/B Testing", () => {
    let template: Template;

    beforeEach(() => {
      template = {
        id: "ab-test-template",
        name: "A/B Test Template",
        description: "Template for A/B testing",
        category: "test",
        content: "Base content {{username}}",
        variables: [{ name: "username", type: "string", required: true }],
        platforms: ["twitter"],
        variants: [
          { id: "variant-a", name: "Variant A", content: "Variant A: Hello {{username}}!" },
          { id: "variant-b", name: "Variant B", content: "Variant B: Hi {{username}}!" },
        ],
      };
    });

    it("should render base content when no variant selected", () => {
      const context: TemplateContext = { username: "John" };

      const result = engine.render(template.content, context);

      expect(result.success).toBe(true);
      expect(result.content).toBe("Base content John");
    });

    it("should select and render a variant", () => {
      const context: TemplateContext = { username: "John" };

      const variant = engine.selectVariant(template);
      const result = engine.render(variant.content, context);

      expect(result.success).toBe(true);
      expect(result.content).toMatch(/^Variant [AB]: (Hello|Hi) John!$/);
    });

    it("should respect traffic split", () => {
      const context: TemplateContext = { username: "John" };

      // Run multiple times with 100/0 split
      for (let i = 0; i < 10; i++) {
        const variant = engine.selectVariant(template, [100, 0]);
        const result = engine.render(variant.content, context);
        expect(variant.id).toBe("variant-a");
        expect(result.content).toBe("Variant A: Hello John!");
      }
    });

    it("should check if template has variants", () => {
      expect(engine.hasVariants(template)).toBe(true);

      const noVariants: Template = {
        ...template,
        variants: undefined,
      };
      expect(engine.hasVariants(noVariants)).toBe(false);
    });
  });

  describe("Context Enrichment", () => {
    it("should provide default context values", () => {
      const template: Template = {
        id: "context-test",
        name: "Context Test",
        category: "test",
        content: "Year: {{currentYear}}, Month: {{currentMonth}}",
        variables: [],
        platforms: ["twitter"],
      };

      const enriched = engine.enrichContext({});
      const result = engine.render(template.content, enriched);

      expect(result.success).toBe(true);
      expect(result.content).toMatch(/Year: \d{4}, Month: \w+/);
    });

    it("should merge user context with defaults", () => {
      const enriched = engine.enrichContext({ username: "Alice" });
      const result = engine.render("Welcome {{username}}, it is {{currentYear}}", enriched);

      expect(result.success).toBe(true);
      expect(result.content).toMatch(/Welcome Alice, it is \d{4}/);
    });
  });

  describe("Preview Mode", () => {
    let template: Template;

    beforeEach(() => {
      template = {
        id: "preview-test",
        name: "Preview Test",
        description: "Testing preview mode",
        category: "test",
        content: "Hello {{username}}, price: {{price}}",
        variables: [
          { name: "username", type: "string", required: true },
          { name: "price", type: "string", required: true },
        ],
        platforms: ["twitter"],
      };
    });

    it("should generate preview with sample data", () => {
      const result = engine.preview(template);

      expect(result.success).toBe(true);
      expect(result.content).toBe("Hello johndoe, price: $99");
    });

    it("should use custom sample data when provided", () => {
      const sampleData = { username: "Alice", price: "$150" };
      const result = engine.preview(template, sampleData);

      expect(result.success).toBe(true);
      expect(result.content).toBe("Hello Alice, price: $150");
    });
  });

  describe("Documentation Generation", () => {
    let template: Template;

    beforeEach(() => {
      template = {
        id: "doc-test",
        name: "Documentation Test",
        description: "Testing documentation generation",
        category: "test",
        content: "Hello {{username}}, count: {{count}}, active: {{active}}",
        variables: [],
        platforms: ["twitter"],
      };
    });

    it("should generate comprehensive documentation", () => {
      const docs = engine.generateDocumentation(template);

      expect(docs.variables).toHaveLength(3);
      expect(docs.variables.map((v) => v.name)).toEqual(["username", "count", "active"]);
      expect(docs.helpers.length).toBeGreaterThan(10);
      expect(docs.examples).toHaveLength(3);
    });

    it("should provide example values for each variable", () => {
      const docs = engine.generateDocumentation(template);

      const exampleMap = docs.examples.reduce(
        (acc, example) => {
          acc[example.variable] = example.example;
          return acc;
        },
        {} as Record<string, string>
      );

      // All variables default to "string" type, so examples contain the variable name
      expect(exampleMap.username).toContain("username");
      expect(exampleMap.count).toContain("count");
      expect(exampleMap.active).toContain("active");
    });
  });

  describe("Custom Helpers", () => {
    it("should allow registering custom helpers", () => {
      engine.registerHelper("reverse", (str: string) => str.split("").reverse().join(""));

      const result = engine.render("Reversed: {{reverse text}}", { text: "hello" });

      expect(result.success).toBe(true);
      expect(result.content).toBe("Reversed: olleh");
    });

    it("should list registered helpers", () => {
      const helpers = engine.getRegisteredHelpers();

      expect(helpers).toContain("formatDate");
      expect(helpers).toContain("uppercase");
      expect(helpers).toContain("join");
      expect(helpers.length).toBeGreaterThan(10);
    });
  });

  describe("Error Handling", () => {
    it("should handle malformed templates gracefully", () => {
      const result = engine.render("{{#invalid syntax}}", {});

      expect(result.success).toBe(false);
      expect(result.errors).toBeDefined();
      expect(result.errors!.length).toBeGreaterThan(0);
    });

    it("should handle runtime errors in helpers", () => {
      const result = engine.render("{{divide 10 0}}", {});

      expect(result.success).toBe(true);
      expect(result.content).toBe("0"); // Division by zero returns 0
    });
  });
});
