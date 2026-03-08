"use client";

/**
 * @file TemplateEditorToolbar.tsx
 * @description Header toolbar for the TemplateEditor, rendering the title, validation button,
 * cancel, and save actions.
 */

import React from "react";
import { Button } from "@packages/ui";
import { CheckCircle, Save } from "lucide-react";
import type { TemplateEditorToolbarProps } from "./templateEditorTypes";

export function TemplateEditorToolbar({
  template,
  formData,
  isSaving,
  onValidate,
  onCancel,
  onSave,
}: TemplateEditorToolbarProps) {
  return (
    <div className="flex items-center justify-between">
      <div>
        <h2 className="text-2xl font-bold">{template ? "Edit Template" : "Create Template"}</h2>
        <p className="text-muted-foreground">
          {template ? `Editing "${template.name}"` : "Create a new content template"}
        </p>
      </div>
      <div className="flex items-center space-x-2">
        <Button variant="outline" onClick={onValidate} className="flex items-center space-x-1">
          <CheckCircle className="h-4 w-4" />
          <span>Validate</span>
        </Button>
        <Button variant="outline" onClick={onCancel}>
          Cancel
        </Button>
        <Button
          onClick={onSave}
          disabled={isSaving || !formData.name?.trim() || !formData.content?.trim()}
          className="flex items-center space-x-1"
        >
          <Save className="h-4 w-4" />
          <span>{isSaving ? "Saving..." : "Save Template"}</span>
        </Button>
      </div>
    </div>
  );
}
