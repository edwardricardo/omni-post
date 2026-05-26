/**
 * @file types.ts
 * @description Input and output DTOs for AI Prompt Template use cases.
 * @layer application
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

export interface ListAIPromptTemplatesInput {
  accountId?: string;
}

export interface CreateAIPromptTemplateInput {
  accountId: string;
  name: string;
  category: string;
  platforms: string[];
  prompt: string;
  variables: TemplateVariableDto[];
  tone: string[];
}

export interface UpdateAIPromptTemplateInput {
  templateId: string;
  name?: string;
  category?: string;
  platforms?: string[];
  prompt?: string;
  variables?: TemplateVariableDto[];
  tone?: string[];
}

export interface DeleteAIPromptTemplateInput {
  templateId: string;
  accountId: string;
}

export interface CreateAIPromptTemplateOutput {
  id: string;
}
