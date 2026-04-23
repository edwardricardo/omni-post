/**
 * @file BaseTemplateEngine.ts
 * @description Shared Handlebars-based template compilation engine with date-fns formatters,
 *              variable validation, and common helpers used by client and admin apps.
 * @layer domain
 */

import Handlebars from "handlebars";
import { format, parseISO, isValid } from "date-fns";

// ===== Shared Types =====

export interface TemplateVariable {
  name: string;
  type: "string" | "number" | "boolean" | "date" | "array" | "object";
  description?: string;
  required?: boolean;
  defaultValue?: unknown;
  options?: string[];
}

export interface TemplateVariant {
  id: string;
  name: string;
  content: string;
  weight?: number;
}

export interface Template {
  id: string;
  name: string;
  description?: string;
  category: string;
  content: string;
  variables: TemplateVariable[];
  platforms: string[];
  variants?: TemplateVariant[];
  tags?: string[];
  version?: number;
  createdAt?: Date;
  updatedAt?: Date;
}

export interface TemplateContext {
  user?: {
    name?: string;
    username?: string;
    company?: string;
    [key: string]: unknown;
  };
  content?: {
    title?: string;
    description?: string;
    url?: string;
    tags?: string[];
    [key: string]: unknown;
  };
  platform?: {
    name: string;
    [key: string]: unknown;
  };
  schedule?: {
    publishDate?: Date;
    timezone?: string;
    [key: string]: unknown;
  };
  project?: {
    id: string;
    name: string;
    [key: string]: unknown;
  };
  // Common variables
  username?: string;
  date?: string | Date;
  hashtags?: string[];
  platforms?: string[];
  premium?: boolean;
  [key: string]: unknown;
}

export interface TemplateCompilationResult {
  success: boolean;
  content?: string;
  errors?: string[];
  warnings?: string[];
  usedVariables?: string[];
  missingVariables?: string[];
  metadata?: {
    templateId: string;
    variantId?: string;
    compiledAt: Date;
    characterCount: number;
    wordCount: number;
    hashtagCount: number;
    mentionCount: number;
    urlCount: number;
  };
}

export interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

// ===== Base Template Engine =====

export abstract class BaseTemplateEngine {
  protected handlebars: typeof Handlebars;
  protected registeredHelpers: Set<string> = new Set();

  constructor() {
    this.handlebars = Handlebars.create();
    this.registerCommonHelpers();
    this.registerPlatformHelpers();
  }

