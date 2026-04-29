/**
 * @file types.ts
 * @description Public types for the AI prompt template hook module.
 * @layer infrastructure
 */

export interface TemplateVariableDto {
  name: string;
  type: "text" | "select" | "date" | "url";
  label: string;
  placeholder: string;
  required: boolean;
  options?: string[];
}

export interface AIPromptTemplateDto {
  id: string;
  accountId: string | null;
  name: string;
  category: string;
  platforms: string[];
  prompt: string;
  variables: TemplateVariableDto[];
  tone: string[];
  isSystem: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CreateTemplateInput {
  accountId: string;
  name: string;
  category: string;
  platforms: string[];
  prompt: string;
  variables: TemplateVariableDto[];
  tone: string[];
}

export interface UpdateTemplateInput {
  templateId: string;
  name?: string;
  category?: string;
  platforms?: string[];
  prompt?: string;
  variables?: TemplateVariableDto[];
  tone?: string[];
}
