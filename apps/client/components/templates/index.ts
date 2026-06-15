/**
 * @file index.ts
 * @description Barrel exports for the client-app template system components and template engine types.
 * @layer infrastructure
 */
// Enhanced Template System Components
export { TemplateEditor } from "./TemplateEditor.js";
export { TemplateLibrary } from "./TemplateLibrary.js";
export { ABTestManager } from "./ABTestManager.js";
export { TemplateVersionControl } from "./TemplateVersionControl.js";

// Re-export template engine and types
export {
  templateEngine,
  type Template,
  type TemplateVariable,
  type TemplateContext,
  type TemplateVariant,
  type ABTestConfig,
  type TemplateCompilationResult,
} from "@/lib/templates/templateEngine";
