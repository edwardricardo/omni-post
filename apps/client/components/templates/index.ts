// Enhanced Template System Components
export { TemplateEditor } from "./TemplateEditor";
export { TemplateLibrary } from "./TemplateLibrary";
export { ABTestManager } from "./ABTestManager";
export { TemplateVersionControl } from "./TemplateVersionControl";

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
