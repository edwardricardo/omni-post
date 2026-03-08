/**
 * Template System Types
 *
 * Type definitions for the template system that are safe to import
 * in both client and server environments (no server-only dependencies).
 */

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
  product?: {
    name?: string;
    price?: string;
    features?: string[];
    [key: string]: unknown;
  };
  campaign?: {
    name?: string;
    startDate?: Date;
    endDate?: Date;
    [key: string]: unknown;
  };
  platforms?: string[];
  hashtags?: string[];
  mentions?: string[];
  date?: Date;
  premium?: boolean;

  // Dynamic properties
  [key: string]: unknown;
}

export interface TemplateCompilationResult {
  success: boolean;
  output?: string;
  error?: string;
  variables?: string[];
}

export interface ValidationResult {
  valid: boolean;
  errors: string[];
}
