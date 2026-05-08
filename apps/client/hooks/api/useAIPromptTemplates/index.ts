/**
 * @file index.ts
 * @description Barrel export for the AI prompt templates hook module —
 *              preserves the public import path
 *              `@/hooks/api/useAIPromptTemplates` after the file split.
 * @layer infrastructure
 */

export type {
  AIPromptTemplateDto,
  CreateTemplateInput,
  TemplateVariableDto,
  UpdateTemplateInput,
} from "./types";

export { useAIPromptTemplates } from "./queries";

export {
  useCreateAIPromptTemplate,
  useDeleteAIPromptTemplate,
  useUpdateAIPromptTemplate,
} from "./mutations";