  /**
   * ✅ Shared: Register common Handlebars helpers
   * These helpers are identical across server and client
   */
  protected registerCommonHelpers(): void {
    // Date formatting helper
    this.handlebars.registerHelper("formatDate", (date: string | Date, formatStr?: string) => {
      try {
        const dateObj = typeof date === "string" ? parseISO(date) : date;
        if (!isValid(dateObj)) {
          return date?.toString() || "";
        }
        return format(dateObj, formatStr || "MMM dd, yyyy");
      } catch {
        return date?.toString() || "";
      }
    });
    this.registeredHelpers.add("formatDate");

    // String manipulation helpers
    this.handlebars.registerHelper("uppercase", (str: string) => str?.toUpperCase() || "");
    this.registeredHelpers.add("uppercase");

    this.handlebars.registerHelper("lowercase", (str: string) => str?.toLowerCase() || "");
    this.registeredHelpers.add("lowercase");

    this.handlebars.registerHelper("capitalize", (str: string) => {
      if (!str) return "";
      return str.charAt(0).toUpperCase() + str.slice(1);
    });
    this.registeredHelpers.add("capitalize");

    this.handlebars.registerHelper("truncate", (str: string, length: number) => {
      if (!str) return "";
      return str.length > length ? str.substring(0, length) + "..." : str;
    });
    this.registeredHelpers.add("truncate");

    // Array helpers
    this.handlebars.registerHelper("join", (array: unknown[], separator: string = ", ") => {
      if (!Array.isArray(array)) return "";
      return array.join(separator);
    });
    this.registeredHelpers.add("join");

    this.handlebars.registerHelper("length", (array: unknown[] | string) => {
      if (Array.isArray(array)) return array.length;
      if (typeof array === "string") return array.length;
      return 0;
    });
    this.registeredHelpers.add("length");

    // Conditional helpers
    this.handlebars.registerHelper("eq", (a: unknown, b: unknown) => a === b);
    this.registeredHelpers.add("eq");

    this.handlebars.registerHelper("ne", (a: unknown, b: unknown) => a !== b);
    this.registeredHelpers.add("ne");

    this.handlebars.registerHelper("gt", (a: number, b: number) => a > b);
    this.registeredHelpers.add("gt");

    this.handlebars.registerHelper("lt", (a: number, b: number) => a < b);
    this.registeredHelpers.add("lt");

    this.handlebars.registerHelper("gte", (a: number, b: number) => a >= b);
    this.registeredHelpers.add("gte");

    this.handlebars.registerHelper("lte", (a: number, b: number) => a <= b);
    this.registeredHelpers.add("lte");

    this.handlebars.registerHelper("and", (...args: unknown[]) => {
      const values = args.slice(0, -1);
      return values.every(Boolean);
    });
    this.registeredHelpers.add("and");

    this.handlebars.registerHelper("or", (...args: unknown[]) => {
      const values = args.slice(0, -1);
      return values.some(Boolean);
    });
    this.registeredHelpers.add("or");

    this.handlebars.registerHelper("not", (value: unknown) => !value);
    this.registeredHelpers.add("not");

    // Math helpers
    this.handlebars.registerHelper("add", (a: number, b: number) => (a || 0) + (b || 0));
    this.registeredHelpers.add("add");

    this.handlebars.registerHelper("subtract", (a: number, b: number) => (a || 0) - (b || 0));
    this.registeredHelpers.add("subtract");

    this.handlebars.registerHelper("multiply", (a: number, b: number) => (a || 0) * (b || 0));
    this.registeredHelpers.add("multiply");

    this.handlebars.registerHelper("divide", (a: number, b: number) =>
      b !== 0 ? (a || 0) / b : 0
    );
    this.registeredHelpers.add("divide");

    this.handlebars.registerHelper("modulo", (a: number, b: number) =>
      b !== 0 ? (a || 0) % b : 0
    );
    this.registeredHelpers.add("modulo");

    // Random choice helper for A/B testing
    this.handlebars.registerHelper("random", (...args: unknown[]) => {
      const choices = args.slice(0, -1);
      if (choices.length === 0) return "";
      const randomIndex = Math.floor(Math.random() * choices.length);
      return choices[randomIndex];
    });
    this.registeredHelpers.add("random");

    // Default value helper
    this.handlebars.registerHelper("default", (value: unknown, defaultValue: unknown) => {
      return value ?? defaultValue;
    });
    this.registeredHelpers.add("default");
  }

  /**
   * ✅ Shared: Register platform-specific helpers
   */
  protected registerPlatformHelpers(): void {
    // Character limit helper
    this.handlebars.registerHelper("characterLimit", (platform: string) => {
      const limits: Record<string, number> = {
        twitter: 280,
        x: 280,
        instagram: 2200,
        linkedin: 3000,
        facebook: 63206,
        tiktok: 150,
        youtube: 5000,
      };
      return limits[platform.toLowerCase()] || 280;
    });
    this.registeredHelpers.add("characterLimit");

    // Hashtag helper
    this.handlebars.registerHelper("hashtag", (tag: string) => {
      if (!tag) return "";
      return tag.startsWith("#") ? tag : `#${tag}`;
    });
    this.registeredHelpers.add("hashtag");

    // Mention helper
    this.handlebars.registerHelper("mention", (username: string, _platform?: string) => {
      if (!username) return "";
      const cleanUsername = username.startsWith("@") ? username.substring(1) : username;
      return `@${cleanUsername}`;
    });
    this.registeredHelpers.add("mention");

    // URL/Link helper
    this.handlebars.registerHelper("link", (url: string, text?: string) => {
      if (!url) return "";
      return text ? `[${text}](${url})` : url;
    });
    this.registeredHelpers.add("link");

    // Platform-specific formatting
    this.handlebars.registerHelper("platformText", (text: string, platform: string) => {
      if (!text) return "";

      const platformLower = platform.toLowerCase();

      // Remove markdown formatting for platforms that don't support it
      if (platformLower === "x" || platformLower === "twitter" || platformLower === "instagram") {
        return text.replace(/\*\*(.*?)\*\*/g, "$1").replace(/\*(.*?)\*/g, "$1");
      }

      return text;
    });
    this.registeredHelpers.add("platformText");
  }

  /**
   * ✅ Shared: Register custom helper
   */
  registerHelper(name: string, helper: Handlebars.HelperDelegate): void {
    this.handlebars.registerHelper(name, helper);
    this.registeredHelpers.add(name);
  }

  /**
   * ✅ Shared: Get all registered helpers
   */
  getRegisteredHelpers(): string[] {
    return Array.from(this.registeredHelpers);
  }

  /**
   * ✅ Shared: Compile template
   */
  compile(templateContent: string): Handlebars.TemplateDelegate {
    return this.handlebars.compile(templateContent);
  }

