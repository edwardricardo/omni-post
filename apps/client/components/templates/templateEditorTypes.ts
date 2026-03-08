/**
 * @file templateEditorTypes.ts
 * @description Shared types and constants used by the TemplateEditor component and
 * its sub-components (toolbar, canvas, sidebar).
 */

import type {
  Template,
  TemplateContext,
  TemplateCompilationResult,
} from "@/lib/templates/templateEngine";

export type EditorMode = "textarea" | "monaco" | "tiptap";
export type EditorTab = "editor" | "preview" | "variables" | "docs";

export interface TemplateEditorProps {
  template?: Template;
  onSave: (template: Template) => Promise<void>;
  onCancel: () => void;
  availablePlatforms?: string[];
  categories?: Array<{ id: string; name: string; description: string }>;
}

export interface TemplateFormData extends Partial<Template> {}

export interface TemplateEditorToolbarProps {
  template?: Template;
  formData: TemplateFormData;
  isSaving: boolean;
  onValidate: () => void;
  onCancel: () => void;
  onSave: () => void;
}

export interface TemplateEditorCanvasProps {
  formData: TemplateFormData;
  activeTab: EditorTab;
  editorMode: EditorMode;
  autoPreview: boolean;
  extractedVariables: Template["variables"];
  compilationResult: TemplateCompilationResult | null;
  previewContext: TemplateContext;
  documentation: ReturnType<
    typeof import("@/lib/templates/templateEngine").templateEngine.generateDocumentation
  > | null;
  onContentChange: (content: string) => void;
  onMonacoContentChange: (value: string | undefined) => void;
  onVariableInsert: (variable: string) => void;
  onPreview: () => void;
  onGenerateSampleContext: () => void;
  onCopyToClipboard: () => void;
  onTabChange: (tab: EditorTab) => void;
  onEditorModeChange: (mode: EditorMode) => void;
  onAutoPreviewChange: (value: boolean) => void;
  onPreviewContextChange: (context: TemplateContext) => void;
  convertPlainTextToHtml: (text: string) => string;
}

export interface TemplateEditorSidebarProps {
  formData: TemplateFormData;
  availablePlatforms: string[];
  categories: Array<{ id: string; name: string; description: string }>;
  onFormDataChange: (updater: (prev: TemplateFormData) => TemplateFormData) => void;
}

export const DEFAULT_CATEGORIES = [
  { id: "announcement", name: "Announcements", description: "Product launches, company news" },
  { id: "promotion", name: "Promotions", description: "Sales, offers, discounts" },
  { id: "engagement", name: "Engagement", description: "Community posts, questions" },
  { id: "educational", name: "Educational", description: "Tips, tutorials, guides" },
];

export const DEFAULT_PLATFORMS = ["twitter", "linkedin", "instagram", "facebook", "tiktok"];
