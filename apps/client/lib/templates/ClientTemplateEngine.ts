/**
 * @file ClientTemplateEngine.ts
 * @description Client-side template engine extending BaseTemplateEngine with API-based template
 *              loading, browser-only preview, documentation generation, and context enrichment.
 *              All API calls route through the canonical proxy `request<T>` helper so the
 *              `/api/backend` prefix and httpOnly session cookie are applied consistently.
 * @layer infrastructure
 */

import { format } from "date-fns";
import {
  BaseTemplateEngine,
  Template,
  TemplateVariable,
  TemplateContext,
  TemplateCompilationResult,
} from "@shared/types";
import { request, PROXY_BASE } from "@/lib/api/clients/request";
import { ApiError } from "@packages/api-errors";

export class ClientTemplateEngine extends BaseTemplateEngine {
  private apiBaseUrl: string;

  constructor(apiBaseUrl: string = PROXY_BASE) {
    super();
    this.apiBaseUrl = apiBaseUrl;
  }

  /**
   * 🌐 Client-only: Enrich context with default values and computed properties
   */
  enrichContext(context: TemplateContext): TemplateContext {
    return {
      // Current date/time
      date: context.date || new Date(),

      // Default platform if not specified
      platforms: context.platforms || ["twitter", "linkedin", "facebook"],

      // Default premium status
      premium: context.premium || false,

      // Computed properties
      currentYear: new Date().getFullYear(),
      currentMonth: format(new Date(), "MMMM"),
      currentDay: format(new Date(), "dd"),

      // User-provided context
      ...context,
    };
  }

  /**
   * 🌐 Client-only: Preview template with sample data
   */
  preview(template: Template, sampleData?: Partial<TemplateContext>): TemplateCompilationResult {
    const defaultSampleData: TemplateContext = {
      username: "johndoe",
      date: new Date(),
      hashtags: ["productivity", "innovation", "growth"],
      platforms: ["twitter", "linkedin"],
      premium: true,
      productName: "Amazing Product",
      companyName: "Tech Innovations Inc.",
      price: "$99",
      discount: "20%",
      ...sampleData,
    };

    return this.render(template.content, defaultSampleData);
  }

  /**
   * 🌐 Client-only: Compile template with enriched context
   */
  compileWithEnrichedContext(
    template: Template,
    context: TemplateContext
  ): TemplateCompilationResult {
    const enrichedContext = this.enrichContext(context);
    return this.render(template.content, enrichedContext);
  }

  /**
   * 🌐 Client-only: Extract variables from template content
   */
  extractVariables(templateContent: string): TemplateVariable[] {
    const usedVariables = this.extractUsedVariables(templateContent);

    return usedVariables.map((name) => ({
      name,
      type: "string", // Default type
      required: true,
    }));
  }

  /**
   * 🌐 Client-only: Generate template documentation
   */
  generateDocumentation(template: Template): {
    variables: TemplateVariable[];
    helpers: string[];
    examples: { variable: string; example: string }[];
  } {
    const variables = this.extractVariables(template.content);
    const helpers = this.getRegisteredHelpers();

    const examples: { variable: string; example: string }[] = variables.map((variable) => ({
      variable: variable.name,
      example: this.generateExampleValue(variable),
    }));

    return {
      variables,
      helpers,
      examples,
    };
  }

  /**
   * 🌐 Client-only: Generate example value for variable
   */
  private generateExampleValue(variable: TemplateVariable): string {
    switch (variable.type) {
      case "string":
        return `"Example ${variable.name}"`;
      case "number":
        return "42";
      case "boolean":
        return "true";
      case "date":
        return new Date().toISOString();
      case "array":
        return '["item1", "item2", "item3"]';
      case "object":
        return '{"key": "value"}';
      default:
        return `"${variable.name}"`;
    }
  }

  /**
   * 🌐 Client-only: Validate template (wrapper around base validate)
   * Accepts either a Template object or template content string
   */
  validateTemplate(template: Template | string) {
    const content = typeof template === "string" ? template : template.content;
    return this.validate(content);
  }

  // ===== Abstract Method Implementations (API-based) =====
  // These methods satisfy the BaseTemplateEngine abstract contract. Production
  // template list/CRUD is performed via the `useTemplates` hook (TanStack
  // Query); these direct fetch paths exist only for non-React consumers.

  async loadTemplates(filter?: { category?: string; tags?: string[] }): Promise<Template[]> {
    const params = new URLSearchParams();
    if (filter?.category) {
      params.append("category", filter.category);
    }
    if (filter?.tags && filter.tags.length > 0) {
      filter.tags.forEach((tag) => params.append("tags", tag));
    }
    const qs = params.toString();
    const path = qs ? `/templates?${qs}` : "/templates";
    const data = await request<{ templates?: Template[] }>(this.apiBaseUrl, path);
    return data.templates ?? [];
  }

  async loadTemplate(id: string): Promise<Template | null> {
    try {
      const data = await request<{ template?: Template }>(this.apiBaseUrl, `/templates/${id}`);
      return data.template ?? null;
    } catch (error) {
      if (error instanceof ApiError && error.status === 404) {
        return null;
      }
      throw error;
    }
  }

  async saveTemplate(template: Template): Promise<Template> {
    const method = template.id ? "PUT" : "POST";
    const path = template.id ? `/templates/${template.id}` : "/templates";
    const data = await request<{ template: Template }>(this.apiBaseUrl, path, {
      method,
      body: JSON.stringify(template),
    });
    return data.template;
  }

  async deleteTemplate(id: string): Promise<boolean> {
    await request<void>(this.apiBaseUrl, `/templates/${id}`, { method: "DELETE" });
    return true;
  }
}

// Export singleton instance with default API base URL
export const clientTemplateEngine = new ClientTemplateEngine();