  /**
   * ✅ Shared: Render template with context
   */
  render(templateContent: string, context: TemplateContext): TemplateCompilationResult {
    try {
      const template = this.compile(templateContent);
      const content = template(context);

      // Calculate metadata
      const characterCount = content.length;
      const wordCount = content.split(/\s+/).filter(Boolean).length;
      const hashtagCount = (content.match(/#\w+/g) || []).length;
      const mentionCount = (content.match(/@\w+/g) || []).length;
      const urlCount = (content.match(/https?:\/\/\S+/g) || []).length;

      // Detect used variables
      const usedVariables = this.extractUsedVariables(templateContent);
      const missingVariables = usedVariables.filter((v) => !(v in context));

      return {
        success: true,
        content,
        usedVariables,
        missingVariables,
        warnings:
          missingVariables.length > 0 ? [`Missing variables: ${missingVariables.join(", ")}`] : [],
        metadata: {
          templateId: (context.templateId as string) || "unknown",
          compiledAt: new Date(),
          characterCount,
          wordCount,
          hashtagCount,
          mentionCount,
          urlCount,
        },
      };
    } catch (error) {
      return {
        success: false,
        errors: [error instanceof Error ? error.message : "Template compilation failed"],
      };
    }
  }

  /**
   * ✅ Shared: Validate template syntax
   */
  validate(templateContent: string): ValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];

    // Check for unclosed tags
    const openTags = (templateContent.match(/\{\{/g) || []).length;
    const closeTags = (templateContent.match(/\}\}/g) || []).length;
    if (openTags !== closeTags) {
      errors.push("Unclosed Handlebars tags detected");
    }

    // Try to compile
    try {
      this.compile(templateContent);
    } catch (error) {
      errors.push(error instanceof Error ? error.message : "Template compilation failed");
    }

    // Check for undefined helpers
    const helperMatches = templateContent.match(/\{\{#?(\w+)/g) || [];
    const usedHelpers = helperMatches.map((m) => m.replace(/\{\{#?/, ""));
    const undefinedHelpers = usedHelpers.filter(
      (h) =>
        !this.registeredHelpers.has(h) &&
        ![
          "if",
          "unless",
          "each",
          "with",
          "lookup",
          "log",
          "blockHelperMissing",
          "helperMissing",
        ].includes(h)
    );

    if (undefinedHelpers.length > 0) {
      warnings.push(`Potentially undefined helpers: ${[...new Set(undefinedHelpers)].join(", ")}`);
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings: warnings.length > 0 ? warnings : [],
    };
  }

  /**
   * ✅ Shared: Extract variables from template
   */
  protected extractUsedVariables(templateContent: string): string[] {
    const variableMatches = templateContent.match(/\{\{(?!#|\/|!)([\w.]+)(?:\s|}})/g) || [];
    const variables = variableMatches
      .map((match) => {
        const cleaned = match.replace(/\{\{/, "").replace(/\s.*/, "").replace(/}}/, "");
        const rootVar = cleaned.split(".")[0];
        return rootVar || "";
      })
      .filter((v): v is string => v !== "");
    return [...new Set(variables)];
  }

  /**
   * ✅ Shared: Check if template has variants
   */
  hasVariants(template: Template): boolean {
    return !!template.variants && template.variants.length > 0;
  }

  /**
   * ✅ Shared: Select variant for A/B testing
   */
  selectVariant(template: Template, trafficSplit?: number[]): TemplateVariant {
    if (!template.variants || template.variants.length === 0) {
      return { id: "default", name: "default", content: template.content };
    }

    // If no traffic split provided, use equal distribution
    const splits = trafficSplit || template.variants.map(() => 100 / template.variants!.length);

    // Generate random number 0-100
    const random = Math.random() * 100;

    // Find which variant this falls into
    let cumulative = 0;
    for (let i = 0; i < template.variants.length; i++) {
      cumulative += splits[i] || 0;
      if (random <= cumulative) {
        return template.variants[i]!;
      }
    }

    // Fallback to first variant
    return template.variants[0]!;
  }

  // ===== Abstract Methods (to be implemented by server/client) =====

  /**
   * Load templates from storage (DB for server, API for client)
   */
  abstract loadTemplates(filter?: { category?: string; tags?: string[] }): Promise<Template[]>;

  /**
   * Load single template by ID
   */
  abstract loadTemplate(id: string): Promise<Template | null>;

  /**
   * Save template (create or update)
   */
  abstract saveTemplate(template: Template): Promise<Template>;

  /**
   * Delete template
   */
  abstract deleteTemplate(id: string): Promise<boolean>;
}
