/**
 * @file index.ts
 * @description Barrel file exporting all content template sub-components, types, and
 * hooks for use in the ContentTemplates page component.
 * @layer infrastructure
 */

export { TemplatesHeader } from "./TemplatesHeader";
export { TemplatesTabs } from "./TemplatesTabs";
export { TemplateFilters } from "./TemplateFilters";
export { TemplateGrid } from "./TemplateGrid";
export { AutomationList } from "./AutomationList";
export { TemplateVariableModal } from "./TemplateVariableModal";
export { TemplatesLoadingSkeleton } from "./TemplatesLoadingSkeleton";
export { useTemplateData } from "./useTemplateData";
export * from "./types";
