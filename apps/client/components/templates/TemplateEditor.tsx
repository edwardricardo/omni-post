"use client";

/**
 * @file TemplateEditor.tsx
 * @description Orchestrator component for the Handlebars template editor. Manages all state
 * (form data, editor mode, preview, compilation) and delegates rendering to
 * TemplateEditorToolbar, TemplateEditorSidebar, and TemplateEditorCanvas.
 */

import React, { useState, useCallback, useEffect, useMemo } from "react";
import { TooltipProvider } from "@packages/ui";
import {
  type Template,
  type TemplateContext,
  templateEngine,
  type TemplateCompilationResult,
} from "@/lib/templates/templateEngine";
import { useToast } from "@packages/ui";
import type {
  TemplateEditorProps,
  TemplateFormData,
  EditorMode,
  EditorTab,
} from "./templateEditorTypes";
import { DEFAULT_CATEGORIES, DEFAULT_PLATFORMS } from "./templateEditorTypes";
import { TemplateEditorToolbar } from "./TemplateEditorToolbar";
import { TemplateEditorSidebar } from "./TemplateEditorSidebar";
import { TemplateEditorCanvas } from "./TemplateEditorCanvas";

export function TemplateEditor({
  template,
  onSave,
  onCancel,
  availablePlatforms = DEFAULT_PLATFORMS,
  categories = DEFAULT_CATEGORIES,
}: TemplateEditorProps) {
  const { success, error } = useToast();

  // -- State ------------------------------------------------------------------

  const [formData, setFormData] = useState<TemplateFormData>({
    name: template?.name || "",
    description: template?.description || "",
    category: template?.category || "announcement",
    content: template?.content || "",
    platforms: template?.platforms || [],
    tags: template?.tags || [],
    variables: template?.variables || [],
    version: template?.version || 1,
  });

  const [activeTab, setActiveTab] = useState<EditorTab>("editor");
  const [editorMode, setEditorMode] = useState<EditorMode>("textarea");
  const [compilationResult, setCompilationResult] = useState<TemplateCompilationResult | null>(
    null
  );
  const [previewContext, setPreviewContext] = useState<TemplateContext>({});
  const [isSaving, setIsSaving] = useState(false);
  const [autoPreview, setAutoPreview] = useState(true);

  // -- Derived data -----------------------------------------------------------

  const extractedVariables = useMemo(() => {
    if (!formData.content) return [];
    return templateEngine.extractVariables(formData.content);
  }, [formData.content]);

  const documentation = useMemo(() => {
    if (!formData.content) return null;

    const tempTemplate: Template = {
      id: "temp",
      name: "temp",
      description: "",
      category: "announcement",
      content: formData.content,
      variables: extractedVariables,
      platforms: [],
    };

    return templateEngine.generateDocumentation(tempTemplate);
  }, [formData.content, extractedVariables]);

  // -- Callbacks (declared before effects that depend on them) -----------------

  const convertHtmlToPlainText = useCallback(
    (html: string) => {
      if (editorMode === "tiptap") {
        const tempDiv = document.createElement("div");
        tempDiv.innerHTML = html;
        let text = tempDiv.innerText || tempDiv.textContent || "";
        text = text.replace(/\n\s+/g, "\n");
        return text;
      }
      return html;
    },
    [editorMode]
  );

  const convertPlainTextToHtml = useCallback(
    (text: string) => {
      if (editorMode === "tiptap" && text) {
        const html = text
          .replace(/\n/g, "<br>")
          .replace(
            /\{\{([^}]+)\}\}/g,
            '<span data-handlebars-variable class="bg-blue-100 text-blue-800 px-1 rounded-sm font-mono text-sm">${{$1}}</span>'
          );
        return html;
      }
      return text;
    },
    [editorMode]
  );

  const handleContentChange = useCallback(
    (content: string) => {
      const processedContent = convertHtmlToPlainText(content);
      setFormData((prev) => ({ ...prev, content: processedContent }));
    },
    [convertHtmlToPlainText]
  );

  const handleMonacoContentChange = useCallback(
    (value: string | undefined) => {
      if (value !== undefined) {
        handleContentChange(value);
      }
    },
    [handleContentChange]
  );

  const handleVariableInsert = useCallback(
    (variable: string) => {
      const cursorPosition = formData.content?.length || 0;
      const newContent =
        (formData.content?.slice(0, cursorPosition) || "") +
        `{{${variable}}}` +
        (formData.content?.slice(cursorPosition) || "");
      handleContentChange(newContent);
    },
    [formData.content, handleContentChange]
  );

  const handlePreview = useCallback(() => {
    if (!formData.content) {
      setCompilationResult(null);
      return;
    }

    const tempTemplate: Template = {
      id: template?.id || "temp",
      name: formData.name || "Preview",
      description: formData.description || "",
      category: formData.category || "announcement",
      content: formData.content,
      variables: extractedVariables,
      platforms: formData.platforms || [],
      tags: formData.tags || [],
      version: formData.version || 1,
    };

    const result = templateEngine.preview(tempTemplate, previewContext);
    setCompilationResult(result);
  }, [formData, extractedVariables, previewContext, template?.id]);

  const handleValidate = useCallback(() => {
    if (!formData.content) return;

    const validation = templateEngine.validateTemplate(formData.content);

    if (validation.valid) {
      success({ description: "Template syntax is valid!" });
    } else {
      error({
        description: `Template validation failed: ${validation.errors.join(", ")}`,
      });
    }
  }, [formData.content, success, error]);

  const handleSave = useCallback(async () => {
    if (!formData.name?.trim() || !formData.content?.trim()) {
      error({ description: "Template name and content are required" });
      return;
    }

    const validation = templateEngine.validateTemplate(formData.content);
    if (!validation.valid) {
      error({
        description: `Cannot save template with syntax errors: ${validation.errors.join(", ")}`,
      });
      return;
    }

    setIsSaving(true);
    try {
      const templateToSave: Template = {
        id: template?.id || `template-${Date.now()}`,
        name: formData.name!,
        description: formData.description || "",
        category: formData.category || "announcement",
        content: formData.content!,
        variables: extractedVariables,
        platforms: formData.platforms || [],
        tags: formData.tags || [],
        version: (template?.version || 0) + 1,
        updatedAt: new Date(),
        ...(!template && { createdAt: new Date() }),
      };

      await onSave(templateToSave);
      success({ description: "Template saved successfully!" });
    } catch (err) {
      error({
        description: `Failed to save template: ${err instanceof Error ? err.message : "Unknown error"}`,
      });
    } finally {
      setIsSaving(false);
    }
  }, [formData, extractedVariables, template, onSave, success, error]);

  const handleCopyToClipboard = useCallback(async () => {
    if (compilationResult?.content) {
      try {
        await navigator.clipboard.writeText(compilationResult.content);
        success({ description: "Content copied to clipboard!" });
      } catch {
        error({ description: "Failed to copy to clipboard" });
      }
    }
  }, [compilationResult?.content, success, error]);

  const generateSampleContext = useCallback(() => {
    const sampleContext: TemplateContext = {
      username: "johndoe",
      date: new Date(),
      hashtags: ["innovation", "productivity", "growth"],
      platforms: ["twitter", "linkedin"],
      premium: true,
      productName: "Amazing Product",
      companyName: "Tech Innovations Inc.",
      price: "$99",
      discount: "20%",
      eventName: "Tech Conference 2024",
      eventDate: "March 15, 2024",
    };

    setPreviewContext(sampleContext);
    if (autoPreview) {
      handlePreview();
    }
  }, [autoPreview, handlePreview]);

  // -- Effects ----------------------------------------------------------------

  useEffect(() => {
    setFormData((prev) => ({
      ...prev,
      variables: extractedVariables,
    }));
  }, [extractedVariables]);

  useEffect(() => {
    if (autoPreview && formData.content) {
      handlePreview();
    }
  }, [formData.content, previewContext, autoPreview, handlePreview]);

  // -- Render -----------------------------------------------------------------

  return (
    <TooltipProvider>
      <div className="space-y-6">
        <TemplateEditorToolbar
          {...(template !== undefined && { template })}
          formData={formData}
          isSaving={isSaving}
          onValidate={handleValidate}
          onCancel={onCancel}
          onSave={handleSave}
        />

        <TemplateEditorSidebar
          formData={formData}
          availablePlatforms={availablePlatforms}
          categories={categories}
          onFormDataChange={setFormData}
        />

        <TemplateEditorCanvas
          formData={formData}
          activeTab={activeTab}
          editorMode={editorMode}
          autoPreview={autoPreview}
          extractedVariables={extractedVariables}
          compilationResult={compilationResult}
          previewContext={previewContext}
          documentation={documentation}
          onContentChange={handleContentChange}
          onMonacoContentChange={handleMonacoContentChange}
          onVariableInsert={handleVariableInsert}
          onPreview={handlePreview}
          onGenerateSampleContext={generateSampleContext}
          onCopyToClipboard={handleCopyToClipboard}
          onTabChange={setActiveTab}
          onEditorModeChange={setEditorMode}
          onAutoPreviewChange={setAutoPreview}
          onPreviewContextChange={setPreviewContext}
          convertPlainTextToHtml={convertPlainTextToHtml}
        />
      </div>
    </TooltipProvider>
  );
}
