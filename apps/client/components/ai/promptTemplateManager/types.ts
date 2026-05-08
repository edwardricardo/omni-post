/**
 * @file types.ts
 * @description Local form state + constants used by the prompt-template
 *              manager sub-components. The DTO types
 *              (`AIPromptTemplateDto`, `CreateTemplateInput`,
 *              `TemplateVariableDto`) live next to the API hook in
 *              `hooks/api/useAIPromptTemplates`.
 * @layer infrastructure
 */

export interface CreateFormState {
  name: string;
  category: string;
  platforms: string[];
  prompt: string;
  tone: string;
}

export const EMPTY_FORM: CreateFormState = {
  name: "",
  category: "Custom",
  platforms: [],
  prompt: "",
  tone: "",
};

export const AVAILABLE_PLATFORMS = [
  "twitter",
  "instagram",
  "facebook",
  "linkedin",
  "tiktok",
  "youtube",
  "pinterest",
  "snapchat",
  "telegram",
] as const;
